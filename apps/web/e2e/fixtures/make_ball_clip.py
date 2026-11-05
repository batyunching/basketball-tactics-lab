"""籃球追蹤測試用示範短片（全部程式繪製，不含真人影像）。

半場、側邊高處視角、籃框在右；紅藍各 3 人（球衣有背號）。
12 秒內容：
  0–2.8 秒  紅1 在弧頂運球
  3.0 秒    紅1 傳給紅2（左翼）
  4.65 秒   紅2 回傳給空切到籃下的紅1
  5.3 秒    紅1 上籃 → 進球
  6.6 秒    紅1 撿球；7.4 秒傳給右翼紅3
  8.7 秒    紅3 三分出手 → 碰框彈出（沒進）
  10.35 秒  藍3 搶到籃板
另放一個場邊橘色角錐（靜止的橘色物品，測試排除）。
輸出：ball-3v3.webm、ball-meta.json（校正點、籃框、球與球權、出手的正確答案）。
用法：python3 make_ball_clip.py [輸出資料夾]
"""
import json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
W, H, FPS, SECS = 1280, 720, 30, 12

# ---------- 相機：球場 (x,y) 公尺 → 影像像素 ----------
def solve_h(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(A, float))
    return vt[-1].reshape(3, 3) / vt[-1][-1]
CAM = solve_h([(14, 0), (28, 0), (28, 15), (14, 15)], [(300, 250), (1020, 250), (1210, 680), (110, 680)])
def to_img(x, y):
    v = CAM @ np.array([x, y, 1.0]); return (float(v[0] / v[2]), float(v[1] / v[2]))
def ppm(x, y):
    a, b = to_img(x, y), to_img(x + 0.5, y)
    c = to_img(x, y + 0.5)
    return (math.hypot(b[0] - a[0], b[1] - a[1]) + math.hypot(c[0] - a[0], c[1] - a[1]))  # 兩方向平均（每公尺）

BASKET = (26.425, 7.5)
fx, fy = to_img(*BASKET)
P0 = ppm(*BASKET)
RIM = (fx, fy - 3.05 * P0)
RIM_W = 0.45 * P0

# ---------- 背景 ----------
bg = Image.new('RGB', (W, H), (36, 46, 70))
d = ImageDraw.Draw(bg)
for yy in range(0, 250):
    c = 36 + yy // 12
    d.line([(0, yy), (W, yy)], fill=(c, c + 8, c + 30))
d.polygon([to_img(13, -1.2), to_img(29.5, -1.2), to_img(29.5, 16.5), to_img(13, 16.5)], fill=(205, 165, 112))
d.polygon([to_img(14, 0), to_img(28, 0), to_img(28, 15), to_img(14, 15)], fill=(226, 189, 139))
d.polygon([to_img(22.2, 5.05), to_img(28, 5.05), to_img(28, 9.95), to_img(22.2, 9.95)], fill=(196, 104, 60))
def L(p, q, w=3): d.line([to_img(*p), to_img(*q)], fill=(255, 250, 240), width=w)
for p, q in [((14, 0), (28, 0)), ((28, 0), (28, 15)), ((28, 15), (14, 15)), ((14, 15), (14, 0)), ((28, 5.05), (22.2, 5.05)), ((22.2, 5.05), (22.2, 9.95)), ((22.2, 9.95), (28, 9.95))]:
    L(p, q)
pts = [(28, 0.9)]
for i in range(61):
    a = math.radians(258 - 156 * i / 60); pts.append((BASKET[0] + 6.75 * math.cos(a), 7.5 + 6.75 * math.sin(a)))
