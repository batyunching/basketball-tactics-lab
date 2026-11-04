import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { useStore } from './store';
import { IndexedDbRepository } from '../features/storage/db';
import { resetPersistenceForTests, setRepository } from '../features/storage/persistence';

let n = 0;
beforeEach(() => {
  setRepository(new IndexedDbRepository(`app-db-${++n}`));
  resetPersistenceForTests();
  useStore.setState({ saveStatus: 'loading', formations: [] });
});

const countPlayers = (team: 'red' | 'blue') => document.querySelectorAll(`[data-player-id^="${team}-"]`).length;

describe('App 介面', () => {
  it('預設 3v3 半場，可切換 1v1～5v5 與全場', async () => {
    render(<App />);
    await waitFor(() => expect(useStore.getState().saveStatus).toBe('saved'));
    expect(countPlayers('red')).toBe(3);
    expect(countPlayers('blue')).toBe(3);
    fireEvent.click(screen.getByRole('radio', { name: '5v5' }));
    expect(countPlayers('red')).toBe(5);
    fireEvent.click(screen.getByRole('radio', { name: '1v1' }));
    expect(countPlayers('blue')).toBe(1);
    fireEvent.click(screen.getByRole('radio', { name: /全場/ }));
    expect(screen.getByTestId('court').getAttribute('viewBox')).toMatch(/^-1\.2 -1\.2 30\.4/);
  });

  it('套用快速隊形 3 後切到 5v5，並可復原', async () => {
    render(<App />);
    await waitFor(() => expect(useStore.getState().saveStatus).toBe('saved'));
    fireEvent.click(screen.getByTestId('formation-quick-3'));
    expect(countPlayers('red')).toBe(5);
    fireEvent.click(screen.getByTestId('undo'));
    expect(countPlayers('red')).toBe(3);
  });

  it('點選球員顯示屬性並可設為持球', async () => {
    render(<App />);
    await waitFor(() => expect(useStore.getState().saveStatus).toBe('saved'));
    const blue2 = screen.getByTestId('player-blue-2');
    fireEvent.pointerDown(blue2, { pointerId: 1 });
    expect(screen.getByTestId('player-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('give-ball'));
    expect(screen.getByTestId('holder-label').textContent).toBe('藍 2 號');
  });

  it('新增步驟後可播放', async () => {
    render(<App />);
    await waitFor(() => expect(useStore.getState().saveStatus).toBe('saved'));
    fireEvent.click(screen.getByTestId('add-step'));
    expect(screen.getByTestId('step-indicator').textContent).toContain('2 / 2');
    fireEvent.click(screen.getByTestId('play'));
    expect(useStore.getState().playback.playing).toBe(true);
  });
});
