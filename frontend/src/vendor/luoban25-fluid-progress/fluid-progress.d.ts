export type FluidTheme = {
  baseColor: string
  fillColor: string
  deepColor: string
  midColor: string
  brightColor: string
  foamColor: string
  rimColor: string
}

export function createFluidProgress(
  canvas: HTMLCanvasElement,
  theme: FluidTheme
): {
  resize(cssWidth: number, cssHeight: number): void
  frame(seconds: number, target: number, reduceMotion: boolean): void
  dispose(): void
} | null
