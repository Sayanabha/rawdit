import * as UTIF from 'utif2'

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

  self.postMessage({ type: 'progress', value: 20 })

  // Strategy 2: UTIF2 full DNG/TIFF decode
  try {
    console.log('[Worker] Trying UTIF2...')
    self.postMessage({ type: 'progress', value: 30 })

    const ifds = UTIF.decode(arrayBuffer)
    const allIfds = flattenIfds(ifds)
    console.log('[Worker] Total IFDs:', allIfds.length)
    allIfds.forEach((ifd: any, i: number) => {
      console.log(`  IFD[${i}]: ${ifd.t256}x${ifd.t257}`)
    })

    // Decode all IFDs, pick largest
    let bestIfd: any = null
    let bestPixels = 0

    for (const ifd of allIfds) {
      try {
        UTIF.decodeImage(arrayBuffer, ifd)
        const w = ifd.width || ifd.t256
        const h = ifd.height || ifd.t257
        const px = (w || 0) * (h || 0)
        console.log(`[Worker] IFD decoded: ${w}x${h}`)
        if (px > bestPixels) {
          bestPixels = px
          bestIfd = ifd
        }
      } catch (ex) {
        console.log('[Worker] IFD failed:', ex)
      }
    }

    if (!bestIfd) throw new Error('No decodable IFD')

    const width: number  = bestIfd.width  || bestIfd.t256
    const height: number = bestIfd.height || bestIfd.t257
    console.log('[Worker] ✓ Best IFD:', width, 'x', height)

    self.postMessage({ type: 'progress', value: 60 })

    // Check if toRGBA8 gives actual data
    let rgba: Uint8Array = UTIF.toRGBA8(bestIfd)
    const sampleMax = Math.max(...Array.from(rgba.slice(0, 400)))
    console.log('[Worker] toRGBA8 max sample:', sampleMax)

    if (sampleMax < 10) {
      console.log('[Worker] Black image — running manual demosaic')

      // Read black/white levels
      let blackLevel = 512
      let whiteLevel = 16383

      const blTag = bestIfd.t50714
      if (blTag && Array.isArray(blTag[0])) {
        blackLevel = blTag[0][0] / blTag[0][1]
      } else if (blTag) {
        blackLevel = blTag[0]
      }

      const wlTag = bestIfd.t50717
      if (wlTag) whiteLevel = Array.isArray(wlTag) ? wlTag[0] : wlTag

      console.log('[Worker] BlackLevel:', blackLevel, 'WhiteLevel:', whiteLevel)

      // CFA pattern
      const cfaTag = bestIfd.t33421
      const pattern: number[] = (cfaTag && cfaTag.length >= 4)
        ? Array.from(cfaTag).slice(0, 4) as number[]
        : [0, 1, 1, 2]
      console.log('[Worker] CFA pattern:', pattern)

      // Raw pixel data as Uint16
      const rawData = bestIfd.data as Uint8Array
      const view16 = new Uint16Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 2)

      // Estimate white balance
      const wb = estimateWhiteBalance(view16, width, height, pattern, blackLevel, whiteLevel)
      console.log('[Worker] WB — r:', wb.r.toFixed(3), 'g:', wb.g.toFixed(3), 'b:', wb.b.toFixed(3))

      self.postMessage({ type: 'progress', value: 70 })

      rgba = demosaic(view16, width, height, blackLevel, whiteLevel, pattern, wb)
      console.log('[Worker] Demosaic done')
    }

    if (!width || !height || rgba.length === 0) throw new Error('Empty result')

    self.postMessage({ type: 'progress', value: 90 })

    // Transfer the buffer (copy it out of Uint8ClampedArray first)
    const transferBuffer = rgba.buffer.slice(0)
    self.postMessage(
      { type: 'done', imageData: { data: transferBuffer, width, height } },
      [transferBuffer] as unknown as WindowPostMessageOptions
    )
    return

  } catch (err) {
    console.log('[Worker] ✗ UTIF2 failed:', (err as Error).message)
  }

  self.postMessage({
    type: 'error',
    message: 'Could not decode this DNG file. Check console for details.',
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendBitmap(bitmap: ImageBitmap) {
  const oc = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = oc.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  self.postMessage({ type: 'progress', value: 95 })
  const transferBuffer = id.data.buffer.slice(0)
  self.postMessage(
    { type: 'done', imageData: { data: transferBuffer, width: id.width, height: id.height } },
    [transferBuffer] as unknown as WindowPostMessageOptions
  )
}

function flattenIfds(ifds: any[]): any[] {
  const result: any[] = []
  for (const ifd of ifds) {
    result.push(ifd)
    if (ifd.subIFD) result.push(...flattenIfds(Array.isArray(ifd.subIFD) ? ifd.subIFD : [ifd.subIFD]))
    if (ifd.exifIFD) result.push(...flattenIfds(Array.isArray(ifd.exifIFD) ? ifd.exifIFD : [ifd.exifIFD]))
    if (ifd['330']) {
      const sub = Array.isArray(ifd['330']) ? ifd['330'] : [ifd['330']]
      result.push(...flattenIfds(sub))
    }
  }
  return result
}

function estimateWhiteBalance(
  bayer: Uint16Array,
  width: number,
  height: number,
  pattern: number[],
  blackLevel: number,
  whiteLevel: number
): { r: number; g: number; b: number } {
  const sums   = [0, 0, 0]
  const counts = [0, 0, 0]
  const clip   = whiteLevel * 0.95
  const step   = 16

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const val = bayer[y * width + x]
      if (val >= clip) continue
      const c = pattern[(y % 2) * 2 + (x % 2)]
      sums[c]   += val - blackLevel
      counts[c]++
    }
  }

  const avgR = counts[0] > 0 ? sums[0] / counts[0] : 1
  const avgG = counts[1] > 0 ? sums[1] / counts[1] : 1
  const avgB = counts[2] > 0 ? sums[2] / counts[2] : 1
  console.log('[Worker] Channel avgs — R:', avgR.toFixed(1), 'G:', avgG.toFixed(1), 'B:', avgB.toFixed(1))

  return {
    r: avgG / avgR,
    g: 1.0,
    b: avgG / avgB,
  }
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
    x = Math.max(0, Math.min(width  - 1, x))
    y = Math.max(0, Math.min(height - 1, y))
    return bayer[y * width + x]
  }

  const colorAt = (x: number, y: number): number =>
    pattern[(y % 2) * 2 + (x % 2)]

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

      out[idx+0] = Math.pow(Math.max(0, Math.min(1, r)), 1/2.2) * 255
      out[idx+1] = Math.pow(Math.max(0, Math.min(1, g)), 1/2.2) * 255
      out[idx+2] = Math.pow(Math.max(0, Math.min(1, b)), 1/2.2) * 255
      out[idx+3] = 255
    }
  }

  return out
}