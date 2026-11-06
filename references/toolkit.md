# Toolkit: the IPS techniques the effects share

The effects in `examples/` are built from a small set of moves. Copy helpers from the effect that has them;
unused helpers cost nothing. The language itself is in the SDK's `share/iprop/LLM_REFERENCE.md`, and that
reference wins over anything here.

## Colour

**Ramps.** An effect paints from one 8-step ramp, `cs`, darkest to white. `tone(cs, t)` picks a step by
heat, so a particle cools by lowering `t` as it ages:

```
tone(cs: list<color>, t: f32) -> color {
  n = list.len(cs)
  return cs[clamp(int(t * float(n)), 0, n - 1)]
}
```

**Palette families.** Name each family as a `palette` of 8 tones and roll which one to use with weights,
so rare looks stay rare:

```
const distribution looks = weighted {1: 40, 2: 20, 3: 15, 4: 15, 5: 10}
...
stream_push(hash(start ^ lookKey))
kind = 1 to 5 with looks
stream_pop()
```

**The tint input.** `rampFrom(tint)` builds the 8 steps from any colour: four shades from near-black,
the colour itself, two lifts toward warm white, and white. Most effects share this function, so a tint
means the same thing everywhere. The hit spark and the sword slash use a 7-step `rampFrom7`, and the
fireball uses `hotRamp`: nine steps, hottest first. Test the alpha, because colours
cannot be compared with `==`: `if (tint.a != 0) { cs = rampFrom(tint) }`.

**Alpha.** `ink(c, a)` scales a colour's alpha. Translucent paint survives only in a source-over layer,
which is why the template draws every pass inside `layer ...(alpha = surface.source_over)`:

```
ink(c: color, a: f32) -> color {
  return color.set.a(c, int(clamp(a, 0.0, 1.0) * float(c.a)))
}
```

## Two passes from one scene

`scene` and every helper take `pass` and `amp`. Pass 0 paints colour. Pass 1 paints only what emits light,
in the light's colour, at `amp` times its strength.

- **Shared shapes**: decide the colour per pass. `glowInk(c, pass, amp, k, all)` returns the sprite colour
  in pass 0 and `ink(c, amp * max(k, all))` in pass 1, where `k` is how strongly this part glows:

  ```
  glowInk(c: color, pass: i32, amp: f32, k: f32, all: f32) -> color {
    if (pass == 1) { return ink(c, amp * max(k, all)) }
    return c
  }
  ```

- **Sprite-only shapes** (smoke, rocks, the dark body of a cloud): `if (pass == 0) { ... }`.
- **Light-only shapes** (a pool on the floor, haze in the air, a pop along a blow): `if (pass == 1) {
  haze(...) }`. The sprite never shows them, but they light the scene. `haze` stacks a few translucent
  ovals:

  ```
  haze(p: vec2, r: f32, col: color, a: f32) {
    for i in 0..4 {
      k = 1.0 - float(i) * 0.24
      oval(p, r * k, r * k, ink(col, a * (0.12 + 0.08 * float(i))))
    }
  }
  ```

- **Fading toward an edge**: when a glowing thing has to reach the canvas edge (the lightning bolt comes
  out of the sky), fade it in the mask only. The lightning does this with `fadeAt`, which fades the
  mask toward the sky and the sides, so the baked light isn't cut off.

## Time

- **One-shots**: `t` is in seconds. Stages are progress values: `seg(t, a, b)` runs 0 to 1 between `a` and
  `b`:

  ```
  seg(t: f32, a: f32, b: f32) -> f32 {
    return clamp((t - a) / (b - a), 0.0, 1.0)
  }
  ```

- **Easing**:
  - `easeOut(u, k) = 1 - (1 - u)^k` for punch: fast in, slow out.
  - `easeIn(u, k) = u^k`.
  - `easeOutBack(x, s)` overshoots and settles, for petals and crystals that pop open.
  - `bump(u) = sin(pi u)` swells and fades.
  - `smoothstep(e0, e1, x)` for ramps.
  - `exp(-t / 0.08)` for flashes.
- **Loops**: `phase` runs 0 to 1 over the cycle. Everything must come back to where it started:
  - **waves**: `sin(tau * phase * float(k) + ph)` with a whole `k`, rolled as `bob = pick(1, 2)`;
  - **births**: a particle is born `births` times a cycle, at its own offset:
    `u = fract(phase * float(births) + at)` is its age from 0 to 1;
  - **noise**: sample it round a circle, so it wraps:

    ```
    loopNoise(phase: f32, lane: f32, key: i32) -> f32 {
      q = 6.28318 * phase
      return noise(cos(q) * 1.6 + lane * 5.3, sin(q) * 1.6 + lane * 2.9, key)
    }
    ```

  - **rotation**: by whole fractions of a turn per cycle. Portal arms turn 1/arms of a turn. The black
    hole's streaks repeat m times round the disc, and each band turns a whole number of m-ths.
