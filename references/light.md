# Light under the pixels

Pixel effects look flat when they are pasted onto a dark scene as stickers. Real fire, magic and lightning
light up what is around them. Each effect therefore draws a **light mask** (renderPass 1) and reports
three numbers per frame in its `glow` output: **power**, **sigma** and **blur**. Together they turn the
mask into a layer of light that a game adds *under* the sprite. The effect can also bake that layer itself
(renderPass 2).

## The model

```
S     = G(sigma) * mask + G(blur) * mask        premultiplied: S.rgb, S.a
a     = 1 - exp(-power * S.a)                   exposure
light = S.rgb / S.a * a                         premultiplied light
frame = background + light, then the sprite over it (source-over)
```

- **mask**: renderPass 1, straight RGBA. RGB is the colour of the light and alpha its strength. It holds
  only what emits light, often in a warmer or more saturated tone than the sprite. A white-hot core
  throws orange light. It can also hold *light-only* shapes that the sprite never draws: a pool on the
  floor under a fire, a haze in the air round a portal, a pop of light along a blow.
- **sigma**: the radius of the **pool**, the wide soft light that reaches the floor and the air. The light
  fades out at about 3 sigma. At this scale 6-12 px suits most effects, roughly a third to a half of the
  effect's radius.
- **blur**: the **bloom**, a tight halo that hugs the bright pixels and softens their edges. 1-2 px.
- **power**: the **exposure**. A faint mask gives light in proportion to it, and a strong one saturates to
  the mask's own colour at full strength. Light never clips past white and keeps its hue, so a flash at
  power 9 stays orange instead of burning to a white blob.
- `G(s)` is a normalised Gaussian with radius `ceil(3 s)` whose edges repeat the nearest pixel. It is the
  same blur as Infinite Props' `.blur(sigma)`.

Two blurs are summed because one never looks right. A wide blur alone washes the scene evenly. A tight
blur alone is a halo with no light on the ground. Light has a bright core and a long, soft falloff.

`<skill>/scripts/lib/light.mjs` is the reference implementation in plain JavaScript (no Node APIs):
`lightFromMask(rgba, w, h, power, sigma, blur)`, `composite(...)` and `backdrop(...)`. The contact
sheets, the montage and the gallery all light frames with it.

## Light that moves

The glow is per frame, so the light is animated along with the pixels:

| effect | power | sigma | blur |
|---|---|---|---|
| a hit, an explosion or a strike | flashes to 7-9 on the impact frame, then falls with `exp(-t / 0.08)` | 7-10, widening as it cools | 1.5 |
| fire, plasma, a portal (loops) | flickers or breathes round 1.8-2.8, periodic in the phase or ticked in time | 9-10 | 1.5-2 |
| magic that builds (circle, nova) | 1.8-2 while it gathers, a flash to 6-7 when it fires, then fades | 9-10 | 1.5 |
| water | about 2 on the hit, then about 0.5 | 6 | 1.5 |

- Fade `power` to 0 before the mask empties. Otherwise the check warns, and an engine that blurs the mask
  itself lights nothing anyway.
- Flicker in time, not per frame (`tick = int(t * 30.0)`), so a retimed effect flickers at the same rate.
- Light is cheap to overdo. Mask only the hottest parts, keep white for the very core, and drop power
  before adding more mask.

## Three ways to use it

### 1. The baked light (renderPass 2)

The effect blurs and exposes its own mask. renderPass 2 returns the finished light layer as straight RGBA:
draw it **additively** (source × alpha + destination) under the sprite, at the same place and scale.

- Simplest for a game: one more texture per frame, no shader.
- The canvas bounds the light, because nothing outside it is drawn. That is why effects leave 3 sigma of
  room round what glows, or fade the mask toward a tight edge (the lightning fades its sky).
- Internally the pass paints each blurred layer `k = ceil(power)` times at `power / k` of its strength.
  `k` source-over coats give `1 - (1 - x/k)^k`, which is the exposure curve to within a few percent.
- Sigma is clamped to 12 inside the asset to stay within the fuel budget, so use the mask path for wider
  light.

### 2. The mask, blurred by the game

Generate renderPass 1 and read `glow`. Then blur the mask twice in a shader (two separable Gaussian
passes at sigma and at blur), sum the two, and expose `a = 1 - exp(-power * S.a)` in the last pass. On the
CPU, while caching frames, port `lightFromMask` as it stands. This path lets the light:

- spill past the canvas: pad the mask by 3 sigma on each side before blurring;
- follow the scene: scale `power` with darkness, for example the full value at night and a third by day;
- share one screen-space light buffer: draw every effect's mask into it and blur once a frame.

### 3. Sprite sheets

`node <skill>/scripts/render-fx.mjs <effect> --seeds 1-3 --sheet` writes `<stem>-<seed>.png` and `.json`:

- **PNG**: the colour frames in the first row and the light masks under them in the second row.
- **JSON**: Aseprite-style `frames` (`"<stem> 3"` and `"<stem> light 3"`, each with `frame` and `duration`
  in ms), plus `meta.iprop`, which holds `{effect, seed, frames, fps, loop, pivot: {x, y}, glow: [{power,
  sigma, blur} per frame]}`.

Light each frame with its own glow (path 2), or bake the light offline with `lightFromMask` into a third
row of your own. Import with nearest-neighbour filtering and no compression.

## In an engine

