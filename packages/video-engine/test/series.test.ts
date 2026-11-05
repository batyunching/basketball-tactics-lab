import { describe, expect, it } from 'vitest';
import { createProject } from '@btl/tactic-engine';
import type { Track, TrackPoint } from '../src';
import { buildPlayerSamples, positionAt, projectTracks, qualityReport, sampleTimes, trajectoriesToTactic } from '../src';

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // 影像座標＝球場座標（測試用）
const players = createProject({ teamSize: 3 }).players.filter((p) => p.slot < 3);

function pt(t: number, x: number, y: number, extra: Partial<TrackPoint> = {}): TrackPoint {
  // 腳底點 = (x, y)：框寬 0.6、高 1.8
  return { timeMs: t, box: { x: x - 0.3, y: y - 1.8, w: 0.6, h: 1.8 }, court: null, detectionConfidence: 0.9, color: { team: 'red', confidence: 0.9 }, source: 'observed', flags: [], ...extra };
}

describe('軌跡換算與不確定標記', () => {
  it('腳底點換算球場座標；場外、低信心、重疊、隊色不明都會標記', () => {
    const tracks: Track[] = [
      { trackId: 'T1', team: 'red', teamConfidence: 0.9, points: [pt(0, 20, 5), pt(200, 20, 5, { detectionConfidence: 0.3 }), pt(400, 5, 5)] },
      { trackId: 'T2', team: 'blue', teamConfidence: 0.9, points: [pt(0, 20.1, 5, { color: { team: 'unknown', confidence: 0 } })] },
    ];
    const [a, b] = projectTracks(tracks, I);
    expect(a!.points[0]!.court).toEqual({ x: 20, y: 5 });
    expect(a!.points[0]!.flags).toContain('overlap');
    expect(a!.points[1]!.flags).toContain('low-confidence');
    expect(a!.points[2]!.flags).toContain('out-of-court');
    expect(b!.points[0]!.flags).toEqual(expect.arrayContaining(['overlap', 'team-uncertain']));
    expect(projectTracks(tracks, null)[0]!.points[0]!.flags).toContain('no-calibration');
  });
});

