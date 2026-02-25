import { create } from 'zustand'

export interface Adjustments {
  exposure: number       // -3 to +3 EV
  brightness: number     // -100 to +100
  contrast: number       // -100 to +100
  highlights: number     // -100 to +100
  shadows: number        // -100 to +100
  whites: number         // -100 to +100
  blacks: number         // -100 to +100
  saturation: number     // -100 to +100
  vibrance: number       // -100 to +100
  temperature: number    // -100 to +100 (cool to warm)
  tint: number           // -100 to +100 (green to magenta)
  sharpness: number      // 0 to 100
  vignette: number       // -100 to +100
  grain: number          // 0 to 100
}

export const defaultAdjustments: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  sharpness: 0,
  vignette: 0,
  grain: 0,
}

export type ActiveTool = 'none' | 'brush' | 'eraser'

export interface EditorState {
  // File state
  rawFile: File | null
  isDecoding: boolean
  decodeProgress: number
  imageWidth: number
  imageHeight: number
  isImageLoaded: boolean

  // Edit state
  adjustments: Adjustments
  maskActive: boolean
  activeTool: ActiveTool
  brushSize: number
  brushHardness: number

  // Actions
  setRawFile: (file: File) => void
  setDecoding: (val: boolean) => void
  setDecodeProgress: (val: number) => void
  setImageDimensions: (w: number, h: number) => void
  setImageLoaded: (val: boolean) => void
  setAdjustment: (key: keyof Adjustments, value: number) => void
  resetAdjustments: () => void
  setMaskActive: (val: boolean) => void
  setActiveTool: (tool: ActiveTool) => void
  setBrushSize: (val: number) => void
  setBrushHardness: (val: number) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  rawFile: null,
  isDecoding: false,
  decodeProgress: 0,
  imageWidth: 0,
  imageHeight: 0,
  isImageLoaded: false,

  adjustments: { ...defaultAdjustments },
  maskActive: false,
  activeTool: 'none',
  brushSize: 40,
  brushHardness: 0.7,

  setRawFile: (file) => set({ rawFile: file }),
  setDecoding: (val) => set({ isDecoding: val }),
  setDecodeProgress: (val) => set({ decodeProgress: val }),
  setImageDimensions: (w, h) => set({ imageWidth: w, imageHeight: h }),
  setImageLoaded: (val) => set({ isImageLoaded: val }),
  setAdjustment: (key, value) =>
    set((state) => ({
      adjustments: { ...state.adjustments, [key]: value },
    })),
  resetAdjustments: () => set({ adjustments: { ...defaultAdjustments } }),
  setMaskActive: (val) => set({ maskActive: val }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  setBrushSize: (val) => set({ brushSize: val }),
  setBrushHardness: (val) => set({ brushHardness: val }),
}))