pts.append((28, 14.1))
d.line([to_img(*p) for p in pts], fill=(255, 250, 240), width=3)
d.line([to_img(22.2 + 1.8 * math.cos(math.radians(a)), 7.5 + 1.8 * math.sin(math.radians(a))) for a in range(90, 271, 6)], fill=(255, 250, 240), width=3)
# 場邊橘色角錐（靜止）
cx, cy = to_img(15.0, 15.9)
d.polygon([(cx - 9, cy), (cx + 9, cy), (cx, cy - 26)], fill=(240, 110, 20))
d.ellipse([cx - 13, cy - 4, cx + 13, cy + 4], fill=(240, 110, 20))
# 籃架：柱子、籃板
bx_, by_ = to_img(29.0, 7.5)
d.line([(bx_, by_), (bx_, by_ - 3.3 * P0)], fill=(80, 84, 96), width=10)
d.line([(bx_, by_ - 3.3 * P0), (RIM[0] + 0.5 * P0, RIM[1] - 0.2 * P0)], fill=(80, 84, 96), width=8)
bbl, bbr = to_img(27.9, 6.6), to_img(27.9, 8.4)
top = RIM[1] - 1.0 * P0
d.polygon([(bbl[0], top), (bbr[0], top), (bbr[0], RIM[1] + 0.1 * P0), (bbl[0], RIM[1] + 0.1 * P0)], fill=(245, 248, 252), outline=(60, 60, 70))
d.rectangle([RIM[0] - 0.3 * P0 + 8, RIM[1] - 0.45 * P0, RIM[0] + 0.3 * P0 + 8, RIM[1] - 0.02 * P0], outline=(200, 40, 40), width=3)

font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 40)
SKIN = [(241, 194, 150), (198, 140, 96), (226, 172, 124), (168, 112, 74), (235, 186, 140), (210, 156, 110)]
def person(img, u, v, h, team, num, k, phase):
    dr = ImageDraw.Draw(img)
    s = h / 160
    jersey = (214, 38, 61) if team == 'red' else (27, 110, 232)
    shorts = (150, 20, 40) if team == 'red' else (16, 66, 150)
    dr.ellipse([u - 26 * s, v - 6 * s, u + 26 * s, v + 6 * s], fill=(165, 128, 84))
    sw = math.sin(phase) * 14 * s
    for side, off in ((-1, sw), (1, -sw)):
        dr.line([(u + side * 9 * s, v - 62 * s), (u + side * 9 * s + off, v - 4 * s)], fill=SKIN[k], width=max(2, int(12 * s)))
        dr.ellipse([u + side * 9 * s + off - 9 * s, v - 10 * s, u + side * 9 * s + off + 9 * s, v], fill=(30, 30, 34))
    dr.rounded_rectangle([u - 22 * s, v - 82 * s, u + 22 * s, v - 54 * s], radius=6 * s, fill=shorts)
    dr.rounded_rectangle([u - 24 * s, v - 128 * s, u + 24 * s, v - 78 * s], radius=10 * s, fill=jersey)
    for side in (-1, 1):
        dr.line([(u + side * 24 * s, v - 122 * s), (u + side * 34 * s - side * sw * 0.4, v - 86 * s)], fill=SKIN[k], width=max(2, int(10 * s)))
    dr.ellipse([u - 15 * s, v - 160 * s, u + 15 * s, v - 128 * s], fill=SKIN[k])
    dr.chord([u - 15 * s, v - 162 * s, u + 15 * s, v - 136 * s], 180, 360, fill=(40, 30, 26))
    f = font.font_variant(size=max(12, int(30 * s)))
    dr.text((u, v - 104 * s), str(num), fill=(255, 255, 255), font=f, anchor='mm')

# ---------- 球員跑位（秒、公尺） ----------
PATHS = {
    'red-1': [[0, 19.7, 7.5], [3.2, 19.7, 7.5], [4.6, 26.0, 6.6], [5.4, 26.3, 7.0], [6.6, 26.3, 7.0], [7.6, 25.6, 6.5], [12, 25.6, 6.5]],
    'red-2': [[0, 22.5, 2.0], [12, 22.5, 2.0]],
    'red-3': [[0, 22.6, 13.0], [12, 22.6, 13.0]],
    'blue-1': [[0, 20.9, 7.4], [3.2, 20.9, 7.0], [4.6, 24.2, 6.3], [6.0, 25.2, 6.8], [12, 25.2, 6.8]],
    'blue-2': [[0, 23.4, 2.8], [12, 23.4, 2.8]],
    'blue-3': [[0, 23.4, 12.2], [8.6, 23.4, 12.0], [9.4, 23.4, 12.0], [10.2, 24.9, 10.9], [12, 24.9, 10.9]],
}
def at(keys, t):
    if t <= keys[0][0]: return keys[0][1], keys[0][2]
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            k = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k
    return keys[-1][1], keys[-1][2]
