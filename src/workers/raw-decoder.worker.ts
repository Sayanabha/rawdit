self.onerror = (e: any) => {
  self.postMessage({ type: 'error', message: 'Worker error: ' + String(e) })
}
self.onunhandledrejection = (e: any) => {
  self.postMessage({ type: 'error', message: 'Unhandled: ' + String(e?.reason) })
}

console.log('[Worker] Started')

self.onmessage = async (e: MessageEvent) => {
  const { arrayBuffer, fileName } = e.data as {
    arrayBuffer: ArrayBuffer
    fileName: string
  }

  console.log('[Worker] File:', fileName, (arrayBuffer.byteLength / 1024 / 1024).toFixed(1) + 'MB')
  self.postMessage({ type: 'progress', value: 5 })

  // Strategy 1: Native browser decode
  try {
    console.log('[Worker] Trying native...')
    const blob = new Blob([arrayBuffer.slice(0)])
    const bitmap = await createImageBitmap(blob)
    console.log('[Worker] ✓ Native:', bitmap.width, 'x', bitmap.height)
    self.postMessage({ type: 'progress', value: 70 })
    await sendBitmap(bitmap)
    return
  } catch {
    console.log('[Worker] ✗ Native failed')
  }

  self.postMessage({ type: 'progress', value: 15 })

  // Strategy 2: Manual TIFF/DNG parser — no external library needed
  try {
    console.log('[Worker] Trying manual TIFF parse...')
    self.postMessage({ type: 'progress', value: 25 })

    const result = await decodeDNG(arrayBuffer)

    self.postMessage({ type: 'progress', value: 90 })
    const transferBuffer = new ArrayBuffer(result.buffer.byteLength)
    new Uint8Array(transferBuffer).set(result.buffer)
    ;(self as any).postMessage(
      { type: 'done', imageData: { data: transferBuffer, width: result.width, height: result.height } },
      [transferBuffer]
    )
    return

  } catch (err) {
    console.error('[Worker] ✗ Manual parse failed:', (err as Error).message)
    self.postMessage({ type: 'error', message: 'Could not decode: ' + (err as Error).message })
  }
}

// ── Core DNG/TIFF decoder — no dependencies ──────────────────────────────────

