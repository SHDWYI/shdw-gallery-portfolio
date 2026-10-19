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
   • a neon layer: a sign's lit lines hum, and now and then stutter off and on
       { type: 'neon', areas, key: { minLum, fullLum }, every: [min, max] }
   • a glitch layer: a region tears into shifted, colour-split slices for a
       moment, then snaps back   { type: 'glitch', rect: [x, y, w, h], every, dur, shift }
   • a pulse layer: a gem beating like a heart (lub-dub) with a soft glow
       { type: 'pulse', x, y, r, glow, period, color }
   • a rain layer: thin streaks falling across the whole painting
       { type: 'rain', count, speed: [min, max], length: [min, max], slant, alpha }
   • a ripples layer: raindrops landing on a wet floor (perspective rings)
       { type: 'ripples', areas, exclude?, count, size: [min, max], life: [min, max] }
   • a currents layer: the whole background flows slowly like deep water, and
       every so often a ring wave spreads out from a point (WebGL)
       { type: 'currents', amp, scale, speed, keep: { box, maxLum, grow },
         ripple: { x, y, every: [min, max], speed, width, amp, first } }
       keep = a dark silhouette (found by luminance inside box) that stays still
   • a twinkle layer: the painted stars shimmer; the brightest now and then flare
       { type: 'twinkle', areas?, count, flares, minContrast }
   • a bubbles layer: tiny bubbles rising from a point, wobbling, fading to stars
       { type: 'bubbles', x, y, every, rise: [min, max], size: [min, max], life }
   • a balloon layer: a balloon in the art becomes a separate piece that bobs,
       now and then inflates, trembles and POPS, then grows back
       { type: 'balloon', clean: { src, fit }, box, key: { rg }, pivot, every }
       clean = an AI edit of the art without the balloon (fit like blink's)
   • a blow layer: new balloons (some heart-shaped) inflate at a point, float
       up to one side and pop   { type: 'blow', from: [x, y], every, life }
   • a gaze layer: the eyes' shine (and a hint of the pupils) shifts toward
       whoever is looking — set painting.gaze = { x, y } in -1..1
       { type: 'gaze', eyes: [{ x, y, r, socket }], shift, pupilShift }
   • a blush layer: cheeks blush as painting.proximity (0..1) rises
       { type: 'blush', spots: [{ x, y, rx, ry }], strength }
   • a breathe layer (put it last): a soft squash-and-stretch of a region
       { type: 'breathe', box: [x, y, w, h], pivot: [x, y], amount, period }
   • flutter layers may carry flap: { every, dur } — then they only move in
       short bursts (an ear flap) and rest in between
   • a cards layer: playing cards drifting down one by one, tumbling; each flip
       to the face side glitches; they land, lie flat and fade
       { type: 'cards', every: [min, max], fall: [min, max] px/s, size: [min, max],
         lanes: [[x0, x1], ...], floor: [y0, y1] }
   • a blink layer: a closed-eyes version of the face, wiped down like eyelids
       { type: 'blink', src, fit, eyes: [{ x, y, w, h }], areas, every: [min, max] }
   • a tear layer: a glassy droplet that wells up and creeps down a path
       { type: 'tear', path: [[x, y], ...], size, well, travel, fade, rest }

   config.intro (optional): a one-time opening video that ends on the art
       { src, fit, fade, onceKey }
       Until it plays the painting shows the video's first frame; play() runs
       it, the last `fade` seconds cross-fade into the living painting, and
       the layers' clock starts when it ends. restartIntro() puts it back to
       the void to play again. With onceKey it plays only once per browser
       session (sessionStorage); without, once per page load.
       poster: 'art' — the painting lives normally until startIntro() is
       called (the clip starts and ends on the art; it fades in and out).
       lazy: true — the clip only downloads after prefetch().

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
    uniform float reach, amp, wl, t, speed, gain;
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
      vec2 off = amp * gain * w * gust * (perp * (0.75 * bend + 0.45 * flick) + dir * 0.2 * flick);
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
    gl.uniform1f(u('gain'), 1);
    gl.viewport(0, 0, b.w, b.h);
    L.gl = gl; L.glCanvas = c; L.uT = u('t'); L.uGain = u('gain');
    if (L.flap) L.flapSched = eventTimes(L.flap.every || [5, 9], 61 + L.anchor[0] % 7);
    return true;
  }

  // ---- currents: slow water-like flow over the whole painting + ring waves ----
  const CURRENTS_FS = `
    precision mediump float;
    uniform sampler2D img, keep;
    uniform vec2 size;
    uniform float t, amp, scale, speed;
    uniform vec3 ring;            // x, y, radius (radius < 0: no ring)
    uniform vec3 ringShape;       // width, strength, glow
    varying vec2 uv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main(){
      vec2 p = uv * size;
      vec2 q = p / scale;
      // two drifting noise fields make a lazy, swirling current
      vec2 off = vec2(noise(q + vec2(t * speed, 0.0)) - 0.5, noise(q + vec2(5.2, t * speed * 0.8)) - 0.5);
      off += 0.5 * vec2(noise(q * 2.3 - vec2(0.0, t * speed * 1.4)) - 0.5, noise(q * 2.3 + vec2(t * speed * 1.2, 3.7)) - 0.5);
      off *= amp * 2.0;
      float glow = 0.0;
      if (ring.z >= 0.0) {
        vec2 r = p - ring.xy; float d = length(r);
        float band = exp(-pow((d - ring.z) / ringShape.x, 2.0));
        off += normalize(r + 0.001) * band * ringShape.y * sin((d - ring.z) / ringShape.x * 3.14159);
        glow = band * ringShape.z;
      }
      float k = 1.0 - texture2D(keep, uv).a;        // the silhouette stays still
      vec3 c = texture2D(img, (p - off * k) / size).rgb;
      c += glow * k * vec3(0.55, 0.85, 1.0);
      gl_FragColor = vec4(c, 1.0);
    }`;
  function buildCurrents(L, img, W, H) {
    const c = makeCanvas(W, H), gl = c.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!gl) return false;
    // the silhouette to keep still: dark pixels inside the box, grown a little
    const keep = makeCanvas(W, H);
    if (L.keep) {
      const [bx, by, bw, bh] = L.keep.box, s = makeCanvas(W, H).getContext('2d', { willReadFrequently: true });
      s.drawImage(img, 0, 0);
      const d = s.getImageData(bx, by, bw, bh), kd = new ImageData(bw, bh);
      for (let i = 0; i < d.data.length; i += 4) if (0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2] < (L.keep.maxLum || 45)) kd.data[i + 3] = 255;
      const raw = makeCanvas(W, H); raw.getContext('2d').putImageData(kd, bx, by);
      const k = keep.getContext('2d'); k.filter = `blur(${L.keep.grow || 6}px)`;
      for (let n = 0; n < 3; n++) k.drawImage(raw, 0, 0);
    }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, FLUTTER_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, CURRENTS_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    [[0, img], [1, keep]].forEach(([unit, src]) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    });
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('img'), 0); gl.uniform1i(u('keep'), 1);
    gl.uniform2f(u('size'), W, H);
    gl.uniform1f(u('amp'), L.amp || 2.5); gl.uniform1f(u('scale'), L.scale || 260); gl.uniform1f(u('speed'), L.speed || 0.05);
    gl.viewport(0, 0, W, H);
    L.gl = gl; L.glCanvas = c; L.uT = u('t'); L.uRing = u('ring'); L.uRingShape = u('ringShape');
    if (L.ripple) L.sched = eventTimes(L.ripple.every || [20, 30], 41);
    return true;
  }

  // ---- twinkle: the painting's own stars (sharp bright points) ----
  function buildTwinkle(L, img, W, H) {
    const a = makeCanvas(W, H).getContext('2d', { willReadFrequently: true }); a.drawImage(img, 0, 0);
    const b = makeCanvas(W, H).getContext('2d', { willReadFrequently: true }); b.filter = 'blur(6px)'; b.drawImage(img, 0, 0);
    const d = a.getImageData(0, 0, W, H).data, bl = b.getImageData(0, 0, W, H).data;
    const area = L.areas ? L.mask.getContext('2d').getImageData(0, 0, W, H).data : null;
    const lum = (q, i) => 0.299 * q[i] + 0.587 * q[i + 1] + 0.114 * q[i + 2], stars = [];
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const i = (y * W + x) * 4; if (area && area[i + 3] < 128) continue;
      const c = lum(d, i) - lum(bl, i); if (c < (L.minContrast || 45)) continue;
      let peak = true;
      for (let dy = -2; dy <= 2 && peak; dy++) for (let dx = -2; dx <= 2; dx++) if (lum(d, i + (dy * W + dx) * 4) > lum(d, i)) { peak = false; break; }
      if (peak) stars.push({ x, y, c });
    }
    stars.sort((p, q) => q.c - p.c);
    const pick = [];
    for (const s of stars) { if (pick.length >= (L.count || 140)) break; if (!pick.some(p => Math.abs(p.x - s.x) < 10 && Math.abs(p.y - s.y) < 10)) pick.push(s); }
    L.stars = pick.map((s, n) => {
      const r = 4, cv = makeCanvas(r * 2, r * 2), cx = cv.getContext('2d'), id = cx.createImageData(r * 2, r * 2);
      for (let yy = 0; yy < r * 2; yy++) for (let xx = 0; xx < r * 2; xx++) {
        const i = ((s.y - r + yy) * W + (s.x - r + xx)) * 4, j = (yy * r * 2 + xx) * 4, f = 1 - smoothstep(0.3, 1, Math.hypot(xx - r + 0.5, yy - r + 0.5) / r);
        id.data[j] = d[i]; id.data[j + 1] = d[i + 1]; id.data[j + 2] = d[i + 2]; id.data[j + 3] = 255 * f;
      }
      cx.putImageData(id, 0, 0);
      return { x: s.x - r, y: s.y - r, cx: s.x, cy: s.y, sprite: cv, seed: n * 1.37, rate: 0.6 + (hash(n * 3.1) * 0.5 + 0.5) * 1.6, flare: n < (L.flares || 8) };
    });
    // a soft four-point glint
    const G = 48, gc = makeCanvas(G, G), g = gc.getContext('2d');
    const rg = g.createRadialGradient(G / 2, G / 2, 0, G / 2, G / 2, G / 2);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.12, 'rgba(190,235,255,0.6)'); rg.addColorStop(0.4, 'rgba(120,190,255,0.12)'); rg.addColorStop(1, 'rgba(80,140,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, G, G);
    g.globalCompositeOperation = 'lighter';
    [[G, 1.6], [1.6, G]].forEach(([w, h]) => { const lg = g.createRadialGradient(G / 2, G / 2, 0, G / 2, G / 2, G / 2); lg.addColorStop(0, 'rgba(220,245,255,0.9)'); lg.addColorStop(1, 'rgba(150,200,255,0)'); g.fillStyle = lg; g.fillRect((G - w) / 2, (G - h) / 2, w, h); });
    L.glint = gc;
    L.flareSched = eventTimes(L.flareEvery || [3, 7], 53);
  }

  // ---- balloons ----
  const BALLOON_COLORS = {
    pink: ['#ffc6df', '#f06ba8', '#b52f6c'], blue: ['#d2f6ff', '#5ccdf0', '#2786ad'],
    heart: ['#ffb8c6', '#ff4d74', '#b0103a'], lilac: ['#ead6ff', '#b58cf2', '#7646b8'], mint: ['#d8fff0', '#62e0b5', '#22936c']
  };
  // a glossy party balloon (round or heart), knot at the bottom, string trailing
  function drawBalloon(ctx, x, y, r, colors, heart, alpha, tilt) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(tilt);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, r * 1.08); ctx.bezierCurveTo(r * 0.35, r * 1.6, -r * 0.35, r * 2.1, r * 0.1, r * 2.7); ctx.stroke();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.08, 0, 0, r * 1.25);
    g.addColorStop(0, colors[0]); g.addColorStop(0.45, colors[1]); g.addColorStop(1, colors[2]);
    ctx.fillStyle = g;
    if (heart) { ctx.save(); ctx.scale(r * 1.05, r * 1.05); suitPath(ctx, 'h', false); ctx.restore(); ctx.fill(); }   // (path is fixed when traced; fill with the unscaled gradient)
    else { ctx.beginPath(); ctx.ellipse(0, 0, r * 0.88, r, 0, 0, 6.283); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(-r * 0.12, r * 1.08); ctx.lineTo(r * 0.12, r * 1.08); ctx.lineTo(0, r * 0.94); ctx.closePath(); ctx.fill();   // knot
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.2, r * 0.12, -0.6, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  // a pop: white starburst lines and shreds of rubber flying out (u: 0..1)
  function drawPop(ctx, x, y, size, u, color, seed) {
    const k = 1 - u;
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${(0.95 * k).toFixed(3)})`; ctx.lineWidth = 2.5 * k + 0.5;
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.283 + seed, r0 = size * (0.35 + 0.9 * u), r1 = size * (0.65 + 1.4 * u);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.fillStyle = color; ctx.globalAlpha = k;
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * 6.283 + hash(seed + i * 3.1), v = size * (0.9 + 1.3 * (hash(seed + i * 7.7) * 0.5 + 0.5));
      ctx.save(); ctx.translate(x + Math.cos(a) * v * u, y + Math.sin(a) * v * u + 60 * u * u); ctx.rotate(a + u * 7);
      ctx.fillRect(-size * 0.1, -size * 0.045, size * 0.2, size * 0.09); ctx.restore();
    }
    ctx.restore();
  }
  // fill unknown pixels smoothly from known ones (pull-push): average down to 1×1,
  // then back up, each level filling its gaps from the smoother level below.
  // rgba = image data (rgba bytes), known = 0..1 per pixel; returns rgba-like array.
  function pullPush(rgba, known, W, H) {
    const levels = [];
    let w = W, h = H, c = new Float32Array(W * H * 3), k = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) { const a = known[i]; k[i] = a; c[i * 3] = rgba[i * 4] * a; c[i * 3 + 1] = rgba[i * 4 + 1] * a; c[i * 3 + 2] = rgba[i * 4 + 2] * a; }
    levels.push({ w, h, c, k });
    while (w > 1 || h > 1) {
      const nw = Math.max(1, (w + 1) >> 1), nh = Math.max(1, (h + 1) >> 1), nc = new Float32Array(nw * nh * 3), nk = new Float32Array(nw * nh);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = y * w + x, d = (y >> 1) * nw + (x >> 1);
        nk[d] += k[s]; nc[d * 3] += c[s * 3]; nc[d * 3 + 1] += c[s * 3 + 1]; nc[d * 3 + 2] += c[s * 3 + 2];
      }
      for (let i = 0; i < nw * nh; i++) { const f = Math.min(1, nk[i]) / Math.max(1e-6, nk[i]); nk[i] *= f; nc[i * 3] *= f; nc[i * 3 + 1] *= f; nc[i * 3 + 2] *= f; }   // weight caps at 1
      w = nw; h = nh; c = nc; k = nk; levels.push({ w, h, c, k });
    }
    let up = null;
    for (let li = levels.length - 1; li >= 0; li--) {
      const L = levels[li], out = new Float32Array(L.w * L.h * 3);
      for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x, a = Math.min(1, L.k[i]);
        let ur = 0, ug = 0, ub = 0;
        if (up) {   // bilinear sample of the coarser level
          const U = levels[li + 1], fx = Math.min(U.w - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(U.h - 1, Math.max(0, (y - 0.5) / 2));
          const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(U.w - 1, x0 + 1), y1 = Math.min(U.h - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
          for (let j = 0; j < 3; j++) {
            const v00 = up[(y0 * U.w + x0) * 3 + j], v10 = up[(y0 * U.w + x1) * 3 + j], v01 = up[(y1 * U.w + x0) * 3 + j], v11 = up[(y1 * U.w + x1) * 3 + j];
            const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
            if (j === 0) ur = v; else if (j === 1) ug = v; else ub = v;
          }
        }
        const own = a > 0 ? 1 / L.k[i] : 0;
        out[i * 3] = L.c[i * 3] * own * a + ur * (1 - a);
        out[i * 3 + 1] = L.c[i * 3 + 1] * own * a + ug * (1 - a);
        out[i * 3 + 2] = L.c[i * 3 + 2] * own * a + ub * (1 - a);
      }
      up = out;
    }
    const res = new Float32Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { res[i * 4] = up[i * 3]; res[i * 4 + 1] = up[i * 3 + 1]; res[i * 4 + 2] = up[i * 3 + 2]; }
    return res;
  }

  // the art's own balloon cut out as a sprite, plus a patch of the AI "no balloon"
  // edit. The balloon is whatever differs between the art and that edit; the patch
  // is colour-matched to the art around it so no ghost of the balloon shows.
  function buildBalloon(L, img, W, H, done) {
    const [bx, by, bw, bh] = L.box, n = bw * bh;
    L.sched = eventTimes(L.every || [12, 18], 71);
    const c = new Image(); c.crossOrigin = 'anonymous';
    c.onload = () => {
      const a = makeCanvas(W, H).getContext('2d', { willReadFrequently: true }); a.drawImage(img, 0, 0);
      const b = makeCanvas(W, H).getContext('2d', { willReadFrequently: true });
      b.drawImage(c, L.clean.fit.x, L.clean.fit.y, c.naturalWidth * L.clean.fit.scale, c.naturalHeight * L.clean.fit.scale);
      const p = a.getImageData(bx, by, bw, bh).data, q = b.getImageData(bx, by, bw, bh).data, m = new Float32Array(n);
      // 1) the balloon = a big difference between art and edit (finds the shadowed
      //    neck against his head) OR clearly saturated pink (finds the top, which is
      //    close in colour to the pink backdrop)
      const rg = (L.key && L.key.rg) || 80, pinkM = new Float32Array(n);
      for (let i = 0, k = 0; k < n; k++, i += 4) pinkM[k] = p[i] >= p[i + 2] * 0.92 ? smoothstep(rg - 12, rg + 12, p[i] - p[i + 1]) : 0;
      // the difference test only counts right next to the pink (the AI also redrew
      // nearby bits like the hair tuft, which must stay put)
      const near = makeCanvas(bw, bh), nx = near.getContext('2d', { willReadFrequently: true });
      const pc = makeCanvas(bw, bh), pcx = pc.getContext('2d'), pid = pcx.createImageData(bw, bh);
      for (let k = 0; k < n; k++) pid.data[k * 4 + 3] = 255 * pinkM[k];
      pcx.putImageData(pid, 0, 0);
      nx.filter = 'blur(12px)'; for (let r = 0; r < 4; r++) nx.drawImage(pc, 0, 0);
      const nd = nx.getImageData(0, 0, bw, bh).data;
      for (let i = 0, k = 0; k < n; k++, i += 4) {
        const dd = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
        m[k] = Math.max(smoothstep(L.diff ? L.diff[0] : 45, L.diff ? L.diff[1] : 90, dd) * smoothstep(10, 60, nd[i + 3]), pinkM[k]);
      }
      // fill holes: anything not reachable from the box edge through non-balloon is balloon
      const out = new Uint8Array(n), st = [];
      for (let x = 0; x < bw; x++) st.push(x, (bh - 1) * bw + x);
      for (let y = 0; y < bh; y++) st.push(y * bw, y * bw + bw - 1);
      while (st.length) { const k = st.pop(); if (out[k] || m[k] > 0.5) continue; out[k] = 1; const x = k % bw, y = (k / bw) | 0;
        if (x > 0) st.push(k - 1); if (x < bw - 1) st.push(k + 1); if (y > 0) st.push(k - bw); if (y < bh - 1) st.push(k + bw); }
      for (let k = 0; k < n; k++) if (!out[k]) m[k] = 1;
      const spr = makeCanvas(bw, bh), sx = spr.getContext('2d'), sd = sx.createImageData(bw, bh);
      for (let i = 0, k = 0; k < n; k++, i += 4) { sd.data[i] = p[i]; sd.data[i + 1] = p[i + 1]; sd.data[i + 2] = p[i + 2]; sd.data[i + 3] = 255 * m[k]; }
      sx.putImageData(sd, 0, 0);
      L.sprite = spr;
      // 2) where to paint the edit: the balloon's shape grown and feathered
      const grow = makeCanvas(bw, bh), gx = grow.getContext('2d', { willReadFrequently: true });
      gx.filter = 'blur(11px)'; for (let k = 0; k < 6; k++) gx.drawImage(spr, 0, 0);   // wide enough to take its shadow on his head too
      const gm = gx.getImageData(0, 0, bw, bh).data;
      // 3) what's behind the balloon:
      //    • the pink backdrop: filled in from the real backdrop around it (pull-push:
      //      shrink the art-with-a-hole level by level, then grow it back underneath),
      //      so it is the art's own smooth gradient — no seam, no ghost
      //    • his head (where the balloon's neck sat on it): the AI edit, shifted to
      //      the art's colour measured on the head just around it
      const known = new Float32Array(n);
      for (let i = 0, k = 0; k < n; k++, i += 4) known[k] = gm[i + 3] < 8 && q[i + 2] <= q[i] + 10 ? 1 : 0;   // backdrop clear of the balloon
      const fill = pullPush(p, known, bw, bh);
      const off = [0, 0, 0]; let cnt = 0;                               // head colour shift
      for (let i = 0, k = 0; k < n; k++, i += 4) if (gm[i + 3] > 20 && m[k] < 0.05 && q[i + 2] > q[i] + 20) { off[0] += p[i] - q[i]; off[1] += p[i + 1] - q[i + 1]; off[2] += p[i + 2] - q[i + 2]; cnt++; }
      if (cnt) off.forEach((v, j) => off[j] = v / cnt);
      const patch = makeCanvas(bw, bh), px = patch.getContext('2d'), pd = px.createImageData(bw, bh);
      for (let i = 0; i < pd.data.length; i += 4) {
        const head = smoothstep(5, 25, q[i + 2] - q[i]);                // the edit shows blue head here
        for (let j = 0; j < 3; j++) pd.data[i + j] = fill[i + j] * (1 - head) + (q[i + j] + off[j]) * head;
        pd.data[i + 3] = gm[i + 3];
      }
      px.putImageData(pd, 0, 0);
      L.patch = patch;
    };
    c.src = L.clean.src;
    done(c);
  }
  // the eyes as movable parts: the whites (socket, with the pupil filled in from
  // the white around it), the pupil (with its shine erased) and the shine itself.
  // Pupil and socket are ellipses { x, y, rx, ry } in still pixels.
  function buildGaze(L, img, W, H) {
    const s = makeCanvas(W, H).getContext('2d', { willReadFrequently: true }); s.drawImage(img, 0, 0);
    const inside = (x, y, e, k = 1) => Math.pow((x - e.x) / (e.rx * k), 2) + Math.pow((y - e.y) / (e.ry * k), 2) < 1;
    L.eyeParts = L.eyes.map(e => {
      const so = e.socket, x0 = Math.floor(so.x - so.rx - 2), y0 = Math.floor(so.y - so.ry - 2);
      const SW = Math.ceil(so.rx * 2 + 4), SH = Math.ceil(so.ry * 2 + 4);
      const p = s.getImageData(x0, y0, SW, SH).data, n = SW * SH;
      const lum = i => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      // 1) shine = anything lighter than the black, well inside the pupil
      const K = new Float32Array(n);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) K[y * SW + x] = inside(x0 + x, y0 + y, e, 0.86) ? smoothstep(10, 45, lum((y * SW + x) * 4)) : 0;
      // 2) the pupil without its shine (shine + a 3px margin painted black), soft-edged
      const pupil = makeCanvas(SW, SH), shine = makeCanvas(SW, SH);
      const pd = pupil.getContext('2d').createImageData(SW, SH), hd = shine.getContext('2d').createImageData(SW, SH);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const i = (y * SW + x) * 4, X = x0 + x, Y = y0 + y;
        let kk = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < SW && yy < SH) kk = Math.max(kk, K[yy * SW + xx]); }
        const dn = Math.sqrt(Math.pow((X - e.x) / e.rx, 2) + Math.pow((Y - e.y) / e.ry, 2));
        const edge = 1 - smoothstep(0.96, 1.03, dn);                     // soft rim
        pd.data[i] = p[i] * (1 - kk) + 6 * kk; pd.data[i + 1] = p[i + 1] * (1 - kk) + 6 * kk; pd.data[i + 2] = p[i + 2] * (1 - kk) + 8 * kk; pd.data[i + 3] = 255 * edge;
        hd.data[i] = p[i]; hd.data[i + 1] = p[i + 1]; hd.data[i + 2] = p[i + 2]; hd.data[i + 3] = 255 * K[y * SW + x];
      }
      pupil.getContext('2d').putImageData(pd, 0, 0); shine.getContext('2d').putImageData(hd, 0, 0);
      // 3) the whites with the pupil filled in from the white around it
      const known = new Float32Array(n);
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const X = x0 + x, Y = y0 + y;
        known[y * SW + x] = inside(X, Y, so, 0.97) && !inside(X, Y, e, 1.08) && lum((y * SW + x) * 4) > 70 ? 1 : 0;
      }
      const f = pullPush(p, known, SW, SH), white = makeCanvas(SW, SH), wd = white.getContext('2d').createImageData(SW, SH);
      for (let i = 0; i < n * 4; i += 4) { wd.data[i] = known[i / 4] ? p[i] : f[i]; wd.data[i + 1] = known[i / 4] ? p[i + 1] : f[i + 1]; wd.data[i + 2] = known[i / 4] ? p[i + 2] : f[i + 2]; wd.data[i + 3] = 255; }
      white.getContext('2d').putImageData(wd, 0, 0);
      return { e, so, x0, y0, white, pupil, shine };
    });
    L.g = { x: 0, y: 0 };
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

  // ---- shared helpers for the glitchy layers ----
  // a canvas split into its cyan (green+blue) and red parts: drawing cyan then
  // adding red with 'lighter' rebuilds the image; offsetting red = colour split
  function channelSplit(src) {
    const part = color => {
      const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
      return c;
    };
    return { cyan: part('rgb(0,255,255)'), red: part('rgb(255,0,0)') };
  }
  // draws `split` (from channelSplit) torn into horizontal bands: each band slides
  // sideways and its red part slides a little further. seed picks the tear.
  // `split` may be a pair of splits: each band then comes from one or the other,
  // so the tear scrambles between two versions (e.g. Japanese and English name)
  function drawTorn(ctx, splits, x, y, w, h, seed, amount, shift, mix = 0.5) {
    let by = 0, n = 0;
    while (by < h) {
      const split = Array.isArray(splits) ? splits[(hash(seed + n * 11.3) * 0.5 + 0.5) < mix ? 1 : 0] : splits;
      const bh = Math.max(2, Math.round(h * (0.06 + 0.22 * (hash(seed + n * 1.7) * 0.5 + 0.5))));
      const hit = hash(seed + n * 3.3) > -0.2;                      // some bands stay put
      const dx = hit ? hash(seed + n * 5.9) * shift * amount : 0;
      const sy = hit && hash(seed + n * 7.1) > 0.6 ? Math.max(0, Math.min(h - bh, by + Math.round(hash(seed + n * 9.4) * h * 0.3))) : by;  // borrow a slice from elsewhere
      const rs = (2 + 4 * amount) * (hash(seed + n) > 0 ? 1 : -1);
      const hh = Math.min(bh, h - by);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(split.cyan, 0, sy, w, hh, x + dx, y + by, w, hh);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(split.red, 0, sy, w, hh, x + dx + rs, y + by, w, hh);
      by += bh; n++;
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // the region with its painted lettering swapped for other text: the old letters
  // are filled in from the background around them, then the new text is written
  // in the same column, one letter per original character, in the same colour.
  // alt = { text, column: [x0, x1, yMax], font, size }   (column in still pixels)
  function altText(region, alt, rx, ry) {
    const w = region.width, h = region.height;
    const src = region.getContext('2d').getImageData(0, 0, w, h), d = src.data;
    const [cx0, cx1, yMax] = alt.column, lum = i => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // 1) which pixels are lettering (pale, low-saturation) inside the column
    const txt = makeCanvas(w, h), tx = txt.getContext('2d'), td = tx.createImageData(w, h);
    let top = h, bot = 0, cr = 0, cg = 0, cb = 0, cn = 0;
    for (let y = 0; y < Math.min(h, yMax - ry); y++) for (let x = cx0 - rx; x < cx1 - rx; x++) {
      const i = (y * w + x) * 4, l = lum(i), mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (l > 62 && (mx - mn) / Math.max(1, mx) < 0.45) {
        td.data[i + 3] = 255; if (y < top) top = y; if (y > bot) bot = y;
        if (l > 150) { cr += d[i]; cg += d[i + 1]; cb += d[i + 2]; cn++; }
      }
    }
    tx.putImageData(td, 0, 0);
    // grow the lettering mask a little so the soft edges go too
    const grow = makeCanvas(w, h), gx = grow.getContext('2d');
    gx.filter = 'blur(2.5px)'; gx.drawImage(txt, 0, 0); gx.drawImage(txt, 0, 0); gx.drawImage(txt, 0, 0); gx.filter = 'none';
    // 2) background estimate: blur only the non-letter pixels (alpha-normalised)
    const bg = makeCanvas(w, h), bx = bg.getContext('2d');
    bx.drawImage(region, 0, 0); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(grow, 0, 0);
    const fill = makeCanvas(w, h), fx = fill.getContext('2d');
    fx.filter = 'blur(7px)'; fx.drawImage(bg, 0, 0); fx.filter = 'blur(14px)'; fx.globalCompositeOperation = 'destination-over'; fx.drawImage(bg, 0, 0);
    fx.filter = 'none'; fx.globalCompositeOperation = 'source-over';
    const fd = fx.getImageData(0, 0, w, h);                 // colours come back un-premultiplied:
    for (let i = 3; i < fd.data.length; i += 4) fd.data[i] = 255;   // make the estimate fully opaque
    fx.putImageData(fd, 0, 0);
    // 3) original with the letters replaced by that background
    const out = makeCanvas(w, h), ox = out.getContext('2d');
    ox.drawImage(region, 0, 0);
    const patch = makeCanvas(w, h), px = patch.getContext('2d');
    px.drawImage(fill, 0, 0); px.globalCompositeOperation = 'destination-in'; px.drawImage(grow, 0, 0);
    ox.drawImage(patch, 0, 0);
    // 4) the new letters, spread over the same span, one per original character
    const chars = [...alt.text], n = chars.length, glyph = (bot - top) / n * 0.85;
    const step = (bot - top - glyph) / Math.max(1, n - 1), size = alt.size || glyph * 1.15;
    ox.fillStyle = cn ? `rgb(${cr / cn | 0},${cg / cn | 0},${cb / cn | 0})` : '#eee';
    ox.font = `${alt.weight || 300} ${size}px ${alt.font || "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"}`;
    ox.textAlign = 'center'; ox.textBaseline = 'middle';
    ox.shadowColor = 'rgba(255,225,215,0.35)'; ox.shadowBlur = 3;
    const cx = (cx0 + cx1) / 2 - rx;
    chars.forEach((ch, i) => ox.fillText(ch, cx, top + glyph / 2 + i * step));
    ox.shadowBlur = 0;
    return out;
  }

  // irregular event times (seconds) repeating with a long cycle
  function eventTimes(every, seed, n = 48) {
    const list = []; let at = every[0] * 0.5 + seed % 3;
    for (let i = 0; i < n; i++) { list.push(at); at += every[0] + (every[1] - every[0]) * (hash(i * 4.3 + seed) * 0.5 + 0.5); }
    return { list, cycle: at };
  }
  // seconds since the latest event started (Infinity if none yet this cycle)
  function sinceEvent(sched, t) {
    const u = t % sched.cycle; let since = Infinity;
    for (const e of sched.list) { if (e > u) break; since = u - e; }
    return since;
  }
  // a running count of events so far (to vary which thing each event picks)
  function eventIndex(sched, t) {
    const u = t % sched.cycle; let n = 0;
    for (const e of sched.list) { if (e > u) break; n++; }
    return Math.floor(t / sched.cycle) * sched.list.length + Math.max(0, n - 1);
  }
  // per-pixel weight sprites (add = the lit pixels again, shade = black over them)
  function weightSprites(img, W, H, box, weightAt) {
    const src = makeCanvas(W, H).getContext('2d', { willReadFrequently: true });
    src.drawImage(img, 0, 0);
    const s = src.getImageData(box.x, box.y, box.w, box.h).data;
    const add = makeCanvas(box.w, box.h), shade = makeCanvas(box.w, box.h);
    const ad = add.getContext('2d').createImageData(box.w, box.h), sd = shade.getContext('2d').createImageData(box.w, box.h);
    for (let yy = 0; yy < box.h; yy++) for (let xx = 0; xx < box.w; xx++) {
      const i = (yy * box.w + xx) * 4, m = weightAt(box.x + xx, box.y + yy, s[i], s[i + 1], s[i + 2]);
      if (m <= 0) continue;
      ad.data[i] = s[i]; ad.data[i + 1] = s[i + 1]; ad.data[i + 2] = s[i + 2]; ad.data[i + 3] = 255 * Math.min(1, m);
      sd.data[i + 3] = 255 * Math.min(1, m);
    }
    add.getContext('2d').putImageData(ad, 0, 0); shade.getContext('2d').putImageData(sd, 0, 0);
    return { add, shade };
  }

  // ---- playing cards, drawn once at load (suits as paths: no emoji fonts) ----
  function suitPath(c, suit, fill = true) {
    c.beginPath();
    if (suit === 'd') { c.moveTo(0, -1); c.lineTo(0.72, 0); c.lineTo(0, 1); c.lineTo(-0.72, 0); c.closePath(); }
    else if (suit === 'h') {
      c.moveTo(0, 0.95); c.bezierCurveTo(-1.15, 0.15, -1, -0.95, -0.5, -0.95); c.bezierCurveTo(-0.2, -0.95, 0, -0.68, 0, -0.45);
      c.bezierCurveTo(0, -0.68, 0.2, -0.95, 0.5, -0.95); c.bezierCurveTo(1, -0.95, 1.15, 0.15, 0, 0.95); c.closePath();
    } else if (suit === 's') {
      c.moveTo(0, -1); c.bezierCurveTo(1.15, -0.25, 1, 0.7, 0.5, 0.7); c.bezierCurveTo(0.25, 0.7, 0.1, 0.58, 0.06, 0.42);
      c.lineTo(0.28, 1); c.lineTo(-0.28, 1); c.lineTo(-0.06, 0.42);
      c.bezierCurveTo(-0.1, 0.58, -0.25, 0.7, -0.5, 0.7); c.bezierCurveTo(-1, 0.7, -1.15, -0.25, 0, -1); c.closePath();
    } else {   // clubs
      [[0, -0.5], [-0.47, 0.08], [0.47, 0.08]].forEach(([x, y]) => { c.moveTo(x + 0.4, y); c.arc(x, y, 0.4, 0, 6.283); });
      c.moveTo(0, -0.1); c.lineTo(0.28, 1); c.lineTo(-0.28, 1); c.closePath();
    }
    if (fill) c.fill();
  }
  const CW = 120, CH = 168;
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function cardFace(rank, suit) {
    const cv = makeCanvas(CW, CH), c = cv.getContext('2d');
    roundRect(c, 1, 1, CW - 2, CH - 2, 10);
    const g = c.createLinearGradient(0, 0, CW, CH); g.addColorStop(0, '#efe6d2'); g.addColorStop(1, '#cfc2a8');
    c.fillStyle = g; c.fill(); c.save(); c.clip();
    c.strokeStyle = 'rgba(120,90,40,0.45)'; c.lineWidth = 1.5; roundRect(c, 7, 7, CW - 14, CH - 14, 6); c.stroke();
    const ink = suit === 'h' || suit === 'd' ? '#8a1420' : '#151216';
    c.fillStyle = ink;
    const corner = () => {
      c.font = 'bold 24px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(rank, 18, 32);
      c.save(); c.translate(18, 46); c.scale(8, 8); suitPath(c, suit); c.restore();
    };
    corner(); c.save(); c.translate(CW, CH); c.rotate(Math.PI); corner(); c.restore();
    c.save(); c.translate(CW / 2, CH / 2);
    if (/[KQJ]/.test(rank)) { c.font = 'bold 54px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(rank, 0, -6); c.translate(0, 34); c.scale(11, 11); suitPath(c, suit); }
    else { c.scale(rank === 'A' ? 30 : 22, rank === 'A' ? 30 : 22); suitPath(c, suit); }
    c.restore(); c.restore();
    return litCard(cv);
  }
  // the back: deep blood red, darkest at the edges, with a dim antique-gold
  // double border, corner flourishes, a faint lattice and a diamond medallion
  function cardBack() {
    const cv = makeCanvas(CW, CH), c = cv.getContext('2d'), gold = 'rgba(140,108,58,', mx = CW / 2, my = CH / 2;
    roundRect(c, 1, 1, CW - 2, CH - 2, 10);
    const g = c.createRadialGradient(mx, my, 6, mx, my, CH * 0.62);
    g.addColorStop(0, '#3e070b'); g.addColorStop(0.6, '#290406'); g.addColorStop(1, '#130102');
    c.fillStyle = g; c.fill(); c.save(); c.clip();
    // faint lattice, inside the inner border only
    c.save(); roundRect(c, 13, 13, CW - 26, CH - 26, 4); c.clip();
    c.strokeStyle = gold + '0.10)'; c.lineWidth = 0.8;
    for (let d = -CH; d < CW + CH; d += 9) { c.beginPath(); c.moveTo(d, 0); c.lineTo(d + CH, CH); c.moveTo(d, CH); c.lineTo(d + CH, 0); c.stroke(); }
    c.restore();
    // double border
    c.strokeStyle = gold + '0.75)'; c.lineWidth = 1.6; roundRect(c, 7, 7, CW - 14, CH - 14, 6); c.stroke();
    c.strokeStyle = gold + '0.45)'; c.lineWidth = 0.8; roundRect(c, 11.5, 11.5, CW - 23, CH - 23, 4); c.stroke();
    // corner flourishes: a small inward arc and a dot
    [[16, 16, 0], [CW - 16, 16, 1], [CW - 16, CH - 16, 2], [16, CH - 16, 3]].forEach(([x, y, q]) => {
      c.save(); c.translate(x, y); c.rotate(q * Math.PI / 2);
      c.strokeStyle = gold + '0.6)'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, 9, 0, Math.PI / 2); c.stroke();
      c.fillStyle = gold + '0.7)'; c.beginPath(); c.arc(4, 4, 1.4, 0, 6.283); c.fill();
      c.restore();
    });
    // diamond medallion with a spade
    const diamond = (rx, ry) => { c.beginPath(); c.moveTo(mx, my - ry); c.lineTo(mx + rx, my); c.lineTo(mx, my + ry); c.lineTo(mx - rx, my); c.closePath(); };
    diamond(30, 44); c.fillStyle = '#1c0204'; c.fill(); c.strokeStyle = gold + '0.8)'; c.lineWidth = 1.5; c.stroke();
    diamond(23, 34); c.strokeStyle = gold + '0.4)'; c.lineWidth = 0.8; c.stroke();
    c.fillStyle = gold + '0.85)'; c.save(); c.translate(mx, my); c.scale(11, 11); suitPath(c, 's'); c.restore();
    [[mx, my - 54], [mx, my + 54]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 1.8, 0, 6.283); c.fill(); });
    c.restore();
    return litCard(cv);
  }
  // match the scene: dim, slightly violet light, so cards don't glow like UI
  function litCard(cv) {
    const c = cv.getContext('2d');
    c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgb(178,166,192)'; c.fillRect(0, 0, CW, CH);
    c.globalCompositeOperation = 'destination-in'; roundRect(c, 1, 1, CW - 2, CH - 2, 10); c.fill();
    c.globalCompositeOperation = 'source-over';
    return { img: cv, split: channelSplit(cv) };
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
      } else if (L.type === 'currents') {
        if (!buildCurrents(L, img, W, H)) L.type = 'none';          // no WebGL: stay still
      } else if (L.type === 'twinkle') {
        buildTwinkle(L, img, W, H);
      } else if (L.type === 'bubbles' || L.type === 'blow' || L.type === 'blush') {
        // drawn fresh each frame; nothing to prepare
      } else if (L.type === 'balloon') {
        buildBalloon(L, img, W, H, im => this.images.push(im));
      } else if (L.type === 'gaze') {
        buildGaze(L, img, W, H);
      } else if (L.type === 'breathe') {
        L.temp = makeCanvas(L.box[2], L.box[3]);
      } else if (L.type === 'neon') {
        const k = Object.assign({ minLum: 60, fullLum: 150 }, L.key), b = boundsOf(L.mask, W, H);
        const md = L.mask.getContext('2d').getImageData(0, 0, W, H).data;
        L.box = b;
        L.sprites = weightSprites(img, W, H, b, (x, y, r, g, bl) => md[(y * W + x) * 4 + 3] / 255 * smoothstep(k.minLum, k.fullLum, 0.299 * r + 0.587 * g + 0.114 * bl));
        L.sched = eventTimes(L.every || [3, 9], 11);
      } else if (L.type === 'glitch') {
        const [x, y, w, h] = L.rect, c = makeCanvas(w, h);
        c.getContext('2d').drawImage(img, -x, -y);
        L.split = channelSplit(c);
        L.sched = eventTimes(L.every || [6, 11], 23);
        if (L.alt) { L.altImg = altText(c, L.alt, x, y); L.altSplit = channelSplit(L.altImg); }
      } else if (L.type === 'pulse') {
        const R = L.r, b = { x: Math.round(L.x - R), y: Math.round(L.y - R), w: R * 2, h: R * 2 };
        L.box = b;
        L.sprites = weightSprites(img, W, H, b, (x, y, r, g) =>
          (1 - smoothstep(0.6, 1, Math.hypot(x - L.x, y - L.y) / R)) * smoothstep(60, 160, r) * smoothstep(0.35, 0.65, (r - g) / Math.max(1, r)));
        const G = L.glow, gc = makeCanvas(G * 2, G * 2), gx = gc.getContext('2d');
        const grad = gx.createRadialGradient(G, G, 0, G, G, G);
        grad.addColorStop(0, L.color || 'rgba(255,40,50,0.9)'); grad.addColorStop(0.35, 'rgba(200,10,30,0.35)'); grad.addColorStop(1, 'rgba(120,0,10,0)');
        gx.fillStyle = grad; gx.fillRect(0, 0, G * 2, G * 2);
        L.glowSprite = gc;
      } else if (L.type === 'rain' || L.type === 'ripples') {
        L.layer = makeCanvas(W, H);
        if (L.type === 'ripples') {
          const d = L.mask.getContext('2d').getImageData(0, 0, W, H).data; L.spots = [];
          for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) if (d[(y * W + x) * 4 + 3] > 220) L.spots.push([x, y]);
        }
      } else if (L.type === 'cards') {
        const ranks = ['A', 'K', 'Q', 'J', '7', 'A', '3', 'A'], suits = ['s', 'h', 'c', 'd'];
        L.faces = ranks.map((r, i) => cardFace(r, suits[i % 4]));
        L.back = cardBack();
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
    if (config.intro) this.setupIntro(config.intro);
  }

  // ---- the one-time intro ----
  const seen = key => { try { return sessionStorage.getItem(key) === '1'; } catch (e) { return false; } };
  LivingPainting.prototype.setupIntro = function (cfg) {
    if (cfg.onceKey && seen(cfg.onceKey)) return;             // already watched this visit
    this.intro = { cfg };
    this.restartIntro();
  };
  // back to the empty void, ready to play the intro again (a fresh <video> each
  // time: rewinding needs a server that supports range requests)
  LivingPainting.prototype.restartIntro = function () {
    const I = this.intro; if (!I) return;
    if (I.v) { I.v.pause(); I.v.removeAttribute('src'); I.v.load(); }
    const lazy = I.cfg.lazy && !I.fetched;
    const v = I.v = Object.assign(document.createElement('video'),
      { src: I.cfg.src, muted: true, playsInline: true, preload: lazy ? 'none' : 'auto', crossOrigin: 'anonymous' });
    I.state = 'waiting'; I.fadeStart = null;
    if (I.cfg.poster !== 'art') {
      this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.fillStyle = '#03040c'; this.ctx.fillRect(0, 0, this.W, this.H);
      this.dirty = true;
    }
    // until it plays, the painting is the empty void (the video's first frame)
    v.addEventListener('loadeddata', () => { if (I.v === v && I.state === 'waiting' && I.cfg.poster !== 'art') { this.drawIntroFrame(); this.dirty = true; } }, { once: true });
    v.addEventListener('ended', () => {
      if (I.v !== v) return;
      I.state = 'done';
      if (I.fadeStart == null) this.startedAt = performance.now();   // (the layers' clock normally starts with the fade)
      this.videos.forEach(x => x.play().catch(() => {}));
      try { if (I.cfg.onceKey) sessionStorage.setItem(I.cfg.onceKey, '1'); } catch (e) {}
    });
  };
  LivingPainting.prototype.drawIntroFrame = function (alpha = 1) {
    const { v, cfg } = this.intro, f = cfg.fit;
    this.ctx.globalCompositeOperation = 'source-over'; this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(v, f.x, f.y, v.videoWidth * f.scale, v.videoHeight * f.scale);
    this.ctx.globalAlpha = 1;
  };

  // start downloading a lazy intro (call when the visitor gets near)
  LivingPainting.prototype.prefetch = function () {
    const I = this.intro;
    if (I && I.v.preload === 'none') { I.fetched = true; I.v.preload = 'auto'; I.v.load(); }
  };
  // for poster:'art' intros — play the clip now
  LivingPainting.prototype.startIntro = function () {
    const I = this.intro;
    if (!I || I.state !== 'waiting') return;
    this.prefetch();
    I.state = 'playing'; I.v.play().catch(() => {});
  };

  LivingPainting.prototype.play = function () {
    const I = this.intro;
    if (I && (I.state === 'playing' || (I.state === 'waiting' && I.cfg.poster !== 'art'))) {   // start (or resume) the intro
      this.prefetch();
      I.state = 'playing'; I.v.play().catch(() => {});
      return;
    }
    this.startedAt = performance.now();
    this.videos.forEach(v => { v.currentTime = 0; v.play().catch(() => {}); });   // start together, in step
  };
  LivingPainting.prototype.pause = function () {
    if (this.intro && this.intro.state === 'playing') this.intro.v.pause();
    this.videos.forEach(v => v.pause());
  };
  LivingPainting.prototype.ready = function () {
    const I = this.intro;
    if (I && (I.state === 'playing' || (I.state === 'waiting' && I.cfg.poster !== 'art')) && I.v.readyState < 2) return false;
    return this.videos.every(v => v.readyState >= 2) && this.images.every(i => i.complete && i.naturalWidth);
  };

  // light level for a flicker layer at time t (seconds)
  function flickerLevel(L, t) {
    let u = t % L.cycle;
    for (const [dur, level] of L.pattern) { if (u < dur) return level; u -= dur; }
    return 1;
  }

  LivingPainting.prototype.render = function (now) {
    const I = this.intro;
    if (I && I.state !== 'done' && !(I.state === 'waiting' && I.cfg.poster === 'art')) {
      if (I.state === 'waiting') return this.canvas;          // the void, until play()
      const v = I.v, fade = I.cfg.fade || 0.8, left = v.duration - v.currentTime;
      if (I.cfg.poster === 'art' && v.currentTime < (I.cfg.fadeIn || 0.25)) {   // ease in from the living painting
        this.renderLayers(now);
        this.drawIntroFrame(v.currentTime / (I.cfg.fadeIn || 0.25));
        return this.canvas;
      }
      if (!(left < fade)) { this.drawIntroFrame(); return this.canvas; }
      // last moments: the living painting comes up underneath and the video fades out
      if (I.fadeStart == null) { I.fadeStart = now; this.startedAt = now; }
      this.renderLayers(now);
      this.drawIntroFrame(Math.max(0, Math.min(1, left / fade)));
      return this.canvas;
    }
    return this.renderLayers(now);
  };

  LivingPainting.prototype.renderLayers = function (now) {
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
        if (L.flap) {                                   // bursts only: rest = the untouched still
          const s = sinceEvent(L.flapSched, t), dur = L.flap.dur || 0.9;
          if (s >= dur) continue;
          L.gl.uniform1f(L.uGain, Math.sin(Math.PI * s / dur));
        }
        L.gl.uniform1f(L.uT, t); L.gl.drawArrays(L.gl.TRIANGLE_STRIP, 0, 4);
        ctx.drawImage(L.glCanvas, L.box.x, L.box.y);
        continue;
      }
      if (L.type === 'embers') { this.renderEmbers(L, t); continue; }
      if (L.type === 'currents') { this.renderCurrents(L, t); continue; }
      if (L.type === 'twinkle') { this.renderTwinkle(L, t); continue; }
      if (L.type === 'bubbles') { this.renderBubbles(L, t); continue; }
      if (L.type === 'balloon') { this.renderBalloon(L, t); continue; }
      if (L.type === 'blow') { this.renderBlow(L, t); continue; }
      if (L.type === 'gaze') { this.renderGaze(L, t); continue; }
      if (L.type === 'blush') { this.renderBlush(L, t); continue; }
      if (L.type === 'breathe') { this.renderBreathe(L, t); continue; }
      if (L.type === 'none') continue;
      if (L.type === 'neon') { this.renderNeon(L, t); continue; }
      if (L.type === 'glitch') { this.renderGlitch(L, t); continue; }
      if (L.type === 'pulse') { this.renderPulse(L, t); continue; }
      if (L.type === 'rain') { this.renderRain(L, t); continue; }
      if (L.type === 'ripples') { this.renderRipples(L, t); continue; }
      if (L.type === 'cards') { this.renderCards(L, t); continue; }
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

  // currents: draws the whole painting, gently flowing, with any ring wave in it
  LivingPainting.prototype.renderCurrents = function (L, t) {
    const gl = L.gl, R = L.ripple;
    gl.uniform1f(L.uT, t);
    let radius = -1, fade = 0;
    if (R) {
      let since = (R.first != null && t >= R.first && t < R.first + 8) ? t - R.first : sinceEvent(L.sched, t);
      radius = since * (R.speed || 130);
      fade = 1 - smoothstep(0.55, 1, radius / (R.reach || 900));
      if (fade <= 0) radius = -1;
    }
    gl.uniform3f(L.uRing, R ? R.x : 0, R ? R.y : 0, radius);
    gl.uniform3f(L.uRingShape, R ? R.width || 40 : 1, R ? (R.amp || 6) * fade : 0, R ? (R.glow || 0.06) * fade : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.ctx.drawImage(L.glCanvas, 0, 0);
  };

  // twinkle: each star brightens and dims at its own pace; now and then one of
  // the brightest flares with a soft four-point glint
  LivingPainting.prototype.renderTwinkle = function (L, t) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of L.stars) {
      const v = vnoise(t * s.rate, s.seed) * 1.4;
      if (v > 0.15) { ctx.globalAlpha = Math.min(1, (v - 0.15) * 1.3); ctx.drawImage(s.sprite, s.x, s.y); }
    }
    // flares: one of the brightest stars at each event
    const since = sinceEvent(L.flareSched, t), dur = 1.6, flares = L.stars.filter(s => s.flare);
    if (since < dur && flares.length) {
      const s = flares[eventIndex(L.flareSched, t) % flares.length];
      const k = Math.sin(Math.PI * since / dur), sz = 34 * (0.6 + 0.4 * k);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = k * 0.9;
      ctx.drawImage(L.glint, s.cx - sz / 2, s.cy - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  };

  // bubbles: little glassy rings rising from a point with a lazy wobble; near the
  // end of their rise they shrink into a bright point and wink out, like stars
  LivingPainting.prototype.renderBubbles = function (L, t) {
    const ctx = this.ctx, every = L.every || 1.6, [r0, r1] = L.rise || [18, 32], [s0, s1] = L.size || [1.6, 4], life = L.life || 5;
    const R = (k, s, lo, hi) => lo + (hi - lo) * (hash(k * 9.7 + s * 3.3) * 0.5 + 0.5);
    for (let k = Math.max(0, Math.floor((t - life) / every) - 1); k <= Math.floor(t / every); k++) {
      if (hash(k * 5.5) < -0.35) continue;                         // irregular: some beats skip
      const start = k * every + hash(k * 1.9) * every * 0.4, age = t - start;
      if (age < 0 || age > life) continue;
      const u = age / life, rise = R(k, 1, r0, r1), size = R(k, 2, s0, s1);
      const x = L.x + R(k, 3, -4, 4) + age * R(k, 4, 2, 7) + Math.sin(age * R(k, 5, 2, 3.5) + k) * R(k, 6, 1.5, 4);
      const y = L.y - rise * age - 4 * age * age * 0.2;
      const a = smoothstep(0, 0.08, u) * (1 - smoothstep(0.75, 1, u));
      const r = size * (1 + 0.3 * u) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 * 0.7 : 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(10,40,90,0.35)'; ctx.lineWidth = 2;          // a faint dark rim reads on bright water
      ctx.beginPath(); ctx.arc(x, y, r + 0.6, 0, 6.283); ctx.stroke();
      ctx.strokeStyle = 'rgba(235,252,255,0.95)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
      ctx.fillStyle = 'rgba(200,240,255,0.15)'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, Math.max(0.5, r * 0.28), 0, 6.283); ctx.fill();
      if (u > 0.7) {                                              // becoming a star
        const k2 = Math.sin(Math.PI * (u - 0.7) / 0.3), g = 6 + 8 * k2;
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = k2 * 0.8;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, g); grad.addColorStop(0, 'rgba(235,250,255,1)'); grad.addColorStop(1, 'rgba(120,200,255,0)');
        ctx.fillStyle = grad; ctx.fillRect(x - g, y - g, g * 2, g * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.globalAlpha = 1;
  };

  // the head balloon: always bobbing on its base; every so often it inflates,
  // trembles, POPS, is gone for a beat, then grows back with a springy overshoot
  LivingPainting.prototype.renderBalloon = function (L, t) {
    if (!L.patch) return;                                    // clean plate still loading: leave the art as is
    const ctx = this.ctx, [bx, by, bw, bh] = L.box, [px, py] = L.pivot;
    const since = sinceEvent(L.sched, t);
    let s = 1, show = true, pop = -1;
    const T = { inflate: 1.7, tremble: 0.3, pop: 0.5, gone: 0.9, regrow: 1.3 };
    const t1 = T.inflate, t2 = t1 + T.tremble, t3 = t2 + T.pop, t4 = t3 + T.gone, t5 = t4 + T.regrow;
    if (since < t1) { const u = since / t1; s = 1 + 0.42 * u * u * (3 - 2 * u) + 0.03 * Math.sin(since * 18) * u; }
    else if (since < t2) s = 1.42 + 0.025 * Math.sin(since * 70);
    else if (since < t4) { show = false; if (since < t3) pop = (since - t2) / T.pop; }
    else if (since < t5) { const u = (since - t4) / T.regrow; s = 1 - Math.exp(-6 * u) * Math.cos(9 * u); s = Math.max(0.05, s); }
    // the head without its balloon
    ctx.drawImage(L.patch, bx, by);
    if (show) {
      const sway = 0.06 * Math.sin(t * 1.1) + 0.025 * Math.sin(t * 2.6 + 1);
      ctx.save(); ctx.translate(px, py); ctx.rotate(sway); ctx.scale(s * (1 - 0.012 * Math.sin(t * 1.9)), s * (1 + 0.015 * Math.sin(t * 1.9)));
      ctx.drawImage(L.sprite, bx - px, by - py);
      ctx.restore();
    }
    if (pop >= 0) {   // centre of the balloon, scaled up as it was when it burst
      const cx = px + (bx + bw / 2 - px) * 1.42, cy = py + (by + bh * 0.42 - py) * 1.42;
      drawPop(ctx, cx, cy, bw * 0.5, pop, '#e8609e', Math.floor(t / L.sched.cycle));
    }
  };

  // blowing balloons: one grows at the trunk tip, lets go, drifts up to one side
  // (clear of his face) and pops near the top; about a third are hearts
  LivingPainting.prototype.renderBlow = function (L, t) {
    const ctx = this.ctx, [fx, fy] = L.from, every = L.every || 7, grow = 1.5, fly = L.life || 6;
    const R = (k, s, lo, hi) => lo + (hi - lo) * (hash(k * 13.1 + s * 4.7) * 0.5 + 0.5);
    const names = ['pink', 'blue', 'lilac', 'mint'];
    for (let k = Math.max(0, Math.floor((t - grow - fly - 0.6) / every) - 1); k <= Math.floor(t / every); k++) {
      const start = k * every + 2 + hash(k * 2.3) * every * 0.3, age = t - start;
      if (age < 0 || age > grow + fly + 0.6) continue;
      const heart = hash(k * 9.1) > 0.3 ? false : true, colors = BALLOON_COLORS[heart ? 'heart' : names[Math.floor(R(k, 1, 0, 4)) % 4]];
      const r = R(k, 2, L.size ? L.size[0] : 40, L.size ? L.size[1] : 56), side = hash(k * 5.3) > 0 ? 1 : -1;
      if (age < grow) {                                      // being blown up at the trunk
        const u = age / grow, rr = r * (0.12 + 0.88 * u * u * (3 - 2 * u)) * (1 + 0.04 * Math.sin(age * 20));
        drawBalloon(ctx, fx, fy + rr * 1.08, rr, colors, heart, 1, Math.PI);   // knot at the trunk, hanging down
      } else if (age < grow + fly) {                         // floating away
        // first swing out sideways (clear of his face), then rise
        const u = (age - grow) / fly, out = smoothstep(0, 0.28, u), rise = smoothstep(0.12, 1, u);
        const x = fx + side * (R(k, 3, 250, 330) * out + 60 * rise) + 14 * Math.sin(age * 1.4 + k) * out;
        const y = fy - 30 * out - R(k, 4, 650, 780) * rise;
        drawBalloon(ctx, x, y, r, colors, heart, 1, 0.12 * Math.sin(age * 1.7 + k) + side * 0.15 * (1 - u));
      } else {                                               // pop!
        const x = fx + side * (R(k, 3, 250, 330) + 60), y = fy - 30 - R(k, 4, 650, 780);
        drawPop(ctx, x, y, r * 1.1, (age - grow - fly) / 0.6, colors[1], k);
      }
    }
  };

  // eyes follow whoever is looking: the pupils drift a touch, the shine more
  LivingPainting.prototype.renderGaze = function (L, t) {
    const ctx = this.ctx, target = this.gaze || { x: 0, y: 0 }, g = L.g;
    g.x += (Math.max(-1, Math.min(1, target.x)) - g.x) * 0.12;   // eased, so it glides
    g.y += (Math.max(-1, Math.min(1, target.y)) - g.y) * 0.12;
    // pupils move toward the viewer inside the whites; when the viewer is close the
    // two eyes also turn in a little (they focus on you); the shine moves less
    // than the pupil (it's a reflection of a fixed light)
    const ps = L.pupilShift || 6, hs = L.shift || ps * 0.5, conv = (L.converge || 0) * Math.max(0, Math.min(1, this.proximity || 0));
    L.eyeParts.forEach((P, idx) => {
      const { e, so, x0, y0 } = P, side = idx === 0 ? 1 : -1;
      const k = e.rx / 52;                                       // the farther (narrower) eye moves less
      const dx = (g.x + conv * side) * ps * k, dy = g.y * ps;
      ctx.save(); ctx.beginPath(); ctx.ellipse(so.x, so.y, so.rx - 0.5, so.ry - 0.5, 0, 0, 6.283); ctx.clip();
      ctx.drawImage(P.white, x0, y0);                            // the whites, no pupil
      ctx.drawImage(P.pupil, x0 + dx, y0 + dy);                  // the pupil, moved
      ctx.beginPath(); ctx.ellipse(e.x + dx, e.y + dy, e.rx * 0.95, e.ry * 0.95, 0, 0, 6.283); ctx.clip();
      ctx.drawImage(P.shine, x0 + dx * hs / ps, y0 + dy * hs / ps);
      ctx.restore();
    });
  };

  // cheeks: a soft pink glow that rises as you come close
  LivingPainting.prototype.renderBlush = function (L, t) {
    const a = (L.strength || 0.45) * Math.max(0, Math.min(1, this.proximity || 0)) * (0.9 + 0.1 * Math.sin(t * 2));
    if (a < 0.01) return;
    const ctx = this.ctx;
    for (const s of L.spots) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.scale(1, s.ry / s.rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s.rx);
      g.addColorStop(0, `rgba(255,110,165,${a.toFixed(3)})`); g.addColorStop(1, 'rgba(255,110,165,0)');
      ctx.fillStyle = g; ctx.fillRect(-s.rx, -s.rx, s.rx * 2, s.rx * 2);
      ctx.restore();
    }
  };

  // breathing: the whole region (already composited) squashes and stretches a hair
  LivingPainting.prototype.renderBreathe = function (L, t) {
    const [x, y, w, h] = L.box, [px, py] = L.pivot, k = Math.sin(t * 6.283 / (L.period || 3.2)), a = L.amount || 0.005;
    const sy = 1 + a * k, sx = 1 + a * 0.45 * k;
    const tc = L.temp.getContext('2d'); tc.clearRect(0, 0, w, h); tc.drawImage(this.canvas, x, y, w, h, 0, 0, w, h);
    this.ctx.drawImage(L.temp, px - (px - x) * sx, py - (py - y) * sy, w * sx, h * sy);
  };

  // neon: a faint electrical hum, and every few seconds a stutter (off-on-off-dim-on)
  const NEON_STUTTER = [[0.05, 0], [0.06, 1], [0.04, 0], [0.12, 0.45], [0.06, 0], [0.09, 1.25]];
  LivingPainting.prototype.renderNeon = function (L, t) {
    const ctx = this.ctx, since = sinceEvent(L.sched, t);
    let level = 1 + 0.07 * vnoise(t * 9, 5);
    if (since < 0.42) { let u = since; for (const [d, v] of NEON_STUTTER) { if (u < d) { level = v; break; } u -= d; } }
    const { x, y } = L.box;
    if (level < 1) { ctx.globalAlpha = Math.min(1, (1 - level) * 0.85); ctx.drawImage(L.sprites.shade, x, y); }
    else if (level > 1) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, (level - 1) * 1.6); ctx.drawImage(L.sprites.add, x, y); }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  };

  // glitch: for a moment the region tears into colour-split slices, re-tearing
  // every ~60ms, then snaps back to the untouched original
  // with `alt`: glitch over to the other text, hold it, glitch back
  LivingPainting.prototype.renderGlitch = function (L, t) {
    const since = sinceEvent(L.sched, t), dur = L.dur || 0.5, [x, y, w, h] = L.rect;
    const tear = (s, d, splits, mix) => {
      const step = Math.floor(s / 0.06), amount = 0.5 + 0.5 * Math.sin(Math.PI * s / d);
      if (hash(step * 2.1 + Math.floor(t / L.sched.cycle)) < -0.55) return false;   // brief clean flashes inside the burst
      drawTorn(this.ctx, splits, x, y, w, h, step * 13.7 + Math.floor(t * 0.01), amount, L.shift || 14, mix);
      return true;
    };
    if (!L.alt) { if (since < dur) tear(since, dur, L.split); return; }
    const hold = L.hold || 2.4;
    if (since < dur) {                                       // into the other text
      if (!tear(since, dur, [L.split, L.altSplit], since / dur) && since > dur * 0.5) this.ctx.drawImage(L.altImg, x, y);
    } else if (since < dur + hold) {                          // holding it
      this.ctx.drawImage(L.altImg, x, y);
    } else if (since < dur * 2 + hold) {                      // and back
      const s = since - dur - hold;
      if (!tear(s, dur, [L.split, L.altSplit], 1 - s / dur) && s < dur * 0.5) this.ctx.drawImage(L.altImg, x, y);
    }
  };

  // heartbeat: a slow lub-dub, then a long rest; the gem's own red deepens and
  // brightens from within (strength), with only a whisper of light around it (halo)
  LivingPainting.prototype.renderPulse = function (L, t) {
    const ctx = this.ctx, u = t % (L.period || 2.6);
    const bump = (c, w) => Math.exp(-Math.pow((u - c) / w, 2));
    const beat = bump(0.15, 0.14) + 0.6 * bump(0.6, 0.17);
    if (beat < 0.01) return;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, beat * (L.strength == null ? 0.35 : L.strength)); ctx.drawImage(L.sprites.add, L.box.x, L.box.y);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, beat * (L.halo == null ? 0.08 : L.halo)); ctx.drawImage(L.glowSprite, L.x - L.glow, L.y - L.glow);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  };

  // rain: thin slanted streaks; each streak loops top to bottom at its own pace
  // and moves to a new column every pass
  LivingPainting.prototype.renderRain = function (L, t) {
    const { W, H } = this, k = L.layer.getContext('2d'), slant = L.slant || 0.12;
    const [v0, v1] = L.speed || [900, 1400], [l0, l1] = L.length || [18, 42];
    k.clearRect(0, 0, W, H); k.lineCap = 'round';
    for (let i = 0; i < (L.count || 80); i++) {
      const v = v0 + (v1 - v0) * (hash(i * 2.3) * 0.5 + 0.5), len = l0 + (l1 - l0) * (hash(i * 3.9) * 0.5 + 0.5);
      const span = H + len + 60, p = t * v + (hash(i * 5.7) * 0.5 + 0.5) * span, pass = Math.floor(p / span);
      const y = (p % span) - len, x = (hash(i * 7.1 + pass * 1.37) * 0.5 + 0.5) * (W + 80) - 40 - slant * y;
      const a = (L.alpha || 0.16) * (0.5 + 0.5 * (hash(i * 9.2) * 0.5 + 0.5));
      k.strokeStyle = `rgba(215,215,255,${a.toFixed(3)})`; k.lineWidth = 0.7 + 0.6 * (hash(i * 4.4) * 0.5 + 0.5);
      k.beginPath(); k.moveTo(x, y); k.lineTo(x - slant * len, y + len); k.stroke();
    }
    this.ctx.globalCompositeOperation = 'screen'; this.ctx.drawImage(L.layer, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
  };

  // raindrops landing on the wet floor: a quick splash, then thin rings spreading
  // out, flattened by perspective (smaller and flatter further back)
  LivingPainting.prototype.renderRipples = function (L, t) {
    const { W, H } = this, k = L.layer.getContext('2d'), [s0, s1] = L.size || [10, 26], [f0, f1] = L.life || [0.7, 1.3];
    k.clearRect(0, 0, W, H);
    const top = L.spots.length ? L.spots[0][1] : 0, depth = Math.max(1, H - top);
    for (let i = 0; i < (L.count || 14); i++) {
      const life = f0 + (f1 - f0) * (hash(i * 1.9) * 0.5 + 0.5), cycle = life + 0.15 + 0.6 * (hash(i * 6.1) * 0.5 + 0.5);
      const tt = t + hash(i * 8.3) * 10 + 10, gen = Math.floor(tt / cycle), age = tt - gen * cycle;
      if (age > life) continue;
      const [x, y] = L.spots[Math.floor((hash(i * 3.1 + gen * 2.71) * 0.5 + 0.5) * L.spots.length) % L.spots.length];
      const near = 0.55 + 0.45 * (y - top) / depth;                    // closer = bigger
      const u = age / life, size = (s0 + (s1 - s0) * (hash(i * 4.7 + gen) * 0.5 + 0.5)) * near;
      const flat = 0.22 + 0.1 * near;
      for (const [lag, str] of [[0, 1], [0.22, 0.55]]) {
        const v = (u - lag) / (1 - lag); if (v <= 0) continue;
        const r = size * (1 - (1 - v) * (1 - v));
        k.strokeStyle = `rgba(225,220,255,${(0.9 * str * (1 - v)).toFixed(3)})`; k.lineWidth = 1.5 * near;
        k.beginPath(); k.ellipse(x, y, r, r * flat, 0, 0, 6.283); k.stroke();
      }
      if (u < 0.18) { const s = 1 - u / 0.18; k.fillStyle = `rgba(235,235,255,${(0.7 * s).toFixed(3)})`; k.beginPath(); k.ellipse(x, y - 2 * near * (1 - s), 1.3 * near, 1.6 * near, 0, 0, 6.283); k.fill(); }
    }
    k.globalCompositeOperation = 'destination-in'; k.drawImage(L.mask, 0, 0); k.globalCompositeOperation = 'source-over';
    this.ctx.globalCompositeOperation = 'screen'; this.ctx.drawImage(L.layer, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
  };

  // cards: card k starts falling at about k * every; tumbling = in-plane rocking
  // plus a flip around its vertical axis (scaleX = cos). When the face swings
  // into view it glitches for a moment. On the floor it lies flat and fades.
  LivingPainting.prototype.renderCards = function (L, t) {
    const ctx = this.ctx, [e0, e1] = L.every || [3.5, 6], avg = (e0 + e1) / 2;
    const [v0, v1] = L.fall || [70, 110], [z0, z1] = L.size || [34, 50], [fy0, fy1] = L.floor || [this.H - 120, this.H - 30];
    const R = (k, s, lo, hi) => lo + (hi - lo) * (hash(k * 17.3 + s * 5.1) * 0.5 + 0.5);
    const maxLife = (fy1 + 100) / v0 + 3.2;
    for (let k = Math.max(0, Math.floor((t - maxLife) / avg) - 1); k <= Math.floor(t / avg) + 1; k++) {
      const start = k * avg + hash(k * 1.3) * (e1 - e0) * 0.45, age = t - start;
      if (age < 0 || age > maxLife) continue;
      const lane = L.lanes[Math.floor(R(k, 1, 0, L.lanes.length)) % L.lanes.length];
      const w = R(k, 2, z0, z1), h = w * CH / CW, v = R(k, 3, v0, v1), floorY = R(k, 4, fy0, fy1);
      const x0 = R(k, 5, lane[0], lane[1]), sway = R(k, 6, 15, 45), sf = R(k, 7, 0.9, 1.8), sp = R(k, 8, 0, 6.28);
      const rock = R(k, 9, 0.25, 0.6), rot0 = R(k, 10, -0.4, 0.4), fw = R(k, 11, 1.5, 2.8) * (hash(k * 2.9) > 0 ? 1 : -1), f0 = R(k, 12, 0, 6.28);
      const card = { face: L.faces[k % L.faces.length], back: L.back };
      const fallT = (floorY + h) / v;
      const pose = a => ({ x: x0 + sway * Math.sin(a * sf + sp), y: -h + v * a, rot: rot0 + rock * Math.sin(a * sf * 1.3 + sp), phi: f0 + fw * a });
      if (age < fallT) {
        const p = pose(age), sx = Math.cos(p.phi);
        const m = (((p.phi + Math.PI / 2) % 6.283) + 6.283) % 6.283, sinceFace = m < Math.PI ? m / Math.abs(fw) : Infinity;
        // glitch as the face swings open (not while it's still edge-on and too thin to see)
        const g = sinceFace > 0.1 && sinceFace < 0.5 ? Math.sin(Math.PI * (sinceFace - 0.1) / 0.4) : 0;
        this.drawCard(card, p.x, p.y, w, h, p.rot, sx, 1, 1, g, k * 31 + Math.floor(age / 0.05));
      } else {
        const p = pose(fallT), la = age - fallT, end = Math.cos(p.phi) >= 0 ? 1 : -1;
        const k2 = Math.min(1, la / 0.18), sx = Math.cos(p.phi) + (end - Math.cos(p.phi)) * k2, sy = 1 - 0.66 * k2;
        const alpha = 1 - smoothstep(0.8, 3, la);
        if (alpha <= 0) continue;
        if (la < 0.9) {   // the splash where it lands
          const u = la / 0.9, r = w * 0.9 * (1 - (1 - u) * (1 - u));
          ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = `rgba(225,220,255,${(0.5 * (1 - u)).toFixed(3)})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.ellipse(p.x, p.y + h * 0.3, r, r * 0.25, 0, 0, 6.283); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
        this.drawCard(card, p.x, p.y + h * 0.3 * k2, w, h, p.rot, sx, sy, alpha, 0, 0);
      }
    }
  };
  LivingPainting.prototype.drawCard = function (card, x, y, w, h, rot, sx, sy, alpha, glitch, seed) {
    const ctx = this.ctx, face = sx >= 0, src = face ? card.face : card.back;
    if (Math.abs(sx) < 0.03) return;                       // edge-on
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, sy);
    if (glitch > 0 && face) {
      const T = this.cardTemp || (this.cardTemp = makeCanvas(CW + 60, CH)), tx = T.getContext('2d');
      tx.clearRect(0, 0, T.width, T.height);
      drawTorn(tx, src.split, 30, 0, CW, CH, seed, glitch, 26);
      ctx.drawImage(T, -w / 2 - 30 * w / CW, -h / 2, T.width * w / CW, h);
    } else {
      ctx.drawImage(src.img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
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