def player_px(pid, t):
    x, y = at(PATHS[pid], t)
    u, v = to_img(x, y)
    return u, v, 1.85 * ppm(x, y)
def hand(pid, t):
    u, v, h = player_px(pid, t)
    return (u + 0.2 * h, v - 0.5 * h)

# ---------- 球 ----------
def lerp(a, b, k): return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)
def parab(a, b, k, peak): p = lerp(a, b, k); return (p[0], p[1] - 4 * peak * k * (1 - k))
ABOVE = (RIM[0] - 0.1 * RIM_W, RIM[1] - 0.9 * RIM_W)
FRONT = (RIM[0] - 0.55 * RIM_W, RIM[1] - 0.15 * RIM_W)
OUTP = (RIM[0] + 2.8 * RIM_W, RIM[1] - 1.6 * RIM_W)
def ball(t):
    """回傳 (u, v, 持球者或 None)"""
    if t < 2.8:  # 紅1 運球
        hu, hv = hand('red-1', t); _, fv, _ = player_px('red-1', t)
        k = abs(math.sin(math.pi * t / 0.5))
        return hu, hv + (fv - 6 - hv) * (1 - k), 'red-1'
    if t < 3.0: return (*hand('red-1', t), 'red-1')
    if t < 3.3: return (*parab(hand('red-1', 3.0), hand('red-2', 3.3), (t - 3.0) / 0.3, 20), None)
    if t < 4.65: return (*hand('red-2', t), 'red-2')
    if t < 4.95: return (*parab(hand('red-2', 4.65), hand('red-1', 4.95), (t - 4.65) / 0.3, 15), None)
    if t < 5.3: return (*hand('red-1', t), 'red-1')
    if t < 5.65: return (*parab(hand('red-1', 5.3), ABOVE, (t - 5.3) / 0.35, 40), None)
    if t < 5.95: return (*lerp(ABOVE, (RIM[0], RIM[1] + 2.6 * RIM_W), ((t - 5.65) / 0.3) ** 1.3), None)  # 穿過籃框、籃網
    fl = (RIM[0] - 0.2 * RIM_W, fy + 0.3 * P0)
    if t < 6.25: return (*lerp((RIM[0], RIM[1] + 2.6 * RIM_W), fl, ((t - 5.95) / 0.3) ** 1.5), None)
    if t < 6.6:  # 小彈跳
        k = (t - 6.25) / 0.35; return fl[0], fl[1] - 0.5 * P0 * 4 * k * (1 - k), None
    if t < 7.4: return (*hand('red-1', t), 'red-1')
    if t < 7.8: return (*parab(hand('red-1', 7.4), hand('red-3', 7.8), (t - 7.4) / 0.4, 30), None)
    if t < 8.7: return (*hand('red-3', t), 'red-3')
    rel = (hand('red-3', 8.7)[0], hand('red-3', 8.7)[1] - 0.45 * player_px('red-3', 8.7)[2])
    if t < 8.85: return (*lerp(hand('red-3', 8.7), rel, (t - 8.7) / 0.15), 'red-3')
    if t < 9.45: return (*parab(rel, FRONT, (t - 8.85) / 0.6, 150), None)
    if t < 9.75: return (*parab(FRONT, OUTP, (t - 9.45) / 0.3, 25), None)
    if t < 10.35: return (*lerp(OUTP, hand('blue-3', 10.35), ((t - 9.75) / 0.6) ** 1.6), None)
    return (*hand('blue-3', t), 'blue-3')