describe('球員軌跡樣本（計畫書欄位）', () => {
  const tracks = projectTracks(
    [
      { trackId: 'T1', team: 'red', teamConfidence: 0.9, points: [pt(0, 20, 5), pt(200, 20.5, 5), pt(400, 21, 5)] },
      { trackId: 'T7', team: 'red', teamConfidence: 0.9, points: [pt(1400, 23, 5), pt(1600, 23.5, 5)] },
    ],
    I,
  );

  it('只輸出老師指派過的軌跡；追蹤 id 不會自動當成背號', () => {
    const none = buildPlayerSamples({ tracks, assignments: {}, reviews: {}, keyframes: [], players, times: sampleTimes(0, 1600, 5), toleranceMs: 50 });
    expect(Object.keys(none)).toHaveLength(0);
  });

  it('同一人可由多條軌跡拼接，中間空白以內插補上並標記', () => {
    const s = buildPlayerSamples({ tracks, assignments: { T1: 'red-1', T7: 'red-1' }, reviews: { T1: 'confirmed' }, keyframes: [], players, times: sampleTimes(0, 1600, 5), toleranceMs: 50 })['red-1']!;
    expect(s).toHaveLength(9);
    const first = s[0]!;
    expect(first).toMatchObject({ trackId: 'T1', playerId: 'red-1', team: 'red', jerseyNumber: 1, positionSource: 'observed', reviewStatus: 'confirmed', identityConfidence: 0.9 });
    expect(first.courtPosition).toEqual({ x: 20, y: 5 });
    const mid = s.find((x) => x.timeMs === 800)!;
    expect(mid.positionSource).toBe('interpolated');
    expect(mid.flags).toContain('interpolated');
    expect(mid.courtPosition.x).toBeCloseTo(21.8, 2);
    expect(s.find((x) => x.timeMs === 1400)!.reviewStatus).toBe('unreviewed');
  });

  it('人工關鍵影格優先於自動偵測，信心為 1', () => {
    const s = buildPlayerSamples({
      tracks,
      assignments: { T1: 'red-1' },
      reviews: {},
      keyframes: [{ id: 'k', timeMs: 200, players: { 'red-1': { x: 25, y: 7 } } }],
      players,
      times: [0, 200, 400],
      toleranceMs: 50,
    })['red-1']!;
    expect(s[1]).toMatchObject({ positionSource: 'manual', identityConfidence: 1, courtPosition: { x: 25, y: 7 } });
  });

  it('自動追蹤失敗時，只用人工關鍵影格也能產生軌跡', () => {
    const s = buildPlayerSamples({
      tracks: [],
      assignments: {},
      reviews: {},
      keyframes: [
        { id: 'a', timeMs: 0, players: { 'blue-2': { x: 20, y: 3 } } },
        { id: 'b', timeMs: 2000, players: { 'blue-2': { x: 24, y: 3 } } },
      ],
      players,
      times: sampleTimes(0, 2000, 2),
      toleranceMs: 50,
    })['blue-2']!;
    expect(s.map((x) => x.positionSource)).toEqual(['manual', 'interpolated', 'interpolated', 'interpolated', 'manual']);
    expect(positionAt(s, 1000)!.courtPosition.x).toBeCloseTo(22);
  });

  it('間隔超過 3 秒不內插（避免捏造位置）', () => {
    const s = buildPlayerSamples({
      tracks: [],
      assignments: {},
      reviews: {},
      keyframes: [
        { id: 'a', timeMs: 0, players: { 'red-2': { x: 20, y: 3 } } },
        { id: 'b', timeMs: 5000, players: { 'red-2': { x: 24, y: 3 } } },
      ],
      players,
      times: [0, 2500, 5000],
      toleranceMs: 50,
    })['red-2']!;
    expect(s.map((x) => x.timeMs)).toEqual([0, 5000]);
  });

  it('品質報告：覆蓋率與片段數', () => {
    const times = sampleTimes(0, 1600, 5);
    const assignments = { T1: 'red-1', T7: 'red-1' };
    const samples = buildPlayerSamples({ tracks, assignments, reviews: {}, keyframes: [], players, times, toleranceMs: 50 });
    const q = qualityReport([{ boxes: [1, 2] }, { boxes: [1] }], tracks, assignments, samples, times.length);
    expect(q).toMatchObject({ frames: 2, detectionsPerFrame: 1.5, tracks: 2, assignedTracks: 2, fragments: { 'red-1': 2 } });
    expect(q.coverage['red-1']).toBe(1);
  });
});

describe('影片軌跡 → 戰術動畫', () => {
  it('以關鍵影格為步驟，位置與持球者正確', () => {
    const keyframes = [
      { id: 'a', timeMs: 0, players: { 'red-1': { x: 20, y: 7.5 } }, holderId: 'red-1' },
      { id: 'b', timeMs: 1500, players: { 'red-1': { x: 24, y: 6 } }, holderId: 'red-2' },
    ];
    const samples = buildPlayerSamples({ tracks: [], assignments: {}, reviews: {}, keyframes, players, times: sampleTimes(0, 1500, 10), toleranceMs: 20 });
    const p = trajectoriesToTactic({ title: '影片重建', teamSize: 3, samples, keyframes, startMs: 0, endMs: 1500 });
    expect(p.steps).toHaveLength(2);
    expect(p.steps[1]!.players['red-1']).toEqual({ x: 24, y: 6 });
    expect(p.steps[1]!.ball.holderId).toBe('red-2');
    expect(p.steps[1]!.durationMs).toBe(1500);
  });
});

