import { vertexShader } from './shaders/vertex.glsl'
import { fragmentShader } from './shaders/fragment.glsl'
import type { Adjustments } from '../store/editorStore'

function createShader(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error('Shader compile error: ' + info)
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(program))
  }
  return program
}

export class WebGLRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private imageTexture: WebGLTexture | null = null
  private maskTexture: WebGLTexture | null = null
  private vao: WebGLVertexArrayObject
  private startTime = Date.now()

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true, // needed for export
    })
    if (!gl) throw new Error('WebGL2 not supported in this browser.')
    this.gl = gl

    this.program = createProgram(gl, vertexShader, fragmentShader)

    // Full-screen quad
    const positions = new Float32Array([
      -1, -1,  0, 1,
       1, -1,  1, 1,
      -1,  1,  0, 0,
       1,  1,  1, 0,
    ])

    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

    const posLoc = gl.getAttribLocation(this.program, 'a_position')
    const texLoc = gl.getAttribLocation(this.program, 'a_texCoord')

    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0)

    gl.enableVertexAttribArray(texLoc)
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8)

    gl.bindVertexArray(null)
  }

  loadImageData(data: Uint8ClampedArray | Uint8Array, width: number, height: number) {
    const gl = this.gl
    if (this.imageTexture) gl.deleteTexture(this.imageTexture)

    this.imageTexture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA,
      width, height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, data
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  updateMask(maskData: Uint8ClampedArray, width: number, height: number) {
    const gl = this.gl
    if (this.maskTexture) gl.deleteTexture(this.maskTexture)

    this.maskTexture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture)
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R8,
      width, height, 0,
      gl.RED, gl.UNSIGNED_BYTE, maskData
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  clearMask() {
    if (this.maskTexture) {
      this.gl.deleteTexture(this.maskTexture)
      this.maskTexture = null
    }
  }

  render(adjustments: Adjustments) {
    if (!this.imageTexture) return
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0.07, 0.07, 0.07, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)

    // Bind image texture to unit 0
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_image'), 0)

    // Bind mask texture to unit 1
    const hasMask = this.maskTexture !== null
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_hasMask'), hasMask ? 1 : 0)
    if (hasMask) {
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.maskTexture)
      gl.uniform1i(gl.getUniformLocation(this.program, 'u_mask'), 1)
    }

    // Set adjustment uniforms
    const u = (name: string, val: number) =>
      gl.uniform1f(gl.getUniformLocation(this.program, name), val)

    u('u_exposure',    adjustments.exposure)
    u('u_brightness',  adjustments.brightness)
    u('u_contrast',    adjustments.contrast)
    u('u_highlights',  adjustments.highlights)
    u('u_shadows',     adjustments.shadows)
    u('u_whites',      adjustments.whites)
    u('u_blacks',      adjustments.blacks)
    u('u_saturation',  adjustments.saturation)
    u('u_vibrance',    adjustments.vibrance)
    u('u_temperature', adjustments.temperature)
    u('u_tint',        adjustments.tint)
    u('u_sharpness',   adjustments.sharpness)
    u('u_vignette',    adjustments.vignette)
    u('u_grain',       adjustments.grain)
    u('u_time',        (Date.now() - this.startTime) / 1000)

    gl.uniform2f(
      gl.getUniformLocation(this.program, 'u_resolution'),
      canvas.width, canvas.height
    )

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  exportPixels(): { data: Uint8Array; width: number; height: number } {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const { width, height } = canvas
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return { data: pixels, width, height }
  }

  destroy() {
    const gl = this.gl
    if (this.imageTexture) gl.deleteTexture(this.imageTexture)
    if (this.maskTexture) gl.deleteTexture(this.maskTexture)
    gl.deleteProgram(this.program)
  }
}