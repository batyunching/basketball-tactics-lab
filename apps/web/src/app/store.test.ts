import { beforeEach, describe, expect, it } from 'vitest';
import { addStep, createProject, movePlayer, passBall, totalDuration } from '@btl/tactic-engine';
import { useStore } from './store';

function reset() {
  let p = createProject();
  for (let i = 0; i < 5; i++) p = addStep(p, i);
  useStore.getState().loadProject(p);
  useStore.setState({ playback: { timeMs: null, playing: false, speed: 1, loop: false, stopAtMs: null } });
}

describe('store：復原／重做與手勢', () => {
  beforeEach(reset);

  it('commit 後可復原、重做', () => {
    const s = useStore.getState();
    const before = s.history.present;
    s.commit((p) => movePlayer(p, 0, 'red-1', { x: 20, y: 3 }));
    expect(useStore.getState().history.present.steps[0]!.players['red-1']).toEqual({ x: 20, y: 3 });
    useStore.getState().undo();
    expect(useStore.getState().history.present).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().history.present.steps[0]!.players['red-1']).toEqual({ x: 20, y: 3 });
  });

  it('拖曳期間的多次更新只產生一筆復原紀錄', () => {
    const s = useStore.getState();
    s.beginGesture();
    for (let i = 0; i < 30; i++) useStore.getState().gestureUpdate((p) => movePlayer(p, 0, 'red-2', { x: 20 + i * 0.1, y: 4 }));
    useStore.getState().endGesture();
    expect(useStore.getState().history.past).toHaveLength(1);
  });

  it('沒有變更的 commit 不進入歷史', () => {
    useStore.getState().commit((p) => p);
    expect(useStore.getState().history.past).toHaveLength(0);
  });
});

describe('store：播放', () => {
  beforeEach(reset);

  it('播放到結尾後回到最後一步', () => {
    const s = useStore.getState();
    s.play();
    const total = totalDuration(useStore.getState().history.present.steps);
    useStore.getState().tick(total + 10);
    const st = useStore.getState();
    expect(st.playback.timeMs).toBeNull();
    expect(st.currentStep).toBe(5);
  });

  it('0.5 倍速時時間前進一半', () => {
    const s = useStore.getState();
    s.setSpeed(0.5);
    s.play();
    useStore.getState().tick(1000);
    expect(useStore.getState().playback.timeMs).toBe(500);
  });

  it('循環播放會回到開頭', () => {
    const s = useStore.getState();
    s.toggleLoop();
    s.play();
    const total = totalDuration(useStore.getState().history.present.steps);
    useStore.getState().tick(total + 300);
    expect(useStore.getState().playback.playing).toBe(true);
    expect(useStore.getState().playback.timeMs).toBe(300);
  });

  it('下一步只播一段並停在下一步；上一步直接跳回', () => {
    const s = useStore.getState();
    s.setCurrentStep(2);
    useStore.getState().nextStep();
    expect(useStore.getState().playback.playing).toBe(true);
    useStore.getState().tick(5000);
    expect(useStore.getState().currentStep).toBe(3);
    expect(useStore.getState().playback.timeMs).toBeNull();
    useStore.getState().prevStep();
    expect(useStore.getState().currentStep).toBe(2);
  });

  it('暫停保留時間點，回到編輯時跳到最近的步驟', () => {
    const s = useStore.getState();
    s.play();
    useStore.getState().tick(1200);
    useStore.getState().pause();
    expect(useStore.getState().playback.timeMs).toBe(1200);
    useStore.getState().exitPlayback();
    expect(useStore.getState().currentStep).toBe(1);
  });

  it('只有一步時無法播放並提示', () => {
    useStore.getState().loadProject(createProject());
    useStore.getState().play();
    expect(useStore.getState().playback.playing).toBe(false);
    expect(useStore.getState().toast?.text).toMatch(/兩個步驟/);
  });

  it('復原會讓步驟索引保持有效', () => {
    useStore.getState().setCurrentStep(5);
    useStore.getState().commit((p) => passBall(addStep(p, 5), 6, 'red-2'));
    useStore.getState().setCurrentStep(6);
    useStore.getState().undo();
    expect(useStore.getState().currentStep).toBe(5);
  });
});
