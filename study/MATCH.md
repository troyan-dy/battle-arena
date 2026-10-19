# Match layout — the reference's first screen
Reference arena: (8,8)–(955,595) ref px → view 1920×1190, k = 2.027. World = CAM0 + (ref − 8)·k, CAM0 = HOME − (497, 330)·k, HOME = (2100, 1400).
- Camera: the hero stands at ref (505, 338) → view (1007, 669); hero height ≈ 46 ref px → 98 view px.
- Props (ref px): torch (158,158), gravestone (118,228), torch (66,452), ruin wall (30,300) & (24,420), pillar (22,545), pillar (805,70), wall (880,60), pillar (915,160), graves (622,560) & (186,568), rocks (300,40) & (940,470), bushes (600,18) & (940,300).
- Light: cyan rune ring under the hero (r ≈ 45 ref px), warm torch pools, the ice storm crescents spiralling out from the hero.
- Actors: ~120 enemies all round (ghouls, skeletons, bats, brutes outside r 520), density rising outward; ~45 pickups (gold + blue crystals).
- HUD (ref px → view): portrait (18,22,62×60), HP bar (92,28)–(322,46) "HP 98/120", XP bar (92,53)–(275,70) "XP 7/100", "Lv. 12" (20,88)–(80,106), 3 passive icons (20,118)…(52,228), timer "07:32" centred at (527,28), skull 489 / coin 324 at (897..945, 30/60), 5 weapon slots (18..280, 520..566) numbered 1–5, minimap circle centre (890,515) r 62 with red enemy dots.
- QA: SCENE.QA() state 'match' = the demo start after 1 s (07:32, HP 98/120, Lv 12, 489 kills, 324 gold).
