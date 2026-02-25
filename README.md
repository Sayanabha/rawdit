# rawdit 

> A browser-based RAW image editor that does what most people think is impossible in a browser.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Built With](https://img.shields.io/badge/built%20with-React%20%2B%20WebGL2-61DAFB)
![Status](https://img.shields.io/badge/status-actively%20breaking%20things-orange)

---

## What is this?

**rawdit** is a fully client-side RAW image editor. No servers. No uploads. No subscription. No "please wait while we process your 80MB file on our very expensive cloud machine."

You drop a `.DNG`, `.CR2`, `.NEF`, `.ARW` (or basically any RAW format your camera spits out) directly into the browser, and it renders, edits, and exports - entirely on your device. Your photos never leave your machine.

It uses **WebGL2 shaders** for GPU-accelerated editing, a custom **Bayer demosaicing pipeline** for RAW decode, and a **canvas-based brush masking system** for selective adjustments.

---

## Features

- **RAW file support** - DNG, CR2, NEF, ARW, RAF, RW2, ORF and more  
- **Full adjustment panel** - Exposure, Brightness, Contrast, Highlights, Shadows, Whites, Blacks, Saturation, Vibrance, Temperature, Tint, Sharpness, Vignette, Grain  
- **Selective masking** - Paint adjustments onto specific areas with a soft brush  
- **GPU-accelerated** - All edits run as GLSL shaders on your GPU, real-time  
- **100% private** - Nothing is uploaded anywhere. Ever.  
- **Export** - Download your edited image as a high-quality JPEG

---

## Tech Stack

| What | Why |
|------|-----|
| React + TypeScript | UI components and state |
| Vite | Build tool (handles WASM beautifully) |
| WebGL2 | GPU shader pipeline for real-time edits |
| UTIF2 | TIFF/DNG parsing and IFD traversal |
| Zustand | Lightweight state management |
| Web Workers | RAW decoding off the main thread (so the UI doesn't freeze) |

---

## How It Works (the interesting part)

Most people don't realise that a RAW file is basically a text file that says *"here are 33 million numbers representing how much light hit each sensor pixel, good luck."* The browser has no idea what to do with that.

So rawdit does it manually:

1. **UTIF2** reads the TIFF/DNG container and finds all IFDs (image file directories)
2. The largest IFD is selected - that's your full-res sensor data
3. The **Bayer CFA pattern** is read from the file metadata (usually RGGB)
4. **Bilinear demosaicing** interpolates RGB values from the single-channel sensor grid
5. **White balance** is estimated from the image data itself using per-channel averages
6. **Gamma correction** (2.2) maps linear light to display-ready values
7. The result is uploaded as a WebGL2 texture and all edits happen in GLSL fragment shaders

---

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm v9 or higher
- A modern browser (Chrome/Edge recommended - best WebGL2 support)

### Installation

```bash
git clone https://github.com/yourusername/raw-editor.git
cd raw-editor
npm install
npm run dev
```

Open `http://localhost:5173`, drop a RAW file, start editing.

### Build for production

```bash
npm run build
npm run preview
```

---

## Deployment

rawdit is deployed on Netlify. Since everything runs client-side, deployment is trivially simple.

Build command: `npm run build`
Publish directory: `dist`

See [DEPLOYMENT.md](./DEPLOYMENT.md) if you want step-by-step instructions.

---

## Project Structure

```
raw-editor/
├── src/
│   ├── workers/
│   │   └── raw-decoder.worker.ts     # RAW decode pipeline (Web Worker)
│   ├── engine/
│   │   ├── WebGLRenderer.ts          # WebGL2 shader pipeline
│   │   ├── MaskPainter.ts            # Canvas brush masking engine
│   │   └── shaders/
│   │       ├── vertex.glsl.ts        # Passthrough vertex shader
│   │       └── fragment.glsl.ts      # All adjustments as GLSL uniforms
│   ├── components/
│   │   ├── Viewport.tsx              # Main canvas + worker orchestration
│   │   ├── EditPanel.tsx             # Adjustment sliders
│   │   ├── Toolbar.tsx               # Tools + export
│   │   └── FileDropzone.tsx          # File input
│   └── store/
│       └── editorStore.ts            # Zustand state
```

---

## Roadmap

- [ ] AI-assisted masking (SAM / Segment Anything in the browser via ONNX)
- [ ] Tone curves editor with draggable control points
- [ ] Histogram display
- [ ] Before/After toggle
- [ ] Multiple mask layers
- [ ] Lens correction (distortion, chromatic aberration)
- [ ] Healing brush
- [ ] Local export to 16-bit TIFF

---

## Contributing

We'd love your help. See [CONTRIBUTORS.md](./CONTRIBUTORS.md) for how to get involved.

---

## License

MIT - do whatever you want, just don't blame us if your GPU catches fire.