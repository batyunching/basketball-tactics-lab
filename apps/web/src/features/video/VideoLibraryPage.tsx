import { useEffect, useRef, useState } from 'react';
import type { VideoAnalysis, VideoAsset } from '@btl/video-engine';
import { defaultTrim, emptyAnalysis, validateVideoFile } from '@btl/video-engine';
import { navigate } from '../../app/router';
import { useStore } from '../../app/store';
import { repository } from '../storage/db';
import { probeVideo } from './detector';

function fmtSec(ms: number) {
  return `${(ms / 1000).toFixed(1)} 秒`;
}
function fmtSize(b: number) {
  return b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

const STATUS: Record<VideoAnalysis['status'], string> = {
  none: '尚未分析',
  done: '已分析',
  failed: '分析失敗',
  cancelled: '已取消',
};

/** 影片管理（M09）：匯入、驗證、刪除。影片只存在這台電腦。 */
export function VideoLibraryPage() {
  const [list, setList] = useState<{ v: VideoAsset; a?: VideoAnalysis }[] | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const vs = await repository.listVideos();
    setList(await Promise.all(vs.map(async (v) => ({ v, a: await repository.getAnalysis(v.id) }))));
  };
  useEffect(() => {
    void load();
  }, []);

  const importFile = async (f: File) => {
    const err = validateVideoFile(f);
    if (err) {
      useStore.getState().showToast(err, 'error');
      return;
    }
    setBusy(true);
    try {
      const meta = await probeVideo(f);
      const asset: VideoAsset = {
        id: `vid-${crypto.randomUUID()}`,
        name: f.name.replace(/\.[^.]+$/, ''),
        mime: f.type || 'video/mp4',
        size: f.size,
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
        createdAt: new Date().toISOString(),
        consent,
        ...defaultTrim(meta.durationMs),
      };
      await repository.saveVideo(asset, f);
      await repository.saveAnalysis(emptyAnalysis(asset.id));
      useStore.getState().showToast(meta.durationMs < 10_000 ? '已匯入（影片不到 10 秒，將以全長分析）' : '已匯入影片');
      navigate(`/video/${asset.id}`);
    } catch (e) {
      useStore.getState().showToast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>影片分析（3v3 半場）</h1>
        <p className="muted">
          匯入 10～30 秒、固定鏡頭的 3v3 半場短片 → 校正球場 → 自動追蹤或人工標記 → 與虛擬球場同步回放，並可轉成戰術動畫。
        </p>
        <p className="muted small">🔒 影片與分析結果只存在這台電腦的瀏覽器，不會上傳；分析在你的電腦上執行，不做人臉辨識。</p>
      </header>

      <section className="panel-section import-box">
        <h2>匯入影片</h2>
        <ul className="bullets small">
          <li>建議：固定、較高位置的鏡頭，能拍到整個半場；兩隊穿紅、藍兩色背心。</li>
          <li>格式：MP4（H.264）、WebM 或 MOV，500MB 以內。超過 30 秒的影片可在下一步選擇片段。</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="video-consent" />
          我確認已依學校規定取得拍攝與教學使用的必要授權
        </label>
        <button type="button" className="btn primary" disabled={!consent || busy} onClick={() => fileRef.current?.click()} data-testid="video-import">
          {busy ? '讀取中…' : '🎥 選擇影片檔'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
          hidden
          data-testid="video-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
      </section>

      <section className="panel-section">
        <h2>我的影片</h2>
        {list === null ? (
          <p className="muted">讀取中…</p>
        ) : list.length === 0 ? (
          <p className="muted">還沒有影片。</p>
        ) : (
          <ul className="assignment-list" data-testid="video-list">
            {list.map(({ v, a }) => (
              <li key={v.id}>
                <div>
                  <button type="button" className="link" onClick={() => navigate(`/video/${v.id}`)}>
                    <strong>{v.name}</strong>
                  </button>
                  <span className="muted small">
                    {' '}
                    {fmtSec(v.durationMs)}・{v.width}×{v.height}・{fmtSize(v.size)}・片段 {fmtSec(v.trimStartMs)}～{fmtSec(v.trimEndMs)}・{STATUS[a?.status ?? 'none']}
                    {a?.calibration?.homography ? '・已校正' : ''}
                    {a?.keyframes.length ? `・${a.keyframes.length} 個關鍵影格` : ''}
                  </span>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn tiny primary" onClick={() => navigate(`/video/${v.id}`)}>
                    開啟
                  </button>
                  <button
                    type="button"
                    className={`btn tiny ${confirmDel === v.id ? 'danger' : 'ghost'}`}
                    data-testid="video-delete"
                    onClick={async () => {
                      if (confirmDel !== v.id) {
                        setConfirmDel(v.id);
                        return;
                      }
                      await repository.deleteVideo(v.id);
                      setConfirmDel(null);
                      useStore.getState().showToast('已刪除影片、軌跡與分析結果');
                      await load();
                    }}
                  >
                    {confirmDel === v.id ? '確認刪除（含軌跡與分析）' : '刪除'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
