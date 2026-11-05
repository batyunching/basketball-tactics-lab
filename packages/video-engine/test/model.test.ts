import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import { describe, expect, it } from 'vitest';
import { YOLOX_INPUT, decodeYolox, letterbox, rgbaToBgrChw } from '../src';

/**
 * 以真實 YOLOX-Tiny 模型、真實照片（NASA 太空人公有領域照片）驗證前處理＋解碼流程，
 * 確保瀏覽器端用的同一套程式能正確找出「人」。
 */
const root = join(import.meta.dirname, '..', '..', '..');

function resizeBilinear(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      for (let c = 0; c < 3; c++) {
        const v = (src[(y0 * sw + x0) * 3 + c]! * (1 - wx) + src[(y0 * sw + x1) * 3 + c]! * wx) * (1 - wy) + (src[(y1 * sw + x0) * 3 + c]! * (1 - wx) + src[(y1 * sw + x1) * 3 + c]! * wx) * wy;
        out[(y * dw + x) * 3 + c] = Math.round(v);
      }
    }
  }
  return out;
}

describe('YOLOX-Tiny 真實模型推論', () => {
  it('在照片中找到人，框的位置合理', async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync(join(root, 'apps/web/public/models/yolox_tiny.onnx')));
    const W = 256;
    const H = 256;
    const rgb = new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures/astronaut-256.rgb')));
    const lb = letterbox(W, H);
    const scaled = resizeBilinear(rgb, W, H, lb.w, lb.h);
    const rgba = new Uint8Array(YOLOX_INPUT * YOLOX_INPUT * 4).fill(114);
    for (let y = 0; y < lb.h; y++) for (let x = 0; x < lb.w; x++) for (let c = 0; c < 3; c++) rgba[(y * YOLOX_INPUT + x) * 4 + c] = scaled[(y * lb.w + x) * 3 + c]!;
    const input = new ort.Tensor('float32', rgbaToBgrChw(rgba), [1, 3, YOLOX_INPUT, YOLOX_INPUT]);
    const out = await session.run({ [session.inputNames[0]!]: input });
    const raw = out[session.outputNames[0]!]!.data as Float32Array;
    const dets = decodeYolox(raw, lb, { minScore: 0.3 });
    expect(dets.length).toBeGreaterThanOrEqual(1);
    const best = dets[0]!;
    expect(best.score).toBeGreaterThan(0.7);
    // 太空人佔畫面左側大部分：中心約在 (93, 130)，高度超過畫面一半
    expect(best.x + best.w / 2).toBeGreaterThan(50);
    expect(best.x + best.w / 2).toBeLessThan(140);
    expect(best.h).toBeGreaterThan(H * 0.5);
  });
});
