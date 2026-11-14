/* Kemet, the little guardian of the Black Land: TerraPulse's guide and AI companion.
   Named after Kemet, "the Black Land", the ancient Egyptian name for the fertile Nile soil.
   Drawn in SVG from the team's character design: black visor with big turquoise eyes, a gold
   forehead band and gold headphones, an antenna with a turquoise light, a leaf sprouting on top,
   a cream and black body with a glowing leaf on the chest, and a brown scarf with gold triangles.
   In the "hold" pose he projects a small map of the Delta with the Nile running through it.
   kemetSVG({ pose: "rest"|"wave"|"point"|"hold", face: "neutral"|"happy"|"think"|"wow"|"wink", head: bool })
   (samiSVG is kept as an alias so older calls keep working.) */
"use strict";

let kemetN = 0;
function kemetSVG(opt = {}) {
  const pose = opt.pose || "rest", face = opt.face || "neutral", head = !!opt.head;
  const n = ++kemetN, id = (s) => `k${s}${n}`;
  const cream = "#EADFC6", creamD = "#CDBF9F", soil = "#17130E", soil2 = "#2A231A", gold = "#D4A24C", goldD = "#9C7330",
        nile = "#3FD9CF", leaf = "#7CC35A", leafD = "#3F8A35", cape = "#6E4B2C", capeD = "#4F341D";

  // eyes: turquoise rings with dark pupils and a white glint, like the reference
  const ring = (cx, cy, r = 12.5, look = [0, 0]) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${nile}"/><circle cx="${cx + look[0]}" cy="${cy + look[1]}" r="${r - 4.2}" fill="#0B1F1E"/>` +
    `<circle cx="${cx + look[0] + 3}" cy="${cy + look[1] - 3.4}" r="2.8" fill="#fff"/><circle cx="${cx + look[0] - 2.6}" cy="${cy + look[1] + 3}" r="1.1" fill="#fff" opacity=".7"/>`;
  const arc = (cx, cy) => `<path d="M${cx - 9} ${cy + 3}q9-11 18 0" fill="none" stroke="${nile}" stroke-width="4.6" stroke-linecap="round"/>`;
  const eyes = {
    neutral: ring(82, 80) + ring(118, 80),
    happy: arc(82, 80) + arc(118, 80),
    think: ring(82, 80, 12.5, [2.5, -3]) + ring(118, 80, 12.5, [2.5, -3]),
    wow: ring(82, 80, 14) + ring(118, 80, 14),
    wink: arc(82, 80) + ring(118, 80),
  }[face] || ring(82, 80) + ring(118, 80);
  const mouth = {
    neutral: `<path d="M94 99q6 5 12 0"/>`, happy: `<path d="M91 97q9 9 18 0"/>`, think: `<path d="M95 101h9"/>`,
    wow: `<ellipse cx="100" cy="101" rx="3.4" ry="4.4" fill="${nile}" stroke="none"/>`, wink: `<path d="M91 97q9 9 18 0"/>`,
  }[face] || "";

  const armR = {
    rest: `<path class="arm" d="M134 138q10 18 11 36"/><circle class="glove" cx="145" cy="178" r="9.5"/>`,
    wave: `<g class="arm-wave"><path class="arm" d="M134 136q16-10 23-34"/><circle class="glove" cx="158" cy="98" r="9.5"/><path d="M152 91l-3-7M158 89v-8M164 91l3-7" stroke="${soil}" stroke-width="3.2" stroke-linecap="round" fill="none"/></g>`,
    point: `<g class="arm-point"><path class="arm" d="M134 140q18-2 33-10"/><circle class="glove" cx="170" cy="128" r="9.5"/><path d="M176 125l12-5" stroke="${soil}" stroke-width="5" stroke-linecap="round"/></g>`,
    hold: `<path class="arm" d="M134 140q14 6 16 20"/><circle class="glove" cx="151" cy="164" r="9.5"/>
      <g class="holo" transform="translate(151 146)">
        <ellipse cx="0" cy="12" rx="13" ry="3.4" fill="${nile}" opacity=".55"/>
        <path d="M-10 10L-20-14h40L10 10z" fill="${nile}" opacity=".12"/>
        <path d="M-22-18l22-9 22 9-22 9z" fill="#2E6B4A" stroke="${nile}" stroke-width="1.4" opacity=".95"/>
        <path d="M-22-18v5l22 9 22-9v-5" fill="none" stroke="${nile}" stroke-width="1.2" opacity=".8"/>
        <path d="M-1-26c2 4-3 7 0 10s4 6 1 9" fill="none" stroke="${nile}" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M0-12l-6 3M0-12l6 3M0-15l-9 4M0-15l9 4" stroke="${leaf}" stroke-width="1" opacity=".9"/>
      </g>`,
  }[pose];
  const armL = pose === "hold"
    ? `<path class="arm" d="M66 140q-10 16 2 28"/><circle class="glove" cx="70" cy="170" r="9.5"/>`
    : `<path class="arm" d="M66 138q-10 18-11 36"/><circle class="glove" cx="55" cy="178" r="9.5"/>`;

  const tri = (x, y) => `<path d="M${x} ${y}l4-7 4 7z" fill="${gold}" opacity=".85"/>`;
  const body = head ? "" : `
    <path d="M60 128q-16 40-6 78l26-6q-8-34 0-66z" fill="${capeD}"/>
    <path d="M140 128q16 40 6 78l-26-6q8-34 0-66z" fill="${capeD}"/>
    <rect x="74" y="186" width="22" height="30" rx="9" fill="${cream}" stroke="${creamD}" stroke-width="2"/>
    <rect x="104" y="186" width="22" height="30" rx="9" fill="${cream}" stroke="${creamD}" stroke-width="2"/>
    <rect x="68" y="208" width="32" height="18" rx="8.5" fill="${soil}"/><rect x="100" y="208" width="32" height="18" rx="8.5" fill="${soil}"/>
    <circle cx="80" cy="217" r="3.2" fill="none" stroke="${nile}" stroke-width="1.6"/><circle cx="120" cy="217" r="3.2" fill="none" stroke="${nile}" stroke-width="1.6"/>
    <g class="arm-l" fill="none" stroke="${cream}" stroke-width="16" stroke-linecap="round">${armL}</g>
    <rect x="64" y="122" width="72" height="72" rx="26" fill="${soil}" stroke="${gold}" stroke-width="2"/>
    <path d="M70 182q30 10 60 0" fill="none" stroke="${nile}" stroke-width="2" opacity=".8"/>
    <path d="M100 166c-8-4-11-10-11-17 6 1 10 5 11 11 1-6 5-10 11-11 0 7-3 13-11 17z" fill="${nile}"/>
    <path d="M100 166v-14" stroke="${soil}" stroke-width="1.4"/>
    <path d="M58 122q42 24 84 0l5 13q-47 27-94 0z" fill="${cape}" stroke="${capeD}" stroke-width="1.5"/>
    ${tri(66, 134)}${tri(78, 139)}${tri(90, 142)}${tri(102, 142)}${tri(114, 139)}${tri(126, 134)}
    <ellipse cx="64" cy="134" rx="12" ry="9" fill="${cream}" stroke="${creamD}" stroke-width="2"/>
    <ellipse cx="136" cy="134" rx="12" ry="9" fill="${cream}" stroke="${creamD}" stroke-width="2"/>
    <g class="arm-r" fill="none" stroke="${cream}" stroke-width="16" stroke-linecap="round">${armR}</g>`;

  return `<svg class="sami kemet ${head ? "sami-head" : ""} pose-${pose} face-${face}" viewBox="${head ? "18 -2 164 136" : "0 -6 200 242"}" role="img" aria-label="Kemet, the TerraPulse guide${pose === "wave" ? ", waving" : ""}">
  <defs>
    <radialGradient id="${id("hg")}" cx=".35" cy=".25" r=".85"><stop offset="0" stop-color="#FFF8E8"/><stop offset=".6" stop-color="${cream}"/><stop offset="1" stop-color="${creamD}"/></radialGradient>
    <linearGradient id="${id("vg")}" x1="0" y1="0" x2=".2" y2="1"><stop offset="0" stop-color="${soil2}"/><stop offset="1" stop-color="${soil}"/></linearGradient>
    <filter id="${id("gl")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <style>.kemet .glove{fill:${soil};stroke:none}</style>
  <g class="sami-float">
    ${body}
    <path d="M138 40q8-14 12-28" fill="none" stroke="${soil}" stroke-width="3.6" stroke-linecap="round"/>
    <circle class="sami-ant" cx="150" cy="10" r="6" fill="${nile}" filter="url(#${id("gl")})"/>
    <path d="M100 34q-2-10-1-16" stroke="${leafD}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
    <path d="M99 22c-9-1-17-6-20-15 9-1 18 4 20 15z" fill="${leaf}" stroke="${leafD}" stroke-width="1.4"/>
    <path d="M100 20c3-10 11-16 22-16-2 10-10 16-22 16z" fill="${leaf}" stroke="${leafD}" stroke-width="1.4"/>
    <path d="M86 12l12 9M104 18l13-11" stroke="${leafD}" stroke-width="1" opacity=".7"/>
    <rect x="46" y="30" width="108" height="94" rx="45" fill="url(#${id("hg")})" stroke="${creamD}" stroke-width="2"/>
    <path d="M58 46q42-26 84 0l-4 9q-38-20-76 0z" fill="${gold}" stroke="${goldD}" stroke-width="1.5"/>
    <path d="M92 41l8 8 8-8" fill="none" stroke="${goldD}" stroke-width="2" stroke-linejoin="round"/>
    <rect x="56" y="52" width="88" height="62" rx="30" fill="url(#${id("vg")})" stroke="${goldD}" stroke-width="2"/>
    <path d="M68 62q8-6 20-7" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>
    <g class="ear"><circle cx="46" cy="82" r="15" fill="${gold}" stroke="${goldD}" stroke-width="2"/><circle cx="46" cy="82" r="9.5" fill="${soil}"/><circle cx="46" cy="82" r="6" fill="none" stroke="${nile}" stroke-width="2.2"/></g>
    <g class="ear"><circle cx="154" cy="82" r="15" fill="${gold}" stroke="${goldD}" stroke-width="2"/><circle cx="154" cy="82" r="9.5" fill="${soil}"/><circle cx="154" cy="82" r="6" fill="none" stroke="${nile}" stroke-width="2.2"/></g>
    <g class="sami-eyes" filter="url(#${id("gl")})">${eyes}</g>
    <g fill="none" stroke="${nile}" stroke-width="3" stroke-linecap="round">${mouth}</g>
  </g>
</svg>`;
}
const samiSVG = kemetSVG;