async function decodeDNG(arrayBuffer: ArrayBuffer): Promise<{ buffer: Uint8Array; width: number; height: number }> {
  const data = new Uint8Array(arrayBuffer)
  const view = new DataView(arrayBuffer)

  const magic = view.getUint16(0, false)
  const le = magic === 0x4949
  if (magic !== 0x4949 && magic !== 0x4D4D) throw new Error('Not a TIFF/DNG file')

  const allIfds = parseAllIfds(view, data, le)
  console.log('[DNG] Total IFDs found:', allIfds.length)
  allIfds.forEach((ifd, i) => {
    console.log(`  [${i}] ${ifd.width}x${ifd.height} compression:${ifd.compression} photo:${ifd.photometric} bps:${ifd.bitsPerSample}`)
  })

  // Priority 1: Large JPEG color preview (photo 2=RGB or 6=YCbCr, compression 7, bps 8)
  const jpegPreview = allIfds
    .filter(ifd => (ifd.photometric === 2 || ifd.photometric === 6) && ifd.compression === 7 && ifd.bitsPerSample === 8 && ifd.width > 500)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]

  // Priority 2: Raw CFA
  const cfaIfd = allIfds.find(ifd => ifd.photometric === 32803 && ifd.width > 1000)

  const selectedIfd = jpegPreview ?? cfaIfd ?? allIfds.reduce((best, ifd) =>
    (ifd.width * ifd.height) > (best.width * best.height) ? ifd : best
  , allIfds[0])

  console.log('[DNG] Strategy:', jpegPreview ? 'JPEG preview' : cfaIfd ? 'CFA raw' : 'fallback')
  console.log('[DNG] Using IFD:', selectedIfd.width, 'x', selectedIfd.height)

  // For JPEG-compressed strips/tiles, decode via createImageBitmap directly
  if (selectedIfd.compression === 7 || selectedIfd.compression === 6) {
    console.log('[DNG] JPEG compressed — decoding strips via ImageBitmap')

    // Collect all strip/tile byte ranges and try each as a standalone JPEG
    const offsets = selectedIfd.tileOffsets ?? selectedIfd.stripOffsets
    const counts  = selectedIfd.tileByteCounts ?? selectedIfd.stripByteCounts

    // Try concatenating all strips into one JPEG first (most common case)
    let totalSize = 0
    for (const c of counts) totalSize += c
    const combined = new Uint8Array(totalSize)
    let pos = 0
    for (let i = 0; i < offsets.length; i++) {
      combined.set(data.slice(offsets[i], offsets[i] + counts[i]), pos)
      pos += counts[i]
    }

    // Try largest single strip first, then combined
    const candidates: Uint8Array[] = []
    if (offsets.length === 1) {
      candidates.push(data.slice(offsets[0], offsets[0] + counts[0]))
    } else {
      // Try each strip individually (largest first)
      const strips = offsets.map((o, i) => data.slice(o, o + counts[i]))
      strips.sort((a, b) => b.length - a.length)
      candidates.push(...strips, combined)
    }

    for (const candidate of candidates) {
      try {
        const safe   = new Uint8Array(candidate)
        console.log('[DNG] Trying JPEG candidate, size:', safe.buffer)
        if(safe.buffer)     {
        const blob   = new Blob([safe.buffer instanceof ArrayBuffer ? safe.buffer : safe.buffer.slice(0)], { type: 'image/jpeg' })        
        const bitmap = await createImageBitmap(blob)
        console.log('[DNG] ✓ JPEG decoded:', bitmap.width, 'x', bitmap.height)

        const oc  = new OffscreenCanvas(bitmap.width, bitmap.height)
        const ctx = oc.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

        // id.data is already RGBA Uint8ClampedArray — copy to plain Uint8Array
        const rgba = new Uint8Array(id.data.byteLength)
        rgba.set(id.data)
        return { buffer: rgba, width: bitmap.width, height: bitmap.height }}
      } catch (e) {
        console.log('[DNG] JPEG decode failed:', e)
        // try next candidate
      }
    }

    throw new Error('All JPEG strip candidates failed to decode')
  }

  // Uncompressed or CFA path
  const pixels = await extractPixels(view, data, selectedIfd, le)
  console.log('[DNG] Pixels extracted, length:', pixels.length)

  if (selectedIfd.photometric === 32803 && selectedIfd.bitsPerSample === 16) {
    console.log('[DNG] CFA — demosaicing...')
    const blackLevel = selectedIfd.blackLevel ?? 512
    const whiteLevel = selectedIfd.whiteLevel ?? 16383
    const pattern    = selectedIfd.cfaPattern  ?? [0, 1, 1, 2]
    const view16     = new Uint16Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 2)
    const wb         = estimateWB(view16, selectedIfd.width, selectedIfd.height, pattern, blackLevel, whiteLevel)
    console.log('[DNG] WB:', wb.r.toFixed(3), wb.g.toFixed(3), wb.b.toFixed(3))
    const rgba = demosaic(view16, selectedIfd.width, selectedIfd.height, blackLevel, whiteLevel, pattern, wb)
    return { buffer: rgba, width: selectedIfd.width, height: selectedIfd.height }
  }

  return { buffer: pixels, width: selectedIfd.width, height: selectedIfd.height }
}
interface IFDData {
  width: number
  height: number
  compression: number
  photometric: number
  bitsPerSample: number
  stripOffsets: number[]
  stripByteCounts: number[]
  tileOffsets?: number[]
  tileByteCounts?: number[]
  tileWidth?: number
  tileHeight?: number
  blackLevel?: number
  whiteLevel?: number
  cfaPattern?: number[]
  samplesPerPixel: number
}

