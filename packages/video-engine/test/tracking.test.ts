import { describe, expect, it } from 'vitest';
import type { ColorGuess, FrameDetections } from '../src';
import { classifyTeamColor, iou, nms, rgbToHsv, runTracker, voteTeam } from '../src';

/** 演算法單元測試：以可控的偵測序列檢驗追蹤器（不是用來代表真實辨識效果） */
const red: ColorGuess = { team: 'red', confidence: 0.9 };
const blue: ColorGuess = { team: 'blue', confidence: 0.9 };

function frames(n: number, fps: number, fn: (i: number, t: number) => FrameDetections['boxes']): FrameDetections[] {
  return Array.from({ length: n }, (_, i) => ({ timeMs: Math.round((i * 1000) / fps), boxes: fn(i, (i * 1000) / fps) }));
}

describe('隊色判斷', () => {
  const fill = (r: number, g: number, b: number, n = 100) => {
    const a = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) a.set([r, g, b, 255], i * 4);
    return a;
  };
  it('紅、藍背心；白色、膚色為不明', () => {
    expect(classifyTeamColor(fill(200, 30, 40)).team).toBe('red');
    expect(classifyTeamColor(fill(30, 80, 210)).team).toBe('blue');
    expect(classifyTeamColor(fill(240, 240, 240)).team).toBe('unknown');
    expect(classifyTeamColor(fill(224, 172, 140)).team).toBe('unknown');
    expect(rgbToHsv(255, 0, 0)[0]).toBe(0);
  });
  it('混合像素：多數色勝出、信心隨比例下降', () => {
    const a = new Uint8Array([...fill(200, 30, 40, 60), ...fill(30, 80, 210, 20), ...fill(240, 240, 240, 20)]);
    const g = classifyTeamColor(a);
    expect(g.team).toBe('red');
    expect(g.confidence).toBeLessThan(0.9);
  });
});

describe('NMS／IoU', () => {
  it('重疊框只留分數最高者', () => {
    expect(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(1 / 3);
    const kept = nms([
      { x: 0, y: 0, w: 10, h: 20, score: 0.9 },
      { x: 1, y: 0, w: 10, h: 20, score: 0.8 },
      { x: 50, y: 0, w: 10, h: 20, score: 0.7 },
    ]);
    expect(kept.map((k) => k.score)).toEqual([0.9, 0.7]);
  });
});

describe('多目標追蹤', () => {
  it('三名球員移動：軌跡數正確、id 不跳號', () => {
    const fs = frames(30, 5, (i) => [
      { x: 100 + i * 8, y: 200, w: 30, h: 80, score: 0.9, color: red },
      { x: 400 - i * 6, y: 220, w: 30, h: 80, score: 0.85, color: blue },
      { x: 250, y: 100 + i * 4, w: 28, h: 75, score: 0.8, color: red },
    ]);
    const tracks = runTracker(fs);
    expect(tracks).toHaveLength(3);
    for (const t of tracks) expect(t.points.filter((p) => p.source === 'observed')).toHaveLength(30);
    expect(tracks.map((t) => t.team).sort()).toEqual(['blue', 'red', 'red']);
  });

  it('短暫漏偵測（遮擋）以推估補上並接回同一條軌跡', () => {
    const fs = frames(20, 5, (i) => (i === 8 || i === 9 ? [] : [{ x: 100 + i * 10, y: 200, w: 30, h: 80, score: 0.9, color: red }]));
    const tracks = runTracker(fs);
    expect(tracks).toHaveLength(1);
    const pts = tracks[0]!.points;
    expect(pts.filter((p) => p.source === 'predicted')).toHaveLength(2);
    expect(pts.find((p) => p.timeMs === 1600)!.box.x).toBeCloseTo(180, 0);
  });

  it('低信心偵測（被擋住一半）仍能延續既有軌跡，但不會產生新軌跡', () => {
    const fs = frames(10, 5, (i) => [{ x: 100 + i * 5, y: 200, w: 30, h: 80, score: i >= 4 && i <= 6 ? 0.3 : 0.9, color: red }, ...(i === 3 ? [{ x: 600, y: 50, w: 30, h: 80, score: 0.3, color: blue }] : [])]);
    const tracks = runTracker(fs);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.points.filter((p) => p.source === 'observed')).toHaveLength(10);
  });

  it('一閃而過的誤偵測（少於 3 次）不成為軌跡', () => {
    const fs = frames(10, 5, (i) => (i < 2 ? [{ x: 10, y: 10, w: 30, h: 80, score: 0.9, color: blue }] : []));
    expect(runTracker(fs)).toHaveLength(0);
  });

  it('低影格率大位移時改用距離配對', () => {
    const fs = frames(8, 2, (i) => [{ x: 100 + i * 35, y: 200, w: 30, h: 80, score: 0.9, color: red }]);
    expect(runTracker(fs)).toHaveLength(1);
  });

  it('隊色投票：混雜時標為不明', () => {
    const pts = [red, blue, red, blue].map((c, i) => ({ timeMs: i, box: { x: 0, y: 0, w: 1, h: 1 }, court: null, detectionConfidence: 0.9, color: c, source: 'observed' as const, flags: [] }));
    expect(voteTeam(pts).team).toBe('unknown');
  });
});