- **Flicker and crackle by time**: re-roll on a tick counted in time, never per frame. A loop needs a
  whole number of ticks per cycle:

  ```
  ticks = max(1, round(dur * 20.0))           // about 20 a second
  tick = int(floor(phase * float(ticks)))
  stream_push(hash((start ^ crackleKey) + tick * 0x9e3779b1))
  ...
  stream_pop()
  ```

  A one-shot can use `tick = int(t * 30.0)`.

## Particles

**One stream per particle.** Roll the particle's whole life at once by its index, then place it at time `t`:

```
for i in 0..24 {
  stream_push(hash((start ^ sparkKey) + i * 0x9e3779b1))
  ang = 0.0 to 6.2832
  spd = 60.0 to 160.0
  life = 0.3 to 0.7
  stream_pop()
  u = t / life
  if (u < 1.0) { ... }
}
```

Adding a particle, or a roll inside one, moves nothing else. A fixed number with no stream at all:
`rnd(key, i) = float(hash(key + i * 0x9e3779b1) & 65535) / 65535.0`.

**Closed-form motion.** Nothing integrates frame by frame, so any frame renders on its own.

- **Drag**: `e = exp(-drag * age)`, `x = x0 + vx * (1 - e) / drag`, and the velocity is `vx * e`.
- **Gravity**: `h = h0 + vh * age - 0.5 * grav * age * age`. Solve for the landing time once (`landing(h0,
  vh)` in the splash), then switch to what happens after: a plink, a ring, a bounce.
- **Streaks**: draw from where the particle was a moment ago (`t - 0.04`) to where it is. The streak
  stretches with speed for free.
- **Bounces**: when closed form gets awkward, step the flight from launch to `t` at a fixed rate on every
  call. The hit spark's `fly(p0, v, t)` runs gravity, drag and a floor at 120 Hz. On the floor a spark
  keeps 0.7 of its run and 0.35 of its fall. The result depends only on `t`, so frames still render on
  their own; keep the step count small (lives under a second).

**Life and death**: vary size, speed, delay and life for every particle. Let each one cool down the ramp
and fade (`ink(..., 1 - u)`) instead of popping off.

## Shapes and depth

- **Paint back to front** in `scene`. For things that go round (a hoop, a ring on the floor, an accretion
  disc), draw the far half first and the near half last. `floorRing(c, r, thick, col, near)` in the
  template takes `near = 0` for the far half and `1` for the near half.
- **Side view**: a ring lying on the floor is an ellipse 0.16-0.22 as tall as it is wide. Ground effects
  stand on the origin's row, and things in the air cast a light pool on the floor below.
- **Masses painted in coats.** Overlapping blobs read as one cloud when every blob paints its dark rim,
  then every blob its body, then every lit top, then every highlight:

  ```
  for coat in 0..4 {
    for i in 0..billows {
      // the same per-billow stream every coat, so a billow sits in one place
      if (coat == 0) { oval(p, r + 1.2, r * 0.82 + 1.0, ink(cs[1], 0.6)) }
      if (coat == 1) { oval(p, r, r * 0.82, ink(cs[2], 0.8)) }
      if (coat == 2) { oval(p - {r * 0.22, r * 0.25}, r * 0.68, r * 0.55, cs[3]) }
      if (coat == 3) { oval(p - {r * 0.38, r * 0.42}, r * 0.32, r * 0.26, cs[4]) }
    }
  }
  ```

  Fireballs, smoke columns and explosions use the same idea.
- **Light from the upper left.** Offset the lit coat up and left of the body, and keep a darker step at the
  bottom right and the base.
- **Textures from a noise mask, not pixel loops.** The splash's foam is a ridge mask, cut to the water
  patch with a mask made from a layer:

  ```
  corner = {cx - rx - 1.0, floorY - ry - 1.0}
  span = {2.0 * rx + 2.0, 2.0 * ry + 2.0}
  layer patch(alpha = surface.source_over) { oval(cx, floorY, rx, ry, #ffffff) }
  inside = mask.from(patch)
  thr = 0.93 - 0.3 * k                 // k: how much foam there is now
  churn = 0.3 + 0.5 * u
  net = noise.mask(corner, span, noise.mode_ridge, {0.3, 0.9}, thr, start ^ foamKey,
                   octaves = 2, softness = 0.0, comparison = noise.above, warp_amount = churn)
  surface.paint(mask.intersect(net, inside), color = glowInk(cs[6], pass, amp, 0.3, all))
  ```

  - A second mask at `thr + 0.05` with the same seed picks out the crests in white.
  - Move `thr` with time to grow or thin the foam, and `warp_amount` to churn it.
  - Noise masks take an explicit seed and draw from no stream.
  - The modes are `mode_value`, `mode_fbm`, `mode_grad`, `mode_ridge`, `mode_cell` and `mode_cell_edge`.
