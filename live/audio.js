// live/audio.js: sound driven by the sim event bus (S.ev), synthesized with WebAudio (no files). Starts on the first key or
// click (browsers allow audio only after a gesture), plays only in play mode, M mutes. Every sound is derived from an event,
// so the sound always matches what the sim did; hits and pickups are rate-limited so a horde doesn't turn into noise.
(function () {
  if (new URLSearchParams(location.search).has('render')) return;                          // offline renders stay silent
  let ac = null, master = null, muted = false, lastT = -1, lastLoop = null, noiseBuf = null;
  const budget = {};                                                                       // per-kind rate limit
  const start = () => { if (ac) return; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
  addEventListener('keydown', (e) => { start(); if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.35; } });
  addEventListener('pointerdown', start);
  const env = (g, t0, a, peak, d) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); };
  const tone = (type, f0, f1, dur, vol, t0 = ac.currentTime) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur); env(g, t0, 0.005, vol, dur); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05); };
  const noise = (fc, q, dur, vol, t0 = ac.currentTime, sweep = 1) => { const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf;
    f.type = 'bandpass'; f.frequency.setValueAtTime(fc, t0); f.frequency.exponentialRampToValueAtTime(fc * sweep, t0 + dur); f.Q.value = q; env(g, t0, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05); };
  const ok = (k, gap) => { const now = ac.currentTime; if ((budget[k] || 0) > now) return false; budget[k] = now + gap; return true; };
  const SFX = {
    cast: () => ok('cast', 0.12) && (tone('triangle', 1400, 2600, 0.12, 0.05), noise(5000, 3, 0.12, 0.04, ac.currentTime, 1.6)),
    shatter: () => ok('shatter', 0.05) && noise(3200 + Math.random() * 1500, 6, 0.07, 0.05),
    dmg: () => ok('dmg', 0.045) && tone('square', 220 + Math.random() * 60, 120, 0.05, 0.025),
    die: (e) => ok('die', 0.06) && (e.type === 'brute' ? (tone('sine', 120, 40, 0.35, 0.18), noise(300, 1, 0.3, 0.12)) : (noise(900 + Math.random() * 400, 2, 0.12, 0.07), e.type === 'skeleton' && tone('square', 900, 500, 0.06, 0.02))),
    collect: (e) => ok('collect' + e.g, 0.035) && (e.g === 'coin' ? (tone('square', 1320, 1320, 0.05, 0.03), tone('square', 1760, 1760, 0.08, 0.03, ac.currentTime + 0.05)) : e.g === 'heart' ? tone('sine', 520, 1040, 0.25, 0.08) : tone('sine', 880 + Math.random() * 220, 1500, 0.07, 0.04)),
    bolt: () => ok('bolt', 0.08) && (noise(1800, 0.7, 0.35, 0.18, ac.currentTime, 0.2), tone('sawtooth', 180, 50, 0.25, 0.05)),
    hole: () => (tone('sine', 300, 60, 0.9, 0.1), noise(400, 4, 0.9, 0.05, ac.currentTime, 0.3)),
    burn: () => ok('burn', 0.08) && noise(1200, 1.5, 0.12, 0.05, ac.currentTime, 0.6),
    hurt: () => (tone('square', 300, 90, 0.18, 0.08), noise(600, 1, 0.12, 0.06)),
    level: () => { const t0 = ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.07, t0 + i * 0.07)); },
    pick: () => { const t0 = ac.currentTime; tone('triangle', 784, 1568, 0.18, 0.08, t0); tone('sine', 1175, 1175, 0.25, 0.05, t0 + 0.06); },
    wave: () => { tone('sawtooth', 110, 55, 0.6, 0.12); noise(200, 1, 0.6, 0.08); },
    chest: () => { const t0 = ac.currentTime; [659, 784, 988, 1319].forEach((f, i) => tone('square', f, f, 0.12, 0.05, t0 + i * 0.06)); },
    win: () => { const t0 = ac.currentTime; [523, 659, 784, 1047, 1319].forEach((f, i) => tone('triangle', f, f, 0.4, 0.08, t0 + i * 0.12)); },
    death: () => { const t0 = ac.currentTime; [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f * 0.98, 0.35, 0.08, t0 + i * 0.16)); },
  };
  const loop = () => {
    const S = window.SCENE && SCENE.state;
    if (ac && S && !muted && S.ev) {
      if (lastLoop !== S || S.t < lastT) { if (S.t < lastT) lastT = -1; lastLoop = S; }
      for (const e of S.ev) if (e.t > lastT && e.t <= S.t && SFX[e.k]) SFX[e.k](e);
      lastT = S.t;
    } else if (S) lastT = S.t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
