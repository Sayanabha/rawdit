export class MaskPainter {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private isDrawing = false
  private lastX = 0
  private lastY = 0

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    // Start fully transparent (no mask)
    this.ctx.clearRect(0, 0, width, height)
  }

  resize(width: number, height: number) {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height)
    this.canvas.width = width
    this.canvas.height = height
    this.ctx.putImageData(imageData, 0, 0)
  }

  startStroke(x: number, y: number) {
    this.isDrawing = true
    this.lastX = x
    this.lastY = y
  }

  continueStroke(
    x: number,
    y: number,
    brushSize: number,
    hardness: number,
    mode: 'brush' | 'eraser'
  ) {
    if (!this.isDrawing) return
    const ctx = this.ctx

    ctx.globalCompositeOperation =
      mode === 'eraser' ? 'destination-out' : 'source-over'

    // Gradient brush for soft edges
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, brushSize / 2)
    const alpha = mode === 'eraser' ? 1 : 0.6
    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
    gradient.addColorStop(hardness, `rgba(255, 255, 255, ${alpha * 0.5})`)
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
    ctx.fill()

    // Draw line between last and current point for smooth strokes
    if (this.lastX !== x || this.lastY !== y) {
      const dist = Math.hypot(x - this.lastX, y - this.lastY)
      const steps = Math.ceil(dist / (brushSize * 0.2))
      for (let i = 1; i <= steps; i++) {
        const ix = this.lastX + (x - this.lastX) * (i / steps)
        const iy = this.lastY + (y - this.lastY) * (i / steps)
        const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, brushSize / 2)
        g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
        g.addColorStop(hardness, `rgba(255, 255, 255, ${alpha * 0.5})`)
        g.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(ix, iy, brushSize / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    this.lastX = x
    this.lastY = y
  }

 endStroke() {
  this.isDrawing = false
  this.ctx.globalCompositeOperation = 'source-over'
}

  getMaskData(): Uint8ClampedArray {
    const { width, height } = this.canvas
    const imageData = this.ctx.getImageData(0, 0, width, height)
    // Extract just the alpha channel as a grayscale mask
    const mask = new Uint8ClampedArray(width * height)
    for (let i = 0; i < mask.length; i++) {
      mask[i] = imageData.data[i * 4 + 3] // alpha channel
    }
    return mask
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  get width() { return this.canvas.width }
  get height() { return this.canvas.height }
}