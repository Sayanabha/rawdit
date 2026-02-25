export const fragmentShader = /* glsl */`#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform bool u_hasMask;

// Basic adjustments
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_temperature;
uniform float u_tint;
uniform float u_sharpness;
uniform float u_vignette;
uniform float u_grain;
uniform float u_time;
uniform vec2 u_resolution;

// Luminance helper
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// sRGB gamma
vec3 linearToSRGB(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 sRGBToLinear(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(2.2));
}

// Pseudo-random for grain
float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 applyAdjustments(vec3 col) {
  // Exposure (EV stops)
  col *= pow(2.0, u_exposure);

  // Highlights and shadows (simple luma-based)
  float lum = luminance(col);
  float hiMask = smoothstep(0.5, 1.0, lum);
  float shMask = 1.0 - smoothstep(0.0, 0.5, lum);
  col += hiMask * (u_highlights / 100.0) * 0.3;
  col += shMask * (u_shadows / 100.0) * 0.3;

  // Whites and blacks
  col = col + (u_whites / 100.0) * 0.2 * col;
  col = col + (u_blacks / 100.0) * 0.05 * (1.0 - col);

  // Brightness
  col += u_brightness / 100.0 * 0.5;

  // Contrast (S-curve)
  float contrastFactor = (u_contrast / 100.0) * 0.8 + 1.0;
  col = (col - 0.5) * contrastFactor + 0.5;

  // Temperature (shift blue-yellow axis)
  col.r += u_temperature / 100.0 * 0.15;
  col.b -= u_temperature / 100.0 * 0.15;

  // Tint (shift green-magenta axis)
  col.g -= u_tint / 100.0 * 0.1;
  col.r += u_tint / 100.0 * 0.05;
  col.b += u_tint / 100.0 * 0.05;

  // Saturation
  float gray = luminance(col);
  col = mix(vec3(gray), col, 1.0 + u_saturation / 100.0);

  // Vibrance (protect already-saturated colors)
  float maxC = max(col.r, max(col.g, col.b));
  float minC = min(col.r, min(col.g, col.b));
  float sat = maxC - minC;
  col = mix(col, mix(vec3(gray), col, 1.0 + u_vibrance / 100.0), 1.0 - sat);

  return col;
}

void main() {
  vec4 texColor = texture(u_image, v_texCoord);
  vec3 col = sRGBToLinear(texColor.rgb);

  // Determine mask strength
  float maskStrength = 1.0;
  if (u_hasMask) {
    maskStrength = texture(u_mask, v_texCoord).r;
  }

  // Apply adjustments weighted by mask
  vec3 adjusted = applyAdjustments(col);
  col = mix(col, adjusted, maskStrength);

  // Vignette (always global, not masked)
  vec2 uv = v_texCoord - 0.5;
  float vignetteDist = dot(uv, uv) * 2.0;
  float vignetteAmount = u_vignette / 100.0;
  if (vignetteAmount > 0.0) {
    col *= 1.0 - vignetteDist * vignetteAmount;
  } else {
    col *= 1.0 + vignetteDist * (-vignetteAmount);
  }

  // Grain
  if (u_grain > 0.0) {
    float grainAmount = u_grain / 100.0 * 0.08;
    float noise = rand(v_texCoord + u_time) - 0.5;
    col += noise * grainAmount;
  }

  col = linearToSRGB(col);
  outColor = vec4(clamp(col, 0.0, 1.0), texColor.a);
}
`