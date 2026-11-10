# The effect contract

Every effect is one `.ips` asset that keeps this contract, so a game, the gallery and the scripts can play
any of them the same way. `node <skill>/scripts/new-fx.mjs` starts from a template that keeps it, and
`node <skill>/scripts/check-fx.mjs` enforces it.

## The header

The comment at the top is the effect's documentation, and the scripts read it:

```
// Splash: a stone drops into still water. A white hit, then a crown leaps up ...   <- "Title: art direction"
//
// Category: water. One-shot. Canvas 160x96, origin 80,72 (the water's surface ...).
// Frames: the seed rolls 28, 34 or 40 frames over 1.5-1.9 s; `frames` retimes it.
// Light: what the mask holds; power, sigma and blur over time.
//   tint   what the input does, and its rolled default
//   stone  ...
//
// Variety: medium
```

- The first paragraph is the one-line art direction. The gallery shows it under the title.
- `Category: <category>. One-shot|Loop. Canvas WxH, origin x,y (what the origin is).` The check compares
  `One-shot`/`Loop` with what the effect reports.
- `Frames:` gives the seed's frame counts and duration or fps. `Light:` says what glows and how strongly.
- `Variety:` is low, medium, high or extreme: how far seeds differ (families, not only jitter).

## Canvas and origin

- Draw at the scale of a 24x38 px character: a heal 80x104, a hit spark 112x80, a frost nova 192x96.
- The `origin` is where the game puts the effect:
  - ground effects: the floor under them, near the bottom;
  - a projectile: its head;
  - a floating thing: its centre.
