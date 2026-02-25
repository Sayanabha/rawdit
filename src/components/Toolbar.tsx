import { useEditorStore } from '../store/editorStore'
import { WebGLRenderer } from '../engine/WebGLRenderer'

// We need a ref to the renderer for export — use a module-level accessor
// (In a larger app, use a context or event bus)
declare global {
  interface Window {
    _renderer: WebGLRenderer | null
  }
}

export function Toolbar() {
  const {
    isImageLoaded, rawFile,
    maskActive, setMaskActive,
    activeTool, setActiveTool,
    brushSize, setBrushSize,
    brushHardness, setBrushHardness,
    imageWidth, imageHeight,
  } = useEditorStore()

  const handleExport = () => {
    if (!window._renderer) return
    const { data, width, height } = window._renderer.exportPixels()

    // Flip vertically (WebGL reads bottom-to-top)
    const flipped = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width * 4
      const dst = y * width * 4
      flipped.set(data.subarray(src, src + width * 4), dst)
    }

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = width
    exportCanvas.height = height
    const ctx = exportCanvas.getContext('2d')!
    ctx.putImageData(new ImageData(flipped, width, height), 0, 0)

    exportCanvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (rawFile?.name.replace(/\.[^.]+$/, '') || 'export') + '_edited.jpg'
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/jpeg', 0.95)
  }

  return (
    <div style={{
      height: '48px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: '8px',
      flexShrink: 0,
    }}>
      {/* App name */}
      <span style={{ fontWeight: 700, fontSize: '14px', marginRight: '8px', letterSpacing: '-0.02em' }}>
        rawEdit
      </span>

      <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' }} />

      {isImageLoaded && (
        <>
          {/* Mask toggle */}
          <ToolBtn
            label="Mask"
            active={maskActive}
            onClick={() => {
              setMaskActive(!maskActive)
              if (maskActive) setActiveTool('none')
              else setActiveTool('brush')
            }}
          />

          {maskActive && (
            <>
              <ToolBtn label="Brush" active={activeTool === 'brush'} onClick={() => setActiveTool('brush')} />
              <ToolBtn label="Eraser" active={activeTool === 'eraser'} onClick={() => setActiveTool('eraser')} />

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Size</span>
                <input
                  type="range" min={5} max={200} value={brushSize}
                  onChange={e => setBrushSize(+e.target.value)}
                  style={{ width: '80px' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Softness</span>
                <input
                  type="range" min={0} max={100} value={Math.round(brushHardness * 100)}
                  onChange={e => setBrushHardness(+e.target.value / 100)}
                  style={{ width: '80px' }}
                />
              </div>
            </>
          )}

          <div style={{ flex: 1 }} />

          {isImageLoaded && (
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              {imageWidth} × {imageHeight}
            </span>
          )}

          <button
            onClick={handleExport}
            style={{
              padding: '5px 14px',
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: '5px',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            Export
          </button>
        </>
      )}
    </div>
  )
}

function ToolBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: '5px',
        fontSize: '12px',
        fontWeight: 500,
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}