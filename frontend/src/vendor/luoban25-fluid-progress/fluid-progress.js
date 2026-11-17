// 来源：https://github.com/luoban25/luoban25.github.io 的 fluid-progress/theme-06-mint-jade/index.html
// 提交 1b89c0d（2026-11-02）。注意：该仓库没有附带开源协议文件。由 src/Capsule.tsx 调用。
// 着色器和弹簧、晃动的物理参数照搬原页面。相对原文的改动（代码里另有标注）：
// 1. 从页面内联脚本改成模块，去掉点击随机切换进度、定时自动切换和标题自动缩放
// 2. 原来把边界限制在 13%–87%，这里放开，边界可以到两端甚至走出画面
// 3. 新增按宽高比的折算（stretch）：进度条比原设计（620 × 146）更扁长时，浪头不被横向拉宽

function hexToRgb01(hex) {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const vertexSource = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const fragmentSource = `
  precision highp float;

  varying vec2 vUv;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uProgress;
  uniform float uMotion;
  uniform float uVelocity;
  uniform float uSlosh;
  uniform float uEnergy;
  uniform vec3 uBaseColor;
  uniform vec3 uFillColor;
  uniform vec3 uDeepColor;
  uniform vec3 uMidColor;
  uniform vec3 uBrightColor;
  uniform vec3 uFoamColor;
  uniform vec3 uRimColor;

  #define TAU 6.28318530718
  // 改动 3：原设计的宽高比（620 / 146）
  #define DESIGN_ASPECT 4.2466

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rot = mat2(0.86, -0.52, 0.52, 0.86);

    for (int i = 0; i < 4; i++) {
      value += noise(p) * amplitude;
      p = rot * p * 2.01 + 5.31;
      amplitude *= 0.5;
    }

    return value;
  }

  vec2 domainWarp(vec2 p, float t) {
    vec2 q = vec2(
      fbm(p * 0.82 + vec2(0.0,  t * 0.055)),
      fbm(p * 0.94 + vec2(0.0, -t * 0.047) + 3.8)
    );

    vec2 r = vec2(
      fbm(p * 1.42 + q * 1.12 + vec2(-t * 0.028, t * 0.020) + 7.1),
      fbm(p * 1.36 + q * 1.18 + vec2( t * 0.024, t * 0.026) - 4.2)
    );

    return p + (q - 0.5) * 0.22 + (r - 0.5) * 0.085;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    // 改动 3：横向尺寸按原设计的宽高比折算
    float stretch = DESIGN_ASPECT / aspect;
    float t = uTime * uMotion;

    // 物理响应浪头：
    // 静止时保持柔和；加速、减速和回弹时，浪幅与倾斜会自然增强。
    float energy = clamp(uEnergy, 0.0, 1.0);
    float speedSign = sign(uVelocity);
    float slowNoise = fbm(vec2(uv.y * 1.58 + 2.7, t * (0.045 + energy * 0.018)));

    float waveGain = 1.0 + energy * 0.72;
    float waveA = sin(uv.y * TAU * 1.12 + t * (0.66 + energy * 0.18)) * 0.0185 * waveGain;
    float waveB = sin(uv.y * TAU * 2.22 - t * (0.43 + energy * 0.14) + 1.25) * 0.0090 * waveGain;
    float waveC = sin(uv.y * TAU * 3.86 + t * 0.27 + 3.10) * 0.0032;

    // 液体惯性：移动方向改变时，上下区域产生轻微滞后与回摆。
    float vertical = uv.y - 0.5;
    float inertiaTilt = vertical * uSlosh * 0.045;
    float inertiaBend = sin(vertical * 3.14159265) * uSlosh * 0.012;
    float velocityPush = vertical * uVelocity * 0.010;

    float waviness =
        waveA
      + waveB
      + waveC
      + (slowNoise - 0.5) * (0.019 + energy * 0.008)
      + inertiaTilt
      + inertiaBend
      + velocityPush;

    // 改动 2、3：原文是 clamp(uProgress + waviness, 0.13, 0.87)，d 也没有折算
    float edge = uProgress + waviness * stretch;
    float d = (uv.x - edge) / stretch;
    float fillMask = 1.0 - smoothstep(-0.006, 0.006, d);

    float behind = max(-d, 0.0);
    float ahead = max(d, 0.0);

    vec3 baseColor = uBaseColor;
    vec3 fillColor = uFillColor;
    vec3 deepTeal = uDeepColor;
    vec3 oceanCyan = uMidColor;
    vec3 brightCyan = uBrightColor;
    vec3 foam = uFoamColor;
    vec3 limeRim = uRimColor;

    vec3 color = mix(baseColor, fillColor, fillMask * 0.88);

    // 拖尾坐标以切面为原点，波纹向左展开。
    vec2 p = vec2(
      behind * DESIGN_ASPECT * 2.45,
      (uv.y - 0.5) * 2.55
    );

    vec2 wp = domainWarp(p, t);
    float bodyA = fbm(wp * vec2(1.08, 0.90) + 1.6);
    float bodyB = fbm(wp * vec2(1.72, 1.28) - 2.9);
    float curl = fbm(vec2(wp.y * 1.95, wp.x * 1.28) + vec2(0.0, t * 0.032));

    // 海浪带：沿切面向左传播，带柔和浪峰和泡沫。
    float phase =
        behind * (35.0 + energy * 8.0)
      + wp.y * (3.05 + energy * 0.55)
      + bodyA * (3.85 + energy * 1.25)
      - t * (0.88 + energy * 0.42)
      - uSlosh * 0.75;

    float waveBand = 0.5 + 0.5 * sin(phase);
    float crest = pow(max(waveBand, 0.0), mix(4.7, 3.5, energy));
    float softBand = smoothstep(0.22, 0.82, waveBand);

    float longTrail = exp(-behind * mix(6.2, 4.8, energy)) * fillMask;
    float midTrail = exp(-behind * mix(11.6, 9.2, energy)) * fillMask;
    float nearTrail = exp(-behind * mix(23.0, 18.5, energy)) * fillMask;

    float oceanBody =
        longTrail
      * smoothstep(0.18, 0.88, bodyA * 0.58 + bodyB * 0.27 + curl * 0.15);

    float rollingWave =
        midTrail
      * softBand
      * (0.58 + 0.42 * bodyA);

    float whiteFoam =
        nearTrail
      * crest
      * smoothstep(0.30, 0.78, bodyB + 0.18);

    color += deepTeal * oceanBody * 0.68;
    color += oceanCyan * rollingWave * 0.72;
    color += brightCyan * nearTrail * (0.18 + bodyA * 0.55) * 0.48;
    color += foam * whiteFoam * (0.46 + energy * 0.30);

    // 浪头：较细亮芯 + 黄绿色能量边 + 宽柔光。
    float core = exp(-abs(d) * 280.0);
    float innerGlow = exp(-abs(d) * 88.0);
    float outerGlow = exp(-abs(d) * 27.0);
    float forwardGlow = exp(-ahead * 36.0) * (1.0 - fillMask);

    float rimBreath = 0.94 + sin(t * (0.76 + energy * 0.22) + uv.y * 4.0) * (0.05 + energy * 0.035);

    color += limeRim * core * (1.46 + energy * 0.34) * rimBreath;
    color += foam * innerGlow * 0.48;
    color += oceanCyan * outerGlow * 0.24;
    color += limeRim * forwardGlow * 0.07;

    // 清理未完成区域，避免拖尾穿透。
    float rightClean = smoothstep(0.055, 0.18, d);
    color = mix(color, baseColor, rightClean * 0.96);

    // 轻微纵向明暗层次，不产生颗粒。
    float verticalShade = 1.0 - abs(uv.y - 0.5) * 0.10;
    color *= verticalShade;

    color = clamp(color, 0.0, 1.0);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// 浏览器不支持 WebGL 或着色器编译失败时返回 null
export function createFluidProgress(canvas, theme) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance'
  });
  if (!gl) return null;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compile failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  let program;

  try {
    const vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);

    program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    }
  } catch (error) {
    console.warn('流体进度条的着色器不可用，改用静态进度。', error);
    return null;
  }

  const vertices = new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1
  ]);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  gl.useProgram(program);

  const position = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    progress: gl.getUniformLocation(program, 'uProgress'),
    motion: gl.getUniformLocation(program, 'uMotion'),
    velocity: gl.getUniformLocation(program, 'uVelocity'),
    slosh: gl.getUniformLocation(program, 'uSlosh'),
    energy: gl.getUniformLocation(program, 'uEnergy'),
    baseColor: gl.getUniformLocation(program, 'uBaseColor'),
    fillColor: gl.getUniformLocation(program, 'uFillColor'),
    deepColor: gl.getUniformLocation(program, 'uDeepColor'),
    midColor: gl.getUniformLocation(program, 'uMidColor'),
    brightColor: gl.getUniformLocation(program, 'uBrightColor'),
    foamColor: gl.getUniformLocation(program, 'uFoamColor'),
    rimColor: gl.getUniformLocation(program, 'uRimColor')
  };

  for (const name of ['baseColor', 'fillColor', 'deepColor', 'midColor', 'brightColor', 'foamColor', 'rimColor']) {
    const [r, g, b] = hexToRgb01(theme[name]);
    gl.uniform3f(uniforms[name], r, g, b);
  }

  // 改动 1：进度从 0 起步，由调用方每帧给出目标值
  let current = 0;
  let velocity = 0;
  let acceleration = 0;

  // Secondary liquid oscillator. It reacts to the front acceleration,
  // producing inertia, overshoot and a short settling motion.
  let slosh = 0;
  let sloshVelocity = 0;
  let energy = 0;
  let elapsed = 0;

  return {
    resize(cssWidth, cssHeight) {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.7);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    },

    // seconds：距上一帧的秒数；target：目标进度 0–1；reduceMotion：系统要求减少动画
    frame(seconds, target, reduceMotion) {
      const dt = Math.min(0.034, Math.max(0.001, seconds));
      elapsed += dt;

      if (reduceMotion) {
        current += (target - current) * Math.min(1, dt * 2.2);
        velocity *= Math.exp(-dt * 10.0);
        slosh *= Math.exp(-dt * 8.0);
        sloshVelocity *= Math.exp(-dt * 10.0);
        acceleration = 0;
        energy += (0.05 - energy) * Math.min(1, dt * 4.0);
      } else {
        // Time-step independent under-damped mass-spring system.
        // It accelerates, slightly overshoots, then settles naturally.
        const angularFrequency = 6.4;
        const dampingRatio = 0.58;
        const spring = angularFrequency * angularFrequency;
        const damping = 2.0 * dampingRatio * angularFrequency;

        acceleration = spring * (target - current) - damping * velocity;
        velocity += acceleration * dt;
        current += velocity * dt;

        // Secondary fluid slosh oscillator, driven by front acceleration.
        const sloshSpring = 48.0;
        const sloshDamping = 6.4;
        const sloshDrive = -acceleration * 0.034;

        const sloshAcceleration =
          sloshDrive
          - sloshSpring * slosh
          - sloshDamping * sloshVelocity;

        sloshVelocity += sloshAcceleration * dt;
        slosh += sloshVelocity * dt;

        const targetEnergy = Math.min(
          1.0,
          Math.abs(velocity) * 1.65
          + Math.abs(sloshVelocity) * 0.16
          + Math.abs(slosh) * 0.42
        );

        const energyRate = targetEnergy > energy ? 8.0 : 2.8;
        energy += (targetEnergy - energy) * Math.min(1, dt * energyRate);
      }

      // 改动 2：原文在 0.15 和 0.87 处回弹，这里放宽到两端之外，浪头可以走出画面
      if (current < -0.25) {
        current = -0.25;
        velocity = Math.abs(velocity) * 0.38;
      } else if (current > 1.25) {
        current = 1.25;
        velocity = -Math.abs(velocity) * 0.38;
      }

      slosh = Math.max(-1.0, Math.min(1.0, slosh));

      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, elapsed);
      gl.uniform1f(uniforms.progress, current);
      gl.uniform1f(uniforms.motion, reduceMotion ? 0.06 : 1.0);
      gl.uniform1f(uniforms.velocity, Math.max(-1.0, Math.min(1.0, velocity)));
      gl.uniform1f(uniforms.slosh, slosh);
      gl.uniform1f(uniforms.energy, energy);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }
  };
}
