import { useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'

const SUPPORTED = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2', '.orf', '.raw', '.nrw']

export function FileDropzone() {
  const setRawFile = useEditorStore(s => s.setRawFile)

  const handleFile = useCallback((file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!SUPPORTED.includes(ext) && !file.name.match(/\.(jpe?g|png|tiff?)$/i)) {
      alert('Please drop a RAW image file (.CR2, .NEF, .ARW, .DNG, etc.)')
      return
    }
    setRawFile(file)
  }, [setRawFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div
      onDrop={onDrop}
      onDragOver={e => e.preventDefault()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: '16px',
        color: 'var(--text-secondary)',
      }}
    >
      <div style={{ fontSize: '48px', opacity: 0.3 }}>⬡</div>
      <div style={{ fontSize: '16px', color: 'var(--text-primary)' }}>
        Drop a RAW image here
      </div>
      <div style={{ fontSize: '12px' }}>
        CR2 · CR3 · NEF · ARW · DNG · RAF · RW2 · ORF
      </div>
      <label style={{
        padding: '8px 20px',
        background: 'var(--accent)',
        color: '#fff',
        borderRadius: '6px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 500,
      }}>
        Browse file
        <input
          type="file"
          accept=".cr2,.cr3,.nef,.arw,.dng,.raf,.rw2,.orf,.raw,.nrw,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={onInput}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  )
}