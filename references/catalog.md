# Catalog

The effects that ship in `examples/`. Each one is a `.ips` source and a compiled `.iprop`. Every seed gives
a different take, `tint` recolours any of them, `frames` retimes them, and `power`, `sigma` and `blur`
override the light. `node <skill>/scripts/gallery.mjs` builds `out/gallery/index.html`, which plays them
all, each seed three times and then the next one.

| effect | kind | canvas | origin (what it is) | frames the seed rolls | light: power, sigma, blur | own inputs |
|---|---|---|---|---|---|---|
| `arcane/magic-circle` | one-shot | 128x112 | 64,88 floor at the circle's centre | 21, 27 or 33 over 1.4-1.8 s | 1.8 while drawing, flash to 6 when it fires; 9; 1.5 | |
| `arcane/portal` | loop | 112x112 | 56,104 floor under the rift | 18, 24 or 36 at 16.5-19.5 fps | breathes round 2.6; 10; 2 | |
| `explosions/explosion` | one-shot | 144x128 | 72,116 floor under the blast | 18-27 over 1.2-1.5 s | flash to 7, falls with the fire; 7 widening to 12; 1.5 | `style` |
| `holy/heal` | one-shot | 80x104 | 40,92 floor under the healed character | 24, 30 or 36 over 1.55-1.75 s | 2.2, flare to 4 with the burst; 9; 2 | |
| `ice/frost-nova` | one-shot | 192x96 | 96,84 floor under the caster | 24, 30 or 36 over 2.0-2.4 s | gathers to 2, flash to 7, fades with the melt; 10; 1.5 | |
| `impacts/hit-spark` | one-shot | 112x80 | 36,72 floor under the hit | 9, 12 or 15 over 0.46-0.56 s | flash to 9, falls away; 8; 1.5 | |
| `lightning/lightning-strike` | one-shot | 144x192 | 72,180 where the bolt hits the floor | 32, 38 or 44 over 1.5-1.8 s | charges to 1.6, flashes to 12 on the return stroke and 6-9 on each re-strike; 7; 1.5 | `branching`, `lightColor` |
| `lightning/plasma-ball` | loop | 112x104 | 56,96 floor under the stand | 36, 45 or 54 at 16.5-19.5 fps | pulses round 1.8; 10; 2 | |
| `melee/sword-slash` | one-shot | 136x104 | 44,92 floor under the swordsman | 12, 15 or 18 over 0.55-0.65 s | peaks at 5 with the swing; 9; 1.5 | |
| `nature/poison-cloud` | loop | 112x64 | 56,58 floor under the cloud | 18, 24 or 36 at 15-18 fps | breathes round 1.4; 10; 2 | |
| `projectiles/fireball` | loop | 128x48 | 100,24 centre of the head | 12, 15 or 18 at 18-21 fps | flickers round 2.8; 9; 1.5 | |
| `shadow/black-hole` | loop | 112x80 | 56,40 centre of the hole (it floats) | 18, 24 or 36 at 16.5-19.5 fps | breathes round 2.6; 8; 1.5 | |
| `water/splash` | one-shot | 160x96 | 80,72 water surface where the stone goes in | 28, 34 or 40 over 1.5-1.9 s | 2 at the hit, settles at 0.5; 6; 1.5 (lava 2.6-4.8; 8) | `stone` |

The effects are drawn at the scale of a 24x38 px character, seen from the side with light from the upper
left. Effects with a direction face right; mirror them for the left. The header of each `.ips` is its
full documentation.

**Fuel.** This is the peak per generation, measured by `check-fx` with Infinite Props 1.0.0 over seeds 1-6.
The check warns above 3,500,000; a program compiled with 1.0 may spend 25,000,000.
The baked figure includes pass 2 at the maximum light. All 13 pass with 48 of 48 hero frames distinct.

