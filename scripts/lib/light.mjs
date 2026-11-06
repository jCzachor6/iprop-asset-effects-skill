// Light under the pixels, in plain JavaScript (no Node APIs): the same model an effect's renderPass 2
// bakes, so a game, the gallery and the contact sheets all light a scene the same way.
//
//   S     = G(sigma) * mask + G(blur) * mask          (premultiplied: S.rgb, S.a)
//   a     = 1 - exp(-power * S.a)                     (exposure: linear when faint, never past white)
//   light = (S.rgb / S.a) * a                         (premultiplied light colour)
//   frame = background + light, then the colour sprite over it
//
// `mask` is renderPass 1: RGB is the light's colour, alpha its strength. G(s) is a normalised Gaussian
// with radius ceil(3 s), edges repeating the nearest pixel, as Infinite Props' `.blur(sigma)` does.
// renderPass 2 paints each blurred layer ceil(power) times at power/ceil(power) of its strength, and
// k such source-over coats give 1 - (1 - x/k)^k, which is this exposure curve to within a few percent.
// The gallery copies this file with the `export` keywords removed, so keep it free of imports.

/** Gaussian weights for sigma, radius ceil(3 sigma); [1] for sigma <= 0. */
export function gaussianKernel(sigma) {
  if (!(sigma > 0)) return new Float32Array([1])
  const r = Math.ceil(3 * sigma)
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

/** Premultiplied float RGBA (0..1) from straight 8-bit RGBA. */
export function premultiply(rgba, w, h) {
  const out = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255
    out[i * 4] = (rgba[i * 4] / 255) * a
    out[i * 4 + 1] = (rgba[i * 4 + 1] / 255) * a
    out[i * 4 + 2] = (rgba[i * 4 + 2] / 255) * a
    out[i * 4 + 3] = a
  }
  return out
}

/** Separable Gaussian blur of premultiplied float RGBA; edges repeat the nearest pixel. */
export function blurPremultiplied(src, w, h, sigma) {
  if (!(sigma > 0)) return src.slice()
  const k = gaussianKernel(sigma)
  const r = (k.length - 1) / 2
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0
      for (let i = -r; i <= r; i++) {
        const sx = Math.min(w - 1, Math.max(0, x + i))
        const j = (y * w + sx) * 4, q = k[i + r]
        r0 += src[j] * q; g0 += src[j + 1] * q; b0 += src[j + 2] * q; a0 += src[j + 3] * q
      }
      const o = (y * w + x) * 4
      tmp[o] = r0; tmp[o + 1] = g0; tmp[o + 2] = b0; tmp[o + 3] = a0
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, a0 = 0
      for (let i = -r; i <= r; i++) {
        const sy = Math.min(h - 1, Math.max(0, y + i))
        const j = (sy * w + x) * 4, q = k[i + r]
        r0 += tmp[j] * q; g0 += tmp[j + 1] * q; b0 += tmp[j + 2] * q; a0 += tmp[j + 3] * q
      }
      const o = (y * w + x) * 4
      out[o] = r0; out[o + 1] = g0; out[o + 2] = b0; out[o + 3] = a0
    }
  }
  return out
}

/**
 * The light a mask throws, as premultiplied float RGBA in 0..1: the mask blurred by sigma (the pool) and
 * by blur (the bloom), summed, then exposed by power: alpha = 1 - exp(-power * sum).
 */
export function lightFromMask(rgba, w, h, power, sigma, blur) {
  const light = new Float32Array(w * h * 4)
  if (!(power > 0)) return light
  const src = premultiply(rgba, w, h)
  const pool = blurPremultiplied(src, w, h, sigma)
  const bloom = blurPremultiplied(src, w, h, blur)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const sa = pool[o + 3] + bloom[o + 3]
    if (sa <= 1e-6) continue
    const a = 1 - Math.exp(-power * sa)
    light[o] = ((pool[o] + bloom[o]) / sa) * a
    light[o + 1] = ((pool[o + 1] + bloom[o + 1]) / sa) * a
    light[o + 2] = ((pool[o + 2] + bloom[o + 2]) / sa) * a
    light[o + 3] = a
  }
  return light
}

/** Premultiplied float RGBA from a baked light image (renderPass 2: straight RGBA, already scaled). */
export function lightFromBaked(rgba, w, h) {
  return premultiply(rgba, w, h)
}

/**
 * One finished frame into `out` (8-bit RGBA, opaque): the background, plus light * lightK added to it,
 * then the colour sprite over it with its alpha. Any argument but `out` may be null.
 */
export function composite(out, w, h, background, light, sprite, lightK = 1) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    let r = background ? background[o] / 255 : 0
    let g = background ? background[o + 1] / 255 : 0
    let b = background ? background[o + 2] / 255 : 0
    if (light) {
      r += light[o] * lightK
      g += light[o + 1] * lightK
      b += light[o + 2] * lightK
    }
    r = Math.min(1, r); g = Math.min(1, g); b = Math.min(1, b)
    if (sprite) {
      const a = sprite[o + 3] / 255
      r = sprite[o] / 255 * a + r * (1 - a)
      g = sprite[o + 1] / 255 * a + g * (1 - a)
      b = sprite[o + 2] / 255 * a + b * (1 - a)
    }
    out[o] = Math.round(r * 255); out[o + 1] = Math.round(g * 255); out[o + 2] = Math.round(b * 255); out[o + 3] = 255
  }
  return out
}

// A tiny deterministic hash for the backdrops' stones.
function hash2(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/**
 * A dark stage to look at effects on, 8-bit RGBA: "night" (a dusk gradient over stone flags, the floor
 * at floorY), "dark" (flat near-black), "sky" (a gradient with no floor) or "light" (a pale stage, to
 * check that an effect still reads without its glow).
 */
export function backdrop(w, h, floorY, kind = "night") {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let c
      if (kind === "dark") c = [14, 13, 20]
      else if (kind === "light") c = y < floorY ? [168, 176, 190] : [126, 120, 116]
      else {
        const v = y / Math.max(1, h - 1)
        c = [Math.round(13 + 10 * v), Math.round(14 + 9 * v), Math.round(24 + 10 * v)]
        if (kind === "night" && y >= floorY) {
          const row = y - floorY
          const course = Math.floor(row / 5)
          const shift = course % 2 ? 6 : 0
          const stone = Math.floor((x + shift) / 12)
          const edge = row % 5 === 4 || (x + shift) % 12 === 11
          const tone = hash2(stone, course) * 7
          c = edge ? [24, 22, 30] : [Math.round(40 + tone - row * 0.3), Math.round(36 + tone - row * 0.3), Math.round(46 + tone - row * 0.2)]
          if (row === 0) c = [58, 54, 66]
        }
      }
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255
    }
  }
  return out
}
