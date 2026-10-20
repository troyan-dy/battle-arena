// live/sim.js — horde-survival arena (top-down 3/4), deterministic, fixed 120 Hz.
// Contract: create / step / at / spawn / respawn / outOfPlay / scriptInput, events in S.ev (the scene derives all FX from them).
// The hero only moves (WASD / arrows); weapons fire on their own. Kills drop XP crystals and gold; a level-up pauses the
// world and offers three cards (weapon upgrades or stat boosts), picked with 1-3, arrows + Enter, or a click.
(function (root) {
  const DT = 1 / 120, L = 30.0;
  const VIEW = { W: 1920, H: 1190 }, WORLD = { x0: 0, y0: 0, x1: 4200, y1: 2800 };
  const HINT = 'Любая клавиша — играть · WASD / стрелки — движение, оружие бьёт само · 1–3 или клик — улучшение · Пробел — скорость ×2/×4 · Q — автопилот / автоход · M — звук · Esc — пауза · R — заново';
  const HERO = { R: 22, SPEED: 200, ACC: 2600, DEC: 3000, HP: 120, IFR: 0.55, MAG: 150 };
  // the reference's composition: the hero stands here, the first screen is laid out around it (study/MATCH.md)
  const HOME = [2100, 1400], REFK = 1920 / 947, REF0 = [8, 8], HERO_REF = [505, 363];   // the hero's feet in the reference
  const CAM0 = [HOME[0] - (HERO_REF[0] - REF0[0]) * REFK, HOME[1] - (HERO_REF[1] - REF0[1]) * REFK];
  const FEET = [(HERO_REF[0] - REF0[0]) * REFK, (HERO_REF[1] - REF0[1]) * REFK];   // camera keeps the hero there (≈ 1008, 720)
  const R2W = (x, y) => [CAM0[0] + (x - REF0[0]) * REFK, CAM0[1] + (y - REF0[1]) * REFK];   // reference px → world

  // ---------------- enemies ----------------
  const ET = {
    ghoul:    { hp: 14,  sp: 92,  r: 17, dmg: 5,  xp: 1, mass: 1.0 },
    skeleton: { hp: 22,  sp: 76,  r: 19, dmg: 6,  xp: 1, mass: 1.0 },
    bat:      { hp: 9,   sp: 142, r: 15, dmg: 4,  xp: 1, mass: 0.6, fly: 1 },
    brute:    { hp: 120, sp: 54,  r: 32, dmg: 13, xp: 5, mass: 3.5, bar: 1 },
  };
  const TYPES = Object.keys(ET);
  // gait (a run with a flight phase): one stride (two steps) per STRIDE px in any direction; the stance lasts only as long as
  // the painted leg can show its sweep on screen (SWEEP, world px sideways / in depth) → duty D, the rest of the cycle is flight.
  // Phase, amount and direction are integrated here so they stay continuous through turns and stops.
  const STRIDE = { hero: 86, ghoul: 46, skeleton: 56, brute: 27, bat: 0 };
  const SWEEP = { hero: [18, 13], ghoul: [13, 8], skeleton: [11, 9], brute: [16, 9] };
  const WALK = { brute: 1 };                     // heavy walkers keep a double support (duty > 0.5) instead of running
  const strideEff = (st, gdx) => st * (0.85 + 0.15 * Math.abs(gdx));
  const duty = (type, gdx, gdy) => { const sw = SWEEP[type]; if (!sw) return 0.5; const se = strideEff(STRIDE[type], gdx),
      d = 1 / (Math.hypot(gdx / sw[0], gdy / sw[1]) || 1e-6) / se;                 // the sweep the painted leg shows along this heading (an ellipse, not a sum)
    return WALK[type] ? Math.max(0.55, Math.min(0.65, d)) : Math.max(0.2, Math.min(0.5, d)); };
  const gaitStep = (o, vx, vy, type) => { const st = STRIDE[type], sp = Math.hypot(vx, vy);
    if (sp > 4) { o.gdx += (vx / sp - o.gdx) * Math.min(1, DT * 12); o.gdy += (vy / sp - o.gdy) * Math.min(1, DT * 12); }
    if (!st) return;
    if (sp > 20) { const r = sp / strideEff(st, o.gdx); o.prate = r; o.gph = (o.gph + r * DT) % 1; o.gait += (Math.min(1, sp / 45) - o.gait) * Math.min(1, DT * 10); return; }
    // stopping: if a mid-stance (both feet near their stance points) is close, finish the step at the last cadence, then settle
    const D = duty(type, o.gdx, o.gdy), rem = ((D / 2 - (o.gph % 0.5)) % 0.5 + 0.5) % 0.5;
    if (o.gait > 0.02 && rem > 0.004 && rem < 0.22) o.gph = (o.gph + Math.min(rem, Math.max(1.5, o.prate || 2) * DT)) % 1;
    else o.gait = Math.max(0, o.gait - DT * (rem <= 0.004 ? 7 : 12)); };

  // ---------------- weapons (level 1..10: 1–5 the base tier, 6–10 the awakened tier) ----------------
  const WP = {
    ice:  { name: 'Ледяной жезл', max: 10, dmg: [12, 14, 18, 20, 24, 28, 32, 37, 42, 48], n: [2, 3, 4, 4, 5, 5, 6, 6, 7, 8],
            cd: [0.7, 0.62, 0.55, 0.48, 0.4, 0.38, 0.36, 0.34, 0.32, 0.3], life: 1.45, spin: 2.1,
            stat: (l) => [['Урон', WP.ice.dmg[l - 1]], ['Снаряды', WP.ice.n[l - 1]]], desc: 'Увеличивает количество снарядов' },
    hole: { name: 'Черная дыра', max: 10, dmg: [8, 10, 12, 18, 22, 26, 30, 36, 42, 50], rad: [100, 110, 120, 160, 180, 190, 200, 215, 230, 250],
            cd: [7, 6.5, 6, 5.5, 5, 4.7, 4.4, 4.1, 3.8, 3.5], dur: 3.0,
            stat: (l) => [['Радиус', WP.hole.rad[l - 1]], ['Урон', WP.hole.dmg[l - 1]]], desc: 'Увеличивает радиус притяжения' },
    fire: { name: 'Огненный меч', max: 10, dmg: [20, 24, 28, 36, 40, 46, 52, 58, 66, 75], n: [1, 2, 2, 3, 3, 3, 4, 4, 5, 5],
            spd: [1.0, 1.1, 1.2, 1.5, 1.7, 1.8, 1.9, 2.0, 2.1, 2.3], rad: 150,
            stat: (l) => [['Урон', WP.fire.dmg[l - 1]], ['Скорость', WP.fire.spd[l - 1].toFixed(1)]], desc: 'Увеличивает скорость атаки' },
    bolt: { name: 'Молния', max: 10, dmg: [26, 30, 34, 40, 48, 54, 60, 68, 76, 86], n: [1, 2, 2, 3, 4, 4, 5, 5, 6, 7],
            cd: [1.8, 1.6, 1.5, 1.35, 1.2, 1.1, 1.0, 0.95, 0.9, 0.8], range: 620,
            stat: (l) => [['Урон', WP.bolt.dmg[l - 1]], ['Удары', WP.bolt.n[l - 1]]], desc: 'Бьёт случайных врагов рядом' },
  };
  const WORDER = ['ice', 'bolt', 'hole', 'fire'];
  // ---------------- buffs: bought with gold at the altars on the map, ranked; the next rank r (0-based) costs base·1.35^r ----------------
  // val(r) is what rank r gives in total (the shop card shows now → next); heal is a one-off whose price grows with each purchase
  const pc = (v) => Math.round(v * 100) + '%';
  const STATS = {
    might:  { name: 'Мощь',         max: 10, base: 35, desc: '+10% урона всего оружия',              val: (r) => '+' + pc(0.1 * r) },
    haste:  { name: 'Спешка',       max: 8,  base: 35, desc: 'Оружие бьёт на 8% чаще',               val: (r) => '+' + pc(0.08 * r) },
    crit:   { name: 'Криты',        max: 8,  base: 30, desc: '+5% шанс крита, +15% к урону крита',   val: (r) => pc(0.05 * r) + ' · ×' + (1.5 + 0.15 * r).toFixed(2) },
    area:   { name: 'Радиус',       max: 8,  base: 30, desc: '+10% радиуса и размера оружия, +30% магнита; на 8-м ранге магнит со всей карты',
              val: (r) => '+' + pc(0.1 * r) + ' · магнит ' + (r >= 8 ? 'вся карта' : '+' + pc(0.3 * r)) },
    hp:     { name: 'Здоровье',     max: 10, base: 20, desc: '+20% макс. HP',                         val: (r) => Math.round(HERO.HP * (1 + 0.2 * r)) + ' HP' },
    armor:  { name: 'Броня',        max: 8,  base: 30, desc: '−5% урона от врагов',                   val: (r) => '−' + pc(0.05 * r) },
    regen:  { name: 'Регенерация',  max: 8,  base: 25, desc: '+0.4 HP в секунду',                     val: (r) => (0.4 * r).toFixed(1) + ' HP/с' },
    spd:    { name: 'Скорость',     max: 8,  base: 20, desc: '+10% скорости бега',                    val: (r) => '+' + pc(0.1 * r) },
    knock:  { name: 'Толчок',       max: 8,  base: 20, desc: '+8% шанс отбросить врага при ударе',    val: (r) => pc(0.08 * r) },
    vamp:   { name: 'Вампиризм',    max: 6,  base: 25, desc: '+1.5% шанс вылечить 2 HP за убийство',  val: (r) => (1.5 * r).toFixed(1) + '%' },
    dur:    { name: 'Длительность', max: 6,  base: 20, desc: '+12% жизни дыр и осколков',             val: (r) => '+' + pc(0.12 * r) },
    xp:     { name: 'Опыт',         max: 8,  base: 25, desc: '+10% опыта',                            val: (r) => '+' + pc(0.1 * r) },
    luck:   { name: 'Удача',        max: 6,  base: 20, desc: '+10% монет и сердец, сундуки с чемпионов', val: (r) => '+' + pc(0.1 * r) },
    amount: { name: 'Количество',   max: 2,  cost: [400, 900], desc: '+1 снаряд, удар, клинок и дыра каждому оружию', val: (r) => '+' + r },
    gold:   { name: 'Золото',       max: 5,  base: 25, desc: '+15% получаемого золота',               val: (r) => '+' + pc(0.15 * r) },
    heal:   { name: 'Лечение',      base: 40, desc: 'Восстанавливает 50% HP',                         val: () => '+50% HP' },
  };
  const SHOP = Object.keys(STATS), BUFFS = SHOP.filter((k) => k !== 'heal');   // the shop's 16 cards (4 × 4), in this order
  // level-up extras once the weapons run out (never an empty panel)
  const EXTRA = {
    bag:  { name: 'Мешок золота', desc: (S) => '+' + bagGold(S) + ' золота' },
    gift: { name: 'Дар',          desc: () => 'Случайный баф +1 ранг' },
    heal: STATS.heal,
  };
  const REROLL = 50, WIN = 1800;                 // a reroll costs 50 gold once the free ones are spent; surviving 30:00 wins
  const rk = (S, k) => S.st[k] || 0;
  const price = (S, id) => { const b = STATS[id], r = id === 'heal' ? S.heals || 0 : rk(S, id); return b.cost ? b.cost[r] : Math.round(b.base * 1.35 ** r); };
  const maxed = (S, id) => id !== 'heal' && rk(S, id) >= STATS[id].max;
  const canBuy = (S, id) => !maxed(S, id) && S.gold >= price(S, id);
  const allPrice = (S) => 25 + 5 * S.lv;         // «Взять все три» on a level-up
  const bagGold = (S) => 10 + 2 * S.lv;
  // what the buffs do (all weapons read these)
  const pow = (S) => 1 + 0.1 * rk(S, 'might'), pace = (S) => 1 + 0.08 * rk(S, 'haste');
  const critP = (S) => 0.05 * rk(S, 'crit'), critK = (S) => 1.5 + 0.15 * rk(S, 'crit');
  const area = (S) => 1 + 0.1 * rk(S, 'area'), magR = (S) => rk(S, 'area') >= STATS.area.max ? Infinity : HERO.MAG * (1 + 0.3 * rk(S, 'area'));   // max rank: loot from the whole map
  const durK = (S) => 1 + 0.12 * rk(S, 'dur'), more = (S) => rk(S, 'amount');
  const fireSpd = (S) => WP.fire.spd[S.wp.fire - 1] * pace(S) * Math.PI * 2 * 0.55;   // the blades' angular speed (the scene draws them from it)
  const fireN = (S) => WP.fire.n[S.wp.fire - 1] + more(S), fireRad = (S) => WP.fire.rad * area(S);
  // the weapon tooltip: effective numbers at level l with the current buffs, plus what it has done this run
  const big = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : String(Math.round(v));
  function wInfo(S, k, l) {
    const W = WP[k], d = (a) => Math.round(a[l - 1] * pow(S)), cd = (a) => (a[l - 1] / pace(S)).toFixed(2) + ' с', rows = [];
    if (k === 'ice') rows.push(['Урон', d(W.dmg)], ['Снаряды', W.n[l - 1] + more(S)], ['Перезарядка', cd(W.cd)], ['Жизнь осколка', (W.life * durK(S)).toFixed(2) + ' с'], ['Размер', '×' + area(S).toFixed(1)]);
    if (k === 'bolt') rows.push(['Урон', d(W.dmg)], ['Удары', W.n[l - 1] + more(S)], ['Цепь', '60% урона'], ['Перезарядка', cd(W.cd)], ['Дальность', Math.round(W.range * area(S))]);
    if (k === 'hole') rows.push(['Урон за тик (0.5 с)', d(W.dmg)], ['Дыры', 1 + more(S)], ['Радиус', Math.round(W.rad[l - 1] * area(S))], ['Длительность', (W.dur * durK(S)).toFixed(1) + ' с'], ['Перезарядка', cd(W.cd)]);
    if (k === 'fire') rows.push(['Урон', d(W.dmg)], ['Клинки', W.n[l - 1] + more(S)], ['Скорость', (W.spd[l - 1] * pace(S)).toFixed(2)], ['Радиус орбиты', Math.round(W.rad * area(S))]);
    if (rk(S, 'crit')) rows.push(['Крит', pc(critP(S)) + ' · ×' + critK(S).toFixed(2)]);
    if (rk(S, 'knock')) rows.push(['Толчок', pc(0.08 * rk(S, 'knock'))]);
    return rows;
  }
  const wDone = (S, k) => [['Нанесено урона', big((S.dealt && S.dealt[k]) || 0)], ['Убито', big((S.kw && S.kw[k]) || 0)]];
  // ---- the 30-minute curve (clock in s): enemies get tougher, hit harder, run faster and come thicker all the way to the end ----
  const CURVE = {
    hp: (c) => 1 + Math.max(0, c - 60) / 120 + Math.max(0, c - 240) / 80 + 0.125 * Math.max(0, c / 60 - 10) ** 2,  // ×2 at 3:00, ×5 at 6:00, ×10 at 10:00, ×35 at 20:00, ×85 at 30:00
    dmg: (c) => 1 + Math.max(0, c / 60 - 4) * 0.07 + Math.max(0, c / 60 - 12) * 0.08,                    // ×1.4 at 10:00, ×2.8 at 20:00, ×4.3 at 30:00
    spd: (c) => 1 + Math.min(0.3, Math.max(0, c - 240) / 600) + Math.min(0.1, Math.max(0, c - 900) / 6000),   // +30% by 7:00, +40% by 25:00
    rate: (c) => Math.min(18, 0.9 + c * 0.04 + Math.max(0, c - 180) * 0.03) + Math.min(8, Math.max(0, c - 600) * 0.008),   // spawns per second
    cap: (c) => 170 + Math.min(90, Math.max(0, c - 600) / 13),                                            // enemies alive at once: 170 → 260 by 29:30
    champ: (c) => Math.min(0.22, Math.max(0, c - 480) / 1320 * 0.22),                                     // champions from 8:00, more than one in five by 30:00
  };
  const BOSS_EVERY = 5;                          // every 5th wave a boss (a giant brute) joins the wave
  const need = (lv) => Math.round(4 + 5 * lv + 0.25 * lv * lv + 0.035 * Math.max(0, lv - 12) ** 3);   // XP to the next level: quick early levels (Lv 12 → 100, the reference HUD), slow past 30

  // ---------------- level-up panel layout (view px), shared with the scene ----------------
  const UI = {
    panel: (kind) => kind === 'stat' ? [500, 360, 920, 450] : [500, 270, 920, 650],
    card: (kind, i) => kind === 'stat' ? [540 + i * 290, 490, 270, 270] : [540 + i * 290, 400, 270, 400],
    reroll: [640, 834, 300, 52], all: [980, 834, 300, 52],
    // the shop: 4 × 4 cards and the way out
    shop: [250, 110, 1420, 960], scard: (i) => [290 + (i % 4) * 340, 220 + Math.floor(i / 4) * 190, 320, 175], sclose: [1330, 994, 300, 54],
  };

  // ---------------- the level, as data ----------------
  // props: [kind, x, y, scale]; ground contact at (x, y); collision radius from PROPR
  const PROPR = { pillar: 30, grave: 24, torch: 12, wall: 60, rocks: 46, bush: 0 };
  const PROPS = [];
  { const P = (k, rx, ry, s = 1) => { const [x, y] = R2W(rx, ry); PROPS.push([k, x, y, s]); };
    // the reference's first screen (ref px): torches, gravestones, the ruined wall on the left, ruins at the top
    P('torch', 157, 175, 0.72); P('grave', 118, 228, 1.5); P('torch', 67, 487, 0.72); P('wall', 30, 300, 1.0); P('wall', 24, 420, 0.9); P('pillar', 22, 545, 1.1);
    P('pillar', 805, 70, 1.25); P('wall', 880, 60, 0.9); P('pillar', 915, 160, 1.0); P('grave', 622, 560, 1.3); P('grave', 186, 568, 1.2);
    P('rocks', 300, 40, 0.8); P('bush', 600, 18, 0.9); P('bush', 940, 300, 0.8); P('rocks', 940, 470, 0.7);
    // the rest of the arena: deterministic scatter outside the first screen, kept clear of the centre plaza
    const h = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
    const kinds = ['pillar', 'grave', 'grave', 'rocks', 'bush', 'bush', 'torch', 'wall'];
    for (let i = 0; i < 70; i++) { const x = 160 + h(i * 3 + 1) * (WORLD.x1 - 320), y = 200 + h(i * 3 + 2) * (WORLD.y1 - 330);
      if (x > CAM0[0] - 120 && x < CAM0[0] + VIEW.W + 120 && y > CAM0[1] - 120 && y < CAM0[1] + VIEW.H + 120) continue;
      if (PROPS.some((p) => Math.hypot(p[1] - x, p[2] - y) < 230)) continue;
      PROPS.push([kinds[Math.floor(h(i * 3 + 3) * kinds.length)], x, y, 0.85 + 0.35 * h(i * 7 + 5)]); }
    // the arena border: broken walls and pillars all round
    for (let x = 120; x < WORLD.x1; x += 260) { PROPS.push([(x / 260 | 0) % 3 ? 'wall' : 'pillar', x, 150, 1]); PROPS.push([(x / 260 | 0) % 3 === 1 ? 'pillar' : 'wall', x + 90, WORLD.y1 - 40, 1]); }
    for (let y = 400; y < WORLD.y1 - 100; y += 280) { PROPS.push(['pillar', 70, y, 1.1]); PROPS.push(['pillar', WORLD.x1 - 70, y + 120, 1.1]); }
  }
  // the altars (shops): rune circles left and right of the plaza; nothing stands on them
  const ALTARS = [[-1250, -640], [1250, -640], [-1250, 680], [1250, 680]].map(([dx, dy]) => [HOME[0] + dx, HOME[1] + dy]), ALTAR_R = 70;
  for (let i = PROPS.length - 1; i >= 0; i--) if (ALTARS.some(([ax, ay]) => Math.hypot(PROPS[i][1] - ax, PROPS[i][2] - ay) < 220)) PROPS.splice(i, 1);
  const SOLIDS = [];
  for (const [k, x, y, s] of PROPS) { if (!(PROPR[k] > 0)) continue;
    if (k === 'wall') for (const dx of [-90, 0, 90]) SOLIDS.push({ x: x + dx * s, y: y - 8 * s, r: 48 * s });
    else SOLIDS.push({ x, y: y - 8 * s, r: PROPR[k] * s }); }
  const TORCHES = PROPS.filter((p) => p[0] === 'torch');

  // ---------------- helpers ----------------
  const rnd = (S) => { let t = (S.seed = (S.seed + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clampW = (o, r) => { o.x = Math.max(WORLD.x0 + r + 60, Math.min(WORLD.x1 - r - 60, o.x)); o.y = Math.max(WORLD.y0 + r + 160, Math.min(WORLD.y1 - r - 50, o.y)); };
  const pushOut = (o, r) => { for (const s of SOLIDS) { const dx = o.x - s.x, dy = (o.y - s.y) * 1.35, d = Math.hypot(dx, dy), rr = s.r + r;
    if (d < rr && d > 0.01) { o.x = s.x + dx / d * rr; o.y = s.y + dy / d * rr / 1.35; } } };
  // the staff tip, where shots leave: the scene's rig puts the hero's grip and staff here (SIM.RIG shared with the scene)
  const RIG = { H: 98, tip: [37, -98], tipCast: [41, -112] };
  // the cast pose: the staff rises over the last 0.12 s before a shot (the sim knows the cooldown) and settles after it
  const ssm = (a, b, x) => { const q = Math.max(0, Math.min(1, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
  const castAmt = (S) => { const to = S.wp && S.wp.ice ? S.cd.ice : 9, since = S.t - S.castT;
    if (to < 0.16 && to > 0) { const q = 1 - to / 0.16; return q < 0.45 ? -0.2 * ssm(0, 0.45, q) : -0.2 + 1.3 * ssm(0.45, 0.85, q) - 0.1 * ssm(0.85, 1, q); }
    if (since < 0.08) return 1;
    return 1 - ssm(0.08, 0.36, since); };
  const tip = (S) => { const c = castAmt(S); return [S.x + RIG.tip[0] + (RIG.tipCast[0] - RIG.tip[0]) * c, S.y + RIG.tip[1] + (RIG.tipCast[1] - RIG.tip[1]) * c]; };
  const maxHp = (S) => Math.round(HERO.HP * (1 + 0.2 * rk(S, 'hp')));

  // the size (sz) scales the art and the reach; elites, champions and bosses set it
  const reach = (e) => ET[e.type].r * (e.sz || 1);
  function addEnemy(S, type, x, y, champ) {
    const T = ET[type], hpk = CURVE.hp(S.clock) * (champ ? 4 : 1);
    S.en.push({ id: S.nid++, type, x, y, vx: 0, vy: 0, kx: 0, ky: 0, hp: T.hp * hpk, hpMax: T.hp * hpk, hitT: -9, dieT: -1, face: 1,
      dist: rnd(S) * 200, ph: rnd(S), atkT: -9, gph: rnd(S), gait: 0, gdx: 1, gdy: 0, born: S.t, dmg: T.dmg * CURVE.dmg(S.clock) * (champ ? 1.5 : 1) });
    const e = S.en[S.en.length - 1]; if (champ) { e.champ = 1; e.sz = 1.15; } return e;
  }
  // a champion now and then among the ordinary spawns (a red outline, ×4 HP, ×1.5 damage, a big crystal)
  const addMob = (S, type, x, y) => addEnemy(S, type, x, y, !S.demo && rnd(S) < CURVE.champ(S.clock));
  function baseState() {
    return { t: 0, steps: 0, wt0: 0, seed: 1234567, nid: 1, demo: false,
      x: HOME[0], y: HOME[1], vx: 0, vy: 0, face: 1, faceY: 1, dist: 0, gph: 0, gait: 0, gdx: 1, gdy: 0, hp: HERO.HP, hurtT: -9, castT: -9, dead: -1, won: -1, restart: false,
      lv: 1, xp: 0, kills: 0, gold: 0, clock: 0, wave: 0, spawnAcc: 0,
      wp: { ice: 1, hole: 0, fire: 0, bolt: 0 }, cd: { ice: 0.4, hole: 2, bolt: 1 }, st: Object.fromEntries(BUFFS.map((k) => [k, 0])), rerolls: 1, heals: 0, dealt: {}, kw: {}, shop: null, shopLock: -1, shopNext: 0,
      pick: null, picks: 0, pend: 0, prevNav: 0,
      en: [], pr: [], holes: [], gems: [], ev: [], cam: [CAM0[0], CAM0[1]], camV: [0, 0] };
  }
  // the reference's moment: Lv 12 at 07:31, a dense horde all round, crystals and gold on the ground
  function hordeState() {
    const S = baseState();
    Object.assign(S, { lv: 12, xp: 7, hp: 98, kills: 489, gold: 324, clock: 451.0, wave: 43, rerolls: 1,
      wp: { ice: 3, hole: 2, fire: 0, bolt: 2 }, cd: { ice: 0.05, hole: 1.4, bolt: 0.5 } });
    S.hp = 98; S.st.hp = 0;
    // enemies in rings, denser further out, types mixed like the reference (brutes on the outside)
    for (let i = 0; i < 125; i++) { const a = rnd(S) * Math.PI * 2, d = 230 + Math.pow(rnd(S), 0.7) * 820, q = rnd(S);
      const type = d > 520 && q < 0.16 ? 'brute' : q < 0.42 ? 'ghoul' : q < 0.72 ? 'skeleton' : q < 0.86 ? 'bat' : 'ghoul';
      const e = { x: HOME[0] + Math.cos(a) * d * 1.15, y: HOME[1] + Math.sin(a) * d * 0.72 }; clampW(e, 30); pushOut(e, 30);
      addEnemy(S, type, e.x, e.y); }
    for (let i = 0; i < 46; i++) { const a = rnd(S) * Math.PI * 2, d = 120 + rnd(S) * 760;
      S.gems.push({ k: rnd(S) < 0.42 ? 'coin' : 'xp', x: HOME[0] + Math.cos(a) * d * 1.2, y: HOME[1] + Math.sin(a) * d * 0.7, v: 1, t0: -rnd(S) * 3, mag: 0 }); }
    return S;
  }
  const create = () => demoStart(0);          // the attract demo's start (tune.cjs replays SCRIPT from here)
  // play: a fresh run, a thin first wave already closing in
  const spawn = (worldT) => { const S = Object.assign(baseState(), { wt0: worldT, seed: (Math.floor(worldT * 1000) | 0) + 7 });
    for (let i = 0; i < 14; i++) { const a = rnd(S) * Math.PI * 2, d = 850 + rnd(S) * 300; addEnemy(S, rnd(S) < 0.5 ? 'ghoul' : 'skeleton', HOME[0] + Math.cos(a) * d * 1.2, HOME[1] + Math.sin(a) * d * 0.7); }
    return S; };
  const respawn = (S, worldT) => spawn(worldT);
  const outOfPlay = (S) => !!S.restart;

  // ---------------- level-up offers ----------------
  function offer(S) {
    S.picks++;
    // level-ups grow the weapons; the buffs are bought with gold at the altars. Once the weapons run out: gold, a gift, a heal
    const pool = WORDER.filter((k) => S.wp[k] < WP[k].max), kind = pool.length ? 'weapon' : 'stat', opts = [];
    while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rnd(S) * pool.length), 1)[0]);
    for (const x of ['bag', 'gift', 'heal']) if (opts.length < 3) opts.push(x);
    if (S.demo && S.wp.fire === 0 && !opts.includes('fire')) opts[0] = 'fire';   // the attract demo shows the fire blades
    S.pick = { kind, opts, t0: S.t, sel: 0, done: -1, choice: -1 }; S.prevNav = 99; S.navHeld = 1;          // a key held when it opens doesn't move the choice
    S.ev.push({ k: 'level', t: S.t, x: S.x, y: S.y, lv: S.lv });
  }
  // +1 rank of a buff (bought, a gift, a chest once the weapons are maxed); Здоровье also heals a little
  const gain = (S, id) => { S.st[id] = rk(S, id) + 1; if (id === 'hp') S.hp = Math.min(maxHp(S), S.hp + 24); };
  const gift = (S) => { const pool = BUFFS.filter((k) => k !== 'amount' && !maxed(S, k)); if (pool.length) { const id = pool[Math.floor(rnd(S) * pool.length)]; gain(S, id); return id; } };
  const take = (S, id) => {
    if (id === 'heal') S.hp = Math.min(maxHp(S), S.hp + maxHp(S) * 0.5);
    else if (id === 'bag') S.gold += bagGold(S);
    else if (id === 'gift') { const g = gift(S); if (g) S.ev.push({ k: 'gift', t: S.t, x: S.x, y: S.y, id: g }); }
    else S.wp[id]++; };
  function choose(S, i) {
    const p = S.pick; if (!p || p.done >= 0 || i < 0 || i >= p.opts.length) return;
    const id = p.opts[i]; p.done = S.t; p.choice = i; take(S, id);
    S.ev.push({ k: 'pick', t: S.t, x: S.x, y: S.y, id, kind: p.kind });
  }
  // «Взять все три»: every card on the panel for gold
  function chooseAll(S) {
    const p = S.pick; if (!p || p.done >= 0 || S.gold < allPrice(S)) return;
    S.gold -= allPrice(S); p.done = S.t; p.choice = -2; for (const id of p.opts) take(S, id);
    S.ev.push({ k: 'pick', t: S.t, x: S.x, y: S.y, id: 'all', kind: p.kind });
  }
  // the shop
  function buy(S, id) {
    if (!canBuy(S, id)) { S.ev.push({ k: 'nobuy', t: S.t, x: S.x, y: S.y, id }); return; }
    S.gold -= price(S, id); if (id === 'heal') { S.heals++; S.hp = Math.min(maxHp(S), S.hp + maxHp(S) * 0.5); } else gain(S, id);
    S.ev.push({ k: 'buy', t: S.t, x: S.x, y: S.y, id });
  }
  const closeShop = (S) => { S.shopLock = S.shop.i; S.shopNext = S.clock + 45; S.shop = null; S.ev.push({ k: 'shopclose', t: S.t, x: S.x, y: S.y }); };
  const inRect = (px, py, r) => px >= r[0] && px <= r[0] + r[2] && py >= r[1] && py <= r[1] + r[3];

  // ---------------- damage ----------------
  function hit(S, e, d, kx, ky, src) {
    if (e.dieT >= 0) return;
    let crit = 0; if (rk(S, 'crit') && rnd(S) < critP(S)) { crit = 1; d *= critK(S); }          // no rank, no roll: the demo stays as it was
    const m = ET[e.type].mass * (e.boss ? 6 : e.sz || 1);
    if (rk(S, 'knock') && !e.boss && rnd(S) < 0.08 * rk(S, 'knock')) { const ax = e.x - S.x, ay = e.y - S.y, al = Math.hypot(ax, ay) || 1; kx += ax / al * 700; ky += ay / al * 500; }   // shoved away from the hero
    e.hp -= d; e.hitT = S.t; e.kx += kx / m; e.ky += ky / m;
    if (S.dealt) S.dealt[src] = (S.dealt[src] || 0) + Math.min(d, d + e.hp);
    S.ev.push({ k: 'dmg', t: S.t, x: e.x, y: e.y - 40, n: Math.round(d), id: e.id, src, crit });
    if (e.hp <= 0) { e.dieT = S.t; S.kills++; if (S.kw) S.kw[src] = (S.kw[src] || 0) + 1;
      if (rk(S, 'vamp') && rnd(S) < 0.015 * rk(S, 'vamp')) { S.hp = Math.min(maxHp(S), S.hp + 2); S.ev.push({ k: 'vamp', t: S.t, x: S.x, y: S.y }); }
      S.ev.push({ k: 'die', t: S.t, x: e.x, y: e.y, type: e.type, id: e.id, dx: Math.sign(kx) || 1 });
      const T = ET[e.type];
      const xp = e.champ ? 5 : T.xp; S.gems.push({ k: xp >= 5 ? 'xp5' : 'xp', x: e.x, y: e.y - 4, v: xp, t0: S.t, mag: 0 });
      const lk = 1 + 0.1 * rk(S, 'luck');
      if (rnd(S) < (e.type === 'brute' || e.champ ? 0.5 * lk : 0.08 * lk)) S.gems.push({ k: 'coin', x: e.x + 14, y: e.y + 6, v: 1, t0: S.t, mag: 0 });
      if (e.champ && rk(S, 'luck') && rnd(S) < 0.02 * rk(S, 'luck')) S.gems.push({ k: 'chest', x: e.x, y: e.y + 10, v: 1, t0: S.t, mag: 0 });
      if (e.elite) S.gems.push({ k: 'chest', x: e.x, y: e.y + 10, v: e.boss ? 2 : 1, t0: S.t, mag: 0 });
      if (e.boss) {                     // the boss's reward: big crystals and a pile of gold round the chest, a free buff rank and a heal
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; S.gems.push({ k: 'xp5', x: e.x + Math.cos(a) * 70, y: e.y + Math.sin(a) * 45, v: 5, t0: S.t, mag: 0 }); }
        for (let i = 0; i < 24 + S.wave; i++) { const a = i * 2.4, d = 40 + (i % 5) * 26; S.gems.push({ k: 'coin', x: e.x + Math.cos(a) * d * 1.3, y: e.y + Math.sin(a) * d * 0.8, v: 1, t0: S.t, mag: 0 }); }
        const g = gift(S); S.hp = Math.min(maxHp(S), S.hp + maxHp(S) * 0.3); S.ev.push({ k: 'bossdown', t: S.t, x: e.x, y: e.y, id: g }); }
      if (rnd(S) < 0.012 * lk) S.gems.push({ k: 'heart', x: e.x - 12, y: e.y + 2, v: 1, t0: S.t, mag: 0 }); }
  }
  // a bite on the hero: armour cuts it, then brief invulnerability
  function bite(S, t, raw, dx, dy) { if (t - S.hurtT <= HERO.IFR) return; const dm = Math.max(1, Math.round(raw * (1 - 0.05 * rk(S, 'armor'))));
    S.hp -= dm; S.hurtT = t; S.ev.push({ k: 'hurt', t, x: S.x, y: S.y, n: dm, fx: -dx, fy: -dy });
    if (S.hp <= 0) { S.hp = 0; S.dead = t; S.ev.push({ k: 'death', t, x: S.x, y: S.y }); } }
  const nearest = (S, x, y, maxD, skip) => { let best = null, bd = maxD;
    for (const e of S.en) { if (e.dieT >= 0 || (skip && skip.includes(e.id))) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } } return best; };

  // ---------------- step ----------------
  function step(S, inp) {
    const t = S.t + DT; S.t = t;
    // level-up panel: the world waits; pick with 1–3, arrows + Enter / Space, or a click on a card
    if (S.pick) {
      for (const q of S.pr) q.t0 += DT; for (const h of S.holes) h.t0 += DT; S.castT += DT;   // the world waits: shots and holes too
      const p = S.pick;
      if (p.done < 0 && t - p.t0 > 0.35) {
        const nav = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (!nav) S.navHeld = 0; if (nav && nav !== S.prevNav && !S.navHeld) p.sel = (p.sel + nav + p.opts.length) % p.opts.length;
        S.prevNav = nav;
        if (inp.slot === 4 && p.kind === 'weapon' && (S.rerolls > 0 || S.gold >= REROLL)) { if (S.rerolls > 0) S.rerolls--; else S.gold -= REROLL; S.picks--; offer(S); S.pick.t0 -= 0.3; }
        else if (inp.slot === 5) chooseAll(S);
        else if (inp.slot >= 1 && inp.slot <= p.opts.length) choose(S, inp.slot - 1);
        else if ((inp.act || inp.jump) && !S.prevAct) choose(S, p.sel);
        else if (inp.click) { for (let i = 0; i < p.opts.length; i++) if (inRect(inp.px, inp.py, UI.card(p.kind, i))) choose(S, i);
          if (inRect(inp.px, inp.py, UI.all)) chooseAll(S);
          if (p.kind === 'weapon' && (S.rerolls > 0 || S.gold >= REROLL) && inRect(inp.px, inp.py, UI.reroll)) { if (S.rerolls > 0) S.rerolls--; else S.gold -= REROLL; S.picks--; offer(S); S.pick.t0 -= 0.3; } }
        else if (inp.px !== undefined && inp.moved) for (let i = 0; i < p.opts.length; i++) if (inRect(inp.px, inp.py, UI.card(p.kind, i))) p.sel = i;
      }
      S.prevAct = inp.act || inp.jump;
      if (p.done >= 0 && t - p.done > 0.45) { S.pick = null; if (S.pend > 0) { S.pend--; S.lv++; offer(S); } }
      S.t = t; S.steps++; return S;
    }
    // the shop (an altar): the world waits; arrows / WASD move over the 4 × 4 cards, Enter / Space or a click buys, Esc or the button leaves
    if (S.shop) {
      for (const q of S.pr) q.t0 += DT; for (const h of S.holes) h.t0 += DT; S.castT += DT;
      const sh = S.shop;
      if (t - sh.t0 > 0.3) {
        const nx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), ny = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), nav = nx + ny * 3;
        if (!nav) S.navHeld = 0;
        if (nav && nav !== S.prevNav && !S.navHeld) sh.sel = ((sh.sel % 4 + nx + 4) % 4) + ((Math.floor(sh.sel / 4) + ny + 4) % 4) * 4;
        S.prevNav = nav;
        if (inp.buy !== undefined) buy(S, SHOP[inp.buy]);                         // the autopilot buys by index
        else if ((inp.act || inp.jump) && !S.prevAct) buy(S, SHOP[sh.sel]);
        else if (inp.click) { for (let i = 0; i < SHOP.length; i++) if (inRect(inp.px, inp.py, UI.scard(i))) { sh.sel = i; buy(S, SHOP[i]); }
          if (inRect(inp.px, inp.py, UI.sclose)) closeShop(S); }
        else if (inp.px !== undefined && inp.moved) for (let i = 0; i < SHOP.length; i++) if (inRect(inp.px, inp.py, UI.scard(i))) sh.sel = i;
        if (S.shop && inp.esc) closeShop(S);
      }
      S.prevAct = inp.act || inp.jump; S.t = t; S.steps++; return S;
    }
    if (S.won < 0 && S.dead < 0 && !S.demo && S.clock >= WIN) { S.won = t; S.ev.push({ k: 'win', t, x: S.x, y: S.y }); }
    const alive = S.dead < 0 && S.won < 0; if (alive) S.clock += DT;
    // ---- hero movement ----
    if (alive) {
      const ix = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), iy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0), il = Math.hypot(ix, iy) || 1;
      const sp = HERO.SPEED * (1 + 0.1 * S.st.spd), tx = ix / il * sp, ty = iy / il * sp;
      const app = (v, tg) => { const a = (Math.abs(tg) > Math.abs(v) ? HERO.ACC : HERO.DEC) * DT; return v < tg ? Math.min(tg, v + a) : Math.max(tg, v - a); };
      S.vx = app(S.vx, tx); S.vy = app(S.vy, ty); if (ix) S.face = ix; if (iy) S.faceY = iy;
      S.x += S.vx * DT; S.y += S.vy * DT; pushOut(S, HERO.R); clampW(S, HERO.R);
      gaitStep(S, S.vx, S.vy, 'hero');
      if (rk(S, 'regen')) S.hp = Math.min(maxHp(S), S.hp + 0.4 * rk(S, 'regen') * DT);
      // an altar opens the shop when the hero steps into it (once per visit: leave the circle to use it again)
      if (!S.demo) for (let i = 0; i < ALTARS.length; i++) { const d = Math.hypot(S.x - ALTARS[i][0], (S.y - ALTARS[i][1]) * 1.35);
        if (d < ALTAR_R && S.shopLock !== i && !S.pick && S.pend === 0) { S.shop = { i, t0: t, sel: 0 }; S.prevNav = 99; S.navHeld = 1; S.ev.push({ k: 'shop', t, x: ALTARS[i][0], y: ALTARS[i][1] }); }
        else if (d > ALTAR_R + 50 && S.shopLock === i) S.shopLock = -1; }
      const mv = Math.hypot(S.vx, S.vy) * DT; if (mv > 0.02) { const b = Math.floor(S.dist / 62); S.dist += mv; if (Math.floor(S.dist / 62) !== b) S.ev.push({ k: 'step', t, x: S.x, y: S.y }); }
    } else { S.vx *= 0.9; S.vy *= 0.9; gaitStep(S, S.vx, S.vy, 'hero'); if (t - Math.max(S.dead, S.won) > 1.4 && (inp.act || inp.jump || inp.click)) S.restart = true; }

    // ---- spawning: just outside the camera rectangle (never inside the view), faster and tougher with the clock;
    //      every minute a wave closes in from all sides ----
    const offscreen = () => { const cx0 = S.cam[0], cy0 = S.cam[1], ok = [cx0 - 120 > 100, cx0 + VIEW.W + 120 < WORLD.x1 - 100, cy0 - 60 > 220, cy0 + VIEW.H + 170 < WORLD.y1 - 80],
        av = [0, 1, 2, 3].filter((k) => ok[k]), side = av.length ? av[Math.floor(rnd(S) * av.length)] : Math.floor(rnd(S) * 4), u = rnd(S), e = {};
      if (side === 0) { e.x = cx0 - 120; e.y = cy0 + u * VIEW.H; } else if (side === 1) { e.x = cx0 + VIEW.W + 120; e.y = cy0 + u * VIEW.H; }
      else if (side === 2) { e.x = cx0 + u * VIEW.W; e.y = cy0 - 60; } else { e.x = cx0 + u * VIEW.W; e.y = cy0 + VIEW.H + 170; }
      if (e.x < 100 || e.x > WORLD.x1 - 100 || e.y < 220 || e.y > WORLD.y1 - 80) { e.x = S.x * 2 - e.x; e.y = S.y * 2 - e.y; }
      clampW(e, 30); return e; };
    const pickType = () => { const q = rnd(S), c = S.clock; return c > 40 && q < 0.08 + Math.min(0.1, c / 3000) ? 'brute' : c > 15 && q < 0.3 ? 'bat' : q < 0.62 ? 'ghoul' : 'skeleton'; };
    if (alive) {
      const rate = S.demo ? 5 : CURVE.rate(S.clock), cap = S.demo ? 150 : CURVE.cap(S.clock);
      S.spawnAcc += rate * DT;
      while (S.spawnAcc >= 1) { S.spawnAcc -= 1; if (S.en.length >= cap) continue; const e = offscreen(); addMob(S, pickType(), e.x, e.y); }
      // waves grow with their number (w); every BOSS_EVERY-th one also brings a boss
      if (!S.demo && Math.floor(S.clock / 60) > S.wave) { S.wave = Math.floor(S.clock / 60); const w = S.wave, kind = w % 3, boss = w % BOSS_EVERY === 0;
        S.ev.push({ k: 'wave', t, x: S.x, y: S.y, n: w, kind, boss });
        if (kind === 1) {               // a swarm of bats sweeps straight through the screen
          const side = rnd(S) < 0.5 ? -1 : 1, y0 = S.y + (rnd(S) - 0.5) * 500, n = 20 + Math.min(30, w);
          for (let i = 0; i < n; i++) { const e = addMob(S, 'bat', S.x - side * (1150 + rnd(S) * 400), y0 + (rnd(S) - 0.5) * 360); e.swarm = [side * 300, (S.y - y0) * 0.12]; e.life = 9; } }
        else if (kind === 2) {          // a ring of skeletons closing in
          const n = 30 + Math.min(30, w);
          for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, p = { x: S.x + Math.cos(a) * 700, y: S.y + Math.sin(a) * 460 }; clampW(p, 30); pushOut(p, 20); addMob(S, 'skeleton', p.x, p.y); } }
        else {                          // elite brutes (and their escort) that drop a chest each
          for (let j = 0; j < 1 + Math.floor(w / 12); j++) { const p = offscreen(), e = addEnemy(S, 'brute', p.x, p.y); e.elite = 1; e.sz = 1.3; e.hp *= 6; e.hpMax *= 6; }
          for (let i = 0; i < 12 + Math.floor(w / 2); i++) { const q = offscreen(); addMob(S, pickType(), q.x, q.y); } }
        if (boss) {                     // the boss: a giant brute, slow to die, hits hard, drops a double chest and a ring of big crystals
          const p = offscreen(), e = addEnemy(S, 'brute', p.x, p.y); e.elite = 1; e.boss = 1; e.sz = 1.6; e.hp *= 25; e.hpMax *= 25; e.dmg *= 1.6; } }
    }
    // ---- enemies: steer to the hero, separate from each other (grid hash), knockback, contact damage ----
    const CELL = 64, grid = new Map(), key = (cx, cy) => cx * 4096 + cy;
    for (let i = 0; i < S.en.length; i++) { const e = S.en[i]; if (e.dieT >= 0) continue; const k = key(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
      let c = grid.get(k); if (!c) grid.set(k, (c = [])); c.push(i); }
    for (let i = 0; i < S.en.length; i++) {
      const e = S.en[i], T = ET[e.type];
      if (e.dieT >= 0) { e.kx *= 0.9; e.ky *= 0.9; e.x += e.kx * DT; e.y += e.ky * DT; continue; }
      let dx = S.x - e.x, dy = S.y - e.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const slow = S.holes.some((h) => Math.hypot(h.x - e.x, h.y - e.y) < h.r) ? 0.25 : 1;
      let sx = 0, sy = 0; const cx = Math.floor(e.x / CELL), cy = Math.floor(e.y / CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { const c = grid.get(key(cx + ox, cy + oy)); if (!c) continue;
        for (const j of c) { if (j === i) continue; const o = S.en[j], ax = e.x - o.x, ay = e.y - o.y, dd = Math.hypot(ax, ay), rr = (T.r + ET[o.type].r) * 0.95;
          if (dd < rr && dd > 0.01) { const f = (rr - dd) / rr * ET[o.type].mass / (T.mass + ET[o.type].mass); sx += ax / dd * f; sy += ay / dd * f; } } }
      if (e.swarm) { e.vx = e.swarm[0]; e.vy = e.swarm[1]; e.x += e.vx * DT; e.y += e.vy * DT; e.life -= DT; e.face = Math.sign(e.vx); gaitStep(e, e.vx, e.vy, e.type);
        if (alive && d < reach(e) + HERO.R + 6 && t - e.atkT > 0.8) { e.atkT = t; bite(S, t, e.dmg || T.dmg, dx, dy); }
        continue; }
      const wob = T.fly ? Math.sin(t * 5 + e.ph * 6.28) * 0.6 : 0, sp = T.sp * CURVE.spd(S.clock) * slow * (alive ? 1 : 0.4);
      const tvx = (dx - dy * wob) * sp, tvy = (dy + dx * wob) * sp;
      e.vx += (tvx - e.vx) * Math.min(1, 6 * DT); e.vy += (tvy - e.vy) * Math.min(1, 6 * DT);
      const px0 = e.x, py0 = e.y; e.x += (e.vx + e.kx) * DT + sx * 2.2; e.y += (e.vy + e.ky) * DT + sy * 2.2;
      e.kx *= Math.pow(0.0005, DT); e.ky *= Math.pow(0.0005, DT);
      if (!T.fly) pushOut(e, reach(e));
      clampW(e, reach(e));
      const knock = Math.hypot(e.kx, e.ky) > T.sp * 0.8, avx = knock ? 0 : (e.x - px0) / DT, avy = knock ? 0 : (e.y - py0) / DT;
      e.dist += Math.hypot(avx, avy) * DT; gaitStep(e, avx, avy, e.type); if (Math.abs(e.vx) > 8) e.face = Math.sign(e.vx);
      // contact: enemies bite on a short cooldown; the hero has brief invulnerability after a hit
      if (alive && d < reach(e) + HERO.R + 6 && t - e.atkT > 0.8) { e.atkT = t; bite(S, t, (e.dmg || T.dmg) * (S.demo ? 0.25 : 1), dx, dy); }
    }
    // the dead fade, then leave the list
    S.en = S.en.filter((e) => (e.dieT < 0 || t - e.dieT < 1.4) && !(e.swarm && e.life <= 0));          // the body falls, lies 0.6 s, fades (scene); swarms fly off
    // far stragglers re-enter near the hero (a horde never thins out behind the camera)
    for (const e of S.en) if (e.dieT < 0 && !e.swarm && Math.hypot(e.x - S.x, e.y - S.y) > 1700) { const p = offscreen(); e.x = p.x; e.y = p.y; e.born = t; }

    // ---- weapons ----
    if (alive) {
      // ice wand: crescent shards leave the staff tip and spiral outward round it, all turning the same way (the reference's
      // ice storm); each lives 1.45 s and cuts through every enemy it meets (once per enemy)
      if (S.wp.ice) { const l = S.wp.ice; S.cd.ice -= DT;
        if (S.cd.ice <= 0) { S.cd.ice += WP.ice.cd[l - 1] / pace(S); S.castT = t; const [tx0, ty0] = tip(S), tg = nearest(S, S.x, S.y, 900);
          let base = S.face > 0 ? 0 : Math.PI, th0 = base - 0.6;
          if (tg) { const dx = tg.x - tx0, dy = (tg.y - 34 - ty0) / 0.72, d = Math.max(110, Math.hypot(dx, dy)), age = (d - 110) / 260;
            base = Math.atan2(tg.y - S.y, tg.x - S.x); th0 = Math.atan2(dy, dx) - WP.ice.spin * age; }
          const n = WP.ice.n[l - 1] + more(S), ak = area(S);
          for (let i = 0; i < n; i++) S.pr.push({ k: 'ice', ox: tx0, oy: ty0, th: th0 + i * Math.PI * 2 / n, x: tx0, y: ty0, a: base, t0: t, life: WP.ice.life * durK(S), dmg: WP.ice.dmg[l - 1] * pow(S), sz: ak, hits: [] });
          S.ev.push({ k: 'cast', t, x: tx0, y: ty0, a: base }); } }
      // lightning: strikes random enemies within range, chains once
      if (S.wp.bolt) { const l = S.wp.bolt; S.cd.bolt -= DT;
        if (S.cd.bolt <= 0) { S.cd.bolt += WP.bolt.cd[l - 1] / pace(S); const dm = WP.bolt.dmg[l - 1] * pow(S), near = S.en.filter((e) => e.dieT < 0 && Math.hypot(e.x - S.x, e.y - S.y) < WP.bolt.range * area(S));
          for (let i = 0; i < WP.bolt.n[l - 1] + more(S) && near.length; i++) { const e = near.splice(Math.floor(rnd(S) * near.length), 1)[0];
            S.ev.push({ k: 'bolt', t, x: e.x, y: e.y, seed: rnd(S) * 100 }); hit(S, e, dm, 0, 0, 'bolt');
            const c = nearest(S, e.x, e.y, 200 * area(S), [e.id]); if (c) { S.ev.push({ k: 'arc', t, x: e.x, y: e.y - 30, x1: c.x, y1: c.y - 30, seed: rnd(S) * 100 }); hit(S, c, dm * 0.6, 0, 0, 'bolt'); } } } }
      // black hole: opens on the densest spot near the hero, pulls and grinds
      if (S.wp.hole) { const l = S.wp.hole; S.cd.hole -= DT;
        if (S.cd.hole <= 0) { S.cd.hole += WP.hole.cd[l - 1] / pace(S); const r = WP.hole.rad[l - 1] * area(S), opened = [];
          for (let j = 0; j < 1 + more(S); j++) { let best = null, bn = -1;          // each extra hole takes the densest spot clear of the others
            for (let k = 0; k < 10; k++) { const e = S.en[Math.floor(rnd(S) * S.en.length)]; if (!e || e.dieT >= 0 || Math.hypot(e.x - S.x, e.y - S.y) > 700 || opened.some((o) => Math.hypot(o[0] - e.x, o[1] - e.y) < r * 1.6)) continue;
              const n = S.en.filter((o) => Math.hypot(o.x - e.x, o.y - e.y) < 160).length; if (n > bn) { bn = n; best = e; } }
            const hx = best ? best.x : S.x + S.face * (300 + j * 260), hy = best ? best.y : S.y + j * 120; opened.push([hx, hy]);
            S.holes.push({ x: hx, y: hy, r, t0: t, tick: 0, dmg: WP.hole.dmg[l - 1] * pow(S), dur: WP.hole.dur * durK(S) }); S.ev.push({ k: 'hole', t, x: hx, y: hy }); } } }
      // fire swords orbit the hero
      if (S.wp.fire) { const l = S.wp.fire, n = fireN(S), sp = fireSpd(S), fr = fireRad(S), ak = area(S);
        for (let i = 0; i < n; i++) { const a = S.clock * sp + i * Math.PI * 2 / n, fx = S.x + Math.cos(a) * fr, fy = S.y - 30 + Math.sin(a) * fr * 0.62;
          for (const e of S.en) { if (e.dieT >= 0) continue; if (Math.hypot(e.x - fx, (e.y - 30 - fy) * 1.2) < 48 * ak + reach(e) && t - (e['f' + i] || -9) > 0.45) { e['f' + i] = t;
            hit(S, e, WP.fire.dmg[l - 1] * pow(S), -Math.sin(a) * 260, Math.cos(a) * 160, 'fire'); S.ev.push({ k: 'burn', t, x: e.x, y: e.y - 30 }); } } } }
    }
    // projectiles: the ice spiral r(t) = 110 + 260·age, θ(t) = θ0 + spin·age about the point it left (y squashed for the 3/4 view)
    for (const p of S.pr) { const age = t - p.t0, k = p.sz || 1, r = (110 + 260 * age) * k, th = p.th + WP.ice.spin * age; p.life -= DT;
      p.x = p.ox + Math.cos(th) * r; p.y = p.oy + Math.sin(th) * r * 0.72;
      const vx = 260 * k * Math.cos(th) - r * WP.ice.spin * Math.sin(th), vy = (260 * k * Math.sin(th) + r * WP.ice.spin * Math.cos(th)) * 0.72; p.a = Math.atan2(vy, vx);
      for (const e of S.en) { if (e.dieT >= 0 || p.hits.includes(e.id)) continue;
        if (Math.hypot(e.x - p.x, e.y - 34 - p.y) < reach(e) + 30 * k) { p.hits.push(e.id); hit(S, e, p.dmg, Math.cos(p.a) * 260, Math.sin(p.a) * 200, 'ice');
          S.ev.push({ k: 'shatter', t, x: p.x, y: p.y, a: p.a }); } } }
    S.pr = S.pr.filter((p) => p.life > 0);
    // black holes: pull, tick damage, collapse
    for (const h of S.holes) { const age = t - h.t0;
      for (const e of S.en) { if (e.dieT >= 0) continue; const dx = h.x - e.x, dy = h.y - e.y, d = Math.hypot(dx, dy);
        if (d < h.r * 1.9 && d > 4) { const f = (1 - d / (h.r * 1.9)) * 520 / ET[e.type].mass; e.x += dx / d * f * DT; e.y += dy / d * f * DT; } }
      if (age - h.tick > 0.5) { h.tick = age; for (const e of S.en) if (e.dieT < 0 && Math.hypot(h.x - e.x, h.y - e.y) < h.r) hit(S, e, h.dmg, 0, 0, 'hole'); } }
    S.holes = S.holes.filter((h) => t - h.t0 < (h.dur || WP.hole.dur));

    // ---- pickups: magnet, fly to the hero, collect ----
    for (const g of S.gems) { const dx = S.x - g.x, dy = S.y - 30 - g.y, d = Math.hypot(dx, dy);
      if (alive && (g.mag || d < magR(S))) { g.mag = Math.min(1, (g.mag || 0) + DT * 2.5); const v = 280 + 900 * g.mag; g.x += dx / (d || 1) * v * DT; g.y += dy / (d || 1) * v * DT; }
      if (alive && d < 28) { g.got = t;
        if (g.k === 'coin') { S.goldAcc = (S.goldAcc || 0) + 1 + 0.15 * rk(S, 'gold'); const w = Math.floor(S.goldAcc); S.gold += w; S.goldAcc -= w; }
        else if (g.k === 'heart') S.hp = Math.min(maxHp(S), S.hp + 20);
        else if (g.k === 'chest') for (let j = 0; j < g.v; j++) { const pool = WORDER.filter((k) => S.wp[k] > 0 && S.wp[k] < WP[k].max);   // +1 level to an owned weapon per chest charge
          if (pool.length) { const w = pool[Math.floor(rnd(S) * pool.length)]; S.wp[w]++; S.ev.push({ k: 'chest', t, x: S.x, y: S.y, w }); }
          else { gift(S); S.hp = Math.min(maxHp(S), S.hp + maxHp(S) * 0.5); S.ev.push({ k: 'chest', t, x: S.x, y: S.y }); } }   // all maxed: a free buff rank and a heal
        else { S.xpAcc = (S.xpAcc || 0) + g.v * (1 + 0.1 * rk(S, 'xp')); const w = Math.floor(S.xpAcc); S.xp += w; S.xpAcc -= w; while (S.xp >= need(S.lv)) { S.xp -= need(S.lv); S.pend++; } }
        S.ev.push({ k: 'collect', t, x: g.x, y: g.y, g: g.k }); } }
    S.gems = S.gems.filter((g) => !g.got);
    if (S.gems.length > 260) { const far = S.gems.map((g, i) => [Math.hypot(g.x - S.x, g.y - S.y), i]).sort((a, b) => b[0] - a[0]).slice(0, S.gems.length - 260).map((q) => q[1]);   // drop the farthest, never the ones in view
      S.gems = S.gems.filter((g, i) => g.k === 'chest' || !far.includes(i)); }
    if (S.pend > 0 && alive && !S.shop && !(S.demo && S.t > L - 4)) { S.pend--; S.lv++; offer(S); }

    // ---- camera: follow with a little look-ahead, clamped to the arena ----
    const tgx = Math.max(WORLD.x0, Math.min(WORLD.x1 - VIEW.W, S.x - FEET[0] + S.vx * 0.25));
    const tgy = Math.max(WORLD.y0, Math.min(WORLD.y1 - VIEW.H, S.y - FEET[1] + S.vy * 0.2));
    S.camV[0] += (28 * (tgx - S.cam[0]) - 10.5 * S.camV[0]) * DT; S.cam[0] += S.camV[0] * DT;
    S.camV[1] += (28 * (tgy - S.cam[1]) - 10.5 * S.camV[1]) * DT; S.cam[1] += S.camV[1] * DT;
    if (S.ev.length > 320) S.ev.splice(0, S.ev.length - 320);
    S.prevAct = inp.act || inp.jump;
    S.t = t; S.steps++; return S;
  }

  // ---------------- attract demo: kite in a slow loop around the plaza, auto-pick cards ----------------
  const ROUTE = [[0, 0, 0], [2.5, 1, 0.2], [6, 1, -0.6], [9, -0.4, -1], [12.5, -1, 0], [16, -0.6, 1], [19, 0.7, 0.8], [23, 1, -0.2], [27, -0.2, 0], [29, 0, 0]];
  const scriptInput = (t, S) => { const inp = { left: 0, right: 0, up: 0, down: 0, jump: 0, act: 0, slot: 0 };
    if (S.pick) { if (S.pick.done < 0 && t - S.pick.t0 > 1.4) inp.slot = S.pick.kind === 'weapon' ? Math.max(1, S.pick.opts.indexOf('fire') + 1) : 1; return inp; }
    let w = ROUTE[0]; for (const r of ROUTE) if (r[0] <= t + 1e-9) w = r;
    // steer the route direction, but turn away from enemies that get too close
    let dx = w[1], dy = w[2]; for (const e of S.en) { if (e.dieT >= 0) continue; const ex = S.x - e.x, ey = S.y - e.y, d = Math.hypot(ex, ey); if (d < 120) { dx += ex / d * 0.7; dy += ey / d * 0.7; } }
    const hx = HOME[0] - S.x, hy = HOME[1] - S.y; dx += hx * 0.0012; dy += hy * 0.0012;
    if (Math.abs(dx) > 0.3) inp[dx > 0 ? 'right' : 'left'] = 1; if (Math.abs(dy) > 0.3) inp[dy > 0 ? 'down' : 'up'] = 1;
    return inp; };
  // autopilot for endless autoplay (Q in play mode, ?auto=1): flee the crowd (inverse-square push), drift toward crystals,
  // stay off the arena walls, pick cards on its own; restarts itself after a death
  const autoInput = (S) => { const inp = { left: 0, right: 0, up: 0, down: 0, jump: 0, act: 0, slot: 0 };
    if (S.pick) { if (S.pick.done < 0 && S.t - S.pick.t0 > 0.9) inp.slot = S.gold >= allPrice(S) + 300 ? 5 : 1 + (S.picks % S.pick.opts.length); return inp; }
    if (S.dead >= 0) { inp.act = S.t - S.dead > 2.5 ? 1 : 0; return inp; }
    // the shop: buy the first affordable buff down its wish list (a heal first when hurt), one per 0.25 s, then leave
    if (S.shop) { if (S.t - S.shop.t0 < 0.6 || S.t - (S.shop.lastBuy || 0) < 0.25) return inp;
      const want = (S.hp < maxHp(S) * 0.5 ? ['heal'] : []).concat(AUTOBUY).find((id) => canBuy(S, id));
      if (want) { inp.buy = SHOP.indexOf(want); S.shop.lastBuy = S.t; } else inp.esc = 1; return inp; }
    // a trip to the shop: only with gold worth the walk (60+), and it gives up for 30 s if the altar isn't reached in 25 s
    let goShop = S.clock >= S.shopNext && S.gold >= 60 && AUTOBUY.some((id) => canBuy(S, id));
    if (!goShop) S.shopTry = -1; else if (!(S.shopTry >= 0)) S.shopTry = S.clock; else if (S.clock - S.shopTry > 25) { S.shopNext = S.clock + 30; S.shopTry = -1; goShop = false; }
    const alt = goShop ? ALTARS.filter((a, i) => i !== S.shopLock).reduce((a, b) => Math.hypot(b[0] - S.x, b[1] - S.y) < Math.hypot(a[0] - S.x, a[1] - S.y) ? b : a) : null;   // not the one it just left
    // score 16 headings by the danger at a point ~0.7 s ahead (enemies weighted by mass, closer = worse), crystals pull, walls push
    const near = S.en.filter((e) => e.dieT < 0 && Math.abs(e.x - S.x) < 520 && Math.abs(e.y - S.y) < 520);
    let best = null, bs = 1e9;
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
      let sc = 0; for (const ahead of [70, 140]) { const px = S.x + ux * ahead, py = S.y + uy * ahead;
        for (const e of near) { const d2 = (e.x - px) ** 2 + (e.y - py) ** 2; sc += ET[e.type].mass * (e.sz || 1) ** 2 * 4e4 / (d2 + 900); }   // big ones (elites, the boss) scare it more
        const m = 300; sc += Math.max(0, WORLD.x0 + m - px) * 0.6 + Math.max(0, px - WORLD.x1 + m) * 0.6 + Math.max(0, WORLD.y0 + m + 120 - py) * 0.6 + Math.max(0, py - WORLD.y1 + m) * 0.6;
        for (const o of SOLIDS) if (Math.hypot(o.x - px, o.y - py) < o.r + 40) sc += 60; }
      let gp = 0; for (const g of S.gems) { const d = Math.hypot(g.x - S.x, g.y - S.y); if (d < 450) gp += Math.max(0, ux * (g.x - S.x) + uy * (g.y - S.y)) / d * 6 * (1 - d / 450); }
      sc -= Math.min(12, gp);                                                                    // a heap of crystals never outweighs a wall
      if (alt) { const ax = alt[0] - S.x, ay = alt[1] - S.y, ad = Math.hypot(ax, ay) || 1; sc -= (ux * ax + uy * ay) / ad * (9 + 16 * Math.max(0, 1 - ad / 600)); }   // gold to spend: head for the nearest altar, harder when close
      sc -= (ux * Math.cos(S.t * 0.13) + uy * Math.sin(S.t * 0.11)) * 0.8;                      // a slow wander when it is calm
      if (S.vx || S.vy) sc -= (ux * S.vx + uy * S.vy) / (Math.hypot(S.vx, S.vy) || 1) * 1.2;   // keep heading (no jitter)
      if (sc < bs) { bs = sc; best = [ux, uy]; } }
    // stuck (pressing into a wall for 0.6 s): slide sideways for 0.7 s, turning the other way each time
    const au = S.auto || (S.auto = { x: S.x, y: S.y, t: S.t, until: -1, side: 1 });
    if (S.t - au.t > 0.6) { if (best && Math.hypot(S.x - au.x, S.y - au.y) < 8 && S.t > au.until) { au.until = S.t + 0.7; au.side = -au.side; au.dir = [-best[1] * au.side, best[0] * au.side]; } au.x = S.x; au.y = S.y; au.t = S.t; }
    if (S.t < au.until) best = au.dir;
    if (best) { if (best[0] > 0.38) inp.right = 1; if (best[0] < -0.38) inp.left = 1; if (best[1] > 0.38) inp.down = 1; if (best[1] < -0.38) inp.up = 1; }
    return inp; };
  const AUTOBUY = ['might', 'crit', 'haste', 'hp', 'area', 'armor', 'regen', 'amount', 'spd', 'knock', 'vamp', 'xp', 'dur', 'luck', 'gold'];
  const demoStart = (loop) => { const S = hordeState(); S.demo = true; S.wt0 = loop * L; S.xp = need(12) - 9; return S; };
  let cache = null;
  function at(t) {
    const loop = Math.floor(t / L), q = t - loop * L, n = Math.round(q / DT);
    if (!cache || cache.loop !== loop || cache.S.steps > n) cache = { loop, S: demoStart(loop) };
    const S = cache.S; while (S.steps < n) step(S, scriptInput(S.t, S));
    return Object.assign({}, S, { loop, q });
  }
  // the attract loop must show a level-up pick, real killing, and the hero alive at the end
  const demoCheck = (S) => S.picks >= 1 && S.kills >= 489 + 40 && S.dead < 0;
  const selfCheck = () => { const out = [];
    if (SOLIDS.some((s) => Math.hypot(s.x - HOME[0], s.y - HOME[1]) < s.r + 120)) out.push('a solid prop sits on the hero start');
    for (const [ax, ay] of ALTARS) { if (SOLIDS.some((s) => Math.hypot(s.x - ax, s.y - ay) < s.r + ALTAR_R + 40)) out.push('a solid prop sits on an altar at ' + ax + ',' + ay);
      if (ax < 300 || ax > WORLD.x1 - 300 || ay < 400 || ay > WORLD.y1 - 300) out.push('an altar is too close to the arena wall'); }
    return out; };

  root.SIM = { FEET, DT, L, VIEW, WORLD, HINT, HERO, ET, TYPES, WP, WORDER, STATS, UI, PROPS, PROPR, SOLIDS, TORCHES, RIG, HOME, CAM0, R2W, REFK,
    CURVE, BOSS_EVERY, pow, pace, fireSpd, fireN, fireRad, area, magR, critP, critK, rk, price, maxed, canBuy, allPrice, bagGold, wInfo, wDone, big,
    SHOP, BUFFS, EXTRA, ALTARS, ALTAR_R, buy, chooseAll, gift, addEnemy, need, maxHp, tip, castAmt, autoInput, REROLL, WIN, STRIDE, SWEEP, strideEff, duty, create, spawn, respawn, outOfPlay, step, at, scriptInput, demoCheck, selfCheck, hordeState, demoStart, offer, choose };
  if (typeof module !== 'undefined') module.exports = root.SIM;
})(typeof window !== 'undefined' ? window : globalThis);
