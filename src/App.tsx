import { useEditorStore } from './store/editorStore'
import { FileDropzone } from './components/FileDropzone'
import { Viewport } from './components/Viewport'
import { EditPanel } from './components/EditPanel'
import { Toolbar } from './components/Toolbar'
import './index.css'

export default function App() {
const { rawFile } = useEditorStore()
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      background: 'var(--bg-primary)',
    }}>
      <Toolbar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Always mount Viewport when a file is selected — it runs the worker */}
        {rawFile ? (
          <Viewport />
        ) : (
          <div style={{ flex: 1 }}>
            <FileDropzone />
          </div>
        )}

        <EditPanel />
      </div>
    </div>
  )
}
