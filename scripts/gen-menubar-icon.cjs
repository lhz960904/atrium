// Generates resources/menubarTemplate.png (20px @1x) + @2x (40px) from the app
// icon, as macOS template images (black + alpha). Re-run after changing
// resources/icon.png:  node scripts/gen-menubar-icon.cjs
// See design/MENU-BAR-ICON.md for the why and tuning notes.
const fs = require('node:fs');
const zlib = require('node:zlib');

function decode(path) {
  const buf = fs.readFileSync(path);
  let p = 8;
  let W;
  let H;
  let ct;
  const idat = [];
  while (p < buf.length) {
    const l = buf.readUInt32BE(p);
    p += 4;
    const t = buf.toString('ascii', p, p + 4);
    p += 4;
    const d = buf.subarray(p, p + l);
    p += l + 4;
    if (t === 'IHDR') {
      W = d.readUInt32BE(0);
      H = d.readUInt32BE(4);
      ct = d[9];
    } else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3;
  const st = W * bpp;
  const px = Buffer.alloc(H * st);
  const paeth = (a, b, c) => {
    const q = a + b - c;
    const A = Math.abs(q - a);
    const B = Math.abs(q - b);
    const C = Math.abs(q - c);
    return A <= B && A <= C ? a : B <= C ? b : c;
  };
  for (let y = 0; y < H; y++) {
    const f = raw[y * (st + 1)];
    const rs = y * (st + 1) + 1;
    for (let x = 0; x < st; x++) {
      const rb = raw[rs + x];
      const a = x >= bpp ? px[y * st + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * st + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * st + x - bpp] : 0;
      let v = rb;
      if (f === 1) v = rb + a;
      else if (f === 2) v = rb + b;
      else if (f === 3) v = rb + ((a + b) >> 1);
      else if (f === 4) v = rb + paeth(a, b, c);
      px[y * st + x] = v & 255;
    }
  }
  return { W, H, bpp, px };
}

// 1 where the purple tile / cyan dot are (blue-dominant), else 0.
function buildMask({ W, H, bpp, px }) {
  const m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * bpp;
    const r = px[o];
    const b = px[o + 2];
    const a = bpp === 4 ? px[o + 3] : 255;
    m[i] = a > 40 && b - r > 40 ? 1 : 0;
  }
  return m;
}

// Area-average downscale -> antialiased alpha 0..255.
function downscaleAlpha(m, W, H, tw, th) {
  const out = new Uint8Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * W) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * W) / tw));
      const y0 = Math.floor((ty * H) / th);
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * H) / th));
      let s = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          s += m[y * W + x];
          n++;
        }
      }
      out[ty * tw + tx] = Math.round((s / n) * 255);
    }
  }
  return out;
}

const crcTab = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTab[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};
function encode(alpha, size) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x++) {
      raw[y * (1 + size * 4) + 1 + x * 4 + 3] = alpha[y * size + x];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const img = decode('resources/icon.png');
const mask = buildMask(img);
fs.writeFileSync(
  'resources/menubarTemplate.png',
  encode(downscaleAlpha(mask, img.W, img.H, 20, 20), 20),
);
fs.writeFileSync(
  'resources/menubarTemplate@2x.png',
  encode(downscaleAlpha(mask, img.W, img.H, 40, 40), 40),
);
console.log('OK wrote resources/menubarTemplate.png (20) + @2x (40)');
