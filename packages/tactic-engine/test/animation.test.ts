import { describe, expect, it } from 'vitest';
import {
  addStep,
  createProject,
  easeInOutCubic,
  frameAt,
  movePlayer,
  nextSpeed,
  passBall,
  segmentAt,
  shootBall,
  stepTimes,
  totalDuration,
  updateStepMeta,
} from '../src';

function sixStepProject() {
  let p = createProject();
  for (let i = 0; i < 5; i++) p = addStep(p, i);
  return p;
}

describe('時間軸', () => {
  it('六個步驟的到達時間正確累加', () => {
    let p = sixStepProject();
    p = updateStepMeta(p, 2, { durationMs: 500 });
    expect(p.steps).toHaveLength(6);
    expect(stepTimes(p.steps)).toEqual([0, 1500, 2000, 3500, 5000, 6500]);
    expect(totalDuration(p.steps)).toBe(6500);
  });

  it('segmentAt 回傳正確段落與進度', () => {
    const p = sixStepProject();
    expect(segmentAt(p.steps, 750)).toEqual({ fromIndex: 0, toIndex: 1, local: 0.5 });
    expect(segmentAt(p.steps, 99999)).toEqual({ fromIndex: 5, toIndex: 5, local: 0 });
    expect(segmentAt(p.steps, -1)).toEqual({ fromIndex: 0, toIndex: 0, local: 0 });
  });

  it('easing 起訖為 0、1 且中點為 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it('播放速度在 0.25～2 倍循環', () => {
    expect(nextSpeed(0.25)).toBe(0.5);
    expect(nextSpeed(2)).toBe(0.25);
  });
});

describe('frameAt 平滑插值', () => {
  it('球員在兩步之間平滑移動', () => {
    let p = createProject();
    p = addStep(p, 0);
    p = movePlayer(p, 0, 'red-2', { x: 20, y: 2 });
    p = movePlayer(p, 1, 'red-2', { x: 24, y: 2 });
    const mid = frameAt(p, 750);
    expect(mid.players['red-2']?.x).toBeCloseTo(22);
    expect(frameAt(p, 0).players['red-2']?.x).toBe(20);
    expect(frameAt(p, 1500).players['red-2']?.x).toBe(24);
  });

  it('傳球時球在空中由傳球者飛向接球者', () => {
    let p = createProject();
    p = addStep(p, 0);
    p = passBall(p, 1, 'red-2');
    expect(frameAt(p, 0).holderId).toBe('red-1');
    const mid = frameAt(p, 750);
    expect(mid.ballInFlight).toBe(true);
    expect(mid.holderId).toBeNull();
    const end = frameAt(p, 1500);
    expect(end.holderId).toBe('red-2');
    expect(end.ballPosition).toEqual({ x: p.steps[1]!.players['red-2']!.x, y: p.steps[1]!.players['red-2']!.y });
  });

  it('投籃時球最後落在籃框', () => {
    let p = createProject();
    p = addStep(p, 0);
    p = shootBall(p, 1);
    const end = frameAt(p, 1500);
    expect(end.ballPosition.x).toBeCloseTo(26.425);
    expect(end.ballPosition.y).toBeCloseTo(7.5);
  });

  it('持球者移動時球跟著走', () => {
    let p = createProject();
    p = addStep(p, 0);
    p = movePlayer(p, 1, 'red-1', { x: 24, y: 7.5 });
    const f = frameAt(p, 750, { x: 0.3, y: 0.3 });
    const h = f.players['red-1']!;
    expect(f.ballPosition.x).toBeCloseTo(h.x + 0.3);
    expect(f.ballInFlight).toBe(false);
  });
});