import { clampTrim, defaultTrim, estimateAnalysisSec, formatClipTime, recommendedFps, validateVideoFile } from '../src';

describe('影片管理規則', () => {
  it('格式與大小驗證', () => {
    expect(validateVideoFile({ type: 'video/mp4', size: 10, name: 'a.mp4' })).toBeNull();
    expect(validateVideoFile({ type: '', size: 10, name: 'clip.MOV' })).toBeNull();
    expect(validateVideoFile({ type: 'image/png', size: 10, name: 'a.png' })).toMatch(/MP4/);
    expect(validateVideoFile({ type: 'video/mp4', size: 1100 * 1024 * 1024, name: 'a.mp4' })).toMatch(/1GB/);
  });
  it('片段長度限制 10 秒～3 分鐘', () => {
    expect(defaultTrim(45_000)).toEqual({ trimStartMs: 0, trimEndMs: 45_000 });
    expect(defaultTrim(300_000)).toEqual({ trimStartMs: 0, trimEndMs: 180_000 });
    expect(clampTrim(0, 250_000, 300_000)).toEqual({ trimStartMs: 0, trimEndMs: 180_000 });
    expect(clampTrim(5_000, 8_000, 60_000)).toEqual({ trimStartMs: 5_000, trimEndMs: 15_000 });
    expect(clampTrim(0, 50_000, 60_000)).toEqual({ trimStartMs: 0, trimEndMs: 50_000 });
    expect(clampTrim(58_000, 60_000, 60_000)).toEqual({ trimStartMs: 50_000, trimEndMs: 60_000 });
    expect(clampTrim(0, 3_000, 6_000)).toEqual({ trimStartMs: 0, trimEndMs: 6_000 });
  });
});

describe('長片段（最長 3 分鐘）', () => {
  it('依長度建議取樣張數與預估時間', () => {
    expect(recommendedFps(20_000)).toBe(5);
    expect(recommendedFps(60_000)).toBe(3);
    expect(recommendedFps(180_000)).toBe(2);
    expect(estimateAnalysisSec(180_000, 2)).toBe(108);
    expect(formatClipTime(12_300)).toBe('12.3 秒');
    expect(formatClipTime(65_000)).toBe('1:05.0');
  });
  it('3 分鐘片段轉戰術約 30 步', () => {
    const keyframes = [{ id: 'a', timeMs: 0, players: { 'red-1': { x: 20, y: 7.5 } } }];
    const samples = buildPlayerSamples({ tracks: [], assignments: {}, reviews: {}, keyframes, players, times: [0], toleranceMs: 20 });
    const p = trajectoriesToTactic({ title: 't', teamSize: 3, samples, keyframes, startMs: 0, endMs: 180_000 });
    expect(p.steps.length).toBeLessThanOrEqual(31);
    expect(p.steps.length).toBeGreaterThanOrEqual(25);
  });
});

describe('效能：3 分鐘 × 每秒 10 張', () => {
  it('六名球員的軌跡在 300ms 內計算完成', () => {
    const times = sampleTimes(0, 180_000, 10);
    const mk = (id: string, dx: number): Track => ({
      trackId: id,
      team: 'red',
      teamConfidence: 0.9,
      points: times.map((t) => pt(t, 15 + dx * 0.3 + (t / 180_000) * 10, 2 + dx)),
    });
    const tracks = projectTracks(['A', 'B', 'C', 'D', 'E', 'F'].map((id, i) => mk(id, i * 1.5)), I);
    const assignments = { A: 'red-1', B: 'red-2', C: 'red-3', D: 'blue-1', E: 'blue-2', F: 'blue-3' };
    const t0 = performance.now();
    const s = buildPlayerSamples({ tracks, assignments, reviews: {}, keyframes: [], players, times, toleranceMs: 50 });
    const ms = performance.now() - t0;
    expect(s['blue-3']).toHaveLength(times.length);
    expect(ms).toBeLessThan(300);
  });
});