- Leave room inside the canvas. Nothing may touch an edge. Whatever glows needs about 3 sigma of space
  before an edge, or its light fades toward that edge in the mask (the lightning's `fadeAt`).

## Inputs

Declare exactly these, with these defaults:

| input | meaning |
|---|---|
| `input u32 frame = 0` | 0 draws the hero frame (`heroPhase` of the way in, the thumbnail); 1..frames play the effect. A loop wraps: frames+1 is frame 1. A one-shot draws nothing after its last frame in every pass, and reports frame 0. |
| `input u32 frames = 0` | 0 uses the seed's own frame count; 2..64 retimes the effect to that many frames over the same duration (the same cycle for a loop). |
| `input u32 renderPass = 0` | 0 the colour sprite, 1 the light mask, 2 the light under the pixels. |
| `input f32 power = 0.0`, `sigma`, `blur` | 0 keeps each frame's own value; above 0 forces it. |
| `input color tint = #00000000` | transparent lets the seed roll a palette family; a colour builds an 8-step ramp from it (`rampFrom`). |

An effect may add its own inputs (`style` on the explosion, `stone` on the splash). They follow the same
rule: 0 lets the seed roll, any other value forces one aspect.

## Outputs

```
output rect anim     // {x: frames, y: fps, w: 1 loop / 0 one-shot, h: the frame drawn, 0 when done}
output circle glow   // {x: power, y: sigma, radius: blur} of this frame's light
```

Write both in every frame and every pass. The check generates frame 1, reads `anim.frames`, and then
renders frames 1..frames+1 in each pass.

## The three passes

All drawing goes through one helper, `scene(..., pass, amp)`:

- `pass 0`: colour.
- `pass 1`: only what emits light, in its light colour, with alpha scaled by `amp`.

`draw` calls it in a source-over layer, so translucent paint survives, and keeps the template's dispatch:

```
if (renderPass == 1) {           // the light mask
  layer mask1(alpha = surface.source_over) { scene(..., 1, 1.0) }
  surface.paint(mask1, blend = surface.source_over)
} else if (renderPass == 2) {    // the light under the pixels
  if (lp > 0.0) {
    k = max(1, int(ceil(lp)))
    layer mask2(alpha = surface.source_over) { scene(..., 1, lp / float(k)) }
    pool = mask2.blur(ls)
    bloom = mask2.blur(lb)
    for i in 0..k { surface.paint(pool, blend = surface.source_over) }
    for i in 0..k { surface.paint(bloom, blend = surface.source_over) }
  }
} else {                         // the sprite
  layer sprite(alpha = surface.source_over) { scene(..., 0, 1.0) }
  surface.paint(sprite, blend = surface.source_over)
}
```

Clamp the light before you use it: `power` 0..16, `sigma` 0..`sigmaMax` (12), `blur` 0..4. The check renders
pass 2 at power 16, sigma 24 and blur 8, and that frame should stay under 3,500,000 fuel like any other.
A 1.0 program may spend 25,000,000, but a game renders dozens of frames per effect. The bigger the canvas
and the sigma, the more that pass costs, so the clamp on sigma is what keeps it cheap.

Pass 2 paints each blurred layer `k = ceil(power)` times at `power / k` of its strength. That is the
exposure curve of `references/light.md`: light that never clips past white, and the same light a game
computes from the mask.

## Timing

Roll the timing in a stream of its own, before anything else:

```
stream.push(hash(start ^ timeKey))
rolled = pick(24, 30, 36)       // one-shot: the frame count
dur = 1.55 to 1.75              // and how long it plays
stream.pop()
```

```
stream.push(hash(start ^ timeKey))
rolled = pick(18, 24, 36)       // loop: frames per cycle
rate = 16.5 to 19.5             // and fps
stream.pop()
dur = float(rolled) / rate
```

- **One-shots** sample a timeline: `t = (float(f) - 0.5) / float(n) * natural`. Here `natural` is the length
  the effect is choreographed over: a constant, or the rolled `dur` when the motion may stretch with it. The
  game plays the frames at `fps = n / dur`. Choreograph in seconds, not in frames, so that any frame count
  samples the same motion.
- **Loops** run on `phase = (float(f) - 1.0) / float(n)` after `f = (f - 1) % n + 1`. Everything must be
  periodic in the phase:
  - waves `sin(tau * phase * k)` with whole k;
  - particles born a whole number of times a cycle: `age = fract(phase * births + offset) * period`;
  - noise sampled round a circle (`loopNoise`);
  - rotations by whole fractions of a turn.
- **Frame counts.** Aim at 16-24 fps: about one and a half times the classic 12 fps of pixel animation.
  The extra in-betweens make motion smoother and steadier at the same duration. Effects roll from a
  few counts (`pick(24, 30, 36)`), so seeds differ in rhythm as well as in look.
- **Flicker by time, not by frame.** Anything re-rolled while it plays (a crackle, an arc's jump, a flicker)
  uses a tick counted in time: `tick = int(t * 30.0)` for a one-shot, or a whole number of ticks a cycle for
  a loop. Otherwise a higher frame count makes it twitch faster.

## Endings and the hero frame

- A one-shot ends empty. The frame after the last draws nothing in any pass. The last frame covers at most
  30% of the peak, so let the effect shrink, thin or fall away. Mid-animation frames must not be empty: the
  first or last particle can live the whole effect, or a last glint can fade out exactly at the end.
- Fade the light (`lp`) to 0 before its mask runs out. The check warns when power is above 0.05 and the
  mask is empty.
- `heroPhase` points frame 0 at the moment that says the most about the effect. Seeds should differ there:
  the check wants 90% of 48 hero frames to be distinct.

## Randomness

- `start = seed` on the first line of `draw`. Every random draw happens inside a named stream:
  - `stream.push(hash(start ^ lookKey))` for the look;
  - `hash((start ^ sparkKey) + i * 0x9e3779b1)` for particle i.
- Roll everything whatever the inputs. Make each roll whatever the branch, so a forced input never shifts
  the rolls after it.
- Particles roll their whole life once, by index, and get their position at time t in closed form, or by a
  fixed-step `fly()`. Nothing depends on the previous frame, so any frame renders alone. The check renders
  a frame twice and wants the same pixels.
- Weighted families keep rare looks rare: `const distribution looks = weighted {1: 60, 2: 25, 3: 15}`.

## What the check runs

`node <skill>/scripts/check-fx.mjs <file or folder> [--seeds 1-6] [--variety 1-48] [--emit] [--json]`:

- **Declarations**: the inputs, the outputs, the `Category` and `Variety` lines.
- **Every frame of seeds 1-6 in all three passes, plus the frame after the end**:
  - fails on traps and on `anim` or `glow` that are missing or out of range;
  - a loop must wrap (frame n+1 equals frame 1), and it warns when the seam jumps more than 2.5 typical steps;
  - a one-shot must end empty, and it warns when the last frame is too full;
  - warns on an empty sprite mid-animation, light with an empty mask, a sprite touching an edge, and baked
    light cut by an edge.
- **The inputs**: `frames`, `power`, `sigma` and `blur` must come back as forced. `frames = 6` must render.
  The same seed and frame must render the same pixels. Pass 2 at the maximum light must render without
  running out of fuel.
- **The hero frames of seeds 1-48**: none may be empty, and they should differ.
- **Fuel**: warns when any pass peaks above 3,500,000 (`--fuel-warn`). That is the skill's bar for one
  frame, far below the 25,000,000 a program compiled with 1.0 may spend.

`PASS`, `WARN` or `FAIL` per effect; only `FAIL` exits 1. `--emit` writes `<name>.iprop` next to every effect
that does not fail.
