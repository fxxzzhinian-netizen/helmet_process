// 来源：画境观屿 · 宇宙胶囊 https://github.com/yizhe21803/nebula-capsules-guanyu-lab
// 项目版本 1.6.0，提交 aef3f7d（2026-08-05），MIT 协议，见同目录 LICENSE。
// 相对原文件的改动（代码里另有标注）：getProgressReferenceAtlas 可传入自定义配色。
export const PROGRESS_REFERENCE_DURATION = 12;
export const PROGRESS_REFERENCE_FRAME_COUNT = 24;

const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 32;
const CACHE = new Map();

const PALETTES = {
  'model-training': ['#20131f', '#ff3f94', '#ff8a3d', '#fff06a'],
  'agent-migration': ['#111a31', '#245bff', '#00cfff', '#5dffe6'],
  'visual-training': ['#1f172b', '#7042ff', '#42f58d', '#c4ff8a']
};

function drawCloud(context, x, y, radiusX, radiusY, color, alpha) {
  context.save();
  context.translate(x, y);
  context.scale(1, radiusY / radiusX);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  gradient.addColorStop(0, `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`);
  gradient.addColorStop(0.46, `${color}${Math.round(alpha * 0.42 * 255).toString(16).padStart(2, '0')}`);
  gradient.addColorStop(1, `${color}00`);
  context.fillStyle = gradient;
  context.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
  context.restore();
}

// 本项目的改动：可以传入自定义配色（palette），不传时按 id 取原有配色
function createAtlas(id, customPalette) {
  const palette = customPalette || PALETTES[id] || PALETTES['visual-training'];
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH * PROGRESS_REFERENCE_FRAME_COUNT;
  canvas.height = FRAME_HEIGHT;
  const context = canvas.getContext('2d');

  for (let frame = 0; frame < PROGRESS_REFERENCE_FRAME_COUNT; frame += 1) {
    const phase = (frame / PROGRESS_REFERENCE_FRAME_COUNT) * Math.PI * 2;
    const left = frame * FRAME_WIDTH;
    context.save();
    context.translate(left, 0);
    context.fillStyle = palette[0];
    context.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    context.globalCompositeOperation = 'screen';

    drawCloud(context, 35 + Math.sin(phase * 0.83) * 5, 10 + Math.cos(phase * 0.61) * 5, 27, 18, palette[1], id === 'agent-migration' ? 0.32 : 0.42);
    drawCloud(context, 45 + Math.cos(phase * 0.72) * 4, 23 + Math.sin(phase * 0.54) * 4, 22, 15, palette[2], 0.44);
    drawCloud(context, 53 + Math.sin(phase * 1.07) * 2, 16 + Math.cos(phase * 0.89) * 6, 12, 13, palette[3], id === 'model-training' ? 0.30 : 0.20);

    context.globalCompositeOperation = 'source-over';
    const trough = context.createRadialGradient(41, 16, 1, 41, 16, 17);
    trough.addColorStop(0, 'rgba(5,6,11,0.64)');
    trough.addColorStop(0.58, 'rgba(6,7,12,0.26)');
    trough.addColorStop(1, 'rgba(6,7,12,0)');
    context.fillStyle = trough;
    context.fillRect(20, 0, 44, FRAME_HEIGHT);
    context.restore();
  }

  const image = new Image();
  image.decoding = 'async';
  const state = { image, ready: false };
  image.addEventListener('load', () => { state.ready = true; }, { once: true });
  image.addEventListener('error', () => { state.ready = false; }, { once: true });
  image.src = canvas.toDataURL('image/png');
  return state;
}

export function getProgressReferenceAtlas(id, palette) {
  const key = palette ? `${id}:${palette.join()}` : id;
  if (!CACHE.has(key)) CACHE.set(key, createAtlas(id, palette));
  return CACHE.get(key);
}
