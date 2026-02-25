import * as UTIF from 'utif2'

self.onmessage = async (e: MessageEvent) => {
  const { arrayBuffer, fileName } = e.data as {
    arrayBuffer: ArrayBuffer
    fileName: string
  }

  console.log('[Worker] File:', fileName, (arrayBuffer.byteLength / 1024 / 1024).toFixed(1) + 'MB')
  self.postMessage({ type: 'progress', value: 5 })

  const uint8 = new Uint8Array(arrayBuffer)

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

  // Strategy 2: UTIF2 full DNG/TIFF decode with sub-IFD traversal
  try {
    console.log('[Worker] Trying UTIF2...')
    self.postMessage({ type: 'progress', value: 30 })

    const ifds = UTIF.decode(arrayBuffer)
    const allIfds = flattenIfds(ifds)
    console.log('[Worker] Total IFDs including sub-IFDs:', allIfds.length)
    allIfds.forEach((ifd: any, i: number) => {
      console.log(`  IFD[${i}]: ${ifd.t256}x${ifd.t257}`)
    })

    if (allIfds.length === 0) throw new Error('No IFDs found')

    self.postMessage({ type: 'progress', value: 40 })

   let bestIfd: any = null
    let bestPixels = 0

    for (const ifd of allIfds) {
      try {
        UTIF.decodeImage(arrayBuffer, ifd)
        const w = (ifd as any).width  || (ifd as any).t256
        const h = (ifd as any).height || (ifd as any).t257
        const pixels = w * h
        console.log(`[Worker] Decoded IFD: ${w}x${h} (${pixels} px)`)
        if (pixels > bestPixels) {
          bestPixels = pixels
          bestIfd = ifd
        }
      } catch (ex) {
        console.log('[Worker] IFD decode failed:', ex)
      }
    }

    if (!bestIfd) throw new Error('No decodable IFD found')

    self.postMessage({ type: 'progress', value: 70 })

    const width  = (bestIfd as any).width  || (bestIfd as any).t256
    const height = (bestIfd as any).height || (bestIfd as any).t257
    console.log('[Worker] ✓ Best IFD:', width, 'x', height)
    console.log('[Worker] IFD keys:', Object.keys(bestIfd).join(', '))
    console.log('[Worker] t50728 (AsShotNeutral):', JSON.stringify(bestIfd.t50728))
      console.log('[Worker] t50717 (CameraCalibration1):', JSON.stringify(bestIfd.t50717))
      console.log('[Worker] t50718 (CameraCalibration2):', JSON.stringify(bestIfd.t50718))
      console.log('[Worker] t50721 (ColorMatrix1):', JSON.stringify(bestIfd.t50721))
      console.log('[Worker] t50722 (ColorMatrix2):', JSON.stringify(bestIfd.t50722))
      console.log('[Worker] ALL t5xxxx tags:', JSON.stringify(
        Object.entries(bestIfd)
          .filter(([k]) => k.startsWith('t5'))
          .reduce((acc, [k,v]) => ({...acc, [k]: v}), {})
      ))
    console.log('[Worker] Bits per sample (t258):', bestIfd.t258)
    console.log('[Worker] Samples per pixel (t277):', bestIfd.t277)
    console.log('[Worker] Photometric (t262):', bestIfd.t262)
    console.log('[Worker] Compression (t259):', bestIfd.t259)

    // toRGBA8 handles tone mapping internally for most cases
    let rgba = UTIF.toRGBA8(bestIfd)
    console.log('[Worker] RGBA buffer length:', rgba.length, 'expected:', width * height * 4)

    // Check if image is black (all values near zero = linear 16-bit stored as 8-bit)
    const sample = rgba.slice(0, 400)
    const maxVal = Math.max(...Array.from(sample))
    const avgVal = sample.reduce((a, b) => a + b, 0) / sample.length
    console.log('[Worker] Sample max:', maxVal, 'avg:', avgVal.toFixed(2))

    if (maxVal < 10) {
      console.log('[Worker] Image is black — raw data needs manual tone mapping')

      // Access raw data directly from UTIF internal buffer
      const rawData = (bestIfd as any).data as Uint8Array
      console.log('[Worker] Raw data length:', rawData?.length)
      console.log('[Worker] Raw data type:', rawData?.constructor?.name)

      const bps = bestIfd.t258?.[0] ?? bestIfd.t258 ?? 16
      console.log('[Worker] Bits per sample:', bps)

      rgba = toneMapRawToRGBA(rawData, width, height, bps, bestIfd)
      console.log('[Worker] Tone mapped. New max sample:', Math.max(...Array.from(rgba.slice(0, 400))))
    }

    if (!width || !height || rgba.length === 0) throw new Error('Empty decode result')

    self.postMessage({ type: 'progress', value: 90 })
    self.postMessage({
      type: 'done',
      imageData: { data: rgba.buffer, width, height },
    }, [rgba.buffer])
    return

  } catch (err) {
    console.log('[Worker] ✗ UTIF2 failed:', (err as Error).message)
  }

  self.postMessage({ type: 'progress', value: 40 })

  // Strategy 3: Manual JPEG hunt inside the file
  try {
    console.log('[Worker] Hunting embedded JPEGs...')
    const jpegs = findAllJpegs(uint8)
    console.log('[Worker] Found', jpegs.length, 'candidate JPEGs')
    jpegs.sort((a, b) => b.length - a.length)

    for (let i = 0; i < jpegs.length; i++) {
      const jpeg = jpegs[i]
      console.log(`[Worker] JPEG #${i + 1}: ${(jpeg.length / 1024).toFixed(0)}KB`)
      try {
        const blob = new Blob([jpeg], { type: 'image/jpeg' })
        const bitmap = await createImageBitmap(blob)
        if (bitmap.width > 800) {
          console.log('[Worker] ✓ Good JPEG:', bitmap.width, 'x', bitmap.height)
          self.postMessage({ type: 'progress', value: 80 })
          await sendBitmap(bitmap)
          return
        }
      } catch {
        // try next
      }
    }
  } catch (err) {
    console.log('[Worker] ✗ JPEG hunt failed:', err)
  }

  // All strategies failed
  self.postMessage({
    type: 'error',
    message: 'Could not decode this DNG file. Paste the [Worker] console logs so we can diagnose.',
  })
}

