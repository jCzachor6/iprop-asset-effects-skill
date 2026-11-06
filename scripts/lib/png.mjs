// 8-bit RGBA PNG, the format ipgen writes, without dependencies.
import { createHash } from "node:crypto"
import { deflateSync, inflateSync } from "node:zlib"

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Decodes an 8-bit RGBA PNG to { width, height, rgba }; null for other PNGs. */
export const decodePng = (bytes) => {
  if (bytes.subarray(1, 4).toString("latin1") !== "PNG") return null
  let offset = 8
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0
  const idat = []
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1")
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") [width, height, depth, colour, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]]
    if (type === "IDAT") idat.push(data)
    offset += 12 + length
  }
  if (depth !== 8 || colour !== 6 || interlace !== 0 || !idat.length) return null
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const rgba = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = rgba.subarray(y * stride, (y + 1) * stride)
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const previous = y ? rgba.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? line[x - 4] : 0
      const up = previous[x]
      const upLeft = x >= 4 ? previous[x - 4] : 0
      if (filter === 1) line[x] = (line[x] + left) & 0xff
      else if (filter === 2) line[x] = (line[x] + up) & 0xff
      else if (filter === 3) line[x] = (line[x] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - upLeft
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)]
        line[x] = (line[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xff
      }
    }
  }
  return { width, height, rgba }
}

/** Encodes { width, height, rgba } as an 8-bit RGBA PNG. */
export const encodePng = ({ width, height, rgba }) => {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4, "latin1")
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])))
    return Buffer.concat([head, data, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))])
}

export const createImage = (width, height, [r, g, b, a] = [0, 0, 0, 0]) => {
  const rgba = Buffer.alloc(width * height * 4)
  if (r || g || b || a) for (let i = 0; i < width * height; i++) rgba.set([r, g, b, a], i * 4)
  return { width, height, rgba }
}

/** Hash of every channel: equal images, equal hashes. */
export const pixelHash = (image) => createHash("sha1").update(image.rgba).digest("hex")

/** Hash of the covered area only (alpha > 0): the silhouette. */
export const silhouetteHash = (image) => {
  const mask = Buffer.alloc(image.width * image.height)
  for (let i = 0; i < mask.length; i++) mask[i] = image.rgba[i * 4 + 3] ? 1 : 0
  return createHash("sha1").update(mask).digest("hex")
}

export const isEmpty = (image) => {
  for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i]) return false
  return true
}

/** "#rrggbb" or "#rrggbbaa" to [r, g, b, a]. */
export const parseColor = (hex) => {
  const value = String(hex).replace(/^#/, "")
  const full = value.length <= 4 ? [...value].map((c) => c + c).join("") : value
  const parts = full.match(/../g).map((pair) => parseInt(pair, 16))
  return [parts[0], parts[1], parts[2], parts[3] ?? 255]
}
