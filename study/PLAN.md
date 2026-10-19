# Plan — Пиксельная арена (arena + level-ups slice)

## Layers (back → front)
ground_tex (world-space REPEAT) → macro shade (fbm) → bolt scorch cracks → light pools (torches, hero, holes; additive) → rune circle → black holes →
contact shadows → Y-sorted band (props, pickups, enemies, hero; key = ground y) → fire blades → ice shards + trails → event FX → damage numbers → finish (bloom, vignette) → HUD → level-up / game-over panels.

## Assets (generation order)
| name | class | canvas/alpha | used by | status |
|---|---|---|---|---|
| hero (→ hero_full, hero_staff, hero__*) | character anchor → tools/hero_split.py (staff as a held item) + rigcut | key ff00ff | drawRig hero + staff | done |
| ghoul (→ ghoul__*) | enemy anchor → rigcut | key ff00ff | drawRig | done |
| skeleton (→ skeleton__*) | enemy anchor → rigcut | key ff00ff | drawRig | done |
| brute (→ brute__*) | enemy anchor → rigcut (tools/derive_brute.py is the fallback) | key ff00ff | drawRig (walks, duty > 0.5) | done |
| bat (→ bat__body/wingL/wingR) | flyer anchor → tools/batcut.py | key 00ff00 | drawBat | done |
| ground_tex | seamless flagstone material | opaque | SHADERS.ground (plaza + moss + light) | done |
| prop_pillar(_v2) / grave / torch(_v2) / wall / rocks / bush | props | key | Y-band | done |
| pick_coin / pick_xp / pick_xp5 / pick_heart | pickups | key | gems | done |
| icon_ice/bolt/hole/fire, icon_heart/boot/gold, ui_skull | UI icons | opaque / key | HUD, cards | done |
| fx_firesword | FX sprite | key 00ffff | orbiting blades | done |

All finished art is rebuilt from art/raw by `python3 tools/finish.py [names]` (key → despill → LAB grade → mirror → rig cut).
## Effects
ice shards (crescent shader + trail + glow), lightning (jagged beams from the sky + flash + ring + ground cracks), black hole (vortex shader, pull), fire blades (flame shader / sprite + ember puffs), torches (flame shader + flicker glow), rune circle (shimmering), hit flash, death puffs + bone shards, pickup sparkles, level-up ring, hurt ring, step dust.

## Interactions
enemies swarm and separate (grid hash), get knocked back by hits, slowed and pulled by holes; pickups magnet to the hero; props block movement; camera shake on hurts / bolts / death; level-up pauses the world.

## Level as data
SIM.PROPS (the reference's first screen in ref px → world, plus deterministic scatter and a ruined border); waves spawn on a ring outside the view, rate and HP ramp with the clock.

## Animation list (animation.md §13)
| actor | motions |
|---|---|
| hero | idle (breath + weight shift), walk (planted feet, IK knees, arms against legs), cast (staff raise, synced to the shot), hurt (flinch + blink), death (topple) |
| ghoul, skeleton, brute | walk, lunge bite (arms reach), hit (flash + flinch + knockback), death (topple + fade + puffs / bones) |
| bat | flap loop (wings about the shoulders, foreshortened), hover bob, death (spin + fall) |

## Attract beats (30 s)
the reference's moment (07:31, Lv 12, horde) → kiting loop round the plaza → a level-up at ~5 s (weapon cards, picks Огненный меч) → fire blades join the ice, bolts and holes → kills climb past 600.
