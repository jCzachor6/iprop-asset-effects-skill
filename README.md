# iprop-asset-effects

A Claude Code skill for pixel-art effects (VFX) as [Infinite Props](https://infiniteprops.dev) assets:
seeded `.ips` recipes that draw every frame of an animation and compile to `.iprop` for games. It ships
13 ready effects, teaches the effect contract every one of them keeps and the IPS techniques they share,
and puts a check, render and review loop on top of the SDK tools. Each effect has three twists:

- **Every seed is a new take.** The seed rolls the palette family, the shapes, the particle paths, the
  frame count and the timing. Rare looks stay rare.
- **Frames and timing are inputs.** The seed rolls its own frame count, and `frames` retimes any effect
  to 2-64 frames over the same duration.
- **Light under the pixels.** Every frame comes with a light mask and its `power`, `sigma` and `blur`. A
  game blurs the mask into a pool and a bloom and adds it under the sprite, or asks the effect to bake
  that light itself.

## Buy and sell assets on iprop.store

[**iprop.store**](https://iprop.store) is the marketplace for Infinite Props assets: ready-made
generators for your game, from weapons and potions to portraits and racing cars. Made an effect with
this skill? Sell it there.

## The effects

| category | effects |
|---|---|
| arcane | magic circle, portal |
| explosions | explosion (fire, dirt or plasma) |
| holy | heal |
| ice | frost nova |
| impacts | hit spark |
| lightning | lightning strike, plasma ball |
| melee | sword slash |
| nature | poison cloud |
| projectiles | fireball |
| shadow | black hole |
| water | splash |

Each one is a `.ips` source with a ready `.iprop` next to it. `references/catalog.md` lists each one's
canvas, origin, frames, light, inputs and fuel.

## Install

```sh
git clone https://github.com/jCzachor6/iprop-asset-effects-skill ~/.claude/skills/iprop-asset-effects
# or, from a checkout: ln -s "$PWD" ~/.claude/skills/iprop-asset-effects
```

Claude Code picks it up when you ask for a pixel effect, a spell, hit or explosion animation, a sprite
sheet or glow under pixel sprites made with Infinite Props, or want one of these effects in an engine.
`SKILL.md` describes the workflow.

## Requirements

- Node 20 or newer; the scripts use no packages.
- The Infinite Props SDK. The scripts download 0.9.0 for macOS arm64, Linux x86_64 or Windows x86_64
  into `~/.cache/iprop-asset/sdk/<version>` (the cache the iprop-asset skill uses too) and check it
  against the release's SHA-256 sums. `IPROP_SDK` points them at an unpacked SDK instead,
  `IPROP_VERSION` selects another release and `IPROP_SDK_CACHE` moves the cache.
- ffmpeg, only for GIF previews.

## Scripts

```sh
node scripts/sdk.mjs                                                  # the SDK, its tools and its LLM reference
node scripts/render-fx.mjs examples/ice/frost-nova.ips                # out/frost-nova/contact.png, seeds 1-4, lit
node scripts/render-fx.mjs examples/ice/frost-nova.ips --seeds 1-3 --sheet         # engine sprite sheets + JSON
node scripts/render-fx.mjs examples/water/splash.ips --uniform tint=#ff8040 --layers --gif
node scripts/new-fx.mjs ~/game/fx --name rune-trap --category arcane --size 112x96 \
  --frames 24-36 --duration 1.2-1.5 --variety high                    # a one-shot that keeps the contract
node scripts/new-fx.mjs ~/game/fx --name torch --loop --frames 12-24 --fps 15-18   # a loop
node scripts/check-fx.mjs ~/game/fx/rune-trap.ips                     # the contract check: PASS, WARN or FAIL
node scripts/check-fx.mjs ~/game/fx/rune-trap.ips --emit              # ... and write rune-trap.iprop
node scripts/gallery.mjs                                              # out/gallery/index.html, seeds 1-6
node scripts/gallery.mjs --serve                                      # http://localhost:8770/, endless seeds
node scripts/montage.mjs --pick 3 --from 1-12                         # out/montage.png: hero frames of every effect
node --test scripts/test                                              # the skill's own tests
```

`check-fx.mjs` exits with 1 when an effect fails (compile errors, traps, broken outputs or inputs,
one-shots that do not end empty, loops that do not wrap) and prints warnings for the rest: a seam when
a loop wraps, light with an empty mask, sprites touching the edge, fuel near the budget, seeds that look
alike. Renders go to `out/<effect>/` under the current folder.

## See them

`node scripts/gallery.mjs` writes `out/gallery/index.html`, which opens from disk and plays every effect
live: each animation plays three times, then the next seed takes over. `--serve` serves it on
http://localhost:8770/ and renders every next seed on demand, so the seeds never repeat. Click an effect
to see the sprite, the mask or the light, set power, sigma and blur with sliders, and step through
frames.

To play an effect in a game, generate frame 1 and read the `anim` output (frames, fps, loop). Then
generate every frame with `renderPass` 0 for the sprite and 2 for the light, and draw the light
additively under the sprite. `references/light.md` has the model and sketches for Godot, Unity and the
web.

## Contents

- `SKILL.md`: using a ready effect, what to ask the user, the workflow, putting an effect in a game, the
  house style and the pitfalls.
- `examples/`: the 13 example effects, each a `.ips` source and a compiled `.iprop`.
- `references/`: the effect contract, the IPS toolkit, the quality bar and the review loop, the light
  model, and the catalog of effects.
- `templates/`: the one-shot and loop skeletons `new-fx.mjs` fills.
- `NOTICE.md`: what follows pixelfx, and its MIT licence.
- `scripts/`: the tools and their tests. `scripts/gallery/` holds the gallery page's app and style.
- `evals/`: test prompts for measuring the skill: a new effect, a recoloured and retimed portal
  exported as sprite sheets, and a torch loop to fix.

## Keeping it current

When an Infinite Props release changes the language, set `DEFAULT_VERSION` in `scripts/lib/sdk.mjs`,
read the idioms section of its `LLM_REFERENCE.md`, update `SKILL.md`, `references/contract.md` and
`references/toolkit.md`, and run `node --test scripts/test`: it compiles the skeletons, checks every
effect, makes sure every shipped `.iprop` is compiled from its source and that the fix eval's torch
still shows its seam. Then rewrite the `.iprop` files with `node scripts/check-fx.mjs examples --emit`
and measure the fuel table in `references/catalog.md` again. `scripts/lib/sdk.mjs`, `png.mjs` and
`font.mjs` are the same files as in the iprop-asset skill: keep them in step.

## License

[0BSD](LICENSE): use, change, share and sell it for anything, with or without credit. Three example
effects (the lightning strike, the plasma ball and the splash), the method in `SKILL.md` and the quality
bar follow [pixelfx](https://github.com/patch-gg/pixelfx) by Patch and Hugo Duprez, under the MIT
License: [NOTICE.md](NOTICE.md) lists them and carries that licence; keep it with copies of those parts.
