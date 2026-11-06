# Notices

The skill is under 0BSD (see `LICENSE`). Parts of it follow [pixelfx](https://github.com/patch-gg/pixelfx)
by Patch, which builds on Hugo Duprez's [Sprite Fusion pixel art VFX](https://www.spritefusion.com/pixel-art-vfx),
under the MIT License below. Keep this notice with copies of those parts.

- Three example effects follow pixelfx's effects of the same name. They are written anew in IPS, not
  copied code:
  - `examples/lightning/lightning-strike.ips`: the stepped leader and the streamer, the bolt inked as a
    deep halo, a pale body and a white core, the re-strikes with a dart before each, the channel that
    cools and crumbles into motes, and the floor cracks with arcs.
  - `examples/water/splash.ips`: the crown, the drops, the ripples, the foam and the mist.
  - `examples/lightning/plasma-ball.ips`: the tendrils, the glass shell and the core.
- `SKILL.md` follows pixelfx's method: look for a ready effect first, make a new one from a one-line art
  direction and references, and improve it through rounds of render, look and fix. The method (code is
  clay, trust your eyes, feed your references) is written up in "How to make (good) pixel art effects
  with Claude".
- The quality bar and the table of symptoms and fixes in `references/bar.md` are adapted from pixelfx's.
- The ideas of the effect contract come from pixelfx's authoring guide: a colour picture and a light
  picture, seamless loops, one-shots that end empty, and nothing unseeded. Here they are IPS inputs,
  passes and outputs.
- In pixelfx the splash's droplets adapt Sprite Fusion's blood and the plasma ball adapts its energy
  orb; the two effects here inherit that.

Not included: pixelfx's Patch Pixel font, whose licence is not MIT, and the Infinite Props SDK, which
`scripts/lib/sdk.mjs` downloads under its own licence.

---

MIT License (pixelfx)

Copyright (c) 2026 Patch
Copyright (c) 2026 Hugo Duprez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