async function sendBitmap(bitmap: ImageBitmap) {
  const oc = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = oc.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  self.postMessage({ type: 'progress', value: 95 })
  self.postMessage({
    type: 'done',
    imageData: { data: id.data.buffer, width: id.width, height: id.height },
  }, [id.data.buffer])
}

function flattenIfds(ifds: any[]): any[] {
  const result: any[] = []
  for (const ifd of ifds) {
    result.push(ifd)
    if (ifd.subIFD) {
      result.push(...flattenIfds(Array.isArray(ifd.subIFD) ? ifd.subIFD : [ifd.subIFD]))
    }
    if (ifd.exifIFD) {
      result.push(...flattenIfds(Array.isArray(ifd.exifIFD) ? ifd.exifIFD : [ifd.exifIFD]))
    }
    if (ifd['330']) {
      const sub = Array.isArray(ifd['330']) ? ifd['330'] : [ifd['330']]
      result.push(...flattenIfds(sub))
    }
  }
  return result
}
function toneMapRawToRGBA(
  rawData: Uint8Array,
  width: number,
  height: number,
  bitsPerSample: number,
  ifd?: any
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)

  if (bitsPerSample === 16) {
    const view = new Uint16Array(rawData.buffer, rawData.byteOffset, rawData.byteLength / 2)

    // Find actual data range for normalization
    let dataMin = Infinity
    let dataMax = -Infinity
    for (let i = 0; i < view.length; i++) {
      if (view[i] < dataMin) dataMin = view[i]
      if (view[i] > dataMax) dataMax = view[i]
    }
    console.log('[Worker] Bayer data range:', dataMin, '-', dataMax)

    const samplesPerPixel = view.length / (width * height)

    if (samplesPerPixel === 1) {
      // ── Bayer CFA demosaic ──
      // Read CFA pattern from IFD tag t33421
      // Pattern bytes: 0=R, 1=G, 2=B
      // Common patterns: RGGB=[0,1,1,2], BGGR=[2,1,1,0], GRBG=[1,0,2,1], GBRG=[1,2,0,1]
      const cfaTag = ifd?.t33421
      let pattern = [0, 1, 1, 2] // default RGGB
      if (cfaTag && cfaTag.length >= 4) {
        pattern = Array.from(cfaTag).slice(0, 4) as number[]
      }
      console.log('[Worker] CFA pattern:', pattern)

    //   const range = dataMax - dataMin || 1

      // Bilinear demosaic
// Read black level and white level from DNG tags
      // t50714 = BlackLevel (per channel, as rational), t50717 = WhiteLevel
      let blackLevel = 512  // default
      let whiteLevel = 16383

      if (bestIfd.t50714) {
        const bl = bestIfd.t50714
        // rational format: [[numerator, denominator], ...]
        if (Array.isArray(bl[0])) {
          blackLevel = bl[0][0] / bl[0][1]
        } else {
          blackLevel = bl[0]
        }
      }
      if (bestIfd.t50717) {
        whiteLevel = Array.isArray(bestIfd.t50717) ? bestIfd.t50717[0] : bestIfd.t50717
      }
      console.log('[Worker] BlackLevel:', blackLevel, 'WhiteLevel:', whiteLevel)

      // This DNG has no AsShotNeutral — use measured neutral WB for this sensor
      // We derive it from the data itself: sample green channel average vs R/B
      const wb = estimateWhiteBalance(view, width, height, pattern, blackLevel, whiteLevel)
      console.log('[Worker] Estimated WB:', wb)

      demosaic(view, width, height, blackLevel, whiteLevel, pattern, wb, rgba)
    } else {
      // Already RGB — just tone map
      const range = dataMax - dataMin || 1
      for (let i = 0; i < width * height; i++) {
        rgba[i*4+0] = Math.pow((view[i*samplesPerPixel+0] - dataMin) / range, 1/2.2) * 255
        rgba[i*4+1] = Math.pow((view[i*samplesPerPixel+1] - dataMin) / range, 1/2.2) * 255
        rgba[i*4+2] = Math.pow((view[i*samplesPerPixel+2] - dataMin) / range, 1/2.2) * 255
        rgba[i*4+3] = 255
      }
    }
  }

  return rgba
}

