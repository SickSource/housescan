// WebGL2 helpers: point-cloud renderer (used in AR and in the viewer)
// and a camera-image grabber that downsamples the AR camera texture.

export function createProgram(gl, vsSrc, fsSrc) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  return p;
}

const POINT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aCol;
layout(location=2) in float aCnt;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uSize;
uniform float uMinObs;
uniform float uClipY;
uniform int uMode;
uniform vec2 uYRange;
out vec3 vCol;
vec3 ramp(float t) {
  return clamp(vec3(1.5 - abs(4.0*t - 3.0), 1.5 - abs(4.0*t - 2.0), 1.5 - abs(4.0*t - 1.0)), 0.0, 1.0);
}
void main() {
  if (aCnt < uMinObs || aPos.y > uClipY) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec3(0.0);
    return;
  }
  vec4 vp = uView * vec4(aPos, 1.0);
  gl_Position = uProj * vp;
  gl_PointSize = clamp(uSize / max(-vp.z, 0.05), 1.0, 24.0);
  if (uMode == 1) vCol = ramp(clamp((aPos.y - uYRange.x) / max(uYRange.y - uYRange.x, 0.01), 0.0, 1.0));
  else vCol = aCol;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vCol;
uniform float uAlpha;
out vec4 o;
void main() { o = vec4(vCol, uAlpha); }`;

export class PointRenderer {
  constructor(gl, capacity) {
    this.gl = gl;
    this.capacity = capacity;
    this.prog = createProgram(gl, POINT_VS, POINT_FS);
    this.u = {};
    for (const n of ['uProj', 'uView', 'uSize', 'uMinObs', 'uClipY', 'uMode', 'uYRange', 'uAlpha']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 12, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 3, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    this.cntBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cntBuf);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 2, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_SHORT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.uploaded = 0;
  }

  /** Uploads points added since the last call. */
  sync(cloud) {
    const gl = this.gl;
    const from = this.uploaded, to = Math.min(cloud.count, this.capacity);
    if (to <= from) return;
    const n = to - from;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, from * 12, cloud.pos, from * 3, n * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, from * 3, cloud.col, from * 3, n * 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cntBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, from * 2, cloud.score, from, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.uploaded = to;
  }

  uploadAll(cloud) { this.uploaded = 0; this.sync(cloud); }

  draw(proj, view, o = {}) {
    const gl = this.gl, u = this.u;
    if (!this.uploaded) return;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uSize, o.size ?? 100);
    gl.uniform1f(u.uMinObs, o.minObs ?? 0);
    gl.uniform1f(u.uClipY, o.clipY ?? 1e9);
    gl.uniform1i(u.uMode, o.mode ?? 0);
    gl.uniform2f(u.uYRange, o.yMin ?? 0, o.yMax ?? 3);
    gl.uniform1f(u.uAlpha, o.alpha ?? 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.uploaded);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteBuffer(this.posBuf); gl.deleteBuffer(this.colBuf); gl.deleteBuffer(this.cntBuf);
    gl.deleteVertexArray(this.vao); gl.deleteProgram(this.prog);
  }
}

const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const QUAD_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main() { o = texture(uTex, vUv); }`;

/**
 * Renders the (opaque, browser-owned) WebXR camera texture into a tiny
 * framebuffer — one pixel per depth sample — and reads it back to the CPU.
 */
export class CameraGrabber {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, QUAD_VS, QUAD_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.uTex = gl.getUniformLocation(this.prog, 'uTex');
    this.w = 0; this.h = 0; this.fb = null; this.tex = null; this.buf = null;
  }

  _ensure(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    if (this.fb) { gl.deleteFramebuffer(this.fb); gl.deleteTexture(this.tex); }
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.w = w; this.h = h;
    this.buf = new Uint8Array(w * h * 4);
  }

  /** Returns RGBA rows bottom-up (gl.readPixels order). */
  read(cameraTexture, w, h) {
    const gl = this.gl;
    this._ensure(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    {
      // Make sure the texture is sampleable without mipmaps. Harmless if the
      // browser forbids touching its opaque texture (it just sets a GL error).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.getError();
    }
    gl.uniform1i(this.uTex, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.buf;
  }
}
