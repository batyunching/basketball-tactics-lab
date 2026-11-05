import type { Detection } from './types';

/**
 * YOLOX（Apache-2.0）ONNX 模型的前處理與後處理。
 * 前處理：等比例縮放、左上對齊、以 114 補邊；BGR、0～255、CHW（不做正規化）。
 * 後處理：依 stride 8/16/32 的格點解碼、objectness × class、NMS。
 */
export const YOLOX_INPUT = 416;
export const COCO_PERSON = 0;
/** COCO 類別 32：sports ball（籃球在畫面中常太小，模型不一定偵測得到） */
export const COCO_SPORTS_BALL = 32;

export interface Letterbox {
  scale: number;
  size: number;
}

export function letterbox(srcW: number, srcH: number, size = YOLOX_INPUT): Letterbox & { w: number; h: number } {
  const scale = Math.min(size / srcW, size / srcH);
  return { scale, size, w: Math.round(srcW * scale), h: Math.round(srcH * scale) };
}

/** RGBA（已縮放並放在左上角的 size×size 畫布）→ BGR CHW Float32 */
export function rgbaToBgrChw(rgba: Uint8ClampedArray | Uint8Array, size = YOLOX_INPUT): Float32Array {
  const area = size * size;
  const out = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    out[i] = rgba[i * 4 + 2]!; // B
    out[area + i] = rgba[i * 4 + 1]!; // G
    out[2 * area + i] = rgba[i * 4]!; // R
  }
  return out;
}

export function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function nms(dets: Detection[], iouThreshold = 0.45): Detection[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score);
  const keep: Detection[] = [];
  for (const d of sorted) if (keep.every((k) => iou(k, d) < iouThreshold)) keep.push(d);
  return keep;
}

/**
 * 解碼 YOLOX 原始輸出 [N, 85]，回傳原圖像素座標的「人」框
 * @param minScore 低於此分數直接丟棄（追蹤器會再分高、低信心兩段使用）
 */
export function decodeYolox(raw: Float32Array, lb: Letterbox, opts: { minScore?: number; classId?: number; numClasses?: number } = {}): Detection[] {
  const minScore = opts.minScore ?? 0.1;
  const cls = opts.classId ?? COCO_PERSON;
  const nc = opts.numClasses ?? 80;
  const stride = 5 + nc;
  const dets: Detection[] = [];
  let idx = 0;
  for (const s of [8, 16, 32]) {
    const g = lb.size / s;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, idx++) {
        const o = idx * stride;
        const score = raw[o + 4]! * raw[o + 5 + cls]!;
        if (score < minScore) continue;
        const cx = (raw[o]! + gx) * s;
        const cy = (raw[o + 1]! + gy) * s;
        const w = Math.exp(raw[o + 2]!) * s;
        const h = Math.exp(raw[o + 3]!) * s;
        dets.push({ x: (cx - w / 2) / lb.scale, y: (cy - h / 2) / lb.scale, w: w / lb.scale, h: h / lb.scale, score });
      }
    }
  }
  return nms(dets);
}

/** 依影片大小過濾不合理的框（太小、太扁） */
export function plausiblePeople(dets: Detection[], frameW: number, frameH: number): Detection[] {
  const minH = frameH * 0.03;
  return dets.filter((d) => d.h >= minH && d.h > d.w * 0.8 && d.w < frameW * 0.5);
}