function parseAllIfds(view: DataView, data: Uint8Array, le: boolean): IFDData[] {
  const results: IFDData[] = []
  const visited = new Set<number>()

  function parseIfd(offset: number) {
    if (!offset || offset >= data.length || visited.has(offset)) return
    visited.add(offset)

    try {
      const entryCount = view.getUint16(offset, le)
      if (entryCount === 0 || entryCount > 500) return

      const tags: Record<number, { type: number; count: number; offset: number }> = {}

      for (let i = 0; i < entryCount; i++) {
        const base = offset + 2 + i * 12
        if (base + 12 > data.length) break
        const tag   = view.getUint16(base, le)
        const type  = view.getUint16(base + 2, le)
        const count = view.getUint32(base + 4, le)
        tags[tag] = { type, count, offset: base + 8 }
      }

      // Helper: read a numeric tag value
      const readNum = (tag: number): number => {
        const t = tags[tag]
        if (!t) return 0
        if (t.type === 3) return view.getUint16(t.offset, le)  // SHORT
        if (t.type === 4) return view.getUint32(t.offset, le)  // LONG
        if (t.type === 5) {                                      // RATIONAL
          const ptr = view.getUint32(t.offset, le)
          const num = view.getUint32(ptr, le)
          const den = view.getUint32(ptr + 4, le)
          return den ? num / den : 0
        }
        return 0
      }

      // Helper: read array of numbers
      const readNums = (tag: number): number[] => {
        const t = tags[tag]
        if (!t) return []
        const typeSize: Record<number, number> = { 1: 1, 3: 2, 4: 4, 5: 8 }
        const sz = typeSize[t.type] ?? 1
        const totalSize = sz * t.count
        const ptr = totalSize <= 4 ? t.offset : view.getUint32(t.offset, le)
        const result: number[] = []
        for (let i = 0; i < t.count; i++) {
          if (t.type === 3) result.push(view.getUint16(ptr + i * 2, le))
          else if (t.type === 4) result.push(view.getUint32(ptr + i * 4, le))
          else if (t.type === 5) {
            const n = view.getUint32(ptr + i * 8, le)
            const d = view.getUint32(ptr + i * 8 + 4, le)
            result.push(d ? n / d : 0)
          } else result.push(data[ptr + i])
        }
        return result
      }

      const width        = readNum(256)
      const height       = readNum(257)
      const compression  = readNum(259) || 1
      const photometric  = readNum(262)
      const bpsArr       = readNums(258)
      const bitsPerSample = bpsArr[0] ?? 8
      const samplesPerPixel = readNum(277) || 1

      // Strip layout
      const stripOffsets    = readNums(273)
      const stripByteCounts = readNums(279)

      // Tile layout
      const tileOffsets    = readNums(324)
      const tileByteCounts = readNums(325)
      const tileWidth      = readNum(322)
      const tileHeight     = readNum(323)

      // DNG-specific
      const wl = readNums(50717)
      const whiteLevel = wl[0] ?? 16383

      const blArr = readNums(50714)
      let blackLevel = 512
      if (blArr.length > 0) {
        // Could be rational (stored as pairs) or direct
        blackLevel = blArr[0]
        if (blArr.length >= 2 && blArr[0] > 1000 && blArr[1] > 0) {
          blackLevel = blArr[0] / blArr[1]
        }
      }

      // CFA pattern (tag 33421)
      const cfaRaw = readNums(33421)
      const cfaPattern = cfaRaw.length >= 4 ? cfaRaw.slice(0, 4) : [0, 1, 1, 2]

      if (width > 0 && height > 0) {
        results.push({
          width, height, compression, photometric, bitsPerSample,
          samplesPerPixel, stripOffsets, stripByteCounts,
          tileOffsets: tileOffsets.length ? tileOffsets : undefined,
          tileByteCounts: tileByteCounts.length ? tileByteCounts : undefined,
          tileWidth: tileWidth || undefined,
          tileHeight: tileHeight || undefined,
          blackLevel, whiteLevel, cfaPattern,
        })
      }

      // Follow sub-IFDs (tag 330) and next IFD
      const subIfdOffsets = readNums(330)
      for (const sub of subIfdOffsets) parseIfd(sub)

      const nextOffset = view.getUint32(offset + 2 + entryCount * 12, le)
      parseIfd(nextOffset)

    } catch (ex) {
      console.log('[DNG] IFD parse error at', offset, ex)
    }
  }

  const firstIfd = view.getUint32(4, le)
  parseIfd(firstIfd)
  return results
}

