// live/scene.js — horde-survival arena, high 3/4 top-down, HD pixel. Pure function of t and the sim state.
// Layers: ground material (world-space REPEAT) → ground decals (scorch, hero rune circle, black holes) → light pools →
// contact shadows → Y-SORTED band (props, pickups, enemies, hero) → FX (ice shards, bolts, fire blades, sparks) →
// damage numbers → finish → HUD (portrait, bars, timer, counters, slots, minimap) → level-up / game-over panels.
(function () {
  const S = (window.SCENE = {}), L = LIB, M = L.M, W = SIM.VIEW.W, H = SIM.VIEW.H;
  const A = () => window.ASSETS || {}, has = (n) => !!A()[n], RIGS = () => window.RIGS || {};
  S.REPEAT = ['ground_tex'];
  const FONT = '"PT Sans", "Helvetica Neue", "Segoe UI", Arial, sans-serif';
  const INK = [0.012, 0.035, 0.067];
  // one engine ink line round every silhouette (the reference's ≥ 1 ref px = 2 view px dark outline; art.md §3)
  const INKE = { r: 1.8, n: 4, col: INK, dy: 0 }, INKP = { r: 2, n: 6, col: INK, dy: 0 }, INKS = { r: 1.6, n: 4, col: INK, dy: 0 };

  // ---------------- scene shaders ----------------
  const SHADERS = {
    // ice shard: a crescent blade, convex side forward (+x), white rim, cyan body, fading tips (additive)
    crescent: `uniform vec3 u_col; uniform float u_amt, u_n;
void main(){ vec2 p = (floor(v_uv * u_n) + 0.5) / u_n * 2.0 - 1.0;            // on the 4-px pixel grid
  float r = length(p), th = atan(p.y, p.x), ta = abs(th);
  float span = smoothstep(1.55, 0.75, th < 0.0 ? ta * 1.25 : ta);            // asymmetric claw: the leading horn is longer
  float saw = fract(th * 3.2 + 0.3), spike = 0.07 * smoothstep(0.55, 0.95, saw) * smoothstep(1.4, 0.2, ta);
  float w = 0.17 * max(0.0, 1.0 - ta / 1.5) + 0.02, d = r - 0.66;
  float m = step(abs(d - w * 0.2 - spike * 0.5), w + spike) * span;
  float core = step(abs(d - w * 0.4), w * 0.45) * step(ta, 1.05);
  vec3 c = mix(vec3(0.18, 0.34, 0.76), vec3(0.27, 0.56, 0.85), step(0.0, d)); c = mix(c, vec3(0.91, 0.97, 1.0), core);
  o = vec4(c * m * u_amt, m * u_amt * 0.35); }`,
    // soft glowing line segment (bolts, chain arcs, trails) (additive)
    beam: `uniform vec3 u_col; uniform float u_amt;
void main(){ float d = abs(v_uv.y * 2.0 - 1.0); float g = (exp(-d * d * 30.0) + 0.3 * exp(-d * d * 3.0)) * u_amt;
  vec3 c = mix(u_col, vec3(1.0), exp(-d * d * 90.0)); o = vec4(c * g, 0.0); }`,
    // black hole: a swirling violet disc with a dark core and a bright event-horizon rim
    vortex: `uniform float u_amt, u_seed;
void main(){ vec2 p = v_uv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x);
  float sw = a * 3.0 + 4.0 / (r + 0.3) - u_t * 5.0 + fbm(p * 2.5 + u_seed) * 2.0;
  float arms = 0.5 + 0.5 * sin(sw);
  float disc = smoothstep(1.0, 0.7, r), core = smoothstep(0.34, 0.2, r);
  vec3 c = mix(vec3(0.20, 0.06, 0.45), vec3(0.78, 0.48, 1.0), arms * smoothstep(0.25, 0.95, r));
  float al = disc * (0.45 + 0.55 * arms * smoothstep(1.0, 0.4, r));
  float rim = exp(-pow((r - 0.36) / 0.05, 2.0)); c += vec3(0.9, 0.6, 1.0) * rim;
  c = mix(c, vec3(0.01, 0.0, 0.025), core); al = max(al, core);
  o = vec4(c * al * u_amt, al * u_amt); }`,
    // flame tongue for torches and fire blades (pivot at the bottom centre)
    flame: `uniform float u_amt, u_seed; uniform vec3 u_col;
void main(){ float y = 1.0 - v_uv.y, x = (v_uv.x - 0.5) * 2.0;
  float n = fbm(vec2(x * 2.2 + u_seed, y * 2.6 - u_t * 3.2));
  float w = (1.0 - y) * (0.7 + 0.6 * n);
  float m = smoothstep(w, w - 0.3, abs(x + 0.15 * sin(y * 4.0 + u_t * 5.0 + u_seed) * y)) * smoothstep(1.0, 0.55, y + 0.35 * n) * smoothstep(0.0, 0.08, y);
  vec3 c = mix(u_col, vec3(1.0, 0.96, 0.7), smoothstep(0.35, 0.95, m * (1.0 - y * 0.8)));
  o = vec4(c * m * u_amt, m * u_amt * 0.5); }`,
    // the hero's rune circle on the ground (additive): two rings, rotating ticks, faint fill
    rune: `uniform vec3 u_col; uniform float u_amt;
void main(){ vec2 p = v_uv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x);
  float sh = 0.7 + 0.6 * vnoise(vec2(a * 5.0 + u_t * 1.7, u_t * 2.3));
  float ring = (exp(-pow((r - 0.9) / 0.03, 2.0)) + 0.25 * exp(-pow((r - 0.7) / 0.018, 2.0))) * sh;
  float rw = fract(u_t * 0.55) * 0.9, tk = exp(-pow((r - rw) / 0.05, 2.0)) * 0.45 * (1.0 - rw);   // a soft pulse rolling outward
  float fill = smoothstep(0.95, 0.0, r) * 0.10;
  o = vec4(u_col * (ring + tk + fill) * u_amt, 0.0); }`,
    // procedural ground (fallback until ground_tex exists): worn flagstones on a 4 px pixel grid, dark cracks with moss, a lit
    // stone plaza round the arena centre fading into dark mossy grass (colours sampled from the reference floor)
    ground: `uniform vec2 u_cam, u_home; uniform sampler2D u_tex; uniform float u_hastex;
vec2 h2(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
void main(){ vec2 w = floor((v_px + u_cam) / 4.0) * 4.0 + 2.0, w2 = floor((v_px + u_cam) / 2.0) * 2.0 + 1.0;
  // worn rectangular slabs laid in rows (row offset and slab widths vary), thin dark joints
  float RH = 26.0 + 8.0 * h2(vec2(floor(w.y / 30.0), 9.0)).x, row = floor(w.y / RH), fy = w.y - row * RH;
  float off = h2(vec2(row, 3.0)).x * 70.0, SW = 40.0, xx = w.x + off, ix = floor(xx / SW);
  float b0 = (h2(vec2(ix, row)).x - 0.5) * 26.0, b1 = (h2(vec2(ix + 1.0, row)).x - 0.5) * 26.0, lx = xx - ix * SW;
  float id = ix; if (lx < b0) { id = ix - 1.0; } else if (lx > SW + b1) { id = ix + 1.0; }
  float ex = min(abs(lx - b0), abs(lx - SW - b1)), ey = min(fy, RH - fy), edge = min(ex, ey);
  vec2 cid = vec2(id, row); float hv = h2(cid).x, hv2 = h2(cid + 7.3).y;
  vec3 stone = mix(vec3(0.24, 0.27, 0.23), vec3(0.34, 0.36, 0.30), hv);
  float u = clamp((lx - b0) / (SW + b1 - b0), 0.0, 1.0), v = fy / RH;
  stone *= 1.0 + 0.12 * smoothstep(0.25, 0.0, min(u, v)) - 0.12 * smoothstep(0.75, 1.0, max(u, v));   // lit top-left lip, shaded bottom-right
  stone *= 0.9 + 0.14 * hash(floor(w / 8.0) + cid);
  if (hv2 > 0.82) stone *= 0.82;                                                // a few darker, older slabs
  float crack = step(edge, 2.5);
  vec3 c = mix(stone, vec3(0.04, 0.06, 0.08), crack);
  if (u_hastex > 0.5) { vec3 tx = texture(u_tex, w2 / 627.0).rgb; c = tx * vec3(1.04, 1.04, 0.9); crack = 0.0; }   // the generated flagstone material, warmed toward the reference's olive slate
  float plaza = smoothstep(900.0, 260.0, length((w - u_home) * vec2(1.0, 1.25)));
  float n = fbm(w * 0.004 + 3.1) + 0.35 * fbm(w * 0.017 + 8.0);
  float moss = smoothstep(0.56, 0.74, n + 0.22 * (1.0 - plaza) - 0.22 * plaza + 0.1 * hv2);
  vec3 grass = mix(vec3(0.06, 0.17, 0.14), vec3(0.14, 0.26, 0.17), smoothstep(0.3, 0.8, fbm(w * 0.03)));
  grass = mix(grass, vec3(0.18, 0.30, 0.16), step(0.8, hash(floor(w2 / 2.0))) * 0.7); grass *= 0.85 + 0.3 * hash(floor(w2 / 2.0) + 3.1);
  c = mix(c, grass, moss);
  c = mix(c, vec3(0.05, 0.13, 0.12), crack * 0.5 * (1.0 - moss));
  c *= mix(0.72, 1.08, plaza);
  o = vec4(c, 1.0); }`,
    // screen-edge flash (hurt): colour toward the borders only
    edge: `uniform vec3 u_col; uniform float u_amt;
void main(){ vec2 q = (v_uv - 0.5) * vec2(2.0, 2.2); float e = smoothstep(0.75, 1.45, length(q)) * u_amt; o = vec4(u_col * e, e); }`,
    // minimap disc: dark translucent glass with a thin rim
    disc: `uniform float u_amt;
void main(){ vec2 p = v_uv * 2.0 - 1.0; float r = length(p); float m = smoothstep(1.0, 0.985, r);
  float rim = smoothstep(0.93, 0.975, r) * m; vec3 c = mix(vec3(0.03, 0.06, 0.08), vec3(0.32, 0.44, 0.5), rim);
  float al = m * mix(0.62, 0.95, rim) * u_amt; o = vec4(c * al, al); }`,
  };

  S.programs = () => {
    L.init(W, H, SHADERS);
    L.glyphs('0123456789', { size: 64, font: '"Arial Black", "Helvetica Neue", Arial, sans-serif', stroke: '#05080f', fill: ['#ffffff', '#f1f5fa', '#c9d3df'] });
  };

  // ---------------- sizes (view px) ----------------
  const HGT = { chest: 54, hero: 98, skeleton: 86, ghoul: 72, brute: 128, bat: 44,
    pillar: 172, grave: 86, torch: 150, wall: 124, rocks: 84, bush: 90, coin: 30, xp: 34, xp5: 44, heart: 30 };
  const SZ = (n, fb) => { const s = (window.SIZES || {})[n]; return s ? s[1] : HGT[n] || fb || 64; };
  const SPEED = { hero: 200, ghoul: 92, skeleton: 76, brute: 54 };
  const BATW = 1.9;
  const EYE = { ghoul: 0.155, skeleton: 0.12, brute: 0.19 };   // eye line below the head joint (fraction of rig height)
  const STANDIN = { skeleton: 'ghoul', brute: 'ghoul' };   // until their own rigs exist, unrigged walkers borrow a rig (never a sliding sprite)   // bat wingspan / body height
  const PROPTEX = { pillar: 'prop_pillar', grave: 'prop_grave', torch: 'prop_torch', wall: 'prop_wall', rocks: 'prop_rocks', bush: 'prop_bush' };
  const PICKTEX = { coin: 'pick_coin', xp: 'pick_xp', xp5: 'pick_xp5', heart: 'pick_heart' };
  const tex = (n, fb) => has(n) ? n : fb;

  // ---------------- cut-out rigs (rigcut.py format, parts on one canvas in rig px) ----------------
  const part = (name, p) => { const a = A()[name + '__' + p]; return a ? { n: name + '__' + p, x: a.crop[0], y: a.crop[1], w: a.crop[2] - a.crop[0], h: a.crop[3] - a.crop[1] } : null; };
  const drawPart = (Mr, name, p, Mloc, u) => { const q = part(name, p); if (!q) return;
    L.sprite(q.n, 0, 0, { m: M.of(Mr, Mloc || [1, 0, 0, 1, 0, 0], M.t(q.x, q.y)), w: q.w, h: q.h, pivot: [0, 0], u }); };
  // a bone that maps rest segment a→b onto new segment a2→b2 (rotation + stretch along the bone: foreshortening)
  const boneM = (a, b, a2, b2) => { const t0 = Math.atan2(b[1] - a[1], b[0] - a[0]), t1 = Math.atan2(b2[1] - a2[1], b2[0] - a2[0]);
    const k = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    return M.of(M.t(a2[0], a2[1]), M.r(t1), M.s(k, 1), M.r(-t0), M.t(-a[0], -a[1])); };
  // knee from hip and ankle: keeps the drawing's own knee offset (so the rest pose is the approved drawing pixel for pixel);
  // when the leg shortens (a lifted foot) the knee folds outward a little, the rest of the fold reads as foreshortening
  const knee = (hp0, kn0, an0, hp, an, side, fold = 0.5) => {
    const r0x = an0[0] - hp0[0], r0y = an0[1] - hp0[1], D0 = Math.hypot(r0x, r0y) || 1, u0x = r0x / D0, u0y = r0y / D0;
    const kx = kn0[0] - hp0[0], ky = kn0[1] - hp0[1], t0 = (kx * u0x + ky * u0y) / D0, p0 = u0x * ky - u0y * kx;
    const dx = an[0] - hp[0], dy = an[1] - hp[1], D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D, nx = -uy, ny = ux;
    const p = p0 + Math.max(0, D0 - D) * fold * (side < 0 ? 1 : -1);
    return [hp[0] + ux * t0 * D + nx * p, hp[1] + uy * t0 * D + ny * p]; };

  // Run/idle/attack/hit/death pose of a rigged actor (front view), drawn at screen ground point (gx, gy).
  // o: { id, type, face, gph (gait phase 0..1), gait (0..1), gdx, gdy (travel dir), stride (world px), t, seed, atk, tgx, tgy
  //      (unit dir to the target), hit, die (age), cast, neutral, alpha }
  const softplus = (x, s) => (x + Math.hypot(x, s)) / 2;
  function drawRig(name, gx, gy, hgt, o) {
    const R = RIGS()[name]; if (!R) return false; if (name === 'hero') R.reachDepth = 0.1; if (name === 'brute') { R.reachDepth = 0.08; R.reachSide = 0.08; }
    const k = hgt / R.h, face = o.face || 1, nt = !!o.neutral, dt = o.die >= 0 ? o.die : -1, dying = dt >= 0;
    const g0 = [(R.footL[0] + R.footR[0]) / 2, Math.max(R.footL[1], R.footR[1])];
    const run = nt ? 0 : (o.gait || 0) * (dying ? 1 - L.SS(0, 0.12, dt) : 1), uL = ((o.gph || 0) % 1 + 1) % 1, uR = (uL + 0.5) % 1;
    const gdx = o.gdx === undefined ? 1 : o.gdx, gdy = o.gdy || 0, ax = Math.abs(gdx);
    const se = SIM.strideEff(o.stride || 50, gdx) / k, D = SIM.duty(o.type || name, gdx, gdy);   // stride in rig px, stance duty
    const tdx = gdx * face, tdy = gdy, lift = (o.lift || 8) / k;
    const seed = (o.seed || 0) * 6.28, breath = nt ? 0 : Math.sin(o.t * 2.3 + seed), shift = nt ? 0 : Math.sin(o.t * 1.15 + seed + 1);
    const hipC = [(R.hipL[0] + R.hipR[0]) / 2, (R.hipL[1] + R.hipR[1]) / 2];
    // feet: planted for the stance (sliding back at exactly body speed), then a lifted swing forward; running sideways keeps
    // the painted track (legs never cross), running toward/away from the camera narrows it; the leading foot sits a little nearer
    const pull = 0.5 * (1 - ax) + 0.2 * ax;
    const foot = (side, u) => { const s = side < 0 ? 'L' : 'R', rest = R['ankle' + s], hp = R['hip' + s]; let off, offY, up = 0;
      if (u < D) off = offY = (D / 2 - u) * se;
      else { const q = (u - D) / (1 - D), q2 = q * q, q3 = q2 * q, m = -se * (1 - D) * 0.35;     // sideways: Hermite (leaves and lands near the stance speed, no over-reach)
        off = (2 * q3 - 3 * q2 + 1) * (-D / 2 * se) + (q3 - 2 * q2 + q) * m + (-2 * q3 + 3 * q2) * (D / 2 * se) + (q3 - q2) * m;
        offY = (-D / 2 + (3 * q2 - 2 * q3) * D) * se; up = Math.sin(Math.PI * q) * lift; }   // in depth: an eased swing (no overshoot behind)
      // proportions decide the track: standing, the feet sit at least 1.3× the hip width apart (no stance at attention); moving,
      // a wide-hipped rig's track narrows to ≤ 0.3 H so a stride never splays the legs
      const hipW = Math.abs(R.hipR[0] - R.hipL[0]), ankW = Math.abs(R.ankleR[0] - R.ankleL[0]), widen = Math.max(0, 1.32 * hipW - ankW) / 2 * side;
      const sideX = hipC[0] + side * Math.min(ankW, Math.max(0.6 * hipW, 0.44 * R.h - D * se)) / 2, depthX = hp[0] + (hipC[0] - hp[0]) * 0.5;
      const tx = depthX * (1 - ax) + sideX * ax, nx = rest[0] + widen * (1 - run) + (tx - rest[0]) * run, depth = side * ax * (gdx > 0 ? -1 : 1) * face * 1.5 / k;
      return { p: [nx + off * tdx * run, rest[1] + (depth + offY * tdy) * run - up * run], g: rest[1] + (depth + offY * tdy) * run }; };
    const FL = foot(-1, uL), FR = foot(1, uR); let fL = FL.p, fR = FR.p;
    const atk = o.atk || 0, hitA = o.hit !== undefined && o.hit >= 0 && o.hit < 0.25 ? 1 - o.hit / 0.25 : 0, cast = o.cast || 0;
    // hips: a run is lowest at mid-stance and highest in the flight (one bounce per step); breath and weight shift at rest;
    // a dip on hits; the knees buckle first when dying
    let drop = run * (0.018 + 0.012 * ax) * R.h * (D > 0.5 ? 0.5 - 0.5 * Math.cos(4 * Math.PI * (uL - D / 2)) : 0.5 + 0.5 * Math.cos(4 * Math.PI * (uL - D / 2))) + (1 - run) * (1.6 + 1.6 * breath) / k + hitA * 3 / k;
    const hx = (1 - run) * shift * 2.2 / k;
    // the hips also come down until both feet are in reach (a smooth softplus, solved for this step and the mirrored one: no limp)
    const reach = (side, dr, f) => { const s = side < 0 ? 'L' : 'R', hp0 = R['hip' + s], an0 = R['ankle' + s];
      const rest = Math.hypot(an0[0] - hp0[0], an0[1] - hp0[1]); return Math.hypot(f[0] - hp0[0] - hx, f[1] - hp0[1] - dr) - rest * (1.0 + (R.reachDepth || 0.03) * (1 - ax) + (R.reachSide || 0) * ax); };
    // the reach part of the hip height is CONSTANT over a gait cycle (the worst case of 12 phases), so the head only follows
    // the designed bounce — no per-frame reach spikes
    if (!nt && !dying) { let base = o._base; if (base === undefined) { base = 0; for (let s2 = 0; s2 < 12; s2++) { const u1 = s2 / 12, a1 = foot(-1, u1).p, b1 = foot(1, (u1 + 0.5) % 1).p; let dd = 0;
        for (let it = 0; it < 3; it++) dd += softplus(Math.max(reach(-1, dd, a1), reach(1, dd, b1)), 2 / k); base = Math.max(base, dd - softplus(0, 2 / k) * 3); }
        o._base = base; }                                                         // the ink pass and the colour pass share it
      drop += base * run; }
    if (dying) drop += L.SS(0, 0.12, dt) * 0.35 * (g0[1] - hipC[1]);   // the knees buckle by a share of the LEG, not of the figure
    const tg = [o.tgx || 0, o.tgy || 0], lunge = atk * 4 / k;
    const lean = gdx * 0.05 * run + hitA * -0.08, tilt = lean;
    const Mb = M.of(M.t(hipC[0] + hx + tg[0] * face * lunge, hipC[1] + drop + tg[1] * lunge * 0.5), M.r(tilt), M.t(-hipC[0], -hipC[1]));
    const hL = M.ap(Mb, R.hipL), hR = M.ap(Mb, R.hipR);
    const fold = Math.min(0.6, Math.max(0.38, 0.38 * 0.32 / ((g0[1] - hipC[1]) / R.h)));   // short legs fold more at the knee (less foreshortening)
    const kL = knee(R.hipL, R.kneeL, R.ankleL, hL, fL, -1, fold), kR = knee(R.hipR, R.kneeR, R.ankleR, hR, fR, 1, fold);
    // death: falls with gravity about the ground point, one bounce, lies there, then fades
    const f = Math.max(0, Math.min(1, (dt - 0.06) / 0.4)), land = dt > 0.46 ? 0.035 * Math.exp(-(dt - 0.46) * 14) * Math.sin((dt - 0.46) * 30) : 0;
    const topple = dying ? (1.45 * Math.pow(f, 1.35) + land) * (o.dieDir || 1) : 0;
    const Mr = M.of(M.t(gx, gy - (o.z || 0)), M.r(topple), M.s(k * face, k), M.t(-g0[0], -g0[1])), P = (p) => M.ap(Mr, p);
    const al = (o.alpha === undefined ? 1 : o.alpha) * (dying ? 1 - L.SS(1.0, 1.35, dt) : 1);
    const flash = o.hit !== undefined && o.hit >= 0 && o.hit < 0.06 ? 0.5 : 0;
    const u = { alpha: al, grade: [1, 1, flash, 1], haze: [1, 1, 1] }, uFar = { alpha: al, grade: [0.92, 0.85, flash, 1], haze: [1, 1, 1] };
    const leg = (side) => { const Lf = side < 0, s = Lf ? 'L' : 'R', hp0 = R['hip' + s], kn0 = R['knee' + s], an0 = R['ankle' + s], hp = Lf ? hL : hR, kn = Lf ? kL : kR, an = Lf ? fL : fR;
      const uu = (Lf ? face > 0 : face < 0) ? uFar : u, gy0 = (Lf ? FL : FR).g;
      drawPart(Mr, name, 'shin' + s, boneM(kn0, an0, kn, an), uu);
      drawPart(Mr, name, 'foot' + s, M.t(an[0] - an0[0], an[1] - an0[1]), uu);
      drawPart(Mr, name, 'thigh' + s, boneM(hp0, kn0, hp, kn), uu);
      L.joint(o.id, 'hip' + s, P(hp)); L.joint(o.id, 'knee' + s, P(kn)); L.joint(o.id, 'ankle' + s, P(an));
      const toe = R['toe' + s], heel = R['heel' + s];
      if (toe) { L.joint(o.id, 'toe' + s, P([toe[0] + an[0] - an0[0], toe[1] + an[1] - an0[1]])); L.joint(o.id, 'heel' + s, P([heel[0] + an[0] - an0[0], heel[1] + an[1] - an0[1]]));
        L.joint(o.id, 'ground' + s, P([toe[0] + an[0] - an0[0], toe[1] + gy0 - an0[1]])); } };
    // legs in depth order: the foot higher on screen is further away, drawn first
    if (fL[1] <= fR[1]) { leg(-1); leg(1); } else { leg(1); leg(-1); }
    drawPart(Mr, name, 'body', Mb, u);
    // arms turn about the shoulder (never stretched to reach): swing against their own leg (in the picture plane sideways,
    // foreshortened toward/away from the camera); the staff arm swings 40 % as much; lunges reach toward the target; casts raise
    // the staff with a counter-swing of the free arm. The held staff follows the right hand, over the body, under the hand.
    for (const s of ['L', 'R']) { const sh = R['sh' + s], hd = R['hand' + s]; if (!sh || !part(name, 'arm' + s)) continue;
      const side = s === 'L' ? -1 : 1, fwd = Math.cos((s === 'L' ? uR : uL) * Math.PI * 2) * run, cs = s === 'R' ? cast : -0.15 * Math.max(0, cast);
      const sh2 = M.ap(Mb, sh), amp = (s === 'R' && R.staff ? 0.4 : 1) * 0.22;
      const abd = 0.06 * breath * (1 - run) + (dying ? L.SS(0.05, 0.4, dt) * 0.9 : 0) + hitA * 0.3 + cs * 1.0;
      const reachT = atk * (side * tg[0] * face > 0 ? 0.35 : -0.15);                         // toward the target, not out to the sides
      const ang0 = Math.atan2(hd[1] - sh[1], hd[0] - sh[0]), ang = ang0 - side * (abd + reachT) + tilt - fwd * amp * tdx;
      const L0 = Math.hypot(hd[0] - sh[0], hd[1] - sh[1]), kf = 1 + 0.18 * fwd * tdy - atk * 0.12 * Math.max(0, tg[1]);
      const hd2 = [sh2[0] + Math.cos(ang) * L0, sh2[1] + Math.sin(ang) * L0 * kf];
      if (s === 'R' && R.staff && has(R.staff.tex)) { const st = R.staff, a = A()[st.tex], g = st.grip, rot = (ang - ang0) * 0.3 + cs * 0.35;
        const Ms = M.of(M.t(hd2[0], hd2[1]), M.r(rot), M.t(-g[0], -g[1]));
        L.sprite(st.tex, 0, 0, { m: M.of(Mr, Ms, M.t(st.ox + a.crop[0] * st.k, st.oy + a.crop[1] * st.k)), w: (a.crop[2] - a.crop[0]) * st.k, h: (a.crop[3] - a.crop[1]) * st.k, pivot: [0, 0], u });
        o.tipXY = P(M.ap(Ms, st.tip)); L.joint(o.id, 'grip', P(hd2)); L.joint(o.id, 'tip', o.tipXY); }
      drawPart(Mr, name, 'arm' + s, boneM(sh, hd, sh2, hd2), u);
      L.joint(o.id, 'sh' + s, P(sh2)); L.joint(o.id, 'hand' + s, P(hd2)); }
    const hp = M.ap(Mb, hipC), head = M.ap(Mb, R.head);
    L.joint(o.id, 'ground', [gx, gy]); L.joint(o.id, 'hip', P(hp)); L.joint(o.id, 'head', P(head));
    o.headXY = P(head); o.eyeXY = P(M.ap(Mb, [R.head[0], R.head[1] + R.h * (EYE[name] || 0.1)]));
    return true;
  }

  // the bat: body + two wings flapping about the shoulders (wings foreshortened across the stroke), far wing darker
  function drawBat(gx, gy, hgt, o) {
    const R = RIGS().bat, z = 46 + 6 * Math.sin(o.t * 3 + (o.seed || 0) * 6), die = o.die >= 0 ? Math.min(1, o.die / 0.55) : 0;
    const flap = Math.sin(o.t * 15 + (o.seed || 0) * 6.28), al = (o.alpha === undefined ? 1 : o.alpha) * (1 - Math.max(0, die - 0.3) / 0.7);
    const flash = o.hit !== undefined && o.hit >= 0 && o.hit < 0.06 ? 0.5 : 0, u = { alpha: al, grade: [1, 1, flash, 1], haze: [1, 1, 1] };
    const zz = z * (1 - die) + 0, bob = flap * 4;
    if (!R) { const w = L.hsz('bat', hgt); L.sprite('bat', gx - w / 2, gy - zz - hgt - bob, { w, h: hgt, u }); return; }
    const k = hgt / R.bh, Mr = M.of(M.t(gx, gy - zz - bob), M.s(k * (o.face || 1), k), M.t(-R.cx, -R.cy), M.t(R.cx, R.cy), M.r(die * 2.4 * (o.dieDir || 1)), M.t(-R.cx, -R.cy));
    for (const s of ['L', 'R']) { const sh = R['sh' + s], side = s === 'L' ? -1 : 1, a = side * (0.15 + 0.55 * flap) * (1 - die * 0.7) - side * die * 0.8;
      const sx = 0.72 + 0.28 * Math.abs(Math.cos(o.t * 15 + (o.seed || 0) * 6.28));
      drawPart(Mr, 'bat', 'wing' + s, M.of(M.t(sh[0], sh[1]), M.r(a), M.s(sx, 1), M.t(-sh[0], -sh[1])), u);
      L.joint(o.id, 'wing' + s, M.ap(Mr, M.ap(M.of(M.t(sh[0], sh[1]), M.r(a), M.s(sx, 1), M.t(-sh[0], -sh[1])), R['tip' + s]))); }
    drawPart(Mr, 'bat', 'body', null, u);
    L.joint(o.id, 'head', M.ap(Mr, R.head)); L.joint(o.id, 'ground', [gx, gy]);
    o.headXY = M.ap(Mr, R.head);
  }

  // one enemy (or a placeholder sprite before its rig exists)
  function drawEnemy(e, ST, GT, sx, sy, t) {
    const T = SIM.ET[e.type], hgt = SZ(e.type) * (e.elite ? 1.3 : 1), x = sx(e.x), y = sy(e.y);
    const tdx0 = ST.x - e.x, tdy0 = ST.y - e.y, tdl = Math.hypot(tdx0, tdy0) || 1, fadeIn = e.born !== undefined ? L.SS(0, 0.25, GT - e.born) : 1;
    const o = { id: 'e' + e.id, type: e.type, face: e.face, gph: e.gph, gait: e.gait, gdx: e.gdx, gdy: e.gdy, t, seed: e.ph, neutral: ST.neutral, tgx: tdx0 / tdl, tgy: tdy0 / tdl, alpha: fadeIn,
      atk: GT - e.atkT < 0 ? 0 : GT - e.atkT < 0.06 ? -0.3 * L.SS(0, 0.06, GT - e.atkT) : GT - e.atkT < 0.14 ? -0.3 + 1.3 * L.SS(0.06, 0.12, GT - e.atkT) : 1 - L.SS(0.2, 0.4, GT - e.atkT), hit: GT - e.hitT, die: e.dieT >= 0 ? GT - e.dieT : -1, dieDir: (e.id % 2) * 2 - 1,
      stride: SIM.STRIDE[e.type], lift: e.type === 'brute' ? 4.2 : e.type === 'skeleton' ? 6.5 : 5 };
    if (e.type === 'bat') { L.shadow(x, y + 2, 20, 6, 0.32 * fadeIn * (o.die >= 0 ? 1 - Math.min(1, o.die / 0.6) : 1)); drawBat(x, y, hgt, o); }
    else { const shA = (o.die >= 0 ? 1 - L.SS(1.0, 1.35, o.die) : 1) * fadeIn; L.shadow(x + 4, y + 2, hgt * 0.32, hgt * 0.1, 0.5 * shA);
      let ok = false; const body = () => { ok = drawRig(e.type, x, y, hgt, o) || !!(RIGS()[STANDIN[e.type]] && drawRig(STANDIN[e.type], x, y, hgt, Object.assign(o, { type: STANDIN[e.type] }))); };
      if (e.elite) L.inked(body, { r: 2.6, n: 4, col: [1, 0.75, 0.2], dy: 0 }); else if (e.ink && fadeIn > 0.99) L.inked(body, INKE); else body();
      if (!ok) { const n = e.type, w = L.hsz(n, hgt), q = 1 + 0.06 * Math.sin(e.dist * 0.15);
        L.sprite(n, 0, 0, { m: M.of(M.t(x, y), M.s(e.face / Math.sqrt(q), q)), w, h: hgt, pivot: [w / 2, hgt], u: { alpha: o.die >= 0 ? 1 - Math.min(1, o.die / 0.7) : 1, grade: [1, 1, o.hit >= 0 && o.hit < 0.1 ? 0.75 : 0, 1], haze: [1, 1, 1] } });
        o.headXY = [x, y - hgt * 0.8]; } }
    // glowing eyes (the art has the eyes; this is their light)
    if (o.eyeXY && o.die < 0 && fadeIn > 0.5) L.glow(o.eyeXY[0], o.eyeXY[1], hgt * 0.12, e.type === 'brute' ? [1, 0.25, 0.08] : [1, 0.12, 0.08], 0.3, 5);
    // health bar over damaged big enemies
    if (e.hp < e.hpMax && o.die < 0) { const bw = T.bar ? 80 : 46, bh = T.bar ? 8 : 6, bx = x - bw / 2, by = y - hgt - (e.type === 'bat' ? 64 : 16);
      L.rrect(bx - 2, by - 2, bw + 4, bh + 4, 3, [0.02, 0.03, 0.05], [0.02, 0.03, 0.05], 0.85); L.rrect(bx, by, bw * Math.max(0, e.hp / e.hpMax), bh, 2, [0.98, 0.25, 0.27], [0.75, 0.1, 0.14]); }
  }

  // ---------------- the hero ----------------
  let heroDraw = null;
  function drawHero(ST, GT, sx, sy, t) {
    const x = sx(ST.x), y = sy(ST.y), dead = ST.dead >= 0 ? GT - ST.dead : -1, hurt = GT - ST.hurtT;
    const cast = SIM.castAmt(ST);
    const o = { id: 'hero', face: 1, gph: ST.gph, gait: ST.gait, gdx: ST.gdx, gdy: ST.gdy, t, seed: 0.3, hit: hurt, die: dead, dieDir: -1, stride: SIM.STRIDE.hero, lift: 10, cast, neutral: ST.neutral };
    const blink = hurt >= 0 && hurt < SIM.HERO.IFR && Math.floor(hurt * 20) % 2 ? 0.7 : 1; o.alpha = blink;
    L.shadow(x + 4, y + 2, 34, 11, 0.55);
    const draw = () => { if (!drawRig('hero', x, y, SZ('hero'), o)) { const n = 'hero', h = SZ('hero'), w = L.hsz(n, h), q = 1 + 0.05 * Math.sin(ST.dist * 0.1);
      L.sprite(n, 0, 0, { m: M.of(M.t(x, y), M.s(1 / Math.sqrt(q), q)), w, h, pivot: [w / 2, h], u: { alpha: blink } }); } };
    L.inked(draw, { r: 1.6, n: 6, col: INK, dy: 0 }); heroDraw = draw;
    const tp = SIM.tip(ST), dt = o.tipXY || [sx(tp[0]), sy(tp[1])]; L.anchor('staff', [sx(tp[0]), sy(tp[1])], dt, 14);
    // the staff gem glows, flaring on every cast
    L.glow(dt[0], dt[1] + 6, 12 + 22 * Math.max(0, cast), [1.0, 0.75, 0.3], 0.3 + 0.4 * Math.max(0, cast), 3.5); L.glow(dt[0], dt[1] + 6, 22 * Math.max(0, cast), [0.45, 0.85, 1.0], 0.35 * Math.max(0, cast), 3);
  }

  // ---------------- small helpers ----------------
  // one shared breeze (two incommensurate waves + slow gusts travelling across the arena): bushes, flames and smoke all follow it
  const wind = (t, x) => 0.5 * Math.sin(0.53 * t + 0.0021 * x) + 0.3 * Math.sin(1.37 * t + 0.0057 * x + 1.7) + 0.6 * Math.max(0, Math.sin(0.11 * t - 0.0009 * x)) ** 6;
  const beam = (x0, y0, x1, y1, w, col, amt) => { const len = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
    G.draw(L.P.beam, { u_col: col, u_amt: amt }, G.xf(x0, y0 - w / 2, len, w, a, 0, w / 2)); };
  // lightning: a midpoint-displaced channel (rough at every scale, not equal straight segments) with forks; drawn as a wide
  // soft glow plus a thin white core; the seed changes 30 times a second, so the channel flickers while it lives
  const boltPts = (x0, y0, x1, y1, seed, rough = 0.28, lv = 5) => { let P = [[x0, y0], [x1, y1]];
    for (let k = 0; k < lv; k++) { const Q = [P[0]];
      for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), d = (L.rnd(seed + k * 13.7, i) - 0.5) * l * rough;
        Q.push([(a[0] + b[0]) / 2 - dy / (l || 1) * d, (a[1] + b[1]) / 2 + dx / (l || 1) * d], b); }
      P = Q; } return P; };
  const strand = (P, w, col, amt) => { for (let i = 0; i + 1 < P.length; i++) beam(P[i][0], P[i][1], P[i + 1][0], P[i + 1][1], w, col, amt); };
  const bolt = (x0, y0, x1, y1, seed, w, col, amt) => { const P = boltPts(x0, y0, x1, y1, seed);
    strand(P, w * 2.4, col, amt * 0.35); strand(P, w * 0.55, [0.9, 0.97, 1], amt);
    for (let f = 0; f < 3; f++) { const i0 = 6 + Math.floor(L.rnd(seed, 50 + f) * (P.length - 14)), a = P[i0], len = Math.hypot(x1 - x0, y1 - y0) * (0.18 + 0.15 * L.rnd(seed, 60 + f));
      const an = Math.atan2(y1 - y0, x1 - x0) + (L.rnd(seed, 70 + f) - 0.5) * 1.8, F = boltPts(a[0], a[1], a[0] + Math.cos(an) * len, a[1] + Math.sin(an) * len, seed + 100 + f, 0.32, 3);
      strand(F, w * 1.2, col, amt * 0.22); strand(F, w * 0.3, [0.85, 0.95, 1], amt * 0.6); } };
  // chunky white digits, tightly spaced like the reference's damage numbers (glyph atlas from programs())
  const dmgText = (str, x, y, h, alpha) => { const k = h / L.GLYPH_H, gw = G.tex('glyphs').w, adv = (c) => (L.GLYPH[c] || [0, 0])[1] * k * 0.6;
    let w = 0; for (const c of str) w += adv(c); let cx = x - w / 2 - (L.GLYPH[str[0]] || [0, 0])[1] * k * 0.2;
    for (const c of str) { const g = L.GLYPH[c]; if (!g) continue; L.sprite('glyphs', cx, y - h / 2, { w: g[1] * k, h, src: [g[0], 0, g[0] + g[1] / gw, 1], u: { alpha } }); cx += adv(c); } };
  // greedy word wrap by measured width (size panels' text to their content, never a fixed character count)
  const wrap = (str, maxW, size) => { const out = []; let cur = '';
    for (const wd of str.split(' ')) { const nx = cur ? cur + ' ' + wd : wd; if (cur && L.labelW('__wrap', nx, { size, font: FONT }) > maxW) { out.push(cur); cur = wd; } else cur = nx; }
    if (cur) out.push(cur); return out; };
  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const panel = (x, y, w, h, r = 10, a = 0.92, border = [0.30, 0.42, 0.58]) => { L.rrect(x - 2, y - 2, w + 4, h + 4, r + 2, border, border.map((v) => v * 0.6), a); L.rrect(x, y, w, h, r, [0.05, 0.08, 0.14], [0.03, 0.05, 0.09], a); };
  const ICON = { ice: 'icon_ice', bolt: 'icon_bolt', hole: 'icon_hole', fire: 'icon_fire', hp: 'icon_heart', spd: 'icon_boot', gold: 'icon_gold', heal: 'pick_heart', magnet: 'pick_xp5' };
  const ICOL = { ice: [0.45, 0.8, 1], bolt: [0.5, 0.75, 1], hole: [0.7, 0.4, 1], fire: [1, 0.5, 0.15], hp: [0.3, 0.9, 0.4], spd: [0.5, 0.75, 1], gold: [1, 0.8, 0.25], heal: [1, 0.3, 0.35], magnet: [0.7, 0.4, 1] };
  const icon = (id, x, y, s, a = 1) => { const n = ICON[id];
    if (has(n)) { const w = L.hsz(n, s); L.sprite(n, x + (s - w) / 2, y, { w, h: s, u: { alpha: a } }); return; }
    const c = ICOL[id] || [1, 1, 1]; L.glow(x + s / 2, y + s / 2, s * 0.55, c, 0.9 * a, 3); L.star(x + s / 2, y + s / 2, s * 0.45, c, a); };

  // ================================================================ render ================================================================
  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, rnd = L.rnd;
    // shake: trauma from hurts and lightning, decays fast
    let tr = 0; for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'hurt' && a < 0.25) tr = Math.max(tr, 0.6 * (1 - a / 0.25)); if (e.k === 'bolt' && a < 0.15) tr = Math.max(tr, 0.25 * (1 - a / 0.15)); if (e.k === 'death' && a < 0.5) tr = Math.max(tr, 1 - a / 0.5); }
    const shk = 9 * tr * tr, cx = ST.cam[0] + shk * Math.sin(GT * 91.3), cy = ST.cam[1] + shk * Math.sin(GT * 117.1 + 1);
    const sx = (x) => x - cx, sy = (y) => y - cy;
    const off = (k) => ST.qaOff && ST.qaOff.includes(k);
    const vis = (x, y, m = 160) => x > cx - m && x < cx + W + m && y > cy - m && y < cy + H + m * 1.6;

    // ===== ground =====
    L.beginBG([0.04, 0.07, 0.06, 1]);
    const gt = A().ground_tex && A().ground_tex.w >= 1000;
    G.draw(L.P.ground, { u_cam: [cx, cy], u_home: SIM.HOME, u_tex: G.tex(gt ? 'ground_tex' : 'pick_coin'), u_hastex: gt ? 1 : 0 }, G.xf(0, 0, W, H));
    L.beginComp();
    // macro darkness: cloud-like low-frequency shade drifting slowly (breaks the tiling, keeps the low-key mood)
    L.fog(-100, H + 200, [0.0009, 0.012, 0.5, 0.38], [0.01, 0.03, 0.03], 3, t, 0);
    // scorch decals from bolts (fade over a few seconds), ground cracks
    for (const e of ST.ev) { if (e.k !== 'bolt') continue; const a = GT - e.t; if (a < 0 || a > 3) continue;
      L.cracks(sx(e.x), sy(e.y), 46, a, e.seed, 0, 1 - a / 3); }
    // light pools on the ground: torches (warm, flickering), the hero (cool), holes (violet)
    G.blend('add');
    for (const [k, x, y, s] of SIM.TORCHES) { if (!vis(x, y, 400)) continue; const f = 0.85 + 0.15 * Math.sin(t * 9 + x) * Math.sin(t * 13.7 + y);
      const fy0 = sy(y) - SZ('torch') * s * 0.92; G.draw(L.P.glow, { u_col: [1.0, 0.55, 0.18], u_k: 2.4, u_amt: 0.22 * f }, G.xf(sx(x) - 120 * s, fy0 + 40 - 80 * s, 240 * s, 160 * s)); }
    G.draw(L.P.glow, { u_col: [0.25, 0.75, 0.75], u_k: 2.6, u_amt: 0.16 }, G.xf(sx(ST.x) - 300, sy(ST.y) - 210, 600, 400));
    if (!off('rune')) G.draw(L.P.rune, { u_col: [0.25, 0.95, 0.9], u_amt: 0.8, u_t: t }, G.xf(sx(ST.x) - 96, sy(ST.y) - 40 - 72, 192, 144));
    G.blend();
    for (const h of off('hole') ? [] : ST.holes) { const a = GT - h.t0, grow = L.SS(0, 0.25, a) * (1 - L.SS(SIM.WP.hole.dur - 0.3, SIM.WP.hole.dur, a)), r = h.r * 1.25 * grow;
      L.glow(sx(h.x), sy(h.y), r * 2.2, [0.55, 0.2, 1.0], 0.5 * grow, 2.5);
      G.draw(L.P.vortex, { u_amt: 0.95 * grow, u_seed: h.t0, u_t: t }, G.xf(sx(h.x) - r, sy(h.y) - r * 0.62, 2 * r, 2 * r * 0.62)); }

    // ===== Y-sorted band =====
    const Y = [];
    for (const [k, x, y, s] of SIM.PROPS) { if (!vis(x, y, 300)) continue; const n = PROPTEX[k];
      Y.push([y, () => { const h = SZ(k) * s, w = L.hsz(n, h), fl = false;   // baked upper-left light: never mirror props
        L.shadow(sx(x) + 10, sy(y) + 2, w * 0.42, Math.min(26, h * 0.14), 0.5);
        let u0 = {};
        if (k === 'bush') { let push = 0; const near = (ox, oy) => { const d = Math.hypot(ox - x, (oy - y) * 1.6); if (d < 90) push += Math.sign(x - ox || 1) * (1 - d / 90); };
          near(ST.x, ST.y); for (const e of ST.en) if (Math.abs(e.x - x) < 90 && Math.abs(e.y - y) < 60) near(e.x, e.y);
          u0 = { sway: [0.006 + 0.004 * Math.abs(wind(t, x)), 4, t * 1.3 + x, 1], lean: [Math.max(-0.25, Math.min(0.25, 0.04 * wind(t, x) + 0.18 * push)) * (fl ? -1 : 1), 0] }; }
        L.inked(() => L.sprite(n, sx(x) - w / 2, sy(y) - h, { w, h, flip: fl, pad: k === 'bush' ? 0.3 : 0, u: u0 }), INKP);
        if (k === 'torch' && !off('torch')) { const fx = sx(x), fy = sy(y) - h * 0.92;
          L.glow(fx, fy - 10, 58, [1, 0.58, 0.2], 0.45 + 0.1 * Math.sin(t * 11 + x), 3);
          G.draw(L.P.flame, { u_amt: 1, u_seed: x * 0.01, u_t: t, u_col: [1.0, 0.42, 0.08] }, G.xf(fx - 9 * s / 0.72, fy - 40 * s / 0.72, 18 * s / 0.72, 42 * s / 0.72, 0.18 * wind(t, x), 9 * s / 0.72, 40 * s / 0.72)); } }]); }
    for (const g of ST.gems) { if (!vis(g.x, g.y)) continue; const n = g.k === 'chest' ? 'icon_gold' : PICKTEX[g.k];
      Y.push([g.y + 8, () => { const h = SZ(g.k), b = 3 * Math.sin(t * 3.1 + g.x * 0.05), gx = sx(g.x), gy = sy(g.y);
        L.shadow(gx, gy + h * 0.45, h * 0.32, h * 0.1, 0.4);
        const c = g.k === 'coin' || g.k === 'chest' ? [1, 0.75, 0.2] : g.k === 'heart' ? [1, 0.25, 0.3] : g.k === 'xp5' ? [0.7, 0.4, 1] : [0.3, 0.6, 1];
        if (g.k === 'chest' || ST.gems.length < 90 || Math.hypot(g.x - ST.x, g.y - ST.y) < 420) L.glow(gx, gy - b, h * (g.k === 'chest' ? 2.2 : 0.9), c, g.k === 'chest' ? 0.45 + 0.2 * Math.sin(t * 5) : 0.1, 3.5);
        { const w = L.hsz(n, h), dr = () => L.sprite(n, gx - w / 2, gy - h / 2 - b, { w, h }); if (g.k === 'coin') dr(); else L.inked(dr, INKS); }
        if ((t * 0.7 + g.x * 0.013) % 1 < 0.08) L.star(gx + h * 0.2, gy - h * 0.25 - b, h * 0.5, [1, 1, 1], 0.8); }]); }
    { const near = ST.en.filter((e) => vis(e.x, e.y)).map((e) => [Math.hypot(e.x - ST.x, e.y - ST.y), e]).sort((a, b) => a[0] - b[0]);
      near.forEach(([d, e], i) => { e.ink = i < 45; Y.push([e.y + (e.type === 'bat' ? 0.5 : 0), () => drawEnemy(e, ST, GT, sx, sy, t)]); }); }
    Y.push([ST.y, () => drawHero(ST, GT, sx, sy, t)]);
    Y.sort((a, b) => a[0] - b[0]).forEach(([, d]) => d());
    // the hero stays readable inside the horde: enemies standing in front of him let a faint cool silhouette show through
    { let occ = 0; for (const e of ST.en) if (e.dieT < 0 && e.y > ST.y && e.y - ST.y < 80 && Math.abs(e.x - ST.x) < 55) occ++;
      if (occ && heroDraw && ST.dead < 0) { L.sp = { dx: 0, dy: 0, a: 0.85, lod: 0, ink: [0.5, 0.9, 1.0], grow: 2.5 }; heroDraw(); L.sp = { dx: 0, dy: 0, a: 0.55, lod: 0, ink: [0.06, 0.16, 0.24] }; heroDraw(); L.sp = null; } }

    // ===== FX =====
    // fire blades orbiting the hero
    if (ST.wp.fire && !off('fire')) { const l = ST.wp.fire, n = SIM.WP.fire.n[l - 1], spd = SIM.WP.fire.spd[l - 1] * Math.PI * 2 * 0.55;
      for (let i = 0; i < n; i++) { const a = ST.clock * spd + i * Math.PI * 2 / n, fx = sx(ST.x + Math.cos(a) * SIM.WP.fire.rad), fy = sy(ST.y - 30 + Math.sin(a) * SIM.WP.fire.rad * 0.62);
        for (let j = 1; j <= 5; j++) { const b = a - j * 0.09, bx = sx(ST.x + Math.cos(b) * SIM.WP.fire.rad), by = sy(ST.y - 30 + Math.sin(b) * SIM.WP.fire.rad * 0.62);
          L.puff(bx, by, 16 - j * 2, [1, 0.45, 0.1], 0.35 * (1 - j / 6), i * 10 + j); }
        L.glow(fx, fy, 70, [1, 0.5, 0.12], 0.6, 3);
        if (has('fx_firesword')) { const h = 104, w = L.hsz('fx_firesword', h), ra = Math.atan2(Math.sin(a) * 0.62, Math.cos(a)) + Math.PI / 2;   // tip pointing away from the hero
          L.inked(() => L.sprite('fx_firesword', 0, 0, { m: M.of(M.t(fx, fy), M.r(ra)), w, h, pivot: [w / 2, h * 0.62] }), INKS); }
        else { G.blend('add'); G.draw(L.P.flame, { u_amt: 1, u_seed: i * 3.1, u_t: t, u_col: [1, 0.35, 0.05] }, G.xf(fx - 26, fy - 62, 52, 80, 0, 26, 62)); G.blend(); } } }
    // ice storm: each claw drags a fading ribbon along its spiral; the cast flourish is a wide arc sweeping round the hero
    G.blend('add');
    for (const p of ST.pr) { const age = GT - p.t0, fade = Math.min(1, p.life / 0.2) * Math.min(1, age / 0.05), spin = SIM.WP.ice.spin;
      const at = (a) => { const r = 110 + 260 * a, th = p.th + spin * a; return [sx(p.ox + Math.cos(th) * r), sy(p.oy + Math.sin(th) * r * 0.72)]; };
      const nb = Math.min(9, Math.floor(age / 0.03)); let prev = at(age);
      for (let j = 1; j <= nb; j++) { const pt = at(age - j * 0.03), q = j / 10; beam(pt[0], pt[1], prev[0], prev[1], 34 * (1 - q) + 4, [0.18, 0.4, 0.95], 0.8 * fade * (1 - q) * (1 - q)); prev = pt; }
      const hx = sx(p.x), hy = sy(p.y);
      G.draw(L.P.glow, { u_col: [0.25, 0.55, 1.0], u_k: 3, u_amt: 0.25 * fade }, G.xf(hx - 55, hy - 55, 110, 110));
      G.draw(L.P.crescent, { u_col: [0.3, 0.6, 1.0], u_amt: 1.6 * fade, u_n: 38 }, G.xf(hx - 76, hy - 76, 152, 152, p.a, 76, 76)); }
    for (const e of ST.ev) { if (e.k !== 'cast') continue; const a0 = GT - e.t; if (a0 < 0 || a0 > 0.9) continue;
      const q = a0 / 0.9, head = e.a + q * 5.2, R0 = 200 + 90 * q, cx0 = sx(ST.x), cy0 = sy(ST.y) - 40;
      let prev = null; for (let j = 0; j <= 20; j++) { const an = head - j * 0.11, rr = R0 - j * 2.5, pt = [cx0 + Math.cos(an) * rr, cy0 + Math.sin(an) * rr * 0.62];
        if (prev) beam(prev[0], prev[1], pt[0], pt[1], 30 * (1 - j / 21) + 3, [0.18, 0.45, 1.0], 0.85 * (1 - q) * (1 - j / 21)); prev = pt; } }
    G.blend();
    // event FX
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 1.2) continue; const ex = sx(e.x), ey = sy(e.y);
      if (e.k === 'cast' && a < 0.2) { const q = a / 0.2; L.star(ex, ey, 22 * (1 - q), [0.7, 0.95, 1], 0.7 * (1 - q)); L.glow(ex, ey, 30, [0.4, 0.7, 1], 0.35 * (1 - q), 3); }
      if (e.k === 'shatter' && a < 0.35) { const q = a / 0.35; for (let j = 0; j < 5; j++) { const an = e.a + (j - 2) * 0.5 + rnd(e.t, j) * 0.3, d = 10 + 40 * q;
          L.solid(ex + Math.cos(an) * d, ey + Math.sin(an) * d, 4, 4, [0.75, 0.95, 1], 0, 2, 2, 1 - q); } L.star(ex, ey, 22 * (1 - q), [0.7, 0.9, 1], 1 - q); }
      if (e.k === 'bolt' && a < 0.3) { const q = a / 0.3, on = a < 0.06 || (a > 0.1 && a < 0.16) || (a > 0.2 && a < 0.24) ? 1 : 0.35;
        G.blend('add'); bolt(ex + (rnd(e.seed, 1) - 0.5) * 160, ey - 820, ex, ey - 12, e.seed + Math.floor(a * 30), 9, [0.35, 0.55, 1], 1.3 * on * (1 - q * 0.5)); G.blend();
        L.glow(ex, ey - 16, 150, [0.5, 0.68, 1], 0.9 * (1 - q), 2.5);
        for (let j = 0; j < 7; j++) { const an = -Math.PI * (0.1 + 0.8 * rnd(e.t, j)), v = 120 + 160 * rnd(e.t, j + 9);
          L.solid(ex + Math.cos(an) * v * a, ey - 8 + Math.sin(an) * v * a + 600 * a * a, 4, 4, [0.75, 0.9, 1], 0, 2, 2, 1 - q); } }
      if (e.k === 'arc' && a < 0.22) { const q = a / 0.22; G.blend('add'); const P = boltPts(ex, ey, sx(e.x1), sy(e.y1), e.seed + Math.floor(a * 40), 0.35, 4); strand(P, 14, [0.35, 0.55, 1], 0.4 * (1 - q)); strand(P, 3, [0.9, 0.97, 1], 1.1 * (1 - q)); G.blend(); }
      if (e.k === 'burn' && a < 0.4) { const q = a / 0.4; for (let j = 0; j < 3; j++) L.puff(ex + (rnd(e.t, j) - 0.5) * 30, ey - 30 * q - j * 6, 10 + 8 * q, [1, 0.5, 0.15], 0.6 * (1 - q), e.t + j); }
      if (e.k === 'hole' && a < 0.4) { const q = a / 0.4; L.ring(ex, ey, 40 + 160 * q, 25 + 100 * q, [0.8, 0.5, 1], 1 - q, 0.08); }
      if (e.k === 'die' && a > 0.46 && a < 1.06) { const q = (a - 0.46) / 0.6, bone = e.type === 'skeleton', c = bone ? [0.85, 0.88, 0.86] : e.type === 'bat' ? [0.4, 0.25, 0.5] : [0.25, 0.28, 0.32];
        const n = e.type === 'brute' ? 9 : 5; for (let j = 0; j < n; j++) { const an = rnd(e.t, j) * 6.28, d = (20 + 50 * rnd(e.t, j + 9)) * (1 - (1 - q) ** 2), up = 60 * q - 140 * q * q * 0 ;
          L.puff(ex + Math.cos(an) * d, ey - 30 + Math.sin(an) * d * 0.6 - up * 0.3, 8 + 10 * q, c, 0.55 * (1 - q), e.t * 3 + j); }
        if (bone) for (let j = 0; j < 4; j++) { const an = -1.2 - rnd(e.t, j + 20) * 0.8 + (j % 2) * 2.4, v = 160 + 90 * rnd(e.t, j + 30), b = a - 0.46;
          L.solid(ex + Math.cos(an) * v * b, ey - 20 + Math.sin(an) * v * b + 500 * b * b, 10, 4, [0.88, 0.9, 0.86], an * 3 + a * 12, 5, 2, 1 - q); } }
      if (e.k === 'collect' && a < 0.35) { const q = a / 0.35, c = e.g === 'coin' ? [1, 0.85, 0.35] : e.g === 'heart' ? [1, 0.4, 0.45] : [0.5, 0.75, 1]; L.star(ex, ey, 26 * (1 - q), c, 1 - q); }
      if (e.k === 'hurt' && a < 0.3) { const q = a / 0.3; for (let j = 0; j < 5; j++) { const an = rnd(e.t, j) * 6.28; L.solid(ex + Math.cos(an) * (14 + 40 * q), ey - 50 + Math.sin(an) * (14 + 40 * q), 5, 5, [1, 0.3, 0.25], 0, 2.5, 2.5, 1 - q); } }
      if (e.k === 'level' && a < 1.2) { const q = a / 1.2, k = Math.sin(Math.PI * Math.min(1, q * 1.6)); G.blend('add');
        for (let j = 0; j < 6; j++) beam(ex, ey - 10, ex, ey - 10 - 420 * k, 70 - j * 10, [0.4, 0.85, 1], 0.12 * k);
        for (let j = 0; j < 16; j++) { const ph = (q * 1.4 + rnd(e.t, j)) % 1, xx = ex + (rnd(e.t, j + 20) - 0.5) * 120; G.draw(L.P.glow, { u_col: [0.6, 0.95, 1], u_k: 4, u_amt: 0.9 * (1 - q) * Math.sin(Math.PI * ph) }, G.xf(xx - 8, ey - 20 - 300 * ph - 8, 16, 16)); }
        G.blend(); L.glow(ex, ey - 40, 200, [0.5, 0.9, 1], 0.5 * (1 - q), 2); }
      if (e.k === 'pick' && a < 0.8) { const q = a / 0.8; for (let j = 0; j < 12; j++) { const an = j * Math.PI / 6 + e.t, d = 30 + 170 * (1 - (1 - q) ** 2);
          L.star(ex + Math.cos(an) * d, ey - 40 + Math.sin(an) * d * 0.62, 18 * (1 - q), e.kind === 'stat' ? [0.6, 1, 0.6] : [0.6, 0.85, 1], 1 - q); }
        L.ring(ex, ey, 30 + 220 * q, 18 + 136 * q, [0.7, 0.95, 1], 1 - q, 0.05); }
      if (e.k === 'die' && e.type === 'brute' && a > 0.46 && a < 0.91) { const q = (a - 0.46) / 0.45; L.ring(ex, ey, 30 + 90 * q, 14 + 40 * q, [0.6, 0.65, 0.6], 0.8 * (1 - q), 0.1); }
      if (e.k === 'chest' && a < 1.2) { const q = a / 1.2; for (let j = 0; j < 14; j++) { const an = j * 0.449 + e.t, d = 40 + 200 * (1 - (1 - q) ** 2); L.star(ex + Math.cos(an) * d, ey - 40 + Math.sin(an) * d * 0.6, 20 * (1 - q), [1, 0.85, 0.35], 1 - q); } L.glow(ex, ey - 40, 220, [1, 0.8, 0.3], 0.6 * (1 - q), 2); }
      if (e.k === 'step' && a < 0.35) { const q = a / 0.35; L.puff(ex, ey - 2 - 6 * q, 6 + 7 * q, [0.35, 0.4, 0.36], 0.35 * (1 - q), e.t * 10); } }
    // damage numbers: one per enemy per 0.35 s (summed), black-hole ticks silent, at most the newest 24
    { const agg = new Map(); for (const e of ST.ev) { if (e.k !== 'dmg' || e.src === 'hole') continue; const a = GT - e.t; if (a < 0 || a > 1.1) continue;
        const key = e.id + ':' + Math.floor(e.t / 0.35), g = agg.get(key); if (g) g.n += e.n; else agg.set(key, { n: e.n, t: e.t, x: e.x, y: e.y, id: e.id }); }
      const list = [...agg.values()].sort((p, q) => q.t - p.t).slice(0, 12), placed = [];
      for (const e of list) { let lift = 0; for (const q of placed) if (Math.abs(q[0] - e.x) < 46 && Math.abs(q[1] - lift - e.y) < 26) lift += 26; placed.push([e.x, e.y - lift]); e.y -= lift; const a = GT - e.t; if (a > 0.75) continue; const pop = a < 0.08 ? 0.6 + 5 * a : 1 - Math.max(0, a - 0.5) * 0.8, ox = (rnd(e.id, Math.floor(e.t / 0.35)) - 0.5) * 30;
        dmgText(String(e.n), sx(e.x) + 34 * (rnd(e.id, 7) > 0.5 ? 1 : -1) + ox * 0.5, sy(e.y) + 10 - 26 * Math.min(1, a / 0.3), 30 * pop * (e.n >= 30 ? 1.12 : 1), 1 - L.SS(0.5, 0.75, a)); } }
    // ambient: a few cold blue sparks drifting over the ruins (the reference's floating motes), world-anchored with parallax 1
    G.blend('add');
    for (let i = 0; i < 26; i++) { const per = 7 + 5 * rnd(i, 1), k0 = Math.floor((t + per * rnd(i, 2)) / per), u = ((t + per * rnd(i, 2)) / per) % 1;
      const wx = cx + W * rnd(i, k0 + 3), wy = cy + H * rnd(i, k0 + 7), px = wx - cx + 30 * Math.sin(t * 0.7 + i), py = wy - cy - 60 * u;
      const a = Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(t * 5 + i * 3));
      G.draw(L.P.glow, { u_col: [0.4, 0.7, 1.0], u_k: 4, u_amt: 0.55 * a }, G.xf(px - 7, py - 7, 14, 14)); }
    G.blend();
    L.finish(t, { bloom: [0.26, 0.24], vignette: 0.72, warm: 0.15, roll: 1, dither: 1 });
    { let he = null; for (const e of ST.ev) if (e.k === 'hurt' && (!he || e.t > he.t)) he = e; const a = he ? GT - he.t : 9, demo = !S.state ? 0.4 : 1;
      let amt = a >= 0 && a < 0.35 ? (0.10 + 0.25 * Math.min(1, (he.n || 6) / 12)) * (1 - a / 0.35) * demo : 0;
      if (ST.dead < 0 && ST.hp < SIM.maxHp(ST) * 0.3) amt = Math.max(amt, 0.08 + 0.06 * Math.sin(t * 6));
      if (amt > 0.005) G.draw(L.P.edge, { u_col: [0.85, 0.06, 0.05], u_amt: amt }, G.xf(0, 0, W, H)); }
    // the attract loop's seam: a short dip to black instead of a jump
    if (!S.state) { const q = ST.q !== undefined ? ST.q : 0, f = Math.max(L.SS(SIM.L - 0.35, SIM.L, q), 1 - L.SS(0, 0.3, q)); if (f > 0.01) L.rrect(0, 0, W, H, 0, [0, 0, 0], [0, 0, 0], f); }
    hud(ST, GT, t);
  };

  // ================================================================ HUD ================================================================
  function hud(ST, GT, t) {
    // portrait + level
    panel(22, 28, 122, 122, 8, 0.95, [0.62, 0.66, 0.7]);
    if (has('ui_portrait')) L.sprite('ui_portrait', 26, 32, { w: 114, h: 114 });
    else if (has('hero_full')) L.sprite('hero_full', 26, 32, { w: 114, h: 114, src: [0.12, 0.03, 0.6, 0.36] });
    L.uiBox('lv', 24, 158, 120, 40); panel(24, 158, 120, 40, 6, 0.9, [0.5, 0.56, 0.62]);
    L.label('lv', 'Lv. ' + ST.lv, 84, 179, { size: 28, col: '#eef3f7', out: '#05080f', font: FONT, al: 0.5 });
    // HP and XP bars
    const mh = SIM.maxHp(ST), hpq = Math.max(0, Math.min(1, ST.hp / mh)), hurt = GT - ST.hurtT;
    L.uiBox('hpbar', 168, 36, 470, 42, 4); panel(168, 36, 470, 42, 8, 0.9, [0.55, 0.6, 0.66]);
    L.rrect(172, 40, 462 * hpq, 34, 6, [0.93, 0.18, 0.2], [0.62, 0.06, 0.1]);
    if (hurt >= 0 && hurt < 0.4) L.rrect(172, 40, 462 * hpq, 34, 6, [1, 1, 1], [1, 0.8, 0.8], 0.6 * (1 - hurt / 0.4));
    { let hc = -9; for (const e of ST.ev) if (e.k === 'collect' && e.g === 'heart') hc = Math.max(hc, e.t); const a = GT - hc;
      if (a >= 0 && a < 0.5) L.rrect(172, 40, 462 * hpq, 34, 6, [0.6, 1, 0.6], [0.3, 0.8, 0.4], 0.55 * (1 - a / 0.5)); }
    L.label('hp', 'HP  ' + Math.ceil(ST.hp) + '/' + mh, 188, 57, { size: 27, col: '#ffffff', out: '#2a0508', font: FONT });
    const xq = Math.min(1, ST.xp / SIM.need(ST.lv));
    L.uiBox('xpbar', 168, 88, 376, 38, 4); panel(168, 88, 376, 38, 8, 0.9, [0.4, 0.5, 0.62]);
    L.rrect(172, 92, Math.max(0, 368 * xq), 30, 6, [0.32, 0.62, 1.0], [0.12, 0.3, 0.75]);
    { let lc = -9; for (const e of ST.ev) if (e.k === 'collect' && (e.g === 'xp' || e.g === 'xp5')) lc = Math.max(lc, e.t); const a = GT - lc;
      if (a >= 0 && a < 0.3) { L.rrect(172, 92, Math.max(0, 368 * xq), 30, 6, [0.8, 0.95, 1], [0.5, 0.75, 1], 0.5 * (1 - a / 0.3)); L.glow(172 + 368 * xq, 107, 40, [0.5, 0.8, 1], 0.6 * (1 - a / 0.3), 3); } }
    L.label('xp', 'XP  ' + ST.xp + '/' + SIM.need(ST.lv), 188, 107, { size: 25, col: '#eaf3ff', out: '#05101f', font: FONT });
    // passive column (owned weapons as icons)
    const own = SIM.WORDER.filter((k) => ST.wp[k] > 0);
    own.slice(0, 4).forEach((k, i) => { const y = 222 + i * 76; L.uiBox('pas' + i, 24, y, 66, 66, 0); panel(24, y, 66, 66, 6, 0.9, [0.72, 0.72, 0.68]); icon(k, 28, y + 4, 58); });
    // timer
    const tw = L.labelW('timer', mmss(ST.clock), { size: 40, font: FONT });
    L.uiBox('timer', 1052 - tw / 2 - 26, 10, tw + 52, 62); L.rrect(1052 - tw / 2 - 26, 10, tw + 52, 62, 14, [0.02, 0.03, 0.05], [0.02, 0.03, 0.05], 0.55);
    L.label('timer', mmss(ST.clock), 1052, 42, { size: 40, col: '#f4f7fa', out: '#05080f', font: FONT, al: 0.5 });
    // kills and gold (right-aligned counters)
    const cnt = (id, ic, v, y) => { const s = String(v), w = L.labelW(id, s, { size: 34, font: FONT }), x1 = 1902;
      L.uiBox(id, x1 - w - 64, y - 26, w + 70, 52, 2);
      if (ic === 'skull') { if (has('ui_skull')) L.sprite('ui_skull', x1 - w - 58, y - 20, { w: 40, h: 40 }); else { L.glow(x1 - w - 38, y, 22, [1, 1, 1], 0.4, 3); L.rrect(x1 - w - 54, y - 16, 32, 30, 10, [0.95, 0.96, 0.97], [0.75, 0.78, 0.8]); } }
      else L.sprite('pick_coin', x1 - w - 56, y - 20, { w: L.hsz('pick_coin', 40), h: 40 });
      L.label(id, s, x1, y, { size: 34, col: '#f4f7fa', out: '#05080f', font: FONT, al: 1 }); };
    cnt('kills', 'skull', ST.kills, 46); cnt('gold', 'coin', ST.gold, 106);
    { let kd = -9, gc = -9; for (const e of ST.ev) { if (e.k === 'die') kd = Math.max(kd, e.t); if (e.k === 'collect' && e.g === 'coin') gc = Math.max(gc, e.t); }   // the counters answer
      const b1 = GT - kd, b2 = GT - gc; if (b1 >= 0 && b1 < 0.12) L.glow(1800, 46, 34, [1, 1, 1], 0.5 * (1 - b1 / 0.12), 3); if (b2 >= 0 && b2 < 0.15) L.glow(1800, 106, 34, [1, 0.8, 0.3], 0.6 * (1 - b2 / 0.15), 3); }
    // weapon slots 1..5
    for (let i = 0; i < 5; i++) { const x = 22 + i * 108, y = 1032, k = SIM.WORDER[i], on = k && ST.wp[k] > 0;
      L.uiBox('slot' + i, x, y, 96, 96, 0); panel(x, y, 96, 96, 8, 0.92, on ? [0.42, 0.62, 0.9] : [0.25, 0.3, 0.38]);
      if (on) { icon(k, x + 6, y + 6, 84); for (let d = 0; d < SIM.WP[k].max; d++) L.rrect(x + 14 + d * 15, y + 80, 10, 8, 3, d < ST.wp[k] ? [1, 0.85, 0.35] : [0.15, 0.18, 0.24], d < ST.wp[k] ? [0.9, 0.6, 0.15] : [0.08, 0.1, 0.14], 0.95); }
      else if (k) icon(k, x + 6, y + 6, 84, 0.18); else L.rrect(x + 30, y + 26, 36, 44, 8, [0.18, 0.22, 0.3], [0.1, 0.13, 0.18], 0.6);
      L.uiBox('slotn' + i, x + 32, y + 98, 32, 34, 0); L.rrect(x + 32, y + 98, 32, 34, 6, [0.08, 0.1, 0.15], [0.04, 0.05, 0.08], 0.95);
      L.label('slotn' + i, String(i + 1), x + 48, y + 115, { size: 24, col: '#e6edf5', out: '#05080f', font: FONT, al: 0.5 }); }
    // minimap: enemies as red dots around the hero arrow
    const mx = 1786, my = 1030, mr = 128; G.draw(L.P.disc, { u_amt: 1 }, G.xf(mx - mr, my - mr, 2 * mr, 2 * mr));
    for (const e of ST.en) { if (e.dieT >= 0 || (e.id % 5 && e.type !== 'brute') || Math.hypot(e.x - ST.x, e.y - ST.y) < 260) continue; const dx = (e.x - ST.x) / 9, dy = (e.y - ST.y) / 9; if (dx * dx + dy * dy > (mr - 12) ** 2) continue;
      const r = e.type === 'brute' ? 5 : 3.5; L.rrect(mx + dx - r, my + dy - r, 2 * r, 2 * r, r, [1, 0.2, 0.22], [0.8, 0.08, 0.12], 0.95); }
    { const a = Math.atan2(ST.vy || -1, ST.vx || 0) + Math.PI / 2; L.glow(mx, my, 30, [1, 1, 1], 0.35, 3);
      for (let i = 0; i < 9; i++) { const v = -13 + i * 3, half = (v + 13) / 26 * 10;     // a filled arrowhead from scanlines
        L.solid(mx + Math.cos(a) * -half - Math.sin(a) * v, my + Math.sin(a) * -half + Math.cos(a) * v, 2 * half + 1, 3.4, [1, 1, 1], a, 0, 1.7); } }
    if (S.auto && S.state) { const lw = L.labelW('auto', 'АВТОПИЛОТ · Q', { size: 24, font: FONT }); L.uiBox('auto', 1052 - lw / 2 - 16, 80, lw + 32, 38, 4);
      L.rrect(1052 - lw / 2 - 16, 80, lw + 32, 38, 10, [0.05, 0.12, 0.2], [0.03, 0.07, 0.12], 0.8); L.label('auto', 'АВТОПИЛОТ · Q', 1052, 99, { size: 24, col: '#9fd4ff', out: '#05080f', font: FONT, al: 0.5, a: 0.7 + 0.3 * Math.sin(t * 4) }); }
    { let wv = null; for (const e of ST.ev) if (e.k === 'wave' && (!wv || e.t > wv.t)) wv = e; const a = wv ? GT - wv.t : 9;
      if (a >= 0 && a < 2.2) { const k = L.SS(0, 0.25, a) * (1 - L.SS(1.7, 2.2, a)), str = 'ВОЛНА ' + (wv.n + 1), lw = L.labelW('wave', str, { size: 64, font: FONT });
        L.uiBox('wave', W / 2 - lw / 2 - 40, 250, lw + 80, 90, 6); L.rrect(W / 2 - lw / 2 - 40, 250, lw + 80, 90, 16, [0.12, 0.02, 0.03], [0.06, 0.01, 0.02], 0.75 * k);
        L.label('wave', str, W / 2, 295, { size: 64, col: '#ff8a7a', out: '#1a0204', font: FONT, al: 0.5, a: k }); } }
    if (ST.pick) pickPanel(ST, GT, t);
    if (ST.dead >= 0 && GT - ST.dead > 0.6) overPanel(ST, GT);
    if (ST.won >= 0) winPanel(ST, GT);
    if (S.paused && S.state) pausePanel();
  }

  // level-up: "Улучшение оружия" (weapon cards + reroll) or "Новый уровень!" (stat cards)
  function pickPanel(ST, GT, t) {
    const p = ST.pick, a = Math.min(1, (GT - p.t0) / 0.25), out = p.done >= 0 ? Math.min(1, (GT - p.done) / 0.4) : 0, k = a * (1 - out);
    L.rrect(0, 0, W, H, 0, [0, 0.01, 0.03], [0, 0.01, 0.03], 0.55 * k);
    const [px, py, pw, ph] = SIM.UI.panel(p.kind), dy = (1 - a) * 30;
    L.uiBox('panel', px, py + dy, pw, ph, 10); panel(px, py + dy, pw, ph, 14, 0.96 * k, [0.3, 0.42, 0.6]);
    const weapon = p.kind === 'weapon';
    L.label('ptitle', weapon ? 'УЛУЧШЕНИЕ ОРУЖИЯ' : 'НОВЫЙ УРОВЕНЬ!', W / 2, py + dy + 48, { size: 44, col: '#dce8f8', out: '#050a14', font: FONT, al: 0.5, a: k });
    L.label('psub', weapon ? 'Выберите, как усилить ваше оружие' : 'Выберите один из вариантов', W / 2, py + dy + 92, { size: 27, col: '#a9bdd6', out: '#050a14', font: FONT, al: 0.5, a: k });
    p.opts.forEach((id, i) => { const [x, y0, w, h] = SIM.UI.card(p.kind, i), y = y0 + dy, sel = i === p.sel, chosen = p.choice === i;
      const border = weapon ? (sel ? [0.55, 0.78, 1] : [0.3, 0.42, 0.58]) : id === 'hp' ? [0.3, 0.8, 0.45] : id === 'spd' ? [0.35, 0.6, 0.95] : [0.95, 0.75, 0.3];
      const pulse = chosen ? 1 + 0.06 * Math.sin((GT - p.done) * 30) : sel ? 1.0 : 1;
      L.uiBox('card' + i, x, y, w, h, 8); panel(x, y, w, h, 10, 0.97 * k, border.map((v) => v * (sel ? 1.1 : 0.85) * pulse));
      if (sel) L.glow(x + w / 2, y + h / 2, w * 0.75, border, 0.18 * k, 2);
      if (weapon && SIM.WP[id]) { const lv = ST.wp[id], W_ = SIM.WP[id], nl = lv + 1, st = W_.stat(nl), st0 = lv ? W_.stat(lv) : st.map(([n]) => [n, '—']);
        icon(id, x + w / 2 - 62, y + 18, 124, k);
        L.label('cn' + i, W_.name, x + w / 2, y + 170, { size: 30, col: '#f4f7fb', out: '#050a14', font: FONT, al: 0.5, a: k });
        L.label('cl' + i, lv ? `Ур. ${lv} → ${nl}` : 'Новое оружие', x + w / 2, y + 208, { size: 24, col: '#b8c7dc', out: '#050a14', font: FONT, al: 0.5, a: k });
        L.solid(x + 18, y + 232, w - 36, 2, [0.25, 0.35, 0.5], 0, 0, 0, 0.8 * k);
        st.forEach(([n, v], j) => { const pre = `${n}: ${st0[j][1]} → `, pw = L.labelW('cs' + i + j, pre, { size: 23, font: FONT });
          L.label('cs' + i + j, pre, x + 20, y + 260 + j * 34, { size: 23, col: '#dfe8f3', out: '#050a14', font: FONT, a: k });
          L.label('cv' + i + j, String(v), x + 20 + pw, y + 260 + j * 34, { size: 23, col: '#51d2af', out: '#050a14', font: FONT, a: k }); });
        L.solid(x + 18, y + 322, w - 36, 2, [0.25, 0.35, 0.5], 0, 0, 0, 0.8 * k);
        wrap(W_.desc, w - 40, 21).forEach((ln, j) => L.label('cd' + i + j, ln, x + 20, y + 345 + j * 25, { size: 21, col: '#c4d2e2', out: '#050a14', font: FONT, a: k })); }
      else { const S_ = SIM.STATS[id]; icon(id, x + w / 2 - 50, y + 28, 100, k);
        const col = id === 'hp' || id === 'heal' ? '#7ef08f' : id === 'spd' ? '#8fbaff' : id === 'magnet' ? '#c9a6ff' : '#ffd36a';
        L.label('cn' + i, S_.name, x + w / 2, y + 160, { size: 32, col, out: '#050a14', font: FONT, al: 0.5, a: k });
        wrap(S_.desc, w - 40, 22).forEach((ln, j) => L.label('cd' + i + j, ln, x + w / 2, y + 200 + j * 27, { size: 22, col: '#c4d2e2', out: '#050a14', font: FONT, al: 0.5, a: k })); }
      L.label('ck' + i, String(i + 1), x + w - 24, y + 22, { size: 20, col: '#6f86a6', out: '#050a14', font: FONT, al: 0.5, a: k * 0.9 }); });
    if (weapon) { const [rx, ry, rw, rh] = SIM.UI.reroll; L.uiBox('reroll', rx, ry + dy, rw, rh, 4); panel(rx, ry + dy, rw, rh, 10, 0.95 * k, [0.35, 0.55, 0.85]);
      const rr = ST.rerolls > 0 ? `Обновить (${ST.rerolls}) · 4` : `Обновить · ${SIM.REROLL} зол. · 4`, can = ST.rerolls > 0 || ST.gold >= SIM.REROLL;
      L.label('reroll', rr, rx + rw / 2 - 16, ry + dy + rh / 2, { size: 24, col: can ? '#dfeaff' : '#6b7a90', out: '#050a14', font: FONT, al: 0.5, a: k });
      L.star(rx + rw - 40, ry + dy + rh / 2, 16, [0.4, 0.7, 1], k); }
  }
  function winPanel(ST, GT) {
    const a = Math.min(1, (GT - ST.won) / 0.8); L.rrect(0, 0, W, H, 0, [0.02, 0.03, 0.01], [0.01, 0.02, 0.01], 0.5 * a);
    const pw = 680, ph = 300, px = (W - pw) / 2, py = (H - ph) / 2; L.uiBox('win', px, py, pw, ph, 10); panel(px, py, pw, ph, 14, 0.95 * a, [0.85, 0.7, 0.3]);
    L.label('wt', 'ПОБЕДА!', W / 2, py + 64, { size: 56, col: '#ffd36a', out: '#1a1002', font: FONT, al: 0.5, a });
    L.label('ws', `Продержались ${mmss(ST.clock)}   Убито: ${ST.kills}   Уровень: ${ST.lv}`, W / 2, py + 140, { size: 28, col: '#e8eef5', out: '#050a14', font: FONT, al: 0.5, a });
    L.label('wr', GT - ST.won > 1.4 ? 'Пробел или клик — новый забег' : ' ', W / 2, py + 220, { size: 24, col: '#a9bdd6', out: '#050a14', font: FONT, al: 0.5, a });
  }
  function pausePanel() {
    L.rrect(0, 0, W, H, 0, [0, 0.01, 0.03], [0, 0.01, 0.03], 0.5); const pw = 560, ph = 220, px = (W - pw) / 2, py = (H - ph) / 2;
    L.uiBox('pause', px, py, pw, ph, 10); panel(px, py, pw, ph, 14, 0.95, [0.3, 0.42, 0.6]);
    L.label('pt', 'ПАУЗА', W / 2, py + 64, { size: 52, col: '#dce8f8', out: '#050a14', font: FONT, al: 0.5 });
    L.label('pr', 'Esc — продолжить · R — заново', W / 2, py + 150, { size: 26, col: '#a9bdd6', out: '#050a14', font: FONT, al: 0.5 });
  }
  function overPanel(ST, GT) {
    const a = Math.min(1, (GT - ST.dead - 0.6) / 0.6); L.rrect(0, 0, W, H, 0, [0.05, 0, 0.01], [0.02, 0, 0.01], 0.55 * a);
    const pw = 640, ph = 300, px = (W - pw) / 2, py = (H - ph) / 2; L.uiBox('over', px, py, pw, ph, 10); panel(px, py, pw, ph, 14, 0.95 * a, [0.6, 0.25, 0.28]);
    L.label('ot', 'ВЫ ПОГИБЛИ', W / 2, py + 64, { size: 52, col: '#ff8a8a', out: '#1a0204', font: FONT, al: 0.5, a });
    L.label('os', `Время: ${mmss(ST.clock)}   Убито: ${ST.kills}   Золото: ${ST.gold}`, W / 2, py + 140, { size: 28, col: '#e8eef5', out: '#050a14', font: FONT, al: 0.5, a });
    L.label('or', GT - ST.dead > 1.4 ? 'Нажмите пробел или кликните, чтобы начать заново' : ' ', W / 2, py + 220, { size: 24, col: '#a9bdd6', out: '#050a14', font: FONT, al: 0.5, a });
  }

  // ================================================================ QA ================================================================
  S.QA = () => {
    const D = SIM.demoStart(0), adv = (s, n, inp = {}) => { for (let i = 0; i < n; i++) SIM.step(s, inp); return s; };
    const match = adv(SIM.demoStart(0), 120); match.xp = 7; match.clock = 452.2; match.kills = 489; match.gold = 324;
    { const vis = match.en.filter((e) => e.dieT < 0 && e.x > match.cam[0] + 80 && e.x < match.cam[0] + W - 80 && e.y > match.cam[1] + 150 && e.y < match.cam[1] + H - 150);   // the reference's density of feedback
      vis.slice(0, 16).forEach((e, i) => { e.hp = e.hpMax * (0.25 + 0.5 * L.rnd(i, 3)); });
      vis.slice(0, 19).forEach((e, i) => match.ev.push({ k: 'dmg', t: match.t - 0.05 - 0.4 * L.rnd(i, 5), x: e.x, y: e.y - 40, n: [22, 24, 32, 17, 28, 34, 23, 29][i % 8], id: e.id, src: 'ice' })); }
    const pickW = adv(SIM.demoStart(0), 10); pickW.wp = { ice: 4, hole: 4, fire: 4, bolt: 4 }; pickW.lv = 99; SIM.offer(pickW); pickW.pick.kind = 'weapon'; pickW.pick.opts = ['ice', 'hole', 'fire']; adv(pickW, 60);
    pickW.rerolls = 9; pickW.kills = 99999; pickW.gold = 99999; pickW.clock = 5999; pickW.hp = 999; pickW.st.hp = 9;
    const pickN = adv(SIM.demoStart(0), 10); pickN.wp = { ice: 0, hole: 0, fire: 0, bolt: 0 }; pickN.lv = 2; SIM.offer(pickN); pickN.pick.kind = 'weapon'; pickN.pick.opts = ['bolt', 'hole', 'fire']; adv(pickN, 60);
    const pickS = adv(SIM.demoStart(0), 10); pickS.lv = 3; SIM.offer(pickS); pickS.pick.kind = 'stat'; pickS.pick.opts = ['hp', 'spd', 'gold']; adv(pickS, 60);
    const pickX = adv(SIM.demoStart(0), 10); pickX.wp = { ice: 5, hole: 5, fire: 5, bolt: 4 }; pickX.lv = 4; SIM.offer(pickX); pickX.pick.kind = 'weapon'; pickX.pick.opts = ['bolt', 'heal', 'magnet']; adv(pickX, 60);
    const wave = adv(SIM.spawn(0), 10); wave.ev.push({ k: 'wave', t: wave.t - 0.6, x: wave.x, y: wave.y, n: 98 });
    const winS = adv(SIM.demoStart(0), 10); winS.won = winS.t - 2; winS.kills = 99999; winS.clock = 600; winS.lv = 99;
    const over = adv(SIM.demoStart(0), 10); over.hp = 0; over.dead = over.t - 2; over.kills = 99999; over.gold = 99999; over.clock = 5999;
    const start = adv(SIM.spawn(0), 60);
    // ---- rigs: walk cycles (really travelling, camera on the actor), rest poses, loops, transitions ----
    const solo = (o = {}) => Object.assign(SIM.create(), { en: [], gems: [], ev: [], pr: [], holes: [], wp: { ice: 0, hole: 0, fire: 0, bolt: 0 } }, o);
    const camOn = (st, x, y) => { st.cam = [x - W / 2, y - H / 2]; return st; };
    const enemy = (type, x, y, o = {}) => Object.assign({ id: 1, type, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp: 10, hpMax: 10, hitT: -99, dieT: -1, face: 1, dist: 0, ph: 0.3, atkT: -99 }, o);
    const at = (type, X, Y, o, e) => type === 'hero' ? camOn(solo(Object.assign({ x: X, y: Y, hurtT: -99, castT: -99 }, o)), X, Y)
      : camOn(solo(Object.assign({ x: X + 1500, y: Y, castT: -99, hurtT: -99 }, o, { en: [enemy(type, X, Y, e)] })), X, Y);
    const walk = (type, dir, n = 12) => { const se = SIM.strideEff(SIM.STRIDE[type], dir[0]), v = SPEED[type], out = [];
      for (let i = 0; i < n; i++) { const d = se * i / n, X = SIM.HOME[0] + dir[0] * d, Y = SIM.HOME[1] + dir[1] * d, tt = 10 + d / v, f = dir[0] < 0 ? -1 : 1;
        const g = { vx: v * dir[0], vy: v * dir[1], dist: d, gph: i / n, gait: 1, gdx: dir[0], gdy: dir[1] };
        out.push(type === 'hero' ? at(type, X, Y, Object.assign({ t: tt }, g)) : at(type, X, Y, { t: tt }, Object.assign({ face: f }, g))); }
      return out; };
    const R = window.RIGS || {}, walkers = ['hero', 'ghoul', 'skeleton', 'brute'].filter((n) => R[n] || R[STANDIN[n]]);
    const cycles = {}, subject = {}, cycleT = {}, rest = {}, sprites = {}, loops = {}, transitions = {};
    const texOf = (n) => Object.keys(window.ASSETS || {}).filter((k) => k.startsWith((R[n] ? n : STANDIN[n] || n) + '__') || (n === 'hero' && k === 'hero_staff'));
    for (const n of walkers) { const id = n === 'hero' ? 'hero' : 'e1';
      for (const [dn, dir] of [['right', [1, 0]], ['down', [0, 1]]]) { const c = n + '_' + dn; cycles[c] = walk(n, dir); subject[c] = id; cycleT[c] = SIM.strideEff(SIM.STRIDE[n], dir[0]) / SPEED[n]; sprites[c] = texOf(n);
        rest[c] = n === 'hero' ? at(n, SIM.HOME[0], SIM.HOME[1], { t: 10, neutral: true }) : at(n, SIM.HOME[0], SIM.HOME[1], { t: 10, neutral: true }); rest[c].neutral = true; }
      const idle = []; for (let i = 0; i < 12; i++) idle.push(n === 'hero' ? at(n, SIM.HOME[0], SIM.HOME[1], { t: 10 + i * 2.732 / 12 }) : at(n, SIM.HOME[0], SIM.HOME[1], { t: 10 + i * 2.732 / 12 }, {}));
      loops[n + '_idle'] = idle; subject[n + '_idle'] = id; cycleT[n + '_idle'] = 2.732; }
    if (R.bat) { const fl = []; for (let i = 0; i < 12; i++) fl.push(at('bat', SIM.HOME[0], SIM.HOME[1], { t: 10 + i * 0.4189 / 12 }, {})); loops.bat_fly = fl; subject.bat_fly = 'e1'; cycleT.bat_fly = 0.4189; }
    // walk → stop (the hero lets go of the keys), and the first frames of an enemy's death, 1/60 s apart
    { const st = solo({ x: SIM.HOME[0], y: SIM.HOME[1] }), fr = []; for (let i = 0; i < 120; i++) SIM.step(st, { right: 1 });
      for (let i = 0; i < 30; i++) { SIM.step(st, i < 6 ? { right: 1 } : {}); SIM.step(st, i < 6 ? { right: 1 } : {}); fr.push(camOn(JSON.parse(JSON.stringify(st)), st.x, st.y)); }
      transitions.hero_stop = fr; subject.hero_stop = 'hero'; }
    for (const n of walkers.filter((n) => n !== 'hero')) { const fr = []; for (let i = 0; i < 48; i++) fr.push(at(n, SIM.HOME[0], SIM.HOME[1], { t: 10 + i / 60 }, { dieT: 10, hitT: 10, vx: SPEED[n], gait: 1, gph: 0.2, gdx: 1, gdy: 0 }));
      transitions[n + '_death'] = fr; subject[n + '_death'] = 'e1'; }
    const actors = ['hero', ...SIM.TYPES];
    // time-driven effects: frames 1/60 s apart with the effect on vs the same frames with it off
    const fx = (mk, k, box) => { const on = [], offF = []; for (let i = 0; i < 6; i++) { const a = mk(10 + i / 60), b = mk(10 + i / 60); b.qaOff = [k]; on.push(a); offF.push(b); } return { on, off: offF, box }; };
    const T0 = SIM.TORCHES[0], torchSt = (tt) => camOn(solo({ t: tt, x: T0[1] + 400, y: T0[2] + 300 }), T0[1], T0[2] - 80);
    const holeSt = (tt) => camOn(solo({ t: tt, holes: [{ x: SIM.HOME[0], y: SIM.HOME[1], r: 120, t0: 9, tick: 0, dmg: 1 }], x: SIM.HOME[0] + 500 }), SIM.HOME[0], SIM.HOME[1]);
    const runeSt = (tt) => camOn(solo({ t: tt }), SIM.HOME[0], SIM.HOME[1]);
    const fireSt = (tt) => camOn(solo({ t: tt, clock: tt, wp: { ice: 0, hole: 0, fire: 3, bolt: 0 } }), SIM.HOME[0], SIM.HOME[1]);
    const anim = { torch: fx(torchSt, 'torch', [W / 2 - 60, H / 2 - 120, 120, 120]), hole: fx(holeSt, 'hole', [W / 2 - 160, H / 2 - 110, 320, 220]),
      rune: fx(runeSt, 'rune', [W / 2 - 110, H / 2 - 70, 220, 140]), fire: fx(fireSt, 'fire', [W / 2 - 200, H / 2 - 160, 400, 280]) };
    const box = (name) => { const n = name.split('_')[0], h = SZ(n) || 90; return [W / 2 - h * 0.9, H / 2 - h * 1.25, h * 1.8, h * 1.45]; };
    return { states: [['match', match], ['start', start], ['pick_weapon', pickW], ['pick_new', pickN], ['pick_stat', pickS], ['pick_extra', pickX], ['wave', wave], ['game_over', over], ['win', winS]],
      cycles, subject, cycleT, rest, sprites, loops, transitions, actors, box, anim };
  };
})();
