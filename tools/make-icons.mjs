// 產生 App 圖示（PNG）：淡藍底、藍色螢幕、淡紫小圓點
// 用法：node tools/make-icons.mjs icons
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const out = process.argv[2];
const hex = h => h.match(/\w\w/g).map(x => parseInt(x, 16));
const BG = hex('dbe7fd');
const BLUE = hex('2563eb');
const WHITE = hex('ffffff');
const PURPLE = hex('7c5cd6');

// 圓角矩形的距離（負數在裡面）
function rrect(x, y, cx, cy, w, h, r) {
  const qx = Math.abs(x - cx) - w / 2 + r;
  const qy = Math.abs(y - cy) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

// 回傳這一點的顏色 [r,g,b,a]；rounded：背景要不要圓角；scale：圖案大小（maskable 縮小到安全範圍）
function shade(x, y, { rounded, scale }) {
  if (rounded && rrect(x, y, .5, .5, 1, 1, .22) > 0) return [0, 0, 0, 0];
  // 圖案座標：以中心縮放
  const u = .5 + (x - .5) / scale;
  const v = .5 + (y - .5) / scale;
  const screen = rrect(u, v, .5, .43, .6, .4, .07);
  const stroke = .05;
  if (circle(u, v, .68, .515, .035) < 0) return [...PURPLE, 255];
  if (screen < -stroke) return [...WHITE, 255];
  if (screen < 0) return [...BLUE, 255];
  if (rrect(u, v, .5, .685, .07, .09, .01) < 0) return [...BLUE, 255];
  if (rrect(u, v, .5, .745, .3, .05, .025) < 0) return [...BLUE, 255];
  return [...BG, 255];
}

function render(size, opts) {
  const SS = 4; // 每個像素取樣 4×4 次，邊緣比較平滑
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const acc = [0, 0, 0, 0];
      for (let a = 0; a < SS; a++) {
        for (let b = 0; b < SS; b++) {
          const c = shade((i + (a + .5) / SS) / size, (j + (b + .5) / SS) / size, opts);
          acc[0] += c[0] * c[3]; acc[1] += c[1] * c[3]; acc[2] += c[2] * c[3]; acc[3] += c[3];
        }
      }
      const k = (j * size + i) * 4;
      const al = acc[3];
      px[k] = al ? Math.round(acc[0] / al) : 0;
      px[k + 1] = al ? Math.round(acc[1] / al) : 0;
      px[k + 2] = al ? Math.round(acc[2] / al) : 0;
      px[k + 3] = Math.round(al / (SS * SS));
    }
  }
  return png(size, px);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 位元 RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) px.copy(raw, j * (size * 4 + 1) + 1, j * size * 4, (j + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// iPhone 主畫面（180）自己會切圓角，用滿版；其他的背景是圓角；maskable 滿版、圖案縮小
writeFileSync(`${out}/icon-180.png`, render(180, { rounded: false, scale: 1 }));
writeFileSync(`${out}/icon-192.png`, render(192, { rounded: true, scale: 1 }));
writeFileSync(`${out}/icon-512.png`, render(512, { rounded: true, scale: 1 }));
writeFileSync(`${out}/icon-maskable-512.png`, render(512, { rounded: false, scale: .8 }));
console.log('done');
