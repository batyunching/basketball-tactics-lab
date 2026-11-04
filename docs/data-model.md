# 資料模型（schemaVersion = 1）

型別定義：`packages/shared-types/src/index.ts`；驗證：`packages/data-schemas/src/index.ts`。

## 匯出 JSON

```jsonc
{
  "format": "basketball-tactics-lab",
  "schemaVersion": 1,
  "exportedAt": "2026-11-04T15:00:00.000Z",
  "ball": { "holderId": "red-1", "x": 19.8, "y": 7.5 },   // 第一步的球（方便外部讀取）
  "project": {
    "schemaVersion": 1, "id": "proj-…", "title": "傳切", "revision": 3,
    "createdAt": "…", "updatedAt": "…",
    "court": { "mode": "half", "lengthM": 28, "widthM": 15, "attackDirection": "right" },
    "teamSize": 3,
    "teams": [{ "id": "red", "name": "紅隊", "color": "#d7263d" }, { "id": "blue", … }],
    "players": [{ "id": "red-1", "teamId": "red", "slot": 0, "jerseyNumber": 1, "locked": false }, …],
    "steps": [{
      "id": "step-…", "title": "起始站位", "durationMs": 1500,
      "players": { "red-1": { "x": 19.8, "y": 7.5 }, … },        // 所有球員位置（含未上場者）
      "ball": { "holderId": "red-1", "x": 19.8, "y": 7.5 },
      "offenseTeam": "red",
      "events": [{ "id": "ev-…", "type": "pass", "fromId": "red-1", "toId": "red-2" }],
      "annotations": [{ "id": "ann-…", "kind": "run", "points": [{ "x": 20, "y": 3 }, …], "color": "#1d1d1f" }],
      "note": "教師註解"
    }]
  },
  "formations": [{ "id": "builtin-1", "name": "…", "order": 0, "courtMode": "half", "teamSize": 3,
                   "attackDirection": "right", "offenseTeam": "red", "players": { … }, "ball": { … },
                   "builtIn": true, "updatedAt": "…" }]
}
```

- 座標：公尺，x 沿長邊 0～28、y 沿短邊 0～15；允許界外 1m。
- `playerId` 穩定不變（`red-1`…`blue-5`），背號只在同隊內唯一，可修改。
- 每隊固定 5 名；`slot < teamSize` 才出場，切換人數不會遺失位置。
- `attackDirection` 為紅隊進攻方向；半場時兩隊攻同一籃框。
- 每一步記錄「到達該步」的完整狀態；`durationMs` 是從上一步移動過來的時間；`events` 在進入該步的動畫中發生。

## IndexedDB（資料庫 `basketball-tactics-lab` v1）

| store | key | 內容 |
| --- | --- | --- |
| projects | id | TacticProject（index：updatedAt） |
| formations | id | Formation |
| meta | 字串 | `lastProjectId` 等 |
| syncQueue | operationId | 預留 Phase 2：deviceId、entity、baseRevision、syncStatus |

## 版本遷移

`migrateBundle()` 依 `schemaVersion` 轉換；遇到不支援的版本拒絕匯入並提示，不會靜默覆寫。
