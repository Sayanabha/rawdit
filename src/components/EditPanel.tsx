import { useEditorStore, defaultAdjustments, type Adjustments } from '../store/editorStore'

interface SliderProps {
  label: string
  name: keyof Adjustments
  min: number
  max: number
  step?: number
}

function AdjustSlider({ label, name, min, max, step = 1 }: SliderProps) {
  const value = useEditorStore(s => s.adjustments[name])
  const setAdjustment = useEditorStore(s => s.setAdjustment)
  const def = defaultAdjustments[name]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{label}</span>
        <span
          style={{
            color: value !== def ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: '11px',
            cursor: 'pointer',
            minWidth: '32px',
            textAlign: 'right',
          }}
          onDoubleClick={() => setAdjustment(name, def)}
          title="Double-click to reset"
        >
          {typeof value === 'number' && name === 'exposure'
            ? (value >= 0 ? '+' : '') + value.toFixed(1)
            : Math.round(value as number)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value as number}
        onChange={e => setAdjustment(name, parseFloat(e.target.value))}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{
        fontSize: '10px',
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-secondary)',
        marginBottom: '12px',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {children}
      </div>
    </div>
  )
}

export function EditPanel() {
  const { resetAdjustments, isImageLoaded } = useEditorStore()

  if (!isImageLoaded) return null

  return (
    <div style={{
      width: 'var(--panel-width)',
      background: 'var(--bg-panel)',
      borderLeft: '1px solid var(--border)',
      overflow: 'auto',
      padding: '16px',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Adjustments</span>
        <button
          onClick={resetAdjustments}
          style={{
            fontSize: '11px',
            color: 'var(--text-secondary)',
            padding: '3px 8px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        >
          Reset
        </button>
      </div>

      <Section title="Light">
        <AdjustSlider label="Exposure" name="exposure" min={-3} max={3} step={0.1} />
        <AdjustSlider label="Brightness" name="brightness" min={-100} max={100} />
        <AdjustSlider label="Contrast" name="contrast" min={-100} max={100} />
        <AdjustSlider label="Highlights" name="highlights" min={-100} max={100} />
        <AdjustSlider label="Shadows" name="shadows" min={-100} max={100} />
        <AdjustSlider label="Whites" name="whites" min={-100} max={100} />
        <AdjustSlider label="Blacks" name="blacks" min={-100} max={100} />
      </Section>

      <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 20px' }} />

      <Section title="Color">
        <AdjustSlider label="Temperature" name="temperature" min={-100} max={100} />
        <AdjustSlider label="Tint" name="tint" min={-100} max={100} />
        <AdjustSlider label="Saturation" name="saturation" min={-100} max={100} />
        <AdjustSlider label="Vibrance" name="vibrance" min={-100} max={100} />
      </Section>

      <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0 20px' }} />

      <Section title="Effects">
        <AdjustSlider label="Vignette" name="vignette" min={-100} max={100} />
        <AdjustSlider label="Grain" name="grain" min={0} max={100} />
        <AdjustSlider label="Sharpness" name="sharpness" min={0} max={100} />
      </Section>
    </div>
  )
}