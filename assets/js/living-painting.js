/* ============================================================
   LIVING PAINTINGS
   Composites motion over an untouched still image, only inside
   soft-edged motion areas, so every other pixel stays the exact
   original. Shared by the gallery and the living-painting test page.

   config.layers — each layer is either:
   • a video layer: a short AI video loop that starts and ends on the
       original art
       { src, fit: { x, y, scale } | { x, y, sx, sy }, areas, flash? }
       fit   = where the video's pixels land on the still (measured)
       flash = { dim: 0–1 } dims the broad glow of lightning flashes
               while keeping the bright bolt itself crisp
   • a flicker layer: a scripted light that switches on and off
       { type: 'flicker', areas, darken: { x, y, radius, strength },
         pattern: [[seconds, level], ...] }
       level 1 = the original (light on), 0 = darkened (light off)
   • a glow layer: firelight flickering on what the fire already lights
       { type: 'glow', areas, key: { minRed, minRatio }, lobes: [{ x, y, r }],
         specks?: { areas, max, r }, strength, speed }
       key   = which pixels count as "lit by the fire" (bright and red)
       lobes = soft patches that flicker independently, so the light seems
               to move; specks = background embers found automatically, each
               twinkling on its own
   • a sway layer: a slow, sub-pixel ripple (feathers in a faint breeze)
       { type: 'sway', areas, amp, wavelength, speed }
   • a flutter layer: feathers bending in a breeze (WebGL warp; sway fallback)
       { type: 'flutter', areas, anchor: [x, y], reach, amp, wavelength, speed }
       anchor = where the feathers are rooted: nothing moves there, and the
       motion grows toward the tips (full amp at `reach` px away)
   • an embers layer: glowing sparks drifting up through the air
       { type: 'embers', areas, exclude?, count, rise: [min, max] px/s,
         size: [min, max], life: [min, max] s }
       sparks are born inside `areas` and only ever drawn inside them
   • a blink layer: a closed-eyes version of the face, wiped down like eyelids
       { type: 'blink', src, fit, eyes: [{ x, y, w, h }], areas, every: [min, max] }
   • a tear layer: a glassy droplet that wells up and creeps down a path
       { type: 'tear', path: [[x, y], ...], size, well, travel, fade, rest }

   areas: [x, y, w, h] boxes or { poly: [[x, y], ...] }, in still
   pixels; either may carry `feather` (soft-edge px, default 18).
   Plain canvas 2D, no dependencies.
   ============================================================ */
