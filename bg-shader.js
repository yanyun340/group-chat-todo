/* ============================================================
   背景着色器：主题四色在暖纸底上缓慢晕染漂移 + 细纸噪点。
   原生 WebGL，无依赖。不支持 WebGL 时静默退化为纯 CSS 底色。
   尊重 prefers-reduced-motion：只渲染一帧静止画面。

   注意：改 canvas.width/height 会重置 WebGL 上下文状态
   （program / buffer / attribute 绑定全部丢失、drawing buffer 清空），
   所以 resize 时必须重新绑定，并立即重绘一帧。
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    powerPreference: 'low-power'
  });
  if (!gl) return; // 无 WebGL → 用 .bg 的 CSS 底色

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

  var FRAG = [
    'precision mediump float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec2 u_mouse;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise(vec2 p){',
    '  vec2 i=floor(p),f=fract(p);',
    '  vec2 u=f*f*(3.-2.*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),',
    '             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);',
    '}',
    'void main(){',
    '  vec2 uv=gl_FragCoord.xy/u_res.xy;',
    '  vec2 p=vec2(uv.x*u_res.x/u_res.y,uv.y);',
    '  float t=u_time*0.06;',           // 极慢漂移
    '  vec3 paper=vec3(0.957,0.937,0.902);',   // 暖纸底 #F4EFE6
    '  vec3 c1=vec3(0.851,0.714,0.290);',      // 芥末黄
    '  vec3 c2=vec3(0.231,0.298,0.620);',      // 靛蓝
    '  vec3 c3=vec3(0.796,0.431,0.369);',      // 陶土
    '  vec3 c4=vec3(0.455,0.698,0.576);',      // 灰绿
    '  vec3 col=paper;',
    '  float d;vec2 q;',
    '  q=p+vec2(sin(t*1.2),cos(t*.9))*.5;d=length(q-vec2(.30,.35));col=mix(col,c1,smoothstep(.75,0.,d)*.22);',
    '  q=p+vec2(cos(t),sin(t*1.3))*.6;d=length(q-vec2(1.35,.70));col=mix(col,c2,smoothstep(.85,0.,d)*.18);',
    '  q=p+vec2(sin(t*.8),cos(t*1.1))*.5;d=length(q-vec2(.90,1.30));col=mix(col,c3,smoothstep(.80,0.,d)*.16);',
    '  q=p+vec2(cos(t*1.2),sin(t*.7))*.55;d=length(q-vec2(1.60,.20));col=mix(col,c4,smoothstep(.70,0.,d)*.18);',
    '  vec2 m=vec2(u_mouse.x*u_res.x/u_res.y,u_mouse.y);',
    '  float dm=length(p-m);',
    '  col=mix(col,c1,smoothstep(.7,0.,dm)*.28);',   // 鼠标附近芥末黄微光
    '  float n=noise(p*300.);',
    '  col+=(n-.5)*.025;',              // 细纸噪点
    '  gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

  // 全屏四边形（两个三角形）
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  var loc = gl.getAttribLocation(prog, 'a');
  var uRes = gl.getUniformLocation(prog, 'u_res');
  var uTime = gl.getUniformLocation(prog, 'u_time');
  var uMouse = gl.getUniformLocation(prog, 'u_mouse');
  var mouse = new Float32Array([-1, -1]); // 初始屏幕外，无光晕

  // canvas 尺寸改变会重置 context 状态，把绑定收成一个函数，resize 时重放
  function bindState() {
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }
  bindState();

  function draw(time) {
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, time);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function resize() {
    // 用 CSS 像素（不乘 DPR）：纯渐变/色斑，低分辨率视觉无损，省 GPU
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    bindState();          // 尺寸改变重置了状态，重新绑定
    if (reduce) draw(0);  // 静止模式下无 rAF 循环，resize 后必须手动重绘，否则黑屏
  }
  window.addEventListener('resize', resize);
  resize();

  if (reduce) {
    draw(0); // 静止一帧
    return;
  }

  // 鼠标光晕：只在有精确指针（鼠标/触控板）时启用，触屏不跟手
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    window.addEventListener('pointermove', function (e) {
      mouse[0] = e.clientX / window.innerWidth;
      mouse[1] = 1 - e.clientY / window.innerHeight;
    }, { passive: true });
  }

  var raf;
  function frame(now) {
    draw(now * 0.001);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // 退出时停掉循环（本页一般不会触发，但保持干净）
  window.addEventListener('pagehide', function () {
    if (raf) cancelAnimationFrame(raf);
  });
})();
