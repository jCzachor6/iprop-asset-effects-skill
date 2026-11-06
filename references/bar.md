# The quality bar and the review loop

`check-fx` proves that an effect keeps the contract. It cannot tell whether the effect is good: only a
look at the renders can. Judge every effect against the best ones in `examples/` (the lightning strike,
the splash, the frost nova) and against any reference the user gave. If those carry more detail, light
or life at the same size on screen, the new one is not finished.

## Finished means

Looked at on the night stage, at 1x and at 2x:

- **Readable in a glance.** One clear shape and one place the eye goes first. Frame 0, the thumbnail,
  says what the effect is on its own.
- **Timed with weight.** It arrives fast and leaves slowly. Things that build up wind up first; a hit
  gets one or two frames near white; nothing hangs around after the beat.
- **Alive.** Particles never share one size, speed, start or lifetime. Something keeps moving after
  the main beat (sparks, chips, smoke, drips, embers), and no two things move in step.
- **Lit.** The mask holds only what emits light, the light follows the effect, and the floor and the
  air near it pick up its colour.
- **Clean pixels.** Hard steps between tones, few tones per part, readable edges, light from the upper
  left. No stray single pixels and no smooth vector gradients, except in the light itself and in
  translucent smoke.
- **Smooth.** 16-24 frames a second of in-betweens. Crackle and flicker are counted in time, so they
  keep their speed at any frame count.
- **Good on every seed.** The seed picks families (palette, shape, count, rhythm) with weights, rare
  looks stay rare, and no seed is empty, broken or dull.
- **Contract kept.** `node <skill>/scripts/check-fx.mjs <file>` prints `PASS`.

## The loop

Code is a draft. An effect gets good through rounds of render, look and fix, never in one pass.

1. **Render**: `node <skill>/scripts/render-fx.mjs <effect.ips>`, then open `out/<name>/contact.png`. It
   holds every frame of seeds 1-4, lit.
2. **Judge** it as a strict pixel artist would and write down the three worst problems. Put it next to
   the closest effect in `examples/` at the same zoom.
3. **Fix the worst one** and render again. `contact-previous.png` keeps the round before, so you can
   tell whether the fix helped.
4. **Repeat**: three rounds at least, more for a showpiece. Throwing a weak draft away and starting
   over is often faster than patching it.

Each round, look at:

| what | how |
|---|---|
| the first and the last frames | a one-shot must not pop on or off |
| the thumbnail | `--seeds 1-12`: frame 0 is what a game shows in menus and lists |
| a loop's seam | the last frame next to the first; `check-fx` measures the jump |
| detail | `--zoom 4`, or crop the sheet |
| the light | `--layers` adds rows for the sprite alone, the mask and the baked light (pass 2) |
| motion | `--gif` (needs ffmpeg), or the gallery (`node <skill>/scripts/gallery.mjs`) at 1x speed |
| the sprite without its glow | `--stage light`: the shape has to read without the light |
| retiming | `--frames 8` still reads; `--frames 48` is smooth, not twitchy |
| inputs | `--uniform tint=#ff60c0`, `--uniform power=4`, and the effect's own (`--uniform style=3`) |
| variety | `--seeds 1-24`, or `node <skill>/scripts/montage.mjs <effect.ips> --pick 6 --from 1-48` |

## Symptoms and fixes

| symptom | what to change |
|---|---|
| a smudge at 1x | cut tones, simplify the outline, pick one focal point, make the shapes bigger |
| speckle inside shapes | a higher noise threshold or bigger cells, no noise on small shapes; glints only where they mean something |
| no impact, it drifts | ease out (`easeOut`, `exp(-t / k)`), one or two near-white frames on the hit, a shorter total |
| robotic motion | give each particle its own size, speed, start and lifetime; add motion that follows the main beat |
| stutter or jitter | more frames over the same duration (16-24 fps); flicker on time ticks, never on the frame number |
| washed out, all glow | lower power, keep only the hottest parts in the mask, darker edge tones, white only at the core |
| flat | light from the upper left: bright top-left edges, a darker step at the lower right and at the base |
| looks like vector art | hard tone steps in the sprite; softness belongs to the light and to translucent smoke |
| smoke, clouds or fire read as balls | paint the whole mass in coats (dark rims, bodies, lit tops, highlights) and break the outline with wisps |
| pasted on the scene | a light-only pool on the floor and haze in the air in the mask, fading with the effect |
| light clipped by the canvas | about 3 sigma of space around what glows, or fade the mask toward that edge (the lightning's `fadeAt`) |
| dark fringes or halos round translucent paint | paint in a source-over layer (the template's passes do); lower the alpha with `ink`, never mix toward black |
| a one-shot vanishes at once | shrink, thin or drop it away; the last frame at most 30% of the peak |
| an empty frame in the middle | let one glint or particle live to the end; overlap the stages |
| a jump when the loop wraps | everything periodic in the phase: whole births and waves a cycle, noise sampled round a circle, whole fractions of a turn |
| all seeds look alike | roll families (palette, shape, count, timing) with weights, not only small offsets |
| a dull thumbnail | move `heroPhase` to the moment that tells the most |
| a hit that feels weightless | the game carries part of it: the attacker's wind-up before the effect, and a freeze of 0.05-0.2 s on contact |
| fuel warnings | fewer particles, rows instead of single pixels, a smaller canvas, a lower `sigmaMax` |

## What `check-fx` catches

`references/contract.md` lists every check. In short:

- compile errors, and traps in any pass;
- frames over the fuel budget;
- broken outputs, and inputs that do not do what they say;
- one-shots that do not end empty or that go empty in the middle;
- loops that do not wrap or that jump at the seam;
- light with an empty mask, sprites touching an edge, light cut by an edge;
- randomness that is not seeded, and seeds that look alike.

Whether the effect is beautiful, readable and well timed is what the loop above is for.
