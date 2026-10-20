/* Gallery ambience — a quiet, procedural soundscape for each painting.
 *
 * Everything is synthesised with Web Audio (no sound files to download):
 * looping noise "beds" shaped by filters, plus short one-shot events
 * (crackles, drips, pings, chimes…) scheduled a moment ahead of time.
 *
 *   const amb = new GalleryAmbience(audioContext, destinationNode);
 *   amb.setLevel('ren', 0.8, -0.3);   // level 0–1, stereo pan −1…1
 *   amb.tick();                       // once per frame: schedules events, tears down silent scenes
 *
 * A scene's audio graph exists only while its level is above zero (plus a
 * short grace period), so paintings you're far from cost nothing.
 */
(function(){
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];

  function makeNoise(ctx, kind, secs){
    const len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for(let i = 0; i < len; i++){
      const w = Math.random() * 2 - 1;
      if(kind === 'brown'){ last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    // fade the loop seam so it never clicks
    const f = Math.min(2000, len >> 3);
    for(let i = 0; i < f; i++){ const k = i / f; d[i] *= k; d[len - 1 - i] *= k; }
    return buf;
  }

  // ---------------------------------------------------------------- building blocks
  // A looping noise bed through a filter, with an optional slow "breathing" LFO on its level.
  function bed(S, o){
    const c = S.ctx, src = c.createBufferSource();
    src.buffer = o.noise === 'white' ? S.eng.white : S.eng.brown; src.loop = true;
    const f = c.createBiquadFilter(); f.type = o.filter || 'lowpass'; f.frequency.value = o.freq; f.Q.value = o.q || 0.7;
    const g = c.createGain(); g.gain.value = o.gain;
    src.connect(f); f.connect(g); g.connect(S.out);
    src.start(c.currentTime, Math.random() * src.buffer.duration);
    S.nodes.push(src);
    if(o.lfo) lfo(S, g.gain, o.lfo[0], o.gain * o.lfo[1]);
    if(o.sweep) lfo(S, f.frequency, o.sweep[0], o.sweep[1]);
    return g;
  }
  // A steady tone (hum, pad voice).
  function tone(S, o){
    const c = S.ctx, osc = c.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.value = o.freq;
    if(o.detune) osc.detune.value = o.detune;
    let node = osc;
    if(o.lp){ const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    const g = c.createGain(); g.gain.value = o.gain;
    node.connect(g); g.connect(S.out);
    osc.start();
    S.nodes.push(osc);
    if(o.lfo) lfo(S, g.gain, o.lfo[0], o.gain * o.lfo[1]);
    return g;
  }
  function lfo(S, param, rate, depth){
    const c = S.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.value = rate * rnd(0.85, 1.15); g.gain.value = depth;
    o.connect(g); g.connect(param); o.start(c.currentTime, 0);
    S.nodes.push(o);
  }

  // One-shot: a filtered noise burst (crackle, tick, drip splash, thunder…).
  function hit(S, t, o){
    const c = S.ctx, src = c.createBufferSource();
    src.buffer = o.noise === 'brown' ? S.eng.brown : S.eng.white;
    const f = c.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.frequency.value = o.freq; f.Q.value = o.q || 1;
    const g = c.createGain(), a = o.attack || 0.002, dur = o.dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    src.loop = true;   // long events (thunder) may outlast the buffer
    src.connect(f); f.connect(g); g.connect(S.out);
    src.start(t, Math.random() * src.buffer.duration);
    src.stop(t + a + dur + 0.05);
  }
  // One-shot: a pitched blip with a glide (drip, bubble, ping, UI tick, chime, groan).
  function blip(S, t, o){
    const c = S.ctx, osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if(o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.dur));
    let node = osc;
    if(o.lp){ const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    const g = c.createGain(), a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.dur);
    node.connect(g); g.connect(S.out);
    osc.start(t); osc.stop(t + a + o.dur + 0.05);
  }
  // A soft bell/chime: a few inharmonic partials.
  function chime(S, t, f, gain, dur){
    [[1, 1], [2.76, 0.32], [5.4, 0.12]].forEach(([m, k]) => blip(S, t, { f0: f * m, dur: dur / (m > 1 ? 1.8 : 1), gain: gain * k, attack: 0.003 }));
  }

  // ---------------------------------------------------------------- the scenes
  // mix: loudness trim, measured so every scene sits at a similar level.
  // beds: built once when a scene wakes.  events: [ [minGap, maxGap], fn(S, t) ]
  const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
  const SCENES = {
    // first-person underwater horror: deep pressure, sonar, something large far away
    abyss: {
      mix: 0.74,
      beds: S => {
        bed(S, { noise: 'brown', freq: 170, gain: 0.55, lfo: [0.06, 0.35] });
        bed(S, { noise: 'white', filter: 'bandpass', freq: 520, q: 0.8, gain: 0.012, sweep: [0.05, 160] });
        tone(S, { freq: 46, gain: 0.05, lfo: [0.09, 0.5] });
      },
      events: [
        [[7, 12], (S, t) => { blip(S, t, { f0: 1180, f1: 1150, dur: 2.2, gain: 0.05 }); blip(S, t + 0.65, { f0: 1180, f1: 1150, dur: 1.8, gain: 0.018 }); }],
        [[14, 24], (S, t) => blip(S, t, { type: 'sawtooth', f0: 74, f1: 50, dur: 3.6, attack: 1.2, gain: 0.05, lp: 260 })],
        [[3, 7], (S, t) => { const n = 2 + (Math.random() * 4 | 0); for(let i = 0; i < n; i++) blip(S, t + i * rnd(0.05, 0.14), { f0: rnd(380, 600), f1: rnd(900, 1500), dur: 0.05, gain: 0.022 }); }]
      ]
    },
    // zombie survival: cold wind, a dying fluorescent light, groans in the distance
    echoes: {
      mix: 1.24,
      beds: S => {
        bed(S, { noise: 'white', filter: 'bandpass', freq: 380, q: 0.6, gain: 0.07, lfo: [0.11, 0.5], sweep: [0.07, 140] });
        bed(S, { noise: 'brown', freq: 220, gain: 0.25 });
        S.buzz = tone(S, { type: 'sawtooth', freq: 100, gain: 0.0, lp: 2600 });
      },
      events: [
        // the light stutters: quick bursts of electrical buzz
        [[0.6, 3.2], (S, t) => { const g = S.buzz.gain, n = 1 + (Math.random() * 4 | 0); let u = t;
          for(let i = 0; i < n; i++){ const on = rnd(0.03, 0.12); g.setValueAtTime(0.018, u); g.setValueAtTime(0, u + on); u += on + rnd(0.02, 0.09); } }],
        [[9, 17], (S, t) => blip(S, t, { type: 'sawtooth', f0: rnd(105, 125), f1: rnd(78, 92), dur: rnd(1.4, 2.2), attack: 0.35, gain: 0.03, lp: 520 })],
        [[20, 32], (S, t) => hit(S, t, { noise: 'brown', filter: 'lowpass', freq: 110, dur: 4.5, attack: 0.6, gain: 0.7 })]
      ]
    },
    // fire: a low roar, crackles, the odd pop
    redshadow: {
      mix: 1.0,
      beds: S => {
        bed(S, { noise: 'brown', freq: 380, gain: 0.32, lfo: [0.35, 0.25] });
        bed(S, { noise: 'white', filter: 'highpass', freq: 3200, gain: 0.006, lfo: [1.3, 0.6] });
      },
      events: [
        [[0.04, 0.32], (S, t) => hit(S, t, { freq: rnd(1400, 4800), q: 1.4, dur: rnd(0.012, 0.05), gain: rnd(0.04, 0.16) })],
        [[2.5, 6], (S, t) => { hit(S, t, { freq: rnd(700, 1400), q: 0.9, dur: 0.09, gain: 0.25 }); hit(S, t + 0.03, { freq: 3500, q: 1, dur: 0.04, gain: 0.1 }); }]
      ]
    },
    // night rain on wet streets, a neon sign humming, drips
    ren: {
      mix: 1.4,
      beds: S => {
        bed(S, { noise: 'white', filter: 'bandpass', freq: 2600, q: 0.35, gain: 0.08, lfo: [0.08, 0.15] });
        bed(S, { noise: 'brown', freq: 900, gain: 0.16 });
        S.neon = tone(S, { type: 'sawtooth', freq: 60, gain: 0.012, lp: 700 });
        tone(S, { type: 'sine', freq: 120, gain: 0.008 });
      },
      events: [
        [[0.25, 1.1], (S, t) => blip(S, t, { f0: rnd(1500, 2600), f1: rnd(700, 1100), dur: 0.05, gain: rnd(0.012, 0.03) })],
        // the sign stutters now and then (it flickers on the painting too)
        [[3, 8], (S, t) => { const g = S.neon.gain; let u = t; for(let i = 0; i < 3; i++){ g.setValueAtTime(0.03, u); g.setValueAtTime(0.004, u + 0.05); u += rnd(0.07, 0.16); } g.setValueAtTime(0.012, u); }],
        [[24, 40], (S, t) => hit(S, t, { noise: 'brown', filter: 'lowpass', freq: 90, dur: 5, attack: 0.9, gain: 0.55 })]
      ]
    },
    // a mermaid in a nebula: soft underwater hush, a slow shimmering pad, bubbles, twinkles
    requiem: {
      mix: 1.05,
      beds: S => {
        bed(S, { noise: 'brown', freq: 260, gain: 0.22, lfo: [0.07, 0.4] });
        [110, 164.81, 246.94, 329.63].forEach((f, i) => tone(S, { freq: f, detune: rnd(-6, 6), gain: 0.022 - i * 0.003, lfo: [0.05 + i * 0.03, 0.7] }));
      },
      events: [
        [[1.6, 3.6], (S, t) => { const n = 2 + (Math.random() * 3 | 0); for(let i = 0; i < n; i++) blip(S, t + i * rnd(0.08, 0.2), { f0: rnd(300, 520), f1: rnd(800, 1300), dur: 0.07, gain: 0.02 }); }],
        [[1.2, 3.5], (S, t) => chime(S, t, pick(PENTA) * 2, 0.012, 2.6)]
      ]
    },
    // molten stone: deep rumble, hiss, lava bubbles, crackles
    rebirth: {
      mix: 0.73,
      beds: S => {
        bed(S, { noise: 'brown', freq: 120, gain: 0.6, lfo: [0.12, 0.35] });
        bed(S, { noise: 'white', filter: 'bandpass', freq: 2400, q: 0.5, gain: 0.014, lfo: [0.2, 0.6] });
      },
      events: [
        [[0.12, 0.7], (S, t) => hit(S, t, { freq: rnd(1200, 3800), q: 1.3, dur: rnd(0.015, 0.05), gain: rnd(0.03, 0.1) })],
        [[1.4, 3.8], (S, t) => blip(S, t, { f0: rnd(80, 110), f1: rnd(45, 60), dur: 0.28, gain: 0.12, lp: 300 })]
      ]
    },
    // a cheerful little elephant: a music box playing short pentatonic phrases
    blueey: {
      mix: 3.9,
      beds: S => { bed(S, { noise: 'brown', freq: 300, gain: 0.04 }); },
      events: [
        [[1.6, 3.4], (S, t) => { const n = 2 + (Math.random() * 4 | 0); let k = (Math.random() * 4) | 0;
          for(let i = 0; i < n; i++){ k = Math.max(0, Math.min(PENTA.length - 1, k + pick([-1, 1, 1, 2]))); chime(S, t + i * 0.24, PENTA[k], 0.03, 1.4); } }]
      ]
    },
    // a fitness app glowing in the dark: soft device hum, UI ticks, the odd level-up
    forge: {
      mix: 2.5,
      beds: S => {
        tone(S, { freq: 110, gain: 0.012, lfo: [0.1, 0.4] });
        tone(S, { freq: 220.6, gain: 0.006 });
        bed(S, { noise: 'brown', freq: 320, gain: 0.07, lfo: [0.5, 0.3] });
      },
      events: [
        [[1.8, 4], (S, t) => { blip(S, t, { f0: 1480, dur: 0.05, gain: 0.025 }); if(Math.random() < 0.5) blip(S, t + 0.09, { f0: 1980, dur: 0.05, gain: 0.02 }); }],
        [[11, 19], (S, t) => [659.25, 880, 1318.5].forEach((f, i) => chime(S, t + i * 0.11, f, 0.022, 0.8))]
      ]
    }
  };

  // ---------------------------------------------------------------- engine
  function GalleryAmbience(ctx, dest){
    this.ctx = ctx; this.dest = dest; this.scenes = {};
    this.white = makeNoise(ctx, 'white', 2);
    this.brown = makeNoise(ctx, 'brown', 4);
    this.canPan = typeof ctx.createStereoPanner === 'function';
  }
  GalleryAmbience.SCENES = SCENES;
  GalleryAmbience.prototype.wake = function(key){
    const def = SCENES[key]; if(!def) return null;
    const c = this.ctx, out = c.createGain(); out.gain.value = 0;
    let head = out;
    if(this.canPan){ const p = c.createStereoPanner(); out.connect(p); head = p; }
    head.connect(this.dest);
    const S = { key, eng: this, ctx: c, out, pan: head !== out ? head : null, nodes: [], level: 0, quietSince: 0,
                next: def.events.map(([gap]) => c.currentTime + rnd(0.2, gap[1])) };
    def.beds(S);
    return (this.scenes[key] = S);
  };
  GalleryAmbience.prototype.sleep = function(key){
    const S = this.scenes[key]; if(!S) return;
    S.nodes.forEach(n => { try{ n.stop(); }catch(e){} });
    try{ S.out.disconnect(); if(S.pan) S.pan.disconnect(); }catch(e){}
    delete this.scenes[key];
  };
  GalleryAmbience.prototype.setLevel = function(key, level, pan){
    let S = this.scenes[key];
    if(!S){ if(level <= 0.001) return; S = this.wake(key); if(!S) return; }
    const now = this.ctx.currentTime;
    if(Math.abs(level - S.level) > 0.002){ S.out.gain.setTargetAtTime(level * (SCENES[key].mix || 1), now, 0.35); S.level = level; }
    if(S.pan && pan !== undefined) S.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.15);
  };
  // schedule upcoming events a little ahead; put scenes that have been silent for a while to sleep
  GalleryAmbience.prototype.tick = function(ahead){
    const c = this.ctx, now = c.currentTime, until = now + (ahead || 0.3);
    for(const key in this.scenes){
      const S = this.scenes[key];
      if(S.level <= 0.001){
        if(!S.quietSince) S.quietSince = now;
        else if(now - S.quietSince > 3){ this.sleep(key); continue; }
      } else S.quietSince = 0;
      const ev = SCENES[key].events;
      for(let i = 0; i < ev.length; i++){
        if(S.next[i] < now) S.next[i] = now + rnd(0, 0.1);   // tab was in the background: don't burst-fire the backlog
        while(S.next[i] < until){
          if(S.level > 0.001) ev[i][1](S, S.next[i]);
          S.next[i] += rnd(ev[i][0][0], ev[i][0][1]);
        }
      }
    }
  };
  GalleryAmbience.prototype.stopAll = function(){ Object.keys(this.scenes).forEach(k => this.sleep(k)); };

  window.GalleryAmbience = GalleryAmbience;
})();
