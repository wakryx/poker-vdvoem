// Романтичный декор: свечи, розы, бокалы, лепестки (рисуется SVG, без картинок)
(function () {
  let n = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function candle(k, x, y, w, h, delay) {
    const cx = x + w / 2;
    return `
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#wax${k})"/>
      <ellipse cx="${cx}" cy="${y + 1}" rx="${w / 2}" ry="3.2" fill="#f6eddc"/>
      <path d="M${x + 3},${y + 2} q2,10 4,4 q2,-4 3,9 q1,6 3,-2" fill="none" stroke="#eadcc4" stroke-width="3" stroke-linecap="round"/>
      <line x1="${cx}" y1="${y}" x2="${cx}" y2="${y - 7}" stroke="#3a2a20" stroke-width="1.6" stroke-linecap="round"/>
      <path class="flame" style="animation-delay:${delay}s" d="M${cx},${y - 30} C${cx + 7},${y - 19} ${cx + 6},${y - 9} ${cx},${y - 6} C${cx - 6},${y - 9} ${cx - 7},${y - 19} ${cx},${y - 30} Z" fill="url(#fl${k})"/>`;
  }

  function candles() {
    const k = n++;
    return `<svg viewBox="0 0 140 170" aria-hidden="true">
      <defs>
        <linearGradient id="wax${k}" x1="0" x2="1"><stop offset="0" stop-color="#d9c8ac"/><stop offset=".35" stop-color="#efe4d1"/><stop offset="1" stop-color="#cdb999"/></linearGradient>
        <radialGradient id="fl${k}" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff6dc"/><stop offset=".5" stop-color="#f6cf7e"/><stop offset="1" stop-color="#de8c45"/></radialGradient>
        <radialGradient id="halo${k}"><stop offset="0" stop-color="#f3c77a" stop-opacity=".32"/><stop offset="1" stop-color="#f3c77a" stop-opacity="0"/></radialGradient>
      </defs>
      <ellipse class="halo" cx="70" cy="55" rx="72" ry="58" fill="url(#halo${k})"/>
      <ellipse cx="70" cy="156" rx="66" ry="9" fill="#5c4229"/>
      <ellipse cx="70" cy="152" rx="64" ry="7.5" fill="#7d5d3b"/>
      ${candle(k, 20, 74, 26, 78, 0)}
      ${candle(k, 56, 50, 30, 102, 0.6)}
      ${candle(k, 96, 90, 24, 62, 1.1)}
    </svg>`;
  }

  function rose(x, y, r, tone) {
    const base = ['#8a1b2f', '#9a2a3c', '#7a1528'][tone];
    return `<g transform="translate(${x},${y}) scale(${r / 15})">
      <circle r="15" fill="${base}"/>
      <path d="M-15,3 C-12,15 12,15 15,3" fill="none" stroke="#b04456" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M-10,-3 C-10,-13 10,-13 10,-2 C10,8 -6,10 -7,1 C-7,-6 5,-7 5,0 C5,4 -2,4 -2,0" fill="none" stroke="#561020" stroke-width="2" stroke-linecap="round"/>
    </g>`;
  }

  function roses() {
    const k = n++;
    const heads = [[48, 58, 15, 0], [86, 38, 16, 1], [122, 60, 15, 2], [66, 84, 13, 1], [106, 86, 13, 0], [32, 92, 9, 2], [140, 94, 9, 1]];
    const leaves = [[40, 78, -35], [130, 80, 35], [58, 104, -20], [114, 104, 25], [86, 70, 0]];
    const dots = Array.from({ length: 16 }, () => `<circle cx="${rnd(25, 150).toFixed(1)}" cy="${rnd(30, 105).toFixed(1)}" r="${rnd(1.4, 2.6).toFixed(1)}" fill="#efe6da" opacity=".9"/>`).join('');
    return `<svg viewBox="0 0 170 215" aria-hidden="true">
      <defs><linearGradient id="vase${k}" x1="0" x2="1"><stop offset="0" stop-color="#b99a86"/><stop offset=".4" stop-color="#d9c2b0"/><stop offset="1" stop-color="#a88a77"/></linearGradient></defs>
      <g stroke="#4a5f3e" stroke-width="2.4" fill="none" stroke-linecap="round">
        ${heads.map(([x, y]) => `<path d="M85,128 Q${(85 + x) / 2},${(128 + y) / 2 + 10} ${x},${y}"/>`).join('')}
      </g>
      ${leaves.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="11" ry="5" transform="rotate(${a} ${x} ${y})" fill="#55704a"/>`).join('')}
      ${dots}
      ${heads.map(([x, y, r, t]) => rose(x, y, r, t)).join('')}
      <path d="M62,132 C40,148 42,200 85,206 C128,200 130,148 108,132 L103,116 L67,116 Z" fill="url(#vase${k})"/>
      <ellipse cx="85" cy="116" rx="19" ry="4" fill="#a68673"/>
      <path d="M58,160 C70,166 100,166 112,160" fill="none" stroke="#8a6b5a" stroke-width="2" opacity=".6"/>
    </svg>`;
  }

  function glass(x, tilt, level) {
    return `<g transform="translate(${x},0) rotate(${tilt} 30 150)">
      <path d="M8,30 C6,70 20,92 30,94 C40,92 54,70 52,30 Z" fill="#f4ece2" opacity=".14"/>
      <path d="M${10 - level * 0.05},${30 + level} C9,70 21,90 30,92 C39,90 51,70 ${50 + level * 0.05},${30 + level} Z" fill="#6e1324"/>
      <ellipse cx="30" cy="${30 + level}" rx="${20 - level * 0.08}" ry="3" fill="#8b1d31"/>
      <path d="M8,30 C6,70 20,92 30,94 C40,92 54,70 52,30" fill="none" stroke="#e9dfd3" stroke-width="1.6" opacity=".55"/>
      <path d="M14,40 C13,58 18,72 24,80" fill="none" stroke="#fff" stroke-width="2" opacity=".18" stroke-linecap="round"/>
      <rect x="28.6" y="93" width="2.8" height="50" fill="#e9dfd3" opacity=".5"/>
      <ellipse cx="30" cy="145" rx="17" ry="4" fill="#e9dfd3" opacity=".45"/>
    </g>`;
  }
  function wine() {
    return `<svg viewBox="0 0 130 160" aria-hidden="true">
      <ellipse cx="65" cy="150" rx="58" ry="6" fill="#000" opacity=".25"/>
      ${glass(8, -4, 22)}${glass(62, 5, 28)}
    </svg>`;
  }

  function petals(count) {
    let h = '';
    for (let i = 0; i < count; i++) {
      const s = rnd(14, 24);
      h += `<svg class="petal" viewBox="0 0 24 14" style="left:${rnd(0, 92)}%;top:${rnd(0, 88)}%;width:${s}px;transform:rotate(${rnd(0, 360)}deg)" aria-hidden="true">
        <path d="M1,7 C6,-1 18,0 23,6 C18,13 6,14 1,7 Z" fill="${['#8a1b2f', '#9e2d40', '#741426'][i % 3]}"/>
        <path d="M3,7 C9,6 15,6 21,6.5" stroke="#5a0f1e" stroke-width=".8" fill="none" opacity=".6"/>
      </svg>`;
    }
    return h;
  }

  document.querySelectorAll('[data-decor]').forEach((el) => {
    const t = el.dataset.decor;
    el.innerHTML = t === 'candles' ? candles() : t === 'roses' ? roses() : t === 'wine' ? wine() : t === 'petals' ? petals(+el.dataset.count || 7) : '';
  });
})();