async function extractPixels(view: DataView, data: Uint8Array, ifd: IFDData, le: boolean): Promise<Uint8Array> {
  const bpp = (ifd.bitsPerSample / 8) * ifd.samplesPerPixel

  // Tiled layout
  if (ifd.tileOffsets && ifd.tileOffsets.length > 0 && ifd.tileWidth && ifd.tileHeight) {
    const tilesX = Math.ceil(ifd.width  / ifd.tileWidth)
    const tilesY = Math.ceil(ifd.height / ifd.tileHeight)
    const out    = new Uint8Array(ifd.width * ifd.height * bpp)

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const idx    = ty * tilesX + tx
        const offset = ifd.tileOffsets[idx]
        const size   = ifd.tileByteCounts![idx]
        if (!offset || !size) continue

        const tileData = data.slice(offset, offset + size)
        const decoded  = await decompressStrip(tileData, ifd.compression, ifd.tileWidth, ifd.tileHeight, ifd.bitsPerSample)
        const tw = Math.min(ifd.tileWidth,  ifd.width  - tx * ifd.tileWidth)
        const th = Math.min(ifd.tileHeight, ifd.height - ty * ifd.tileHeight)

        for (let row = 0; row < th; row++) {
          const srcRow = row * ifd.tileWidth * bpp
          const dstRow = ((ty * ifd.tileHeight + row) * ifd.width + tx * ifd.tileWidth) * bpp
          out.set(decoded.slice(srcRow, srcRow + tw * bpp), dstRow)
        }
      }
    }
    return out
  }

  // Strip layout
  const out = new Uint8Array(ifd.width * ifd.height * bpp)
  let pos   = 0

  for (let i = 0; i < ifd.stripOffsets.length; i++) {
    const offset = ifd.stripOffsets[i]
    const size   = ifd.stripByteCounts[i]
    if (!offset || !size) continue

    const strip   = data.slice(offset, offset + size)
    const decoded = await decompressStrip(strip, ifd.compression, ifd.width, 0, ifd.bitsPerSample)
    const copyLen = Math.min(decoded.length, out.length - pos)
    out.set(decoded.slice(0, copyLen), pos)
    pos += copyLen
  }

  return out
}

async function decompressStrip(
  data: Uint8Array,
  compression: number,
  width: number,
  height: number,
  bitsPerSample: number
): Promise<Uint8Array> {
  // Uncompressed
  if (compression === 1) return data

  // JPEG compressed (compression 6 or 7)
  if (compression === 6 || compression === 7) {
    try {
      const safe   = new Uint8Array(data)
      const blob   = new Blob([safe.buffer instanceof ArrayBuffer ? safe.buffer : safe.buffer.slice(0)], { type: 'image/jpeg' })  
      const bitmap = await createImageBitmap(blob)
      const oc     = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx    = oc.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

      // If 16-bit CFA, we need raw 16-bit data not 8-bit RGBA
      // JPEG strips in DNG are lossless JPEG — extract luminance channel as 16-bit proxy
      if (bitsPerSample === 16) {
        // Convert RGBA back to 16-bit grayscale (rough but functional)
        const out16 = new Uint8Array(bitmap.width * bitmap.height * 2)
        const dv    = new DataView(out16.buffer)
        for (let i = 0; i < bitmap.width * bitmap.height; i++) {
          // Use red channel scaled to 16-bit range
          const val = Math.round(id.data[i * 4] / 255 * 16383)
          dv.setUint16(i * 2, val, true)
        }
        return out16
      }

      return new Uint8Array(id.data.buffer)
    } catch (e) {
      console.warn('[DNG] JPEG strip decode failed:', e)
      return data
    }
  }

  return data
}
// ── White balance & demosaic ──────────────────────────────────────────────────

