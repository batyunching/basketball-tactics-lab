import type { Lesson } from '@btl/shared-types';
import { lessonSchema } from '@btl/data-schemas';

/**
 * 自訂教材（由影片轉換）放進本機連結：JSON → deflate 壓縮 → base64url。
 * 解碼時一律以 lessonSchema 驗證（連結內容不可信任）。
 */
const MAX_JSON_BYTES = 400_000;

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) throw new Error('教材資料過大');
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function encodeLesson(lesson: Lesson): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(lesson));
  return toB64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeLesson(data: string): Promise<Lesson | null> {
  try {
    const json = await pipe(fromB64Url(data), new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
    const r = lessonSchema.safeParse(JSON.parse(new TextDecoder().decode(json)));
    return r.success ? (r.data as Lesson) : null;
  } catch {
    return null;
  }
}
