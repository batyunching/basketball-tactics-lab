# 架構

```
UI（React 元件）──呼叫──▶ store（Zustand：歷史紀錄、播放、介面狀態）
        │                         │ commit(fn)
        │                         ▼
        │              tactic-engine（純函式，immer 不可變更新）
        │                         │
        ▼                         ▼
CourtBoard（SVG）◀── frameAt(time) 插值 ── 戰術資料（公尺座標）
                                  │ 訂閱變更（0.5s debounce）
                                  ▼
                persistence ──▶ TacticRepository（IndexedDB 實作；未來可換雲端）
```

- **座標**：資料一律公尺座標；`getViewTransform(mode, direction)` 產生 SVG `matrix()`。半場是旋轉（行列式 = 1）而非鏡像。滑鼠／觸控點用 `getScreenCTM().inverse()` 轉回 viewBox，再 `viewToCourt`，所以縮放、平移、全螢幕都不偏移。
- **歷史**：每次 `commit` 推入一個不可變快照（immer 結構共享，記憶體成本低），上限 100 筆；拖曳以 `beginGesture / gestureUpdate / endGesture` 合併為一筆。
- **動畫**：`stepTimes` 累加每步 `durationMs`；`frameAt` 計算球員插值與球位置（同持球人→跟隨；換人→中段出手飛行）。播放用 `requestAnimationFrame` 呼叫 `tick(dt)`，速度只影響時間推進。
- **儲存**：`TacticRepository` 介面隔離儲存實作。`saveProject` 在交易內讀舊版 revision 後 +1，為 Phase 2 衝突檢查預留。
- **測試**：引擎與資料結構 100% 純函式單元測試；store、IndexedDB（fake-indexeddb）、元件（Testing Library）；Playwright 跑附錄 B 驗收情境（桌機滑鼠＋平板觸控兩種）。
