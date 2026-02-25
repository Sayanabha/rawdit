import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { WebGLRenderer } from '../engine/WebGLRenderer'
import { MaskPainter } from '../engine/MaskPainter'

// We keep renderer and maskPainter outside React state (mutable refs)
let renderer: WebGLRenderer | null = null
let maskPainter: MaskPainter | null = null
let rafId: number | null = null

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null) // brush cursor + mask preview
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    rawFile, isDecoding, isImageLoaded,
    adjustments, maskActive, activeTool,
    brushSize, brushHardness,
    setDecoding, setDecodeProgress, setImageLoaded, setImageDimensions,
  } = useEditorStore()

  // Initialize WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      renderer = new WebGLRenderer(canvas)
      window._renderer = renderer // Expose for export
    } catch (e) {
      console.error('WebGL init failed:', e)
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      renderer?.destroy()
      renderer = null
    }
  }, [])

  // Decode RAW file when it changes
  useEffect(() => {
    if (!rawFile || !renderer) return

    setDecoding(true)
    setDecodeProgress(0)
    setImageLoaded(false)

    const worker = new Worker(
      new URL('../workers/raw-decoder.worker.ts', import.meta.url),
      { type: 'module' }
    )

  worker.onmessage = (e) => {
  const msg = e.data
  console.log('[Viewport] Worker message:', msg.type, msg)

  if (msg.type === 'progress') {
    setDecodeProgress(msg.value)

  } else if (msg.type === 'done') {
    const { data, width, height } = msg.imageData
    console.log('[Viewport] Image ready:', width, 'x', height)

    // data is an ArrayBuffer (transferred), wrap it
    const imageData = new Uint8ClampedArray(data)

    const container = containerRef.current!
    const maxW = container.clientWidth
    const maxH = container.clientHeight
    const scale = Math.min(maxW / width, maxH / height, 1)
    const dispW = Math.floor(width * scale)
    const dispH = Math.floor(height * scale)

    console.log('[Viewport] Display size:', dispW, 'x', dispH, 'scale:', scale)

    const canvas = canvasRef.current!
    canvas.width = dispW
    canvas.height = dispH

    if (!renderer) {
      console.error('[Viewport] Renderer is null!')
      return
    }

    renderer.loadImageData(imageData, width, height)
    maskPainter = new MaskPainter(dispW, dispH)
    window._renderer = renderer

    setImageDimensions(width, height)
    setDecoding(false)
    setDecodeProgress(100)
    setImageLoaded(true)
    worker.terminate()
    startRenderLoop()

  } else if (msg.type === 'error') {
    console.error('[Viewport] Decode error:', msg.message)
    setDecoding(false)
    alert('Error: ' + msg.message)
    worker.terminate()
  }
}
    rawFile.arrayBuffer().then(buffer => {
      worker.postMessage({ arrayBuffer: buffer, fileName: rawFile.name }, [buffer])
    })

    return () => worker.terminate()
  }, [rawFile])

  function startRenderLoop() {
    if (rafId) cancelAnimationFrame(rafId)
    function loop() {
      if (renderer) renderer.render(useEditorStore.getState().adjustments)
      rafId = requestAnimationFrame(loop)
    }
    loop()
  }

  // Mask interaction
  const getCanvasPos = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!maskActive || !maskPainter || activeTool === 'none') return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = getCanvasPos(e)
    maskPainter.startStroke(x, y)
    maskPainter.continueStroke(x, y, brushSize, brushHardness, activeTool)
    uploadMask()
  }, [maskActive, activeTool, brushSize, brushHardness])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    // Draw brush cursor on overlay
    const overlay = overlayRef.current
    if (overlay) {
      const rect = overlay.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const ctx = overlay.getContext('2d')!
      ctx.clearRect(0, 0, overlay.width, overlay.height)
      if (maskActive && activeTool !== 'none') {
        ctx.beginPath()
        ctx.arc(cx, cy, brushSize / 2, 0, Math.PI * 2)
        ctx.strokeStyle = activeTool === 'eraser' ? '#ff4444aa' : '#ffffffaa'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }

    if (!maskActive || !maskPainter || activeTool === 'none') return
    const { x, y } = getCanvasPos(e)
    maskPainter.continueStroke(x, y, brushSize, brushHardness, activeTool)
    uploadMask()
  }, [maskActive, activeTool, brushSize, brushHardness])

  const onPointerUp = useCallback(() => {
    maskPainter?.endStroke()
  }, [])

  function uploadMask() {
    if (!maskPainter || !renderer) return
    const data = maskPainter.getMaskData()
    renderer.updateMask(data, maskPainter.width, maskPainter.height)
  }

  // Resize overlay canvas to match display canvas
  useEffect(() => {
    const container = containerRef.current
    const overlay = overlayRef.current
    if (!container || !overlay) return
    const ro = new ResizeObserver(() => {
      overlay.width = container.clientWidth
      overlay.height = container.clientHeight
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        background: 'var(--bg-primary)',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          cursor: maskActive && activeTool !== 'none' ? 'none' : 'default',
        }}
      />
      {/* Transparent overlay for brush cursor */}
      <canvas
        ref={overlayRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: maskActive && activeTool !== 'none' ? 'none' : 'default',
        }}
      />

      {isDecoding && <DecodeOverlay />}
    </div>
  )
}

function DecodeOverlay() {
  const progress = useEditorStore(s => s.decodeProgress)
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#111111cc',
      gap: '12px',
    }}>
      <div style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
        Decoding RAW file...
      </div>
      <div style={{
        width: '200px',
        height: '3px',
        background: 'var(--border)',
        borderRadius: '2px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: 'var(--accent)',
          transition: 'width 0.3s ease',
        }} />
      </div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
        {progress}%
      </div>
    </div>
  )
}