(function (global) {
  const DEFAULT_FEATHER = 18;

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function maskFrom(areas, W, H) {
    const c = makeCanvas(W, H), m = c.getContext('2d');
    m.fillStyle = '#fff';
    areas.forEach(a => {
      m.filter = `blur(${a.feather || DEFAULT_FEATHER}px)`;
      if (a.poly) { m.beginPath(); a.poly.forEach(([x, y], i) => i ? m.lineTo(x, y) : m.moveTo(x, y)); m.closePath(); m.fill(); }
      else m.fillRect(a[0], a[1], a[2], a[3]);
    });
    return c;
  }

  // bounding box of a mask's visible pixels
  function boundsOf(mask, W, H) {
    const d = mask.getContext('2d').getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x: x0, y: y0, w: Math.max(1, x1 - x0 + 1), h: Math.max(1, y1 - y0 + 1) };
  }

  // img clipped to a mask (keeps the mask's soft alpha)
  function masked(src, mask, W, H) {
    const c = makeCanvas(W, H), x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(mask, 0, 0);
    return c;
  }

  function avgLuma(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    return n ? s / n : 0;
  }

  // "light off" version of the still: pixels lit by the light (the bulb, its glow and
  // the light it throws) are darkened AND shifted to the colour of the unlit
  // surroundings — otherwise a warm bulb leaves a brownish lamp-shaped stain on a
  // cool wall. Their texture is kept; dark structure is left alone.
  function darkenedCopy(img, W, H, { x, y, radius, strength }) {
    const c = makeCanvas(W, H), ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
    const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    // the unlit surroundings: average colour of a ring just outside the light's reach
    const pad = Math.ceil(radius * 1.4);
    const rx0 = Math.max(0, Math.floor(x - pad)), ry0 = Math.max(0, Math.floor(y - pad));
    const ring = ctx.getImageData(rx0, ry0, Math.min(W, Math.ceil(x + pad)) - rx0, Math.min(H, Math.ceil(y + pad)) - ry0);
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < ring.data.length; i += 4) {
      const px = rx0 + (i / 4) % ring.width, py = ry0 + Math.floor(i / 4 / ring.width);
      const dist = Math.hypot(px - x, py - y) / radius;
      if (dist < 1.05 || dist > 1.35) continue;
      ar += ring.data[i]; ag += ring.data[i + 1]; ab += ring.data[i + 2]; an++;
    }
    ar /= an; ag /= an; ab /= an;
    const aLum = Math.max(1, lumOf(ar, ag, ab));

    const x0 = Math.max(0, Math.floor(x - radius)), y0 = Math.max(0, Math.floor(y - radius));
    const x1 = Math.min(W, Math.ceil(x + radius)), y1 = Math.min(H, Math.ceil(y + radius));
    const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0), d = data.data, w = x1 - x0;
    for (let i = 0; i < d.length; i += 4) {
      const px = x0 + (i / 4) % w, py = y0 + Math.floor(i / 4 / w);
      const dist = Math.hypot(px - x, py - y) / radius;
      if (dist >= 1) continue;
      const k = strength * smooth(0.12, 0.7, lumOf(d[i], d[i + 1], d[i + 2]) / 255) * (1 - smooth(0.55, 1, dist));
      // 1) dim
      const r = d[i] * (1 - k), g = d[i + 1] * (1 - k), b = d[i + 2] * (1 - k);
      // 2) re-tint toward the surroundings' colour at the same (dimmed) brightness
      const l = lumOf(r, g, b) / aLum;
      const t = Math.min(1, k * 1.1);
      d[i] = r + (ar * l - r) * t; d[i + 1] = g + (ag * l - g) * t; d[i + 2] = b + (ab * l - b) * t;
    }
    ctx.putImageData(data, x0, y0);
    return c;
  }

  // ---- smooth noise for organic timing (deterministic, no dependencies) ----
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
  function vnoise(t, seed) {
    const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
    const a = hash(i + seed * 57.3), b = hash(i + 1 + seed * 57.3);
    return a + (b - a) * u;
  }
  // firelight: slow swells, faster wavers and the odd quick dip, roughly -1..1
  function fire(t, seed) {
    return 0.55 * vnoise(t * 1.6, seed) + 0.3 * vnoise(t * 4.1, seed + 9) + 0.15 * vnoise(t * 9.3, seed + 23);
  }
  const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---- glow: which pixels are lit by the fire, and per-lobe add/shade sprites ----
  function buildGlow(L, img, W, H) {
    const base = makeCanvas(W, H), bx = base.getContext('2d', { willReadFrequently: true });
    bx.drawImage(img, 0, 0);
    const src = bx.getImageData(0, 0, W, H).data;
    const area = L.mask.getContext('2d').getImageData(0, 0, W, H).data;
    const k = Object.assign({ minRed: 70, fullRed: 200, minRatio: 0.45, fullRatio: 0.75 }, L.key);
    const weight = new Float32Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const a = area[i + 3] / 255; if (!a) continue;
      const r = src[i], g = src[i + 1];
      weight[p] = a * smoothstep(k.minRed, k.fullRed, r) * smoothstep(k.minRatio, k.fullRatio, (r - g) / Math.max(1, r));
    }
    const lobes = (L.lobes || []).map((l, n) => Object.assign({ seed: n + 1, depth: 1 }, l));
    if (L.specks) lobes.push(...findSpecks(src, W, H, maskFrom(L.specks.areas, W, H), L.specks).map((s, n) => Object.assign(s, { seed: 100 + n, depth: 1.6, fast: true })));
    L.sprites = lobes.map(l => {
      const x0 = Math.max(0, Math.floor(l.x - l.r)), y0 = Math.max(0, Math.floor(l.y - l.r));
      const x1 = Math.min(W, Math.ceil(l.x + l.r)), y1 = Math.min(H, Math.ceil(l.y + l.r)), w = x1 - x0, h = y1 - y0;
      const add = makeCanvas(w, h), shade = makeCanvas(w, h);
      const ad = add.getContext('2d').createImageData(w, h), sd = shade.getContext('2d').createImageData(w, h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        const px = x0 + xx, py = y0 + yy, p = py * W + px, i = (yy * w + xx) * 4, j = p * 4;
        const fall = 1 - smoothstep(0.35, 1, Math.hypot(px - l.x, py - l.y) / l.r);
        const m = weight[p] * fall; if (m <= 0) continue;
        ad.data[i] = src[j]; ad.data[i + 1] = src[j + 1]; ad.data[i + 2] = src[j + 2]; ad.data[i + 3] = 255 * m;
        sd.data[i + 3] = 255 * m;            // black, so drawing it dims the lit pixels
      }
      add.getContext('2d').putImageData(ad, 0, 0); shade.getContext('2d').putImageData(sd, 0, 0);
      return { x: x0, y: y0, add, shade, seed: l.seed, depth: l.depth, fast: l.fast };
    });
  }

  // small bright orange specks (embers) inside the given areas
  function findSpecks(src, W, H, mask, { max = 40, r = 7, minLum = 90, contrast = 35 }) {
    const md = mask.getContext('2d').getImageData(0, 0, W, H).data, out = [];
    const lum = p => 0.299 * src[p * 4] + 0.587 * src[p * 4 + 1] + 0.114 * src[p * 4 + 2];
    for (let y = 8; y < H - 8; y += 2) for (let x = 8; x < W - 8; x += 2) {
      const p = y * W + x; if (md[p * 4 + 3] < 128) continue;
      const v = lum(p); if (v < minLum || src[p * 4] < src[p * 4 + 1] * 1.3) continue;
      let peak = true, ring = 0;
      for (let d = -3; d <= 3 && peak; d++) for (let e = -3; e <= 3; e++) if (lum(p + d * W + e) > v) { peak = false; break; }
      if (!peak) continue;
      for (let a = 0; a < 8; a++) ring += lum(p + Math.round(Math.sin(a * 0.785) * 7) * W + Math.round(Math.cos(a * 0.785) * 7));
      const c = v - ring / 8; if (c < contrast) continue;
      if (out.some(s => Math.abs(s.x - x) < 14 && Math.abs(s.y - y) < 14)) continue;
      out.push({ x, y, r, c });
    }
    return out.sort((a, b) => b.c - a.c).slice(0, max);
  }

  // ---- flutter: a tiny WebGL warp of one region (the GPU does the per-pixel work) ----
  const FLUTTER_FS = `
    precision mediump float;
    uniform sampler2D img, msk;
    uniform vec2 size, origin, anchor;
    uniform float reach, amp, wl, t, speed;
    varying vec2 uv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main(){
      vec2 p = origin + uv * size;                       // still pixels
      vec2 r = p - anchor; float d = length(r);
      vec2 dir = r / max(d, 1.0), perp = vec2(-dir.y, dir.x);
      float w = smoothstep(0.0, reach, d); w *= w;       // rooted at the anchor, free at the tips
      float gust = 0.55 + 0.45 * noise(vec2(t * 0.35, 3.1));
      float bend = sin((d / wl - t * speed) * 6.2832 + noise(p / (wl * 1.6) + t * 0.25) * 2.5);
      float flick = noise(p / (wl * 0.45) - vec2(t * speed * 1.7, t * 0.4)) * 2.0 - 1.0;
      vec2 off = amp * w * gust * (perp * (0.75 * bend + 0.45 * flick) + dir * 0.2 * flick);
      vec3 c = texture2D(img, (p - off - origin) / size).rgb;
      float m = texture2D(msk, uv).a;
      gl_FragColor = vec4(c * m, m);
    }`;
  const FLUTTER_VS = 'attribute vec2 pos; varying vec2 uv; void main(){ uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5); gl_Position = vec4(pos, 0.0, 1.0); }';

  function buildFlutter(L, img) {
    const b = L.box, c = makeCanvas(b.w, b.h);
    const gl = c.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return false;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, FLUTTER_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FLUTTER_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = (unit, source) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    };
    const crop = makeCanvas(b.w, b.h); crop.getContext('2d').drawImage(img, -b.x, -b.y);
    tex(0, crop); tex(1, L.boxMask);
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('img'), 0); gl.uniform1i(u('msk'), 1);
    gl.uniform2f(u('size'), b.w, b.h); gl.uniform2f(u('origin'), b.x, b.y);
    gl.uniform2f(u('anchor'), L.anchor[0], L.anchor[1]);
    gl.uniform1f(u('reach'), L.reach || 250); gl.uniform1f(u('amp'), L.amp || 5);
    gl.uniform1f(u('wl'), L.wavelength || 120); gl.uniform1f(u('speed'), L.speed || 0.35);
    gl.viewport(0, 0, b.w, b.h);
    L.gl = gl; L.glCanvas = c; L.uT = u('t');
    return true;
  }

  // ---- embers: deterministic particles (same time in = same frame out) ----
  function buildEmbers(L, W, H) {
    // candidate birth points inside the areas
    const d = L.mask.getContext('2d').getImageData(0, 0, W, H).data, spots = [];
    for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) if (d[(y * W + x) * 4 + 3] > 200) spots.push([x, y]);
    L.spots = spots;
    const r = (i, k, lo, hi) => lo + (hi - lo) * (hash(i * 13.7 + k * 3.1) * 0.5 + 0.5);
    const [r0, r1] = L.rise || [14, 34], [s0, s1] = L.size || [1.2, 3], [l0, l1] = L.life || [3, 7];
    L.parts = Array.from({ length: L.count || 36 }, (_, i) => ({
      i, rise: r(i, 1, r0, r1), size: r(i, 2, s0, s1), life: r(i, 3, l0, l1), gap: r(i, 4, 0.2, 2.5),
      sway: r(i, 5, 4, 14), freq: r(i, 6, 0.25, 0.7), drift: r(i, 7, -6, 6), offset: r(i, 8, 0, 20), hue: r(i, 9, 0, 1)
    }));
    // a soft glowing spark sprite (hot core, orange body, red halo)
    const S = 32, sp = makeCanvas(S, S), g = sp.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,240,200,1)'); grad.addColorStop(0.18, 'rgba(255,170,70,0.95)');
    grad.addColorStop(0.45, 'rgba(235,70,20,0.35)'); grad.addColorStop(1, 'rgba(200,20,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
    L.sprite = sp;
    L.layer = makeCanvas(W, H);
  }

  // ---- blink: when (seconds) each blink starts — irregular, like a person ----
  function blinkTimes(every, n = 64) {
    const t = []; let at = every[0] * 0.6;
    for (let i = 0; i < n; i++) {
      t.push(at);
      if (hash(i * 5.1 + 2) > 0.6) t.push(at + 0.45);      // now and then a double blink
      at += every[0] + (every[1] - every[0]) * (hash(i * 3.7 + 1) * 0.5 + 0.5);
    }
    return { list: t, cycle: at };
  }
  // eyelid position 0 (open) .. 1 (shut) over a ~0.3s blink: fast close, brief hold, slower open
  function lidAt(u) {
    if (u < 0 || u > 0.32) return 0;
    if (u < 0.09) { const k = u / 0.09; return k * k; }
    if (u < 0.13) return 1;
    const k = (u - 0.13) / 0.19; return 1 - k * k * (3 - 2 * k);
  }

  // ---- tear: point and direction along a polyline at arclength s ----
  function along(path, s) {
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i], len = Math.hypot(bx - ax, by - ay);
      if (s <= len || i === path.length - 1) { const k = Math.min(1, s / len); return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, dx: (bx - ax) / len, dy: (by - ay) / len }; }
      s -= len;
    }
  }
  const pathLength = path => path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);

  function LivingPainting(img, config) {
    const W = this.W = img.naturalWidth || img.width, H = this.H = img.naturalHeight || img.height;
    this.img = img;
    this.canvas = makeCanvas(W, H);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.drawImage(img, 0, 0);
    this.startedAt = 0;
    const videos = {};   // one <video> per file, shared by every layer that uses it
    this.images = [];    // extra stills a layer needs (the closed-eyes face)
    this.layers = config.layers.map(src => {
      const L = Object.assign({}, src);
      L.mask = maskFrom(L.areas || [], W, H);
      if (L.exclude) {   // carve out things that must stay still (jewels, a brooch...)
        const m = L.mask.getContext('2d');
        m.filter = 'none'; m.globalCompositeOperation = 'destination-out';
        m.drawImage(maskFrom(L.exclude, W, H), 0, 0);
        m.globalCompositeOperation = 'source-over';
      }
      if (L.type === 'glow') {
        buildGlow(L, img, W, H);
      } else if (L.type === 'embers') {
        buildEmbers(L, W, H);
      } else if (L.type === 'sway' || L.type === 'flutter') {
        const b = boundsOf(L.mask, W, H);
        L.box = b; L.rows = makeCanvas(b.w, b.h); L.cols = makeCanvas(b.w, b.h);
        L.boxMask = makeCanvas(b.w, b.h); L.boxMask.getContext('2d').drawImage(L.mask, -b.x, -b.y);
        if (L.type === 'flutter' && !buildFlutter(L, img)) { L.type = 'sway'; L.amp = (L.amp || 5) * 0.5; }   // no WebGL
      } else if (L.type === 'blink') {
        L.schedule = blinkTimes(L.every || [4, 8]);
        L.closed = Object.assign(new Image(), { crossOrigin: 'anonymous' });
        L.closed.onload = () => {
          const c = makeCanvas(W, H), x = c.getContext('2d');
          x.drawImage(L.closed, L.fit.x, L.fit.y, L.closed.naturalWidth * L.fit.scale, L.closed.naturalHeight * L.fit.scale);
          L.closedMasked = masked(c, L.mask, W, H);
        };
        L.closed.src = L.src;
        this.images.push(L.closed);
        L.lid = makeCanvas(W, H);
      } else if (L.type === 'tear') {
        L.length = pathLength(L.path);
        L.cycle = L.well + L.travel + L.fade + L.rest;
        L.lens = makeCanvas(64, 64);
      } else if (L.type === 'flicker') {
        L.offMasked = masked(darkenedCopy(img, W, H, L.darken), L.mask, W, H);
        L.cycle = L.pattern.reduce((s, [t]) => s + t, 0);
      } else {
        if (!videos[L.src]) {
          videos[L.src] = Object.assign(document.createElement('video'),
            { src: L.src, muted: true, loop: true, playsInline: true, preload: 'auto', crossOrigin: 'anonymous' });
        }
        L.video = videos[L.src];
        L.frame = makeCanvas(W, H);
        if (L.flash) {
          L.stillMasked = masked(img, L.mask, W, H);
          L.probe = makeCanvas(64, 100);
          const p = L.probe.getContext('2d'); p.drawImage(L.stillMasked, 0, 0, 64, 100);
          L.baseLuma = avgLuma(L.probe);
          L.highlight = makeCanvas(W, H);
        }
      }
      return L;
    });
    this.videos = Object.values(videos);
  }

  LivingPainting.prototype.play = function () {
    this.startedAt = performance.now();
    this.videos.forEach(v => { v.currentTime = 0; v.play().catch(() => {}); });   // start together, in step
  };
  LivingPainting.prototype.pause = function () { this.videos.forEach(v => v.pause()); };
  LivingPainting.prototype.ready = function () {
    return this.videos.every(v => v.readyState >= 2) && this.images.every(i => i.complete && i.naturalWidth);
  };

  // light level for a flicker layer at time t (seconds)
  function flickerLevel(L, t) {
    let u = t % L.cycle;
    for (const [dur, level] of L.pattern) { if (u < dur) return level; u -= dur; }
    return 1;
  }

  LivingPainting.prototype.render = function (now) {
    const { W, H, ctx } = this;
    // keep loops of different files in step (they share a length but can drift apart)
    const lead = this.videos[0];
    if (lead) this.videos.slice(1).forEach(v => { if (Math.abs(v.currentTime - lead.currentTime) > 0.15) v.currentTime = lead.currentTime; });

    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.drawImage(this.img, 0, 0);
    const t = (now - this.startedAt) / 1000;

    for (const L of this.layers) {
      if (L.type === 'glow') { this.renderGlow(L, t); continue; }
      if (L.type === 'sway') { this.renderSway(L, t); continue; }
      if (L.type === 'flutter') {
        L.gl.uniform1f(L.uT, t); L.gl.drawArrays(L.gl.TRIANGLE_STRIP, 0, 4);
        ctx.drawImage(L.glCanvas, L.box.x, L.box.y);
        continue;
      }
      if (L.type === 'embers') { this.renderEmbers(L, t); continue; }
      if (L.type === 'blink') { this.renderBlink(L, t); continue; }
      if (L.type === 'tear') { this.renderTear(L, t); continue; }
      if (L.type === 'flicker') {
        const level = flickerLevel(L, t);
        if (level < 1) { ctx.globalAlpha = 1 - level; ctx.drawImage(L.offMasked, 0, 0); ctx.globalAlpha = 1; }
        continue;
      }
      const v = L.video, f = L.frame.getContext('2d');
      const sx = L.fit.sx || L.fit.scale, sy = L.fit.sy || L.fit.scale;
      f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1; f.filter = 'none';
      f.clearRect(0, 0, W, H);
      f.drawImage(v, L.fit.x, L.fit.y, v.videoWidth * sx, v.videoHeight * sy);
      f.globalCompositeOperation = 'destination-in';
      f.drawImage(L.mask, 0, 0);

      if (L.flash) {
        // how strong is this frame's flash? (sky brightness vs the still's)
        const p = L.probe.getContext('2d');
        p.clearRect(0, 0, 64, 100); p.drawImage(L.frame, 0, 0, 64, 100);
        const rise = (avgLuma(L.probe) - L.baseLuma) / Math.max(1, L.baseLuma);
        const amount = L.flash.dim * Math.min(1, Math.max(0, (rise - 0.08) / 0.5));
        if (amount > 0.01) {
          // 1) pull the broad glow back toward the dark sky
          f.globalCompositeOperation = 'source-atop';
          f.globalAlpha = amount;
          f.drawImage(L.stillMasked, 0, 0);
          // 2) add the bolt back: only the very brightest new detail survives this filter
          const h = L.highlight.getContext('2d');
          h.globalCompositeOperation = 'source-over'; h.globalAlpha = 1;
          h.clearRect(0, 0, W, H);
          h.filter = 'brightness(0.58) contrast(6)';
          h.drawImage(v, L.fit.x, L.fit.y, v.videoWidth * sx, v.videoHeight * sy);
          h.globalCompositeOperation = 'difference';
          h.drawImage(this.img, 0, 0);          // cancels things already bright in the still (the moon)
          h.filter = 'none';
          h.globalCompositeOperation = 'destination-in';
          h.drawImage(L.mask, 0, 0);
          f.globalCompositeOperation = 'lighter';
          f.globalAlpha = amount;
          f.drawImage(L.highlight, 0, 0);
          f.globalCompositeOperation = 'source-over'; f.globalAlpha = 1;
        }
      }
      ctx.drawImage(L.frame, 0, 0);
    }
    return this.canvas;
  };

  // firelight: each lobe brightens (adds its own lit colour again) or dims (shades it)
  LivingPainting.prototype.renderGlow = function (L, t) {
    const ctx = this.ctx, speed = L.speed || 1, str = L.strength == null ? 0.5 : L.strength;
    for (const s of L.sprites) {
      const v = s.fast ? fire(t * speed * 1.8, s.seed) * 1.3 : fire(t * speed, s.seed);   // embers twinkle faster
      const a = Math.min(1, Math.abs(v) * str * s.depth);
      if (a < 0.01) continue;
      if (v > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.drawImage(s.add, s.x, s.y); }
      else { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * 0.7; ctx.drawImage(s.shade, s.x, s.y); }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  };

  // a faint breeze: thin rows slide sideways, then thin columns slide up/down, by a
  // pixel or so, as a slow travelling wave whose strength swells and settles
  LivingPainting.prototype.renderSway = function (L, t) {
    const { x, y, w, h } = L.box, S = 3, sp = L.speed || 0.35, wl = L.wavelength || 90;
    const gust = 0.55 + 0.45 * vnoise(t * 0.22, 7);
    const amp = (L.amp || 1.2) * gust;
    const r = L.rows.getContext('2d'), c = L.cols.getContext('2d');
    r.clearRect(0, 0, w, h);
    for (let yy = 0; yy < h; yy += S) {
      const ph = (y + yy) / wl - t * sp;
      const dx = amp * (0.7 * Math.sin(ph * 6.283) + 0.3 * Math.sin(ph * 15.1 + 1.3));
      r.drawImage(this.img, x, y + yy, w, S, dx, yy, w, S);
    }
    c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, w, h);
    for (let xx = 0; xx < w; xx += S) {
      const ph = (x + xx) / (wl * 1.3) - t * sp * 0.8;
      const dy = amp * 0.6 * (0.7 * Math.sin(ph * 6.283 + 2) + 0.3 * Math.sin(ph * 13.7));
      c.drawImage(L.rows, xx, 0, S, h, xx, dy, S, h);
    }
    c.globalCompositeOperation = 'destination-in'; c.drawImage(L.boxMask, 0, 0);
    this.ctx.drawImage(L.cols, x, y);
  };

  // sparks: each is born somewhere in the areas, rises with a lazy side-to-side
  // drift, glows, flickers and burns out — then is reborn somewhere else
  LivingPainting.prototype.renderEmbers = function (L, t) {
    const k = L.layer.getContext('2d');
    k.globalCompositeOperation = 'source-over'; k.clearRect(0, 0, this.W, this.H);
    k.globalCompositeOperation = 'lighter';
    for (const p of L.parts) {
      const cycle = p.life + p.gap, tt = t + p.offset, gen = Math.floor(tt / cycle), age = tt - gen * cycle;
      if (age > p.life) continue;
      const spot = L.spots[Math.floor((hash(p.i * 7.3 + gen * 1.91) * 0.5 + 0.5) * L.spots.length) % L.spots.length];
      const x = spot[0] + p.drift * age + p.sway * Math.sin(age * p.freq * 6.283 + p.i);
      const y = spot[1] - p.rise * age;
      const u = age / p.life;
      const a = smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u)) * (0.75 + 0.25 * vnoise(t * 6 + p.i * 3, p.i));
      if (a < 0.02) continue;
      const s = p.size * 4 * (1 - 0.35 * u);           // the sprite's glow is ~4x the hot core
      k.globalAlpha = a;
      k.drawImage(L.sprite, x - s / 2, y - s / 2, s, s);
    }
    k.globalAlpha = 1;
    k.globalCompositeOperation = 'destination-in'; k.drawImage(L.mask, 0, 0);
    this.ctx.globalCompositeOperation = 'lighter'; this.ctx.drawImage(L.layer, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
  };

  // eyelids: the closed-eyes face is revealed from the top of each eye downward
  LivingPainting.prototype.renderBlink = function (L, t) {
    if (!L.closedMasked) return;
    const u0 = t % L.schedule.cycle;
    let lid = 0;
    for (const b of L.schedule.list) { const v = lidAt(u0 - b); if (v > lid) lid = v; if (b > u0) break; }
    if (lid <= 0) return;
    const k = L.lid.getContext('2d');
    for (const e of L.eyes) {
      const pad = 6, ex = e.x - pad, ey = e.y - pad, ew = e.w + pad * 2, eh = e.h + pad * 2;
      k.globalCompositeOperation = 'source-over'; k.clearRect(ex, ey, ew, eh);
      k.drawImage(L.closedMasked, ex, ey, ew, eh, ex, ey, ew, eh);
      const line = e.y + e.h * lid, soft = Math.max(3, e.h * 0.25);
      const g = k.createLinearGradient(0, line - soft, 0, line + soft);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      k.globalCompositeOperation = 'destination-in'; k.fillStyle = g; k.fillRect(ex, ey, ew, eh);
      this.ctx.globalAlpha = Math.min(1, lid * 3);
      this.ctx.drawImage(L.lid, ex, ey, ew, eh, ex, ey, ew, eh);
      this.ctx.globalAlpha = 1;
    }
  };

  // a single tear: wells up at the eye, then creeps down so slowly it is barely
  // noticed at first, leaving a faint wet sheen; then it is gone for a while
  LivingPainting.prototype.renderTear = function (L, t) {
    const ctx = this.ctx, u = t % L.cycle, size = L.size || 4;
    let s, grow = 1, alpha = 1;
    if (u < L.well) { s = 0; grow = smoothstep(0, 1, u / L.well); }
    else if (u < L.well + L.travel) { const k = (u - L.well) / L.travel; s = L.length * Math.pow(k, 1.7); }
    else if (u < L.well + L.travel + L.fade) { s = L.length; alpha = 1 - (u - L.well - L.travel) / L.fade; grow = 0.6 + 0.4 * alpha; }
    else return;
    const p = along(L.path, s);
    // wet sheen along the way it has come
    if (s > 1) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.07 * alpha;
      ctx.strokeStyle = '#ffe6dc'; ctx.lineWidth = size * 0.4; ctx.lineCap = 'round'; ctx.filter = 'blur(0.8px)';
      ctx.beginPath(); ctx.moveTo(L.path[0][0], L.path[0][1]);
      let acc = 0;
      for (let i = 1; i < L.path.length; i++) { const seg = Math.hypot(L.path[i][0] - L.path[i - 1][0], L.path[i][1] - L.path[i - 1][1]); if (acc + seg >= s) break; acc += seg; ctx.lineTo(L.path[i][0], L.path[i][1]); }
      ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.restore();
    }
    const rx = size * 0.78 * grow, ry = size * (0.8 + 0.35 * grow) * grow;
    if (rx < 0.4) return;
    const ang = Math.atan2(p.dy, p.dx) - Math.PI / 2;
    const cx = p.x, cy = p.y - ry * 0.25;
    ctx.save(); ctx.globalAlpha = alpha;
    // soft contact shadow just below
    ctx.fillStyle = 'rgba(30,8,4,0.28)'; ctx.filter = 'blur(1.2px)';
    ctx.beginPath(); ctx.ellipse(cx + 0.5, cy + ry * 0.45, rx * 1.05, ry * 0.9, ang, 0, 6.283); ctx.fill();
    ctx.filter = 'none';
    // the drop itself: a little upside-down magnified view of the skin beneath (a lens)
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, ang, 0, 6.283); ctx.clip();
    ctx.translate(cx, cy); ctx.scale(1.5, -1.5);
    ctx.drawImage(this.img, cx - rx * 2, cy - ry * 2, rx * 4, ry * 4, -rx * 2, -ry * 2, rx * 4, ry * 4);
    ctx.restore();
    // darker rim (top) and a bright glint upper-left, faint caustic lower-right
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    const rim = ctx.createRadialGradient(0, ry * 0.25, Math.min(rx, ry) * 0.3, 0, 0, Math.max(rx, ry) * 1.02);
    rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.75, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(25,6,4,0.45)');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    // the water body: a faint pale sheen, brighter toward the bottom where light pools
    const body = ctx.createLinearGradient(0, -ry, 0, ry);
    body.addColorStop(0, 'rgba(255,235,225,0.05)'); body.addColorStop(1, 'rgba(255,235,225,0.22)');
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,248,240,0.9)'; ctx.beginPath(); ctx.ellipse(-rx * 0.35, -ry * 0.35, rx * 0.26, ry * 0.2, -0.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,200,0.3)'; ctx.beginPath(); ctx.ellipse(rx * 0.3, ry * 0.45, rx * 0.35, ry * 0.18, 0.4, 0, 6.283); ctx.fill();
    ctx.restore();
    ctx.restore();
  };

  global.LivingPainting = LivingPainting;
})(window);
