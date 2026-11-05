import type { FrameDetections, VideoAsset } from '@btl/video-engine';
import { YOLOX_INPUT, classifyTeamColor, decodeYolox, letterbox, plausiblePeople, rgbaToBgrChw, torsoRegion } from '@btl/video-engine';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';

export const MODEL_VERSION = 'yolox-tiny-416@0.1.1rc0';
const MODEL_URL = `${import.meta.env.BASE_URL}models/yolox_tiny.onnx`;

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

let ortP: Promise<Ort> | null = null;
let sessionP: Promise<Session> | null = null;

/** 第一次使用時才下載模型（約 20MB，之後由瀏覽器快取） */
async function getSession(): Promise<{ ort: Ort; session: Session }> {
  ortP ??= import('onnxruntime-web/wasm').then((ort) => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
    // GitHub Pages 沒有跨來源隔離，無法使用多執行緒
    ort.env.wasm.numThreads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    return ort;
  });
  const ort = await ortP;
  sessionP ??= ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }).catch((err) => {
    sessionP = null;
    throw err;
  });
  return { ort, session: await sessionP };
}

function seek(video: HTMLVideoElement, sec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('影片無法跳轉到指定時間'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = sec;
  });
}

export function loadVideoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('瀏覽器無法讀取這支影片（格式或編碼不支援）'));
  });
}

export interface AnalyzeOptions {
  fps: number;
  onProgress?: (done: number, total: number, last: FrameDetections) => void;
  signal?: AbortSignal;
}

/**
 * 在瀏覽器中逐格偵測球員：每秒取 fps 張畫面，用 YOLOX 找人，
 * 再取上半身顏色判斷紅／藍隊。影片不會離開這台電腦。
 */
export async function detectPlayers(videoUrl: string, asset: VideoAsset, opts: AnalyzeOptions): Promise<FrameDetections[]> {
  const { ort, session } = await getSession();
  const video = await loadVideoElement(videoUrl);
  const W = video.videoWidth;
  const H = video.videoHeight;
  const lb = letterbox(W, H);
  const input = document.createElement('canvas');
  input.width = YOLOX_INPUT;
  input.height = YOLOX_INPUT;
  const ictx = input.getContext('2d', { willReadFrequently: true })!;
  // 取色用的畫面（最大寬 960，節省記憶體）
  const cs = Math.min(1, 960 / W);
  const color = document.createElement('canvas');
  color.width = Math.round(W * cs);
  color.height = Math.round(H * cs);
  const cctx = color.getContext('2d', { willReadFrequently: true })!;

  const step = 1000 / opts.fps;
  const times: number[] = [];
  for (let t = asset.trimStartMs; t <= asset.trimEndMs + 1; t += step) times.push(Math.round(t));
  const frames: FrameDetections[] = [];
  for (let i = 0; i < times.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('已取消', 'AbortError');
    const t = times[i]!;
    await seek(video, Math.min(t / 1000, Math.max(0, video.duration - 0.001)));
    ictx.fillStyle = 'rgb(114,114,114)';
    ictx.fillRect(0, 0, YOLOX_INPUT, YOLOX_INPUT);
    ictx.drawImage(video, 0, 0, lb.w, lb.h);
    const rgba = ictx.getImageData(0, 0, YOLOX_INPUT, YOLOX_INPUT).data;
    const tensor = new ort.Tensor('float32', rgbaToBgrChw(rgba), [1, 3, YOLOX_INPUT, YOLOX_INPUT]);
    const out = await session.run({ [session.inputNames[0]!]: tensor });
    const raw = out[session.outputNames[0]!]!.data as Float32Array;
    const people = plausiblePeople(decodeYolox(raw, lb, { minScore: 0.15 }), W, H);
    cctx.drawImage(video, 0, 0, color.width, color.height);
    const boxes = people.map((d) => {
      const r = torsoRegion(d);
      const x = Math.max(0, Math.floor(r.x * cs));
      const y = Math.max(0, Math.floor(r.y * cs));
      const w = Math.max(1, Math.min(color.width - x, Math.ceil(r.w * cs)));
      const h = Math.max(1, Math.min(color.height - y, Math.ceil(r.h * cs)));
      const px = cctx.getImageData(x, y, w, h).data;
      return { ...d, color: classifyTeamColor(px) };
    });
    const frame = { timeMs: t, boxes };
    frames.push(frame);
    opts.onProgress?.(i + 1, times.length, frame);
    // 讓畫面有機會更新
    await new Promise((r) => setTimeout(r, 0));
  }
  video.removeAttribute('src');
  video.load();
  return frames;
}

/** 讀取影片基本資料（長度、解析度） */
export async function probeVideo(file: Blob): Promise<{ durationMs: number; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const v = await new Promise<HTMLVideoElement>((resolve, reject) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      el.src = url;
      el.onloadedmetadata = () => resolve(el);
      el.onerror = () => reject(new Error('瀏覽器無法讀取這支影片（格式或編碼不支援，建議用 H.264 MP4）'));
    });
    if (!Number.isFinite(v.duration) || v.duration <= 0) throw new Error('無法取得影片長度');
    return { durationMs: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