These sketches follow the runtime APIs in the SDK's `share/iprop/backends/<engine>/README.md`, but they
have not been run inside the engines. Check the names against the README of the SDK you ship with. They
all do the same thing:

1. Generate frame 1 and read `anim` to get `{frames, fps, loop, frame}`.
2. Generate each frame in pass 0 and pass 2.
3. Cache the frames by (effect, seed, inputs) and play them at `anim.fps`.
4. Draw the light additively, under the sprite.
5. Place both by the effect's `origin`.

### Godot 4 (GDExtension `IpropAsset`)

```gdscript
var fx := IpropAsset.new()

func bake(path: String, seed: int) -> Dictionary:
    fx.load_file(path)                       # e.g. "res://fx/frost-nova.iprop"
    fx.set_input("frame", 1)
    fx.generate(seed)
    var anim: PackedFloat32Array = fx.outputs["anim"]["values"]   # frames, fps, loop, frame
    var sprites: Array[ImageTexture] = []
    var lights: Array[ImageTexture] = []
    for f in range(1, int(anim[0]) + 1):
        fx.set_input("frame", f)
        fx.set_input("renderPass", 0)
        sprites.append(ImageTexture.create_from_image(fx.generate(seed)))
        fx.set_input("renderPass", 2)
        lights.append(ImageTexture.create_from_image(fx.generate(seed)))
    return {"fps": anim[1], "loop": anim[2] > 0.5, "sprites": sprites, "lights": lights, "origin": fx.origin}
```

Make two `Sprite2D`s with `centered = false`, `offset = -origin` and nearest filtering. Put the light one
first, so it draws under the sprite, and give it a `CanvasItemMaterial` with `blend_mode = BLEND_MODE_ADD`.
Swap both textures at `fps`. For a one-shot, free the node after the last frame. The light also
brightens anything drawn before it, such as the floor and props behind the effect.

### Unity (UPM package `dev.infiniteprops.runtime`)

```csharp
using System.Collections.Generic;
using InfiniteProps;
using UnityEngine;

var frames = new List<(Sprite sprite, Sprite light)>();
using (var program = importedAsset.Load())                          // an imported .iprop
{
    InputValue U(int v) => InputValue.UInt((uint)v);
    var probe = program.Generate(seed: 7, inputs: new Dictionary<string, InputValue> { ["frame"] = U(1) });
    var anim = probe.FindOutput("anim", owner: 0).Values;            // frames, fps, loop, frame
    for (int f = 1; f <= (int)anim[0]; f++)
    {
        var sprite = program.Generate(seed: 7, inputs: new Dictionary<string, InputValue> { ["frame"] = U(f), ["renderPass"] = U(0) });
        var light = program.Generate(seed: 7, inputs: new Dictionary<string, InputValue> { ["frame"] = U(f), ["renderPass"] = U(2) });
        frames.Add((sprite.ToSprite(program.Metadata), light.ToSprite(program.Metadata)));
    }
}
```

`ToSprite` turns the asset's origin into the pivot. Set `texture.filterMode = FilterMode.Point` on both.
Draw the light with a `SpriteRenderer` one sorting order below the sprite, using a material that blends
`Blend SrcAlpha One`, such as a URP Particles/Unlit material in Additive mode. You own the generated
sprites and their textures: destroy both when the effect ends.

### The web (HTML5 / WebAssembly runtime, or the sheets)

```js
// The runtime: generate frames live.
const iprop = await Iprop.create("iprop.wasm")
const bytes = new Uint8Array(await (await fetch("fx/frost-nova.iprop")).arrayBuffer())
const frame = (seed, f, renderPass) => {
  const result = iprop.generate(bytes, { seed, uniforms: { frame: f, renderPass } })
  const canvas = document.createElement("canvas")
  iprop.drawToCanvas(canvas, result)                 // RGBA -> ImageData
  return { canvas, outputs: result.outputs }         // outputs: named slots; a rect packs x, y, w, h
}

// Each tick: the background, the light added, the sprite over it.
function draw(ctx, sprite, light, x, y, pivot, zoom) {
  ctx.imageSmoothingEnabled = false
  ctx.globalCompositeOperation = "lighter"           // source x alpha + destination
  ctx.drawImage(light, x - pivot.x * zoom, y - pivot.y * zoom, light.width * zoom, light.height * zoom)
  ctx.globalCompositeOperation = "source-over"
  ctx.drawImage(sprite, x - pivot.x * zoom, y - pivot.y * zoom, sprite.width * zoom, sprite.height * zoom)
}
```

With a sheet instead of the runtime, read the mask row with `getImageData` and light it with the
gallery's `light.js` (`scripts/lib/light.mjs` without `export`). Put the premultiplied light on opaque black, so
that `"lighter"` adds exactly the light:

```js
function lightCanvas(mask, glow) {                   // mask: ImageData of one frame's light mask
  const { width: w, height: h } = mask
  const light = lightFromMask(mask.data, w, h, glow.power, glow.sigma, glow.blur)
  const out = new ImageData(w, h)
  for (let i = 0; i < w * h * 4; i += 4) {
    out.data[i] = light[i] * 255; out.data[i + 1] = light[i + 1] * 255; out.data[i + 2] = light[i + 2] * 255
    out.data[i + 3] = 255
  }
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext("2d").putImageData(out, 0, 0)
  return canvas
}
```

The gallery (`node <skill>/scripts/gallery.mjs`, then `out/gallery/index.html`) does exactly this, with
sliders that override power, sigma and blur per effect.
