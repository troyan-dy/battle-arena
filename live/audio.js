// live/audio.js: sound driven by the sim event bus (S.ev), synthesized with WebAudio (no files). Starts on the first key,
// click or touch (browsers allow audio only after a gesture; a badge says so until then), plays in the game and in the demo, M mutes. Every sound is derived from an event,
// so the sound always matches what the sim did; hits and pickups are rate-limited so a horde doesn't turn into noise.
(function () {
  if (new URLSearchParams(location.search).has('render')) return;                          // offline renders stay silent
  let ac = null, master = null, muted = false, lastT = -1, lastLoop = null, noiseBuf = null;
  const budget = {}, dbg = (window.__AUDIO = { n: 0, last: '', state: () => ac ? ac.state : 'none' });                                                                       // per-kind rate limit
  const VOL = 1.0;
  const badge = document.createElement('div');
  badge.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);bottom:5vh;font:600 14px -apple-system,sans-serif;color:#cfe3ff;background:#05101fcc;padding:6px 12px;border-radius:8px;pointer-events:none;transition:opacity .5s;z-index:5';
  document.body.appendChild(badge);
  const show = (txt, keep) => { badge.textContent = txt; badge.style.opacity = 1; clearTimeout(show.h); if (!keep) show.h = setTimeout(() => (badge.style.opacity = 0), 1600); };
  show('🔈 Звук: нажмите любую клавишу или кликните', true);
  const start = () => { if (ac) { if (ac.state !== 'running') ac.resume(); return; } try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.connect(ac.destination);
    master = ac.createGain(); master.gain.value = VOL; master.connect(comp); ac.resume();
    setTimeout(() => { if (ac.state === 'running') { show('🔊 Звук включён · M — выключить'); const t0 = ac.currentTime; tone('triangle', 660, 660, 0.12, 0.12, t0); tone('triangle', 990, 990, 0.16, 0.12, t0 + 0.08); } }, 30);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
  addEventListener('keydown', (e) => { if (e.code !== 'Escape') start(); if (e.code === 'KeyM' && master) { muted = !muted; master.gain.value = muted ? 0 : VOL; show(muted ? '🔇 Звук выключен · M — включить' : '🔊 Звук включён · M — выключить', muted); } });
  addEventListener('pointerdown', start); addEventListener('touchstart', start);
  const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); };
  const tone = (type, f0, f1, dur, vol, t0 = ac.currentTime) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur); env(g, t0, 0.005, vol, dur); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05); };
  const noise = (fc, q, dur, vol, t0 = ac.currentTime, sweep = 1) => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.setValueAtTime(fc, t0); f.frequency.exponentialRampToValueAtTime(fc * sweep, t0 + dur); f.Q.value = q; env(g, t0, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05); };
  const ok = (k, gap) => { const now = ac.currentTime; if ((budget[k] || 0) > now) return false; budget[k] = now + gap; return true; };
  const SFX = {
    cast: () => ok('cast', 0.12) && (tone('triangle', 1400, 2600, 0.12, 0.12), noise(5000, 3, 0.12, 0.1, ac.currentTime, 1.6)),
    shatter: () => ok('shatter', 0.05) && noise(3200 + Math.random() * 1500, 6, 0.07, 0.14),
    dmg: () => ok('dmg', 0.045) && tone('square', 220 + Math.random() * 60, 120, 0.05, 0.07),
    die: (e) => ok('die', 0.06) && (e.type === 'brute' ? (tone('sine', 120, 40, 0.35, 0.4), noise(300, 1, 0.3, 0.3)) : (noise(900 + Math.random() * 400, 2, 0.12, 0.18), e.type === 'skeleton' && tone('square', 900, 500, 0.06, 0.06))),
    collect: (e) => ok('collect' + e.g, 0.035) && (e.g === 'coin' ? (tone('square', 1320, 1320, 0.05, 0.07), tone('square', 1760, 1760, 0.08, 0.07, ac.currentTime + 0.05)) : e.g === 'heart' ? tone('sine', 520, 1040, 0.25, 0.2) : tone('sine', 880 + Math.random() * 220, 1500, 0.07, 0.12)),
    bolt: () => ok('bolt', 0.08) && (noise(1800, 0.7, 0.35, 0.4, ac.currentTime, 0.2), tone('sawtooth', 180, 50, 0.25, 0.12)),
    hole: () => (tone('sine', 300, 60, 0.9, 0.25), noise(400, 4, 0.9, 0.12, ac.currentTime, 0.3)),
    burn: () => ok('burn', 0.08) && noise(1200, 1.5, 0.12, 0.14, ac.currentTime, 0.6),
    hurt: () => (tone('square', 300, 90, 0.18, 0.2), noise(600, 1, 0.12, 0.15)),
    level: () => { const t0 = ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.16, t0 + i * 0.07)); },
    pick: () => { const t0 = ac.currentTime; tone('triangle', 784, 1568, 0.18, 0.18, t0); tone('sine', 1175, 1175, 0.25, 0.12, t0 + 0.06); },
    wave: () => { tone('sawtooth', 110, 55, 0.6, 0.3); noise(200, 1, 0.6, 0.2); },
    chest: () => { const t0 = ac.currentTime; [659, 784, 988, 1319].forEach((f, i) => tone('square', f, f, 0.12, 0.12, t0 + i * 0.06)); },
    win: () => { const t0 = ac.currentTime; [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.4, 0.18, t0 + i * 0.12)); },
    shop: () => { const t0 = ac.currentTime; [523, 784, 1047].forEach((f, i) => tone('triangle', f, f * 1.01, 0.3, 0.14, t0 + i * 0.09)); noise(4000, 4, 0.4, 0.06, t0, 1.2); },
    buy: () => { const t0 = ac.currentTime; tone('square', 1320, 1320, 0.06, 0.09, t0); tone('square', 1976, 1976, 0.12, 0.09, t0 + 0.06); tone('triangle', 988, 1976, 0.2, 0.1, t0 + 0.1); },
    nobuy: () => tone('square', 160, 110, 0.18, 0.14),
    gift: () => { const t0 = ac.currentTime; [784, 988, 1319].forEach((f, i) => tone('triangle', f, f, 0.2, 0.13, t0 + i * 0.06)); },
    bossdown: () => { const t0 = ac.currentTime; tone('sine', 90, 40, 0.8, 0.4, t0); [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone('triangle', f, f, 0.35, 0.16, t0 + 0.2 + i * 0.09)); },
    death: () => { const t0 = ac.currentTime; [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.35, 0.18, t0 + i * 0.16)); },
  };
  const loop = () => {
    const S = window.SCENE && (SCENE.state || SCENE.lastST), demo = !(window.SCENE && SCENE.state);
    if (master && !muted) master.gain.value = demo ? VOL * 0.5 : VOL;
    if (ac && S && !muted && S.ev) {
      if (lastLoop !== S || S.t < lastT) { if (S.t < lastT) lastT = -1; lastLoop = S; }
      for (const e of S.ev) if (e.t > lastT && e.t <= S.t && SFX[e.k]) { SFX[e.k](e); dbg.n++; dbg.last = e.k; }
      lastT = S.t;
    } else if (S) lastT = S.t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