| effect | sprite | mask | baked light |
|---|---|---|---|
| magic-circle | 53,921 | 46,051 | 2,013,628 |
| portal | 129,953 | 88,922 | 1,811,509 |
| explosion | 133,461 | 105,616 | 2,622,290 |
| heal | 47,510 | 61,039 | 1,186,373 |
| frost-nova | 194,336 | 168,216 | 2,673,099 |
| hit-spark | 46,340 | 46,934 | 1,250,933 |
| lightning-strike | 1,054,176 | 425,115 | 3,087,292 |
| plasma-ball | 110,353 | 89,219 | 1,663,743 |
| sword-slash | 117,380 | 102,838 | 2,037,400 |
| poison-cloud | 35,022 | 21,698 | 1,004,803 |
| fireball | 86,410 | 76,677 | 919,302 |
| black-hole | 220,386 | 184,480 | 1,406,618 |
| splash | 328,865 | 363,284 | 2,292,071 |

The sprite and the mask cost little. The baked light costs most, and it grows with the canvas and sigma.
The lightning strike is the heaviest: its canvas is the largest and it draws a whole tree three times
(halo, body, core). Its sigma stops at 7, and the mask draws the forks one level coarser, so the heaviest
of 200 seeds stays near 3.3M at the maximum light.

## Arcane

**Magic circle.** A circle draws itself on the floor. A bright spark runs round the outer ring, leaving
the ring behind it, and a second spark draws the inner ring the other way. Runes blink on as the spark
passes them, and a star of straight lines strikes across the middle. Then it fires: the circle flashes
white, a pillar of light shoots up and motes stream up while the circle turns. Finally it fades from the
outside in. The hero frame is the moment it fires.

- Tint rolls 40% arcane violet, 20% holy gold, 15% infernal red, 15% frost cyan and 10% emerald.
- Seeds also roll the star's points and the runes.

**Portal.** An upright rift standing just off the floor. Inside, a dark well falls away in depth bands, and
bright spiral arms wind down into it with knots of light running along them. The rim wobbles and burns
white where two hot spots chase round it. Motes and streaks are pulled in and strike the rim, grit skates
in along the floor, and the floor under the rift glows.

- Tint rolls 45% violet, 25% teal, 15% emerald and 15% crimson.
- The arm count rolls 2, 3 or 4, weighted toward 3.

## Explosions

**Explosion.** A ground blast:

- a white hero frame with a star flare;
- a fireball of puffs cooling from white to soot;
- shock rings over the floor and through the air;
- sparks that skip off the floor, and rocks that tumble and settle;
- embers riding the heat, and a smoke column that rolls up and thins;
- a scorch whose cracks glow until the smoke clears.

`style`: 0 rolls (60% fire, 25% dirt, 15% plasma), 1 fire, 2 dirt (brown dust, more rocks, a small
fireball), 3 plasma (blue, a double shock ring, more sparks, no smoke).

## Holy

**Heal.** Drawn round a character standing on the origin, without drawing the character:

- petals of light bloom round the feet one by one;
- a hoop rises up the body (the far half behind, the near half in front), leaving sparkles, and bursts at
  the top;
- motes spiral up on trails and pop into tiny hearts or twinkles;
- the petals fold away.

Tint rolls 45% healing green, 35% holy gold and 20% mana aqua.

## Ice

**Frost nova.** Frost spirals in while a snowflake spins up over the caster's hands. Then it bursts: a
flash, a spray of shards, and a ring of frost racing out along the floor. Three rings of faceted crystals
punch up behind the ring, tall ones near the caster and small ones far out, each with a spray and a puff
of vapour. Glints run over the ice and snow drifts down. Then the crystals sink back, dripping, and the
frost fades.

Tint rolls 60% ice, 25% glacial teal and 15% arctic violet.

## Impacts

**Hit spark.** The everyday hit:

- a lopsided cross flare round a crisp white diamond: one long ray along the blow, a stub behind and two
  unequal arms across;
- in the frames after, the flare reaches further and thins until only the long ray is left;
- a cone of sparks sprays along the blow, cools, falls and bounces off the floor;
- hot chips tick off the floor.

The first frame is always the full flash. Tint rolls 55% ember, 20% steel, 15% arcane and 10% venom.

## Lightning

**Lightning strike.** The scene darkens and the ground starts to crackle. A stepped leader jerks down out
of the sky, branching as it comes, every tip burning white, and a streamer climbs off the ground to meet
it. Then the return stroke:

- one white frame: the whole branching tree lit at once, the scene and the ground blown white;
- one to three re-strikes flicker down the main channel, which drifts a little each time, a dart running
  down it before each;
