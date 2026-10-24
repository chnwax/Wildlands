// Pictures of the things you can buy and carry (items.js look: [kind, ...colours]), drawn as small flat illustrations
// in ink-outlined SVG: a can, a bottle, a rice ball in its wrapper, a bowl of ramen with its toppings. Each picture is
// drawn at its item's own proportions (its bag cells, sz: 32 units a cell), so a bottle stands tall in a bag and a bento
// lies wide. iconSVG(item) -> '<svg ...>…</svg>'.
const INK = '#2b2420', SW = 1.6;
const P = (d, fill, x = '') => `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round" ${x}/>`;
const R = (x, y, w, h, rx, fill, x2 = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" ${x2}/>`;
const C = (cx, cy, r, fill, x2 = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" ${x2}/>`;
const E = (cx, cy, rx, ry, fill, x2 = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width="${SW}" ${x2}/>`;
const N = (s, sw = 0) => s.replace(/stroke-width="[\d.]+"/g, `stroke-width="${sw}"`).replace(/stroke="[^"]+"/g, sw ? `stroke="${INK}"` : 'stroke="none"'); // (a shape without its outline)
const HI = (x, y, w, h, rx = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#fff" opacity=".38"/>`;
const T = (x, y, s, fill, txt, w = 700) => `<text x="${x}" y="${y}" font-size="${s}" font-weight="${w}" fill="${fill}" text-anchor="middle" font-family="Segoe UI, sans-serif">${txt}</text>`;

const DRAW = {
  // ---- drinks
  pet: (cap, liquid, label) => P('M12 11 L20 11 L20 16 Q26 20 26 28 L26 86 Q26 91 21 91 L11 91 Q6 91 6 86 L6 28 Q6 20 12 16 Z', '#eef5f8')
    + N(P('M7 34 L25 34 L25 86 Q25 90 21 90 L11 90 Q7 90 7 86 Z', liquid, 'opacity=".85"')) + R(6, 44, 20, 24, 1, label) + `<rect x="9" y="50" width="14" height="3" fill="#fff" opacity=".7"/><rect x="9" y="56" width="9" height="2" fill="#fff" opacity=".55"/>`
    + R(11, 4, 10, 8, 1.5, cap) + HI(9, 26, 2.5, 58),
  can: (body, band, txt) => R(5, 9, 22, 50, 4, body) + E(16, 9.5, 11, 3, '#c9ccd0') + N(`<rect x="6" y="26" width="20" height="16" fill="${band}"/>`) + `<line x1="5" y1="26" x2="27" y2="26" stroke="${INK}" stroke-width="1"/><line x1="5" y1="42" x2="27" y2="42" stroke="${INK}" stroke-width="1"/>`
    + T(16, 37, txt.length > 3 ? 6.4 : 8, body, txt) + HI(8, 14, 2.5, 40),
  ramune: () => P('M12 4 L20 4 L20 12 Q24 16 22 20 Q20 23 22 26 Q27 30 27 38 L27 58 Q27 61 24 61 L8 61 Q5 61 5 58 L5 38 Q5 30 10 26 Q12 23 10 20 Q8 16 12 12 Z', '#bfe6ef', 'opacity=".95"')
    + C(16, 19, 3.6, '#e9fbff') + N(`<rect x="6" y="40" width="20" height="10" fill="#2f86c4"/>`) + T(16, 48, 6.5, '#fff', 'ラムネ', 600) + HI(8, 30, 2.5, 26) + R(11, 2, 10, 4, 1.5, '#2f86c4'),
  vial: () => R(9, 9, 14, 21, 3, '#6b3410') + R(11, 3, 10, 7, 1.5, '#d9b04a') + N(`<rect x="10" y="15" width="12" height="9" fill="#f2d68a"/>`) + `<rect x="13" y="18" width="6" height="2" fill="#b3261e"/>` + HI(11, 11, 2, 16, 1),
  // ---- konbini
  onigiri: fill => P('M32 7 Q37 7 41 14 L56 42 Q61 52 52 56 Q42 59 32 59 Q22 59 12 56 Q3 52 8 42 L23 14 Q27 7 32 7 Z', '#fbfaf3')
    + N(P('M23 36 L41 36 L43 59 L21 59 Z', '#203226')) + `<path d="M23 36 L41 36 L43 59 L21 59 Z" fill="none" stroke="${INK}" stroke-width="1.2"/>` + C(32, 26, 5, fill)
    + `<path d="M8 44 Q32 49 56 44" fill="none" stroke="#d23c2a" stroke-width="2.2"/>` + HI(25, 14, 3, 12, 1.5),
  sando: () => P('M6 54 L30 10 L30 54 Z', '#f7efdc') + P('M34 54 L58 10 L58 54 Z', '#f7efdc') + N(P('M10 54 L28 21 L28 54 Z', '#f4cf4a')) + N(P('M38 54 L56 21 L56 54 Z', '#f4cf4a'))
    + `<path d="M6 54 L30 10 L30 54 Z M34 54 L58 10 L58 54 Z" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` + R(4, 50, 56, 8, 2, '#d9e6ef', 'opacity=".7"'),
  bento: () => R(4, 8, 120, 80, 8, '#1d1a19') + R(8, 12, 112, 72, 5, '#b3261e') + R(12, 16, 50, 64, 4, '#f8f6ef') + C(37, 48, 5, '#c0233a')
    + C(78, 30, 9, '#b8742c') + C(96, 34, 9, '#a9682a') + C(84, 48, 9, '#c07d33') + R(66, 60, 22, 16, 3, '#f2cd4a') + P('M94 58 Q104 52 114 60 Q112 76 98 76 Q92 70 94 58 Z', '#6aa84f')
    + `<path d="M64 16 L64 80" stroke="${INK}" stroke-width="1.2"/>` + HI(10, 14, 108, 4, 2),
  bun: (col, pat) => P('M8 46 Q8 14 32 14 Q56 14 56 46 Q56 54 32 54 Q8 54 8 46 Z', col)
    + (pat === 'pleat' ? `<path d="M32 16 Q28 24 22 26 M32 16 Q36 24 42 26 M32 16 L32 26" fill="none" stroke="${INK}" stroke-width="1.2"/>`
      : pat === 'grid' ? `<path d="M16 26 L40 50 M24 18 L50 44 M38 16 L54 32 M48 22 L22 50 M36 16 L12 40" fill="none" stroke="#c8a24a" stroke-width="1.4"/>`
        : `<g fill="#f6efd8"><circle cx="26" cy="22" r="1.4"/><circle cx="32" cy="20" r="1.4"/><circle cx="38" cy="23" r="1.4"/><circle cx="30" cy="26" r="1.4"/><circle cx="35" cy="27" r="1.4"/></g>`)
    + HI(16, 22, 6, 12, 3),
  currypan: () => E(32, 34, 26, 18, '#c48a3e') + `<g fill="#8a5a24">${[[18, 28], [26, 22], [36, 24], [44, 30], [22, 38], [32, 34], [42, 40], [30, 44], [16, 34], [48, 36]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g>` + HI(18, 22, 8, 5, 2.5),
  croissant: () => P('M8 46 Q20 54 48 54 Q76 54 88 46 Q80 38 70 40 Q62 18 48 16 Q34 18 26 40 Q16 38 8 46 Z', '#d9973c')
    + `<path d="M34 22 Q40 36 38 52 M48 18 L48 54 M62 22 Q56 36 58 52" fill="none" stroke="#9a5a1e" stroke-width="1.4"/>` + HI(40, 22, 6, 10, 3),
  cupbox: () => P('M5 22 L27 22 L24 60 L8 60 Z', '#e8402a') + C(10, 18, 5, '#e2a53a') + C(18, 15, 5, '#d9963a') + C(24, 19, 4.5, '#e2a53a') + N(`<rect x="7" y="34" width="18" height="10" fill="#f6d24a"/>`) + T(16, 42, 6, '#c0281e', 'からあげ', 700),
  pocky: () => R(6, 20, 20, 72, 2, '#c8202c') + `<g stroke="#5a2e17" stroke-width="3" stroke-linecap="round"><line x1="10" y1="8" x2="10" y2="24"/><line x1="14" y1="5" x2="14" y2="24"/><line x1="18" y1="9" x2="18" y2="24"/><line x1="22" y1="6" x2="22" y2="24"/></g>`
    + `<g stroke="#e8c88a" stroke-width="3"><line x1="10" y1="20" x2="10" y2="22"/></g>` + T(16, 60, 7, '#fff', 'Pocky') + HI(9, 26, 2.5, 60),
  icebar: () => R(12, 40, 8, 22, 2, '#d9b47a') + R(6, 4, 20, 42, 8, '#7fd0ee') + HI(9, 8, 3, 30),
  pouch: () => P('M6 18 L26 18 L27 58 Q16 62 5 58 Z', '#e6e8ea') + R(12, 6, 8, 12, 2, '#f08a1c') + N(`<rect x="7" y="30" width="19" height="14" fill="#f2b33a"/>`) + T(16, 41, 6, '#fff', 'jelly') + HI(8, 22, 2.5, 30),
  // ---- sweets
  dango: () => `<line x1="16" y1="4" x2="16" y2="94" stroke="#c9a46a" stroke-width="3"/>` + C(16, 22, 10, '#f3a9bd') + C(16, 44, 10, '#fbf6ea') + C(16, 66, 10, '#9cc46a') + HI(10, 16, 4, 6, 2) + HI(10, 38, 4, 6, 2) + HI(10, 60, 4, 6, 2),
  daifuku: () => P('M4 24 Q4 8 16 8 Q28 8 28 24 Q28 28 16 28 Q4 28 4 24 Z', '#fbf8f0') + `<g fill="#e6dfcf"><circle cx="11" cy="14" r="1"/><circle cx="20" cy="12" r="1"/><circle cx="16" cy="18" r="1"/></g>`,
  dorayaki: () => E(32, 26, 26, 11, '#b8692a') + N(E(32, 33, 24, 5, '#5a2622')) + E(32, 38, 26, 11, '#c47634') + HI(18, 21, 14, 3, 1.5),
  taiyaki: () => P('M6 16 Q20 4 50 8 Q70 10 76 16 L90 6 Q92 16 88 16 Q92 18 90 28 L76 18 Q70 26 50 26 Q20 28 6 16 Z', '#d0893a') + C(20, 14, 2.2, INK) + `<path d="M34 10 Q38 16 34 22 M44 10 Q48 16 44 22 M54 11 Q58 16 54 21" fill="none" stroke="#8a4f1c" stroke-width="1.3"/>`,
  // ---- dishes
  bowl: (broth, top) => P('M4 28 L60 28 Q58 52 32 56 Q6 52 4 28 Z', '#1f1b1a') + `<path d="M8 40 Q32 46 56 40" fill="none" stroke="#b3261e" stroke-width="2"/>` + E(32, 28, 28, 9, broth)
    + (top === 'ramen' ? E(20, 26, 7, 4.5, '#c98a6a') + E(40, 25, 6, 4, '#f7f1df') + N(E(40, 25, 3, 2.2, '#f2b02a')) + R(26, 20, 6, 9, 1, '#1d2b20') + C(48, 30, 3, '#fff', 'stroke-width="1"') + `<g fill="#7fbf4f"><circle cx="30" cy="31" r="1.4"/><circle cx="34" cy="32" r="1.4"/><circle cx="26" cy="32" r="1.4"/></g>`
      : top === 'tempura' ? P('M14 26 Q28 18 44 22 Q50 26 44 30 Q28 32 14 26 Z', '#e6b24a') + `<path d="M44 22 L52 18" stroke="#d2462a" stroke-width="2.5"/>`
        : R(18, 22, 26, 8, 2, '#c8812c'))
    + `<path d="M40 12 Q44 6 40 2 M30 12 Q34 6 30 2" fill="none" stroke="#fff" stroke-width="1.6" opacity=".7"/>`,
  gyoza: () => E(32, 38, 29, 14, '#f4f1ea') + [12, 21, 30, 39, 48].map(x => P(`M${x - 3} 40 Q${x + 4} 22 ${x + 11} 40 Z`, '#e8b35a')).join('') + `<path d="M8 40 Q32 48 56 40" fill="none" stroke="#c8962e" stroke-width="1.2"/>`,
  chahan: () => E(32, 44, 29, 11, '#f4f1ea') + P('M10 42 Q14 16 32 16 Q50 16 54 42 Z', '#e8c35a') + `<g fill="#d2462a"><circle cx="24" cy="30" r="1.6"/><circle cx="38" cy="26" r="1.6"/></g><g fill="#6aa84f"><circle cx="30" cy="34" r="1.6"/><circle cx="42" cy="34" r="1.6"/></g>`,
  zaru: () => R(4, 14, 56, 38, 3, '#c9a35a') + `<path d="M8 20 L56 20 M8 28 L56 28 M8 36 L56 36 M8 44 L56 44" stroke="#9a7a3a" stroke-width="1"/>` + P('M14 36 Q20 20 32 22 Q46 20 50 36 Q32 44 14 36 Z', '#7a6a58') + `<path d="M18 32 Q32 24 46 32 M20 36 Q32 30 44 36" fill="none" stroke="#5a4c3e" stroke-width="1"/>` + R(26, 18, 12, 4, 1, '#1d2b20'),
  nigiri: () => R(2, 34, 60, 16, 3, '#c49a5e') + [[10, '#f2875a'], [24, '#c8323a'], [38, '#f2c84a'], [52, '#f29a7a']].map(([x, c]) => R(x - 6, 22, 12, 13, 4, '#fbf8ef') + R(x - 7, 18, 14, 9, 4, c)).join(''),
  maki: () => E(32, 42, 29, 12, '#f4f1ea') + [[16, 32], [32, 30], [48, 32], [24, 42], [40, 42]].map(([x, y]) => C(x, y, 7, '#1d2b20') + N(C(x, y, 5, '#fbf8ef')) + N(C(x, y, 2, '#d2462a'))).join(''),
  yakitori: () => `<line x1="6" y1="54" x2="54" y2="10" stroke="#c9a46a" stroke-width="2.5"/><line x1="14" y1="58" x2="60" y2="18" stroke="#c9a46a" stroke-width="2.5"/>` + [[18, 43], [28, 34], [38, 25], [26, 47], [36, 38], [46, 29]].map(([x, y]) => R(x - 5, y - 5, 10, 10, 3, '#8a4a22')).join(''),
  edamame: () => P('M6 30 L58 30 Q56 52 32 54 Q8 52 6 30 Z', '#4a3a2e') + E(32, 30, 26, 7, '#3a6a2a') + [[20, 26], [32, 24], [44, 26], [26, 30], [38, 30]].map(([x, y]) => E(x, y, 7, 3.2, '#8cc45a', `transform="rotate(${(x * 7) % 40 - 20} ${x} ${y})"`)).join(''),
  karaage: () => E(32, 44, 29, 11, '#f4f1ea') + C(22, 34, 9, '#c07d33') + C(38, 32, 9, '#b8742c') + C(30, 40, 9, '#c88a3a') + P('M46 40 Q54 34 58 42 Q52 48 46 40 Z', '#f2e04a'),
  glass: tea => P('M14 6 L50 6 L46 58 L18 58 Z', '#eaf4f7', 'opacity=".9"') + N(P('M16 18 L48 18 L46 56 L18 56 Z', tea)) + R(22, 20, 9, 9, 1, '#fff', 'opacity=".6"') + R(34, 26, 8, 8, 1, '#fff', 'opacity=".5"') + HI(18, 10, 3, 42),
  coffee: col => E(32, 52, 28, 7, '#f4f1ea') + P('M12 22 L52 22 Q50 50 32 50 Q14 50 12 22 Z', '#fbfaf5') + `<path d="M50 28 Q60 28 58 36 Q56 42 48 40" fill="none" stroke="${INK}" stroke-width="${SW}"/>` + E(32, 22, 20, 5, col) + `<path d="M28 14 Q32 8 28 2 M36 14 Q40 8 36 2" fill="none" stroke="#9a8a7a" stroke-width="1.4" opacity=".7"/>`,
  cake: () => P('M6 50 L40 18 L58 30 L58 50 Z', '#fbf3e4') + N(P('M10 42 L58 40 L58 44 L8 46 Z', '#f2c0c8')) + P('M6 50 L58 50 L58 54 L6 54 Z', '#f4e8d0') + P('M44 14 Q50 8 54 16 Q50 24 44 14 Z', '#d2232a') + `<path d="M48 10 L50 6" stroke="#4a8a2a" stroke-width="2"/>`,
  toast: () => P('M6 22 Q6 8 20 8 Q30 8 32 18 L32 56 L6 56 Z', '#e8b25a') + N(R(10, 22, 18, 30, 2, '#f6dc9a')) + R(15, 30, 9, 6, 1, '#f9e7a0') + E(46, 40, 13, 16, '#fbf8f0') + `<path d="M36 34 L58 34" stroke="${INK}" stroke-width="1"/>`,
  // ---- bags
  daypack: col => R(12, 14, 40, 46, 12, col) + R(18, 36, 28, 18, 5, col) + `<path d="M22 14 Q22 4 32 4 Q42 4 42 14" fill="none" stroke="${INK}" stroke-width="3"/><path d="M20 22 L44 22" stroke="#d9b56a" stroke-width="1.6" stroke-dasharray="3 2"/>` + HI(16, 18, 3, 18),
  sacoche: col => `<path d="M10 30 Q32 -6 54 30" fill="none" stroke="${INK}" stroke-width="2.4"/>` + R(10, 28, 44, 28, 5, col) + `<path d="M10 36 L54 36" stroke="${INK}" stroke-width="1.2"/>` + R(28, 33, 8, 6, 1.5, '#d9b56a'),
  plasticbag: () => P('M10 22 Q10 18 14 18 L50 18 Q54 18 54 22 L56 56 Q56 60 52 60 L12 60 Q8 60 8 56 Z', '#f4f6f6') + `<path d="M18 18 Q18 4 26 6 Q30 8 28 18 M36 18 Q34 8 38 6 Q46 4 46 18" fill="none" stroke="${INK}" stroke-width="${SW}"/>` + `<path d="M14 30 Q32 34 50 28" fill="none" stroke="#c8d0d4" stroke-width="1.2"/>`,
  // ---- what is left
  emptycan: () => P('M7 10 L25 10 L23 28 L27 34 L21 42 L26 58 L6 58 L10 44 L5 34 L10 26 Z', '#b8bcc2') + `<path d="M10 26 L22 30 M10 44 L22 40" stroke="${INK}" stroke-width="1"/>`,
  emptypet: () => P('M12 11 L20 11 L20 16 Q26 22 24 30 L27 44 L22 52 L26 66 L24 86 Q24 91 20 91 L12 91 Q7 91 8 86 L6 64 L11 52 L5 42 L9 30 Q6 20 12 16 Z', '#eef5f8', 'opacity=".9"') + R(11, 4, 10, 8, 1.5, '#d8dde0'),
  // ---- the farm's crops (seed packets, the farm board: home.js)
  lettuce: () => P('M32 56 Q12 56 10 40 Q8 26 20 20 Q24 10 32 12 Q40 10 44 20 Q56 26 54 40 Q52 56 32 56 Z', '#8cc65a') + P('M32 54 Q20 50 20 38 Q20 28 32 26 Q44 28 44 38 Q44 50 32 54 Z', '#b5df7c') + P('M32 50 Q26 44 28 36 M32 50 Q38 44 36 36 M32 50 L32 30', 'none', 'stroke-linecap="round"'),
  cabbage: () => C(32, 36, 22, '#a9d48a') + P('M14 30 Q22 18 32 20 Q42 18 50 30 Q42 26 32 28 Q22 26 14 30 Z', '#c8e6ac') + P('M32 56 L32 30 M32 44 Q24 40 18 32 M32 44 Q40 40 46 32 M32 52 Q22 50 14 42 M32 52 Q42 50 50 42', 'none', 'stroke-linecap="round" opacity=".55"'),
  sunflower: () => P('M31 40 L31 62 L33 62 L33 40 Z', '#4f8a2e') + P('M33 52 Q44 44 50 50 Q42 58 33 54 Z', '#5f9a36') + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => { const a = i / 12 * 6.283, x = 32 + Math.cos(a) * 15, y = 24 + Math.sin(a) * 15; return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="7" ry="3.6" transform="rotate(${(a * 57.3).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="#f6c51f" stroke="${INK}" stroke-width="1.2"/>`; }).join('') + C(32, 24, 9.5, '#6b3d1a') + N(C(29, 21, 3, '#8a5428')),
  tomato: () => C(32, 38, 20, '#e0412c') + HI(20, 28, 5, 8, 3) + P('M32 18 L27 12 L31 17 L24 18 L31 20 L28 26 L33 21 L38 25 L35 19 L42 18 L34 17 L37 11 Z', '#4f9a36') + P('M32 18 L33 10', 'none', 'stroke-linecap="round"'),
  strawberry: () => P('M32 60 Q14 46 14 30 Q14 20 24 20 L40 20 Q50 20 50 30 Q50 46 32 60 Z', '#e23a3a') + [[24, 30], [32, 28], [40, 30], [22, 40], [30, 38], [38, 40], [44, 36], [27, 48], [35, 48], [31, 54]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.2" ry="1.8" fill="#f8e27a"/>`).join('') + P('M20 21 L26 12 L30 19 L32 10 L35 19 L40 12 L44 21 Q32 26 20 21 Z', '#4f9a36'),
  corn: () => P('M32 6 Q42 12 42 32 Q42 52 32 58 Q22 52 22 32 Q22 12 32 6 Z', '#f3cf3c') + Array.from({ length: 6 }, (_, j) => `<line x1="24" y1="${16 + j * 7}" x2="40" y2="${16 + j * 7}" stroke="#c99a1e" stroke-width="1.2"/>`).join('') + `<line x1="32" y1="8" x2="32" y2="56" stroke="#c99a1e" stroke-width="1.2"/>` + P('M32 60 Q16 50 14 24 Q22 36 30 44 Z', '#7cb64a') + P('M32 60 Q48 50 50 24 Q42 36 34 44 Z', '#6aa63c'),
  pumpkin: () => E(32, 38, 26, 19, '#ef8a24') + E(32, 38, 15, 19, '#f49b38') + E(32, 38, 5, 19, '#ef8a24') + P('M30 20 Q30 12 34 8 L37 10 Q34 14 34 20 Z', '#6b8a2e') + HI(14, 32, 4, 10, 2),
  watermelon: () => E(32, 36, 27, 20, '#3f8a34') + ['M14 22 Q20 36 14 50', 'M24 17 Q30 36 24 55', 'M34 16 Q40 36 34 56', 'M44 18 Q50 36 44 54'].map(d => `<path d="${d}" fill="none" stroke="#1f5a22" stroke-width="3.2"/>`).join('') + HI(16, 26, 5, 8, 3),
  potato: () => E(24, 40, 15, 11, '#c9a46a') + E(42, 34, 13, 10, '#d6b277') + [[18, 36], [27, 44], [22, 41], [40, 30], [46, 37]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.6" ry="1.1" fill="#8a6a3e"/>`).join('') + P('M30 22 Q32 10 40 8 Q38 16 33 22 Z', '#5f9a36') + P('M30 22 Q26 12 18 12 Q22 19 28 23 Z', '#7cb64a'),
  bean: () => P('M14 50 Q10 36 18 24 Q24 16 28 22 Q22 32 22 44 Q22 52 14 50 Z', '#8cc65a') + P('M30 54 Q26 38 34 26 Q40 18 44 24 Q38 34 38 46 Q38 56 30 54 Z', '#7ab84c') + P('M44 50 Q42 38 48 30 Q52 26 54 30 Q50 38 50 46 Q50 52 44 50 Z', '#9ad06a') + [[19, 30], [17, 38], [16, 45], [36, 32], [34, 40], [33, 48], [49, 34], [48, 41]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="2.2" fill="#b5df7c" stroke="${INK}" stroke-width="0.8"/>`).join(''),
  emptybottle: () => P('M12 4 L20 4 L20 14 Q27 22 27 34 L27 58 Q27 61 24 61 L8 61 Q5 61 5 58 L5 34 Q5 22 12 14 Z', '#a8c8b0', 'opacity=".85"') + HI(8, 28, 2.5, 28),
};
const cache = new Map();
export function iconSVG(it, sz = null) {
  const key = it.id + (sz ? sz.join('x') : ''); if (cache.has(key)) return cache.get(key);
  const s = sz || it.sz || [2, 2], W = s[0] * 32, H = s[1] * 32, [kind, ...a] = it.look || ['daifuku'];
  // (a dish served here and a bag are drawn on a 2 x 2 frame, a folded bag on its own; the others at their cells)
  const nat = DRAW[kind] ? DRAW[kind](...a) : '';
  const vb = kind === 'bento' ? '0 0 128 96' : it.sz && !it.grid ? `0 0 ${it.sz[0] * 32} ${it.sz[1] * 32}` : '0 0 64 64';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet">${nat}</svg>`;
  cache.set(key, svg); return svg;
}
