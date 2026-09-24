// Прототип: точки (шлейф, свечение, ядро) рисуются WebGL-слоем поверх p5-канвы.
(function () {
  const stage = document.getElementById('stage');
  stage.style.position = 'relative';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  stage.appendChild(cv);
  const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  window.__gl = gl; window.__glCanvas = cv;
  const VS = `
    attribute vec2 a_pos; attribute float a_size; attribute vec4 a_col;
    uniform vec2 u_res; uniform float u_dpr;
    varying vec4 v_col; varying float v_size;
    void main(){
      vec2 c = a_pos / u_res * 2.0 - 1.0;
      gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
      gl_PointSize = a_size * u_dpr; v_size = a_size * u_dpr; v_col = a_col;
    }`;
  const FS = `
    precision mediump float;
    varying vec4 v_col; varying float v_size; uniform int u_kind;
    void main(){
      float a = v_col.a;
      if (u_kind == 1) { // свечение: тот же профиль, что у спрайта (0 -> 1, 0.32 -> 0.48, 1 -> 0)
        float d = length(gl_PointCoord * 2.0 - 1.0);
        float p = d < 0.32 ? mix(1.0, 0.48, d / 0.32) : mix(0.48, 0.0, clamp((d - 0.32) / 0.68, 0.0, 1.0));
        a *= p;
      } else if (u_kind == 2) { // ядро точки: круг со сглаженным краем
        float r = v_size * 0.5;
        float d = length(gl_PointCoord * 2.0 - 1.0) * r;
        a *= clamp(r - d + 0.5, 0.0, 1.0);
      }
      gl_FragColor = vec4(v_col.rgb * a, a);
    }`;
  function sh(t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = { pos: gl.getAttribLocation(prog, 'a_pos'), size: gl.getAttribLocation(prog, 'a_size'), col: gl.getAttribLocation(prog, 'a_col'),
    res: gl.getUniformLocation(prog, 'u_res'), dpr: gl.getUniformLocation(prog, 'u_dpr'), kind: gl.getUniformLocation(prog, 'u_kind') };
  const STRIDE = 7; // x y size r g b a
  const MAXP = 60000;
  const trailBuf = new Float32Array(MAXP * 6 * STRIDE);
  const glowBuf = new Float32Array(MAXP * STRIDE);
  const dotBuf = new Float32Array(MAXP * STRIDE);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, trailBuf.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.size); gl.enableVertexAttribArray(loc.col);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  function bindAttribs() {
    gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, STRIDE * 4, 0);
    gl.vertexAttribPointer(loc.size, 1, gl.FLOAT, false, STRIDE * 4, 8);
    gl.vertexAttribPointer(loc.col, 4, gl.FLOAT, false, STRIDE * 4, 12);
  }
  function upload(arr, count, mode, kind) {
    if (!count) return;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, count * STRIDE));
    bindAttribs();
    gl.uniform1i(loc.kind, kind);
    gl.drawArrays(mode, 0, count);
  }
  window.drawDotsGL = function (glow, trail) {
    const dpr = pixelDensity();
    const W = width, H = height;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    cv.style.width = '100%'; cv.style.height = '100%';
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(loc.res, W, H); gl.uniform1f(loc.dpr, dpr);
    const now = millis();
    const useHsb = cloudMixAmount > 0.3;
    let nt = 0, ng = 0, nd = 0;
    const cx = W / 2, cy = H / 2;
    const n = activePoints.length;
    for (let i = 0; i < n; i++) {
      const p = activePoints[i];
      const fl = p.flashUntil > now;
      const r = (fl ? 255 : p.r) / 255, g = (fl ? 255 : p.g) / 255, b = (fl ? 255 : p.b) / 255, a = (fl ? 255 : p.a) / 255;
      const s = p.scale;
      const sx = cx + (p.px - cx) * s, sy = cy + (p.py - cy) * s;
      if (trail > 0) {
        const len = 72 * trail;
        const tx = cx + (p.px - p.vx * len - cx) * s, ty = cy + (p.py - p.vy * len - cy) * s;
        const w = DOT_SIZE * p.breathe * s * (0.55 + trail * 0.25) * 0.5;
        let dx = tx - sx, dy = ty - sy; const L = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / L * w, ny = dx / L * w;
        const ta = a * trail * 0.42;
        const o = nt * STRIDE;
        const v = [sx + nx, sy + ny, sx - nx, sy - ny, tx + nx, ty + ny, tx + nx, ty + ny, sx - nx, sy - ny, tx - nx, ty - ny];
        for (let k = 0; k < 6; k++) { const q = o + k * STRIDE; trailBuf[q] = v[k * 2]; trailBuf[q + 1] = v[k * 2 + 1]; trailBuf[q + 2] = 1; trailBuf[q + 3] = r; trailBuf[q + 4] = g; trailBuf[q + 5] = b; trailBuf[q + 6] = ta; }
        nt += 6;
      }
      if (glow > 0) {
        const radius = (DOT_SIZE * 0.9 + (10 - DOT_SIZE * 0.9) * glow) * p.breathe * s * (fl ? 1.6 : 1);
        const ga = a * glow * (fl ? 0.32 : 0.18);
        let gr = r, gg = g, gb = b;
        if (useHsb) { gr = cloudMixR / 255; gg = cloudMixG / 255; gb = cloudMixB / 255; }
        else if (!fl) { const c = glowSprites[p.glowBucket]; /* цвет корзины = tigle-цвет точки */ gr = p.tigleR / 255; gg = p.tigleG / 255; gb = p.tigleB / 255; }
        const o = ng * STRIDE;
        glowBuf[o] = sx; glowBuf[o + 1] = sy; glowBuf[o + 2] = radius * 2; glowBuf[o + 3] = gr; glowBuf[o + 4] = gg; glowBuf[o + 5] = gb; glowBuf[o + 6] = ga;
        ng++;
      }
      const o = nd * STRIDE;
      dotBuf[o] = sx; dotBuf[o + 1] = sy; dotBuf[o + 2] = DOT_SIZE * p.breathe * s * (fl ? 1.3 : 1); dotBuf[o + 3] = r; dotBuf[o + 4] = g; dotBuf[o + 5] = b; dotBuf[o + 6] = a;
      nd++;
    }
    upload(trailBuf, nt, gl.TRIANGLES, 0);
    upload(glowBuf, ng, gl.POINTS, 1);
    upload(dotBuf, nd, gl.POINTS, 2);
  };
})();