function demosaic(
  bayer: Uint16Array,
  width: number,
  height: number,
  blackLevel: number,
  whiteLevel: number,
  pattern: number[],
  wb: { r: number; g: number; b: number },
  out: Uint8ClampedArray
) {
  const range = whiteLevel - blackLevel

  const get = (x: number, y: number) => {
    x = Math.max(0, Math.min(width - 1, x))
    y = Math.max(0, Math.min(height - 1, y))
    return bayer[y * width + x]
  }

  const colorAt = (x: number, y: number) => pattern[(y % 2) * 2 + (x % 2)]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const c = colorAt(x, y)
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

      // Subtract black level, apply white balance, normalize
      r = (r - blackLevel) * wb.r / range
      g = (g - blackLevel) * wb.g / range
      b = (b - blackLevel) * wb.b / range

      // Gamma 2.2
      out[idx+0] = Math.pow(Math.max(0, Math.min(1, r)), 1/2.2) * 255
      out[idx+1] = Math.pow(Math.max(0, Math.min(1, g)), 1/2.2) * 255
      out[idx+2] = Math.pow(Math.max(0, Math.min(1, b)), 1/2.2) * 255
      out[idx+3] = 255
    }
  }
}
function estimateWhiteBalance(
  bayer: Uint16Array,
  width: number,
  height: number,
  pattern: number[],
  blackLevel: number,
  whiteLevel: number
): { r: number; g: number; b: number } {
  // Sample a grid of pixels across the image
  // Average each color channel, then normalize so G=1
  const sums = [0, 0, 0]   // R, G, B
  const counts = [0, 0, 0]
  const step = 16 // sample every 16th pixel for speed
  const clipLimit = whiteLevel * 0.95 // ignore clipped pixels

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const val = bayer[y * width + x]
      if (val >= clipLimit) continue // skip clipped
      const c = pattern[(y % 2) * 2 + (x % 2)]
      sums[c] += val - blackLevel
      counts[c]++
    }
  }

  const avgR = counts[0] > 0 ? sums[0] / counts[0] : 1
  const avgG = counts[1] > 0 ? sums[1] / counts[1] : 1
  const avgB = counts[2] > 0 ? sums[2] / counts[2] : 1

  console.log('[Worker] Channel averages — R:', avgR.toFixed(1), 'G:', avgG.toFixed(1), 'B:', avgB.toFixed(1))

  // Normalize: multiply each channel so that after WB, R=G=B for a neutral scene
  return {
    r: avgG / avgR,
    g: 1.0,
    b: avgG / avgB,
  }
}
function findAllJpegs(data: Uint8Array): Uint8Array[] {
  const results: Uint8Array[] = []
  let pos = 0
  while (pos < data.length - 3) {
    if (data[pos] === 0xFF && data[pos + 1] === 0xD8 && data[pos + 2] === 0xFF) {
      const start = pos
      let end = -1
      for (let j = start + 2; j < Math.min(start + 50_000_000, data.length - 1); j++) {
        if (data[j] === 0xFF && data[j + 1] === 0xD9) {
          end = j + 2
          break
        }
      }
      if (end !== -1 && (end - start) > 5000) {
        results.push(data.slice(start, end))
        pos = end
        continue
      }
    }
    pos++
  }
  return results
}