- the channel cools and crumbles from the top down into falling motes;
- on the floor, cracks race out and glow with heat, arcs crawl along them with every stroke, a shock ring
  runs out, sparks, hot chips and grit fly and bounce, dust rolls out, and a scorch cools under smoke.

The bolt is inked in three levels: a translucent deep halo, a pale body and a white core, painted level
by level so no halo covers a body.

No two trees are alike. The trunk is midpoint displacement down to 3 px kinks. The tree rolls its
density, spread and arch. Each fork rolls where it leaves its parent (a beta that favours the upper
part), its angle (a gaussian), its reach (a beta: mostly short, now and then long), its bow and its own
forks (weighted), and so on down to twigs. Forks arch out and down, and thin and darken toward their tips.

`branching` picks the family, which is otherwise rolled:

| value | family | share |
|---|---|---|
| 1 | forked: forks all the way down | 35% |
| 2 | spider: a canopy of long forks spreading from the top | 25% |
| 3 | bare: a lone jagged channel | 20% |
| 4 | twin: a fork reaches the ground too and strikes a second spot | 20% |

The sky end of the bolt fades in the light mask, so its light is never cut off by the top edge. Tint rolls
50% electric blue, 22% violet, 12% gold, 8% crimson and 8% toxic green. `lightColor` sets the colour of the
light the bolt throws (the mask and the baked light) without touching the bolt: a violet bolt can light the
scene amber. Transparent, the default, lights it in the bolt's own colours. The hot cracks keep their heat.

**Plasma ball.** A glass globe on a glossy stand:

- plasma tendrils wander from a pulsing electrode out to the glass, crackling as they go, and fan into
  bright feet where they touch it;
- the glass flares round each foot, and the far tendrils glow dim through the globe;
- the light spills over the stand and the floor.

The crackle re-rolls 20 times a second, whatever the frame count. Tint rolls 45% violet, 30% blue, 15%
rose and 10% green.

## Melee

**Sword slash.** A tilted crescent whips round in a frame or two, white on its outer edge. It holds for a
beat, then the tail chases the head round and the smear cools as it thins. A thinner echo follows just
inside it, and a dotted trace of the blade's path lingers. The tip glints, sparks fly off it and bright
shavings drift off the arc.

- A quarter of the seeds swing upwards.
- Tint rolls 50% steel, 15% crimson, 15% gold, 10% void and 10% jade.

## Nature

**Poison cloud.** A low, heavy cloud squatting on the floor:

- its billows churn and swell, painted in coats across the whole mass so it reads as one cloud;
- wisps peel off the edges and thin away;
- bubbles well up and pop in a ring of droplets;
- a faint sick glow hangs over it.

Tint rolls 60% toxic green, 25% venom violet and 15% plague ochre.

## Projectiles

**Fireball.** A fireball flying right:

- a churning head, white-hot at the heart, with a crisp hot rim where it cuts the air;
- tongues of flame stream back and lash, and thin licks peel off its skin;
- a long torn tail of puffs cools from yellow to deep red, and some burn out into smoke;
- motes flick off the head and embers fall behind.

Move the origin along the projectile's path. Tint rolls 65% fire, 15% blue, 10% witch green and 10% shadow
violet.

## Shadow

**Black hole.** A black shadow ringed by a thin photon ring, inside a tilted accretion disc:

- the disc streams round, white-hot at the inner edge and deep red at the rim;
- the side swinging toward us is brighter;
- the far half's light bends over the top as a lensed ring, and the near half crosses in front;
- motes spiral in and vanish at the edge of the shadow.

Tint rolls 50% amber, 30% void violet and 20% ion cyan.

## Water

**Splash.** A stone drops into still water. A white hit, then a crown leaps up round the hole: a thin
sheet with a rolled white lip, its near wall see-through between bright streaks. Fingers run up off the
lip and the beads on their tips tear off and arc away. The crown falls back lane by lane, shedding drops,
and a jet bounces up the middle. Every drop plinks down with a ring of its own. Ripples spread and break
into glinting dashes, lacy foam floats, mist rolls out low, and the sunk stone lets go of bubbles.

- Tint rolls 60% water, 20% swamp and 20% lava. Lava glows all over.
- `stone`: 0 rolls (three seeds in four drop a stone in first), 1 the stone falls in, 2 the splash alone,
  starting at the hit.