function estimateWB(
  bayer: Uint16Array,
  width: number,
  height: number,
  pattern: number[],
  blackLevel: number,
  whiteLevel: number
): { r: number; g: number; b: number } {
  const clip = whiteLevel * 0.98
  const step = 8
  const rS: number[] = [], gS: number[] = [], bS: number[] = []

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const val = bayer[y * width + x]
      if (val >= clip || val <= blackLevel) continue
      const n = (val - blackLevel) / (whiteLevel - blackLevel)
      const c = pattern[(y % 2) * 2 + (x % 2)]
      if (c === 0) rS.push(n)
      else if (c === 1) gS.push(n)
      else bS.push(n)
    }
  }

  const p95 = (arr: number[]) => {
    if (!arr.length) return 1
    const s = arr.slice().sort((a, b) => a - b)
    return s[Math.min(Math.floor(s.length * 0.95), s.length - 1)] || 1
  }

  const rT = p95(rS), gT = p95(gS), bT = p95(bS)
  const mx = Math.max(rT, gT, bT)
  console.log('[DNG] WB white patch R:', rT.toFixed(4), 'G:', gT.toFixed(4), 'B:', bT.toFixed(4))

  let r = mx / rT, g = mx / gT, b = mx / bT
  r = Math.max(0.5, Math.min(3.0, r))
  g = Math.max(0.5, Math.min(3.0, g))
  b = Math.max(0.5, Math.min(3.0, b))
  const gn = g
  return { r: r / gn, g: 1.0, b: b / gn }
}

function demosaic(
  bayer: Uint16Array,
  width: number,
  height: number,
  blackLevel: number,
  whiteLevel: number,
  pattern: number[],
  wb: { r: number; g: number; b: number }
): Uint8Array {
  const out   = new Uint8Array(width * height * 4)
  const range = whiteLevel - blackLevel

  const get = (x: number, y: number): number => {
    x = Math.max(0, Math.min(width - 1, x))
    y = Math.max(0, Math.min(height - 1, y))
    return bayer[y * width + x]
  }

  const colorAt = (x: number, y: number) => pattern[(y % 2) * 2 + (x % 2)]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const c   = colorAt(x, y)
      let r = 0, g = 0, b = 0

      if (c === 0) {
        r = get(x, y)
        g = (get(x-1,y) + get(x+1,y) + get(x,y-1) + get(x,y+1)) / 4
        b = (get(x-1,y-1) + get(x+1,y-1) + get(x-1,y+1) + get(x+1,y+1)) / 4
      } else if (c === 2) {
        b = get(x, y)
        g = (get(x-1,y) + get(x+1,y) + get(x,y-1) + get(x,y+1)) / 4
        r = (get(x-1,y-1) + get(x+1,y-1) + get(x-1,y+1) + get(x+1,y+1)) / 4
      } else {
        g = get(x, y)
        if (colorAt(x-1, y) === 0 || colorAt(x+1, y) === 0) {
          r = (get(x-1,y) + get(x+1,y)) / 2
          b = (get(x,y-1) + get(x,y+1)) / 2
        } else {
          b = (get(x-1,y) + get(x+1,y)) / 2
          r = (get(x,y-1) + get(x,y+1)) / 2
        }
      }

      r = (r - blackLevel) * wb.r / range
      g = (g - blackLevel) * wb.g / range
      b = (b - blackLevel) * wb.b / range

      out[idx+0] = srgb(r) * 255
      out[idx+1] = srgb(g) * 255
      out[idx+2] = srgb(b) * 255
      out[idx+3] = 255
    }
  }
  return out
}

function srgb(v: number): number {
  v = Math.max(0, Math.min(1, v))
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

async function sendBitmap(bitmap: ImageBitmap) {
  const oc  = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = oc.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  self.postMessage({ type: 'progress', value: 95 })
  const transferBuffer = new ArrayBuffer(id.data.byteLength)
  new Uint8Array(transferBuffer).set(id.data)
  ;(self as any).postMessage(
    { type: 'done', imageData: { data: transferBuffer, width: id.width, height: id.height } },
    [transferBuffer]
  )
}