def draw_net(img):
    dr = ImageDraw.Draw(img, 'RGBA')
    rw = RIM_W
    for i in range(7):
        k = i / 6
        top = (RIM[0] - rw / 2 + rw * k, RIM[1] + 0.06 * rw)
        bot = (RIM[0] - rw * 0.3 + rw * 0.6 * k, RIM[1] + 1.2 * rw)
        dr.line([top, bot], fill=(255, 255, 255, 170), width=1)
    for j in range(1, 4):
        y = RIM[1] + 0.06 * rw + (1.14 * rw) * j / 4
        half = rw / 2 - (rw * 0.2) * j / 4
        dr.line([(RIM[0] - half, y), (RIM[0] + half, y)], fill=(255, 255, 255, 140), width=1)

def draw_rim(img, front):
    dr = ImageDraw.Draw(img)
    box = [RIM[0] - RIM_W / 2, RIM[1] - RIM_W * 0.16, RIM[0] + RIM_W / 2, RIM[1] + RIM_W * 0.16]
    dr.arc(box, 0 if front else 180, 180 if front else 360, fill=(235, 80, 25), width=3)

proc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                         '-c:v', 'libvpx-vp9', '-b:v', '2500k', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', os.path.join(OUT, 'ball-3v3.tmp.webm')], stdin=subprocess.PIPE)
truth_ball = []
for i in range(FPS * SECS):
    t = i / FPS
    f = bg.copy()
    pos = {pid: player_px(pid, t) for pid in PATHS}
    bu, bv, holder = ball(t)
    br = 0.12 * ppm(*BASKET) if holder is None else 0.12 * pos[holder][2] / 1.85
    draw_rim(f, front=False)
    order = sorted(PATHS, key=lambda p: pos[p][1])
    for pid in order:
        u, v, h = pos[pid]
        moving = math.hypot(*(np.subtract(at(PATHS[pid], t), at(PATHS[pid], t - 0.1)))) > 0.01
        person(f, u, v, h, pid.split('-')[0], int(pid[-1]), list(PATHS).index(pid), t * 12 if moving else 0)
    ImageDraw.Draw(f).ellipse([bu - br, bv - br, bu + br, bv + br], fill=(225, 105, 35), outline=(70, 30, 10), width=2)
    draw_net(f)
    draw_rim(f, front=True)
    proc.stdin.write(f.tobytes())
    truth_ball.append({'t': round(t * 1000), 'x': round(bu, 1), 'y': round(bv, 1), 'holder': holder})
proc.stdin.close(); proc.wait()
os.replace(os.path.join(OUT, 'ball-3v3.tmp.webm'), os.path.join(OUT, 'ball-3v3.webm'))
lm = {k: [round(c, 1) for c in to_img(*v)] for k, v in {'baseline-left': (28, 0), 'baseline-right': (28, 15), 'ft-left': (22.2, 5.05), 'ft-right': (22.2, 9.95), 'half-left': (14, 0), 'half-right': (14, 15), 'key-base-left': (28, 5.05), 'key-base-right': (28, 9.95)}.items()}
meta = {
    'size': [W, H], 'fps': FPS, 'landmarks': lm,
    'hoop': {'x': round(RIM[0], 1), 'y': round(RIM[1], 1), 'w': round(RIM_W, 1)},
    'shots': [{'releaseMs': 5300, 'shooter': 'red-1', 'made': True}, {'releaseMs': 8850, 'shooter': 'red-3', 'made': False}],
    'possessions': [{'startMs': 0, 'player': 'red-1'}, {'startMs': 3300, 'player': 'red-2'}, {'startMs': 4950, 'player': 'red-1'}, {'startMs': 6600, 'player': 'red-1'}, {'startMs': 7800, 'player': 'red-3'}, {'startMs': 10350, 'player': 'blue-3'}],
    'paths': PATHS,
    'ball': truth_ball,
}
json.dump(meta, open(os.path.join(OUT, 'ball-meta.json'), 'w'), ensure_ascii=False)
print('ok', meta['hoop'])
