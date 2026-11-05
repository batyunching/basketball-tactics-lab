"""產生 e2e 測試用影片：透視繪製的半場＋三個移動的人形（取自 NASA 太空人公有領域照片）。
只用來測試瀏覽器流程，不代表真實籃球影片的辨識效果。"""
import sys, json, numpy as np
from skimage import data, draw
from skimage.transform import resize
out_dir = sys.argv[1]
W, H = 960, 540
CAM = np.array([[-26, 36, 760], [21, 4, -112], [-0.002, 0.012, 1.0]])  # 球場(公尺) → 影像
def to_img(x, y):
    v = CAM @ np.array([x, y, 1.0]); return v[0]/v[2], v[1]/v[2]
bg = np.zeros((H, W, 3), np.uint8); bg[:] = (40, 52, 80)
# 地板：把半場範圍填色
L, Wc = 28.0, 15.0
poly = [to_img(14, -1), to_img(29, -1), to_img(29, 16), to_img(14, 16)]
rr, cc = draw.polygon([p[1] for p in poly], [p[0] for p in poly], (H, W)); bg[rr, cc] = (226, 192, 145)
def line(p, q, color=(255, 250, 240), t=2):
    a = to_img(*p); b = to_img(*q)
    for d in range(-t//2, t//2+1):
        rr, cc = draw.line(int(a[1])+d, int(a[0]), int(b[1])+d, int(b[0]))
        ok = (rr >= 0) & (rr < H) & (cc >= 0) & (cc < W); bg[rr[ok], cc[ok]] = color
for p, q in [((14,0),(28,0)),((28,0),(28,15)),((28,15),(14,15)),((14,15),(14,0)),((28,5.05),(22.2,5.05)),((22.2,5.05),(22.2,9.95)),((22.2,9.95),(28,9.95))]:
    line(p, q)
import math
bx = 28-1.575; pts=[(28,0.9),(25.01,0.9)]
for i in range(41):
    a = math.radians(258 - 156*i/40); pts.append((bx+6.75*math.cos(a), 7.5+6.75*math.sin(a)))
pts.append((28,14.1))
for p, q in zip(pts, pts[1:]): line(p, q)
astro = data.astronaut()[30:512, 0:300]  # 人物區域
def person(team, h):
    w = int(h*300/482); img = resize(astro, (h, w), preserve_range=True).astype(np.float32)
    t0, t1 = int(h*0.3), int(h*0.62)
    tint = np.array([1.0, 0.25, 0.25]) if team == 'red' else np.array([0.25, 0.4, 1.0])
    img[t0:t1] = img[t0:t1]*tint*1.2
    return np.clip(img, 0, 255).astype(np.uint8)
paths = {
  'red-1': lambda t: (19.5 + 5*t, 7.5),
  'red-2': lambda t: (23.0, 2.5 + 3*t),
  'blue-1': lambda t: (21.0 + 3*t, 11.5 - 2*t),
}
teams = {'red-1':'red','red-2':'red','blue-1':'blue'}
fps, secs = 10, 12
frames = []
truth = {k: [] for k in paths}
for i in range(fps*secs):
    t = i/(fps*secs); f = bg.copy()
    for k, fn in paths.items():
        x, y = fn(t); u, v = to_img(x, y)
        h = int(110 + (v-200)*0.25); p = person(teams[k], h); ph, pw = p.shape[:2]
        x0, y0 = int(u - pw/2), int(v - ph)
        xs, ys = max(0, x0), max(0, y0); xe, ye = min(W, x0+pw), min(H, y0+ph)
        f[ys:ye, xs:xe] = p[ys-y0:ye-y0, xs-x0:xe-x0]
        truth[k].append({'t': int(i*1000/fps), 'x': round(x, 3), 'y': round(y, 3)})
    frames.append(f)
import imageio.v2 as iio
iio.mimwrite(out_dir + '/frames.npy.tmp', [], format='gif') if False else None
np.save(out_dir + '/frames.npy', np.stack(frames))
lm = {k: to_img(*v) for k, v in {'baseline-left':(28,0),'baseline-right':(28,15),'ft-left':(22.2,5.05),'ft-right':(22.2,9.95),'half-left':(14,0),'half-right':(14,15),'key-base-left':(28,5.05),'key-base-right':(28,9.95)}.items()}
json.dump({'size':[W,H],'landmarks':lm,'truth':truth}, open(out_dir + '/clip-meta.json','w'), ensure_ascii=False)
print('frames', len(frames))
