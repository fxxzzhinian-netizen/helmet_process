// colors 依次是：已填充部分的底色、远处光带、近处光带、边界高光；base 是未填充部分的底色
export type ProgressPreset = { id: string; colors: string[]; base?: string }
export class ProgressFlowRenderer {
  resize(width: number, height: number, dpr: number): void
  draw(time: number, progress: number, effectImage?: HTMLImageElement | null): void
  dispose(): void
}
// 浏览器不支持 WebGL2 时返回 null
export function createProgressFlowRenderer(
  canvas: HTMLCanvasElement,
  preset: ProgressPreset
): ProgressFlowRenderer | null
