/* The TerraPulse globe: a small procedural Earth rendered per pixel on a canvas,
   in the same stylised spirit as the proposal video. Its signature is the
   "dawn line": the day/night boundary glows gold, like the sun over the Nile.
   Pauses when off screen and when "reduce motion" is on. */
"use strict";

const Globe = (() => {
  const TW = 512, TH = 256;
  const tex = new Uint8Array(TW * TH), lights = new Uint8Array(TW * TH);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const nz = (x, y, z) => Math.sin(x * 2.1 + .7) * Math.cos(y * 2.6 - .9) + Math.sin(z * 2.9 + x * 1.5) * Math.cos(y * 1.7 + z * 2.4)
    + .5 * Math.sin(x * 5.7 + y * 4.9 + z * 4.1) + .3 * Math.cos(y * 8.9 - x * 6.3 + z * 3.3) + .18 * Math.sin(x * 13 + z * 11) * Math.cos(y * 12);
  for (let j = 0; j < TH; j++) {
    const la = (.5 - (j + .5) / TH) * Math.PI;
    for (let i = 0; i < TW; i++) {
      const lo = (i + .5) / TW * 2 * Math.PI;
      const v = nz(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
      tex[j * TW + i] = Math.max(0, Math.min(255, 128 + v * 52));
      lights[j * TW + i] = (v > -.05 && rnd() < .08) ? 1 : 0;
    }
  }

  function make(canvas) {
    const ctx = canvas.getContext("2d");
    let S = 0, img, D, pr, pc, pl, pn, raf = 0, rot = 2.2, visible = true, last = 0;
    const L = [-.62, .38, .69], ln = Math.hypot(...L);
    function setup() {
      const css = canvas.getBoundingClientRect();
      const want = Math.round(Math.min(600, Math.max(220, css.width * .72)));   // drawn a bit smaller and scaled up by the browser
      if (want === S) return;
      S = want; canvas.width = canvas.height = S;
      img = ctx.createImageData(S, S); D = img.data;
      pr = new Int16Array(S * S).fill(-1); pc = new Int16Array(S * S); pl = new Float32Array(S * S); pn = new Float32Array(S * S);
      const tl = .36, ct = Math.cos(tl), st = Math.sin(tl);
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const nx = (px + .5 - S / 2) / (S / 2 * .86), ny = -(py + .5 - S / 2) / (S / 2 * .86), r2 = nx * nx + ny * ny;
        const i = py * S + px;
        if (r2 >= 1) { pn[i] = Math.sqrt(r2); continue; }
        const nzv = Math.sqrt(1 - r2), y2 = ny * ct + nzv * st, z2 = -ny * st + nzv * ct;
        pr[i] = Math.max(0, Math.min(TH - 1, ((.5 - Math.asin(y2) / Math.PI) * TH) | 0));
        pc[i] = ((Math.atan2(z2, nx) / (2 * Math.PI) + .5) * TW) | 0;
        pl[i] = (nx * L[0] + ny * L[1] + nzv * L[2]) / ln; pn[i] = nzv;
      }
    }
    /* Everything that does not change while the globe turns (lighting, dawn glow, rim, edge, the ocean,
       the halo) is computed once per size; each frame then only looks up the turning land. */
    let prepS = 0, disc, dayA, addR, addG, addB, edgeA, oR, oG, oB, polar;
    const landLUT = new Uint8Array(256 * 3);
    for (let h = 0; h < 256; h++) { const e = Math.max(0, Math.min(1, (h - 124) / 60));
      landLUT[h * 3] = 46 + e * 92; landLUT[h * 3 + 1] = 104 + e * 36; landLUT[h * 3 + 2] = 70 + e * 6; }
    function prep() {
      prepS = S;
      const n = S * S, list = [];
      dayA = new Float32Array(n); addR = new Float32Array(n); addG = new Float32Array(n); addB = new Float32Array(n);
      edgeA = new Uint8Array(n); oR = new Uint8Array(n); oG = new Uint8Array(n); oB = new Uint8Array(n); polar = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * 4, r = pr[i];
        if (r < 0) {                                   // atmosphere halo outside the disc: drawn once
          const d = pn[i], a = d < 1.14 ? Math.pow(1 - (d - 1) / .14, 2.2) : 0;
          D[o] = 63; D[o + 1] = 217; D[o + 2] = 207; D[o + 3] = a * 100; continue;   // Nile-turquoise atmosphere
        }
        list.push(i);
        const lam = pl[i], day = Math.max(0, Math.min(1, (lam + .1) * 2.4));
        const dawn = Math.exp(-Math.pow((lam + .02) / .07, 2));
        const rim = Math.pow(1 - pn[i], 2.6) * (.3 + .9 * day);
        dayA[i] = day;
        addR[i] = 235 * dawn * .6 + 50 * rim; addG[i] = 170 * dawn * .5 + 190 * rim; addB[i] = 60 * dawn * .3 + 185 * rim;   // golden dawn line, turquoise rim
        edgeA[i] = 255 * Math.min(1, pn[i] * S * .43 / 1.2);
        polar[i] = r < 14 || r > TH - 14 ? 1 : 0;
        const R = 3 + (12 + lam * 30 - 3) * day + addR[i], G = 8 + (60 + lam * 52 - 8) * day + addG[i], B = 28 + (140 + lam * 50 - 28) * day + addB[i];
        oR[i] = R > 255 ? 255 : R; oG[i] = G > 255 ? 255 : G; oB[i] = B > 255 ? 255 : B;
      }
      disc = Int32Array.from(list);
    }
    function frame() {
      if (prepS !== S) prep();
      const sh = ((rot / (2 * Math.PI)) * TW) | 0;
      for (let k = 0; k < disc.length; k++) {
        const i = disc[k], o = i * 4;
        const idx = pr[i] * TW + ((pc[i] + sh) & (TW - 1)), h = tex[idx];
        D[o + 3] = edgeA[i];
        if (h <= 124) { D[o] = oR[i]; D[o + 1] = oG[i]; D[o + 2] = oB[i]; continue; }   // ocean: precomputed
        const day = dayA[i];
        let R, G, B;
        if (polar[i]) { R = 226; G = 236; B = 248; } else { R = landLUT[h * 3]; G = landLUT[h * 3 + 1]; B = landLUT[h * 3 + 2]; }
        R = 6 + (R - 6) * day; G = 12 + (G - 12) * day; B = 32 + (B - 32) * day;
        if (lights[idx] && day < .5) { const f = 1 - day * 2; R += 255 * f; G += 200 * f; B += 130 * f; }
        R += addR[i]; G += addG[i]; B += addB[i];
        D[o] = R > 255 ? 255 : R; D[o + 1] = G > 255 ? 255 : G; D[o + 2] = B > 255 ? 255 : B;
      }
      ctx.putImageData(img, 0, 0);
    }
    function loop(t) {
      raf = 0;
      if (!visible) return;
      if (t - last > 80) { rot += .0026 * Math.min(6, (t - last) / 16 || 1); last = t; frame(); }   // ~12 frames/s is plenty for a slow spin
      if (!Prefs.get("reduceMotion")) raf = requestAnimationFrame(loop);
    }
    function start() { setup(); frame(); if (!raf && !Prefs.get("reduceMotion")) raf = requestAnimationFrame(loop); }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
    const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; visible ? start() : stop(); });
    io.observe(canvas);
    let rz = 0; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { setup(); frame(); }, 200); });
    Bus.on("pref", ({ k }) => { if (k === "reduceMotion") { stop(); start(); } });
    return { start, stop };
  }
  return { make };
})();
