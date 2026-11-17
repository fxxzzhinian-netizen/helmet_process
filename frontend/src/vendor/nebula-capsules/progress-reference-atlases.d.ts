export const PROGRESS_REFERENCE_DURATION: number
export const PROGRESS_REFERENCE_FRAME_COUNT: number
export function getProgressReferenceAtlas(
  id: string,
  palette?: string[]
): { image: HTMLImageElement; ready: boolean }