- **Mask arithmetic**: `mask.subtract(mask.from(disc), mask.from(hole))` is a ring of glass (the plasma
  ball's shell). `mask.intersect` clips one shape to another. `surface.paint(mask, color = c)` fills a mask.
- **Branching that looks grown, not placed** (the lightning's `tree`). A path is midpoint displacement:
  `mpd` sums one hashed offset per level, a tent over each cell, each level `rough` as strong, and two
  offsets in eight swing 1.8 times as far. `pathAt` lays it across the line from `a` to `b` and bows it
  by a vector times `sin(pi u)`. Recursion is not allowed, so the levels are nested loops: forks off the
  trunk, forks off those, twigs off those. Each fork draws its shape from distributions, in a stream of
  its own (`stream_push(hash(key + j * 0x9e3779b1))`), so adding one moves no other:

  ```ips
  const distribution rootAt = beta(1.3, 2.1)                       // where it leaves: the upper part favoured
  const distribution forkAngle = gaussian(mean = 0.55, sigma = 0.24)  // how far it turns off, in radians
  const distribution forkReach = beta(1.5, 3.0)                    // mostly short, now and then long
  const distribution subCounts = weighted {0: 18, 1: 34, 2: 30, 3: 18}

  ur = 0.0 to 1.0 with rootAt
  turn = 0.15 to 1.3 with forkAngle
  reachK = 0.04 to 1.0 with forkReach
  subs = 0 to 3 with subCounts
  ```

  - A fork's root and direction come from its parent's path at `u` and a little further on, so it really
    leaves the parent. `downward` keeps it falling.
  - Bow forks outward (`bowOf`), so they leave flatter and then turn down. Step them down the palette
    past 55% and 85% of their length, so they thin out toward the tip.
  - Roll every fork whatever the family, then pick by family: a forced `branching` moves no other roll.
  - Draw the tree once per coat (halo, body, core), so no halo covers a body. The light only needs the
    body, and it can take the forks one level coarser: the blur hides the difference and it halves the cost.

## Impact

- One or two **white hero frames** on the hit: a flash, a star flare, the core at the top of the ramp.
  Then fall away fast.
- **Anticipation** for effects that build: frost spirals in before the nova, a leader steps down before
  the bolt, a spark draws the circle before it fires.
- **Secondary motion** sells it: sparks that skip off the floor, chips that tick, embers riding the heat,
  smoke that thins, a scorch or frost that lingers and fades.

## Fuel

A generation has 5,000,000 fuel, and pass 2 spends most of it on blurs.

- **Blurs**: one `.blur(s)` of a W×H layer costs about `W·H·(1 + 2K)`, with `K = 2·ceil(3s) + 1`. On a
  192x96 canvas, sigma 12 costs about 2.7 M and blur 4 about 0.9 M. That is why the template clamps sigma
  to 12 and blur to 4.
- **Drawing**: paint rows (`rect`), lines and ovals, never per-pixel loops. Keep particle counts in the tens.
- **Layers**: each layer and paint costs a little. Draw a scene once per pass and reuse the layer.
- **Big canvases**: the lightning's 144x192 would pass 3.5 M at sigma 8 with power 16 (k = 16 coats of two
  layers). It clamps sigma to 7. Measure the heaviest seeds' hero frame at `power=16 sigma=24 blur=8`, not
  just seeds 1-6.

`check-fx` reports the peak fuel per pass and warns above 3,500,000.

## Gotchas

- `a to b` on integers includes `b`: `1 to 4` can give 4. `for i in a..b` excludes `b`.
- `round(x)` returns `i32`. `int(x)` truncates. A local keeps the type of its first assignment, so write
  `x = 0.0` for a float.
- `pick(a, b, c)` draws one argument from the current stream, and repeating one weights it:
  `pick(5, 6, 6, 8)`. `chance(p)` returns 1 or 0.
- `noise(x, y, seed)` is value noise in 0..1. `noise.grad` is roughly -1..1.
- `atan2(y, x)` and `atan2(v)` both exist.
- `from`, `layer`, `mask` and `clip` are reserved: don't name locals after them.
- Inputs are visible only in `draw`: pass what helpers need as parameters. Helpers see consts, palettes
  and `seed`.
- `seed` changes with every draw in the main stream. Save `start = seed` on the first line of `draw`, and
  derive every stream from `start` with its own key.
- A layer can be declared inside a helper. `const list<f32>` and `const list<i32>` work for tables.
- `.blur(sigma)` needs sigma in 0..64, so clamp anything computed.
