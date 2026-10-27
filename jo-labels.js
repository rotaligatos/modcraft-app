/* Job Order part labels — QR code with a logo in the centre, and a drawing of the piece showing
   which edges are banded. One file, used by Modcraft (Job Order → Labels) and copied into PMES
   (job page → Print labels) so both print the same label. Needs qrcode-generator loaded first.

   JoLabels.render(el, { labels:[...], logo:'url or data: or ""' })
     label: { scan, p, name, area, L, W, cutL, cutW, th, material, ebt, sc, lc, tape, where, work }
       sc = banded edges on the WIDTH sides (the ends), lc = banded edges along the LENGTH.
   The QR holds `scan` — the same short code the old barcode held, so a scanner types the same text.
   Error correction H: up to ~30% of the code can be covered, so the centre logo stays readable. */
(function (root) {
  var e = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // What the QR spells out (Rommel, 2026-10-17): the part code FIRST (what PMES looks up), then the
  // cut size, the board and the edge banding, so any phone camera shows what the piece is.
  // Project, client, order and who worked on it are printed and kept in PMES, not packed in here:
  // more text makes the squares smaller and the label harder to scan.
  // Edge banding as the floor reads it: L = long sides, S = short sides of the real piece. The stored
  // code is keyed on the length/width fields, so a piece entered wider than long printed backwards.
  function ebtLS(l) {
    var sc = +l.sc || 0, lc = +l.lc || 0; if (!sc && !lc) return '';
    var L = +(l.cutL || l.L) || 0, W = +(l.cutW || l.W) || 0;
    var lenIsLong = L > W || (L === W && String(l.grain || '').charAt(0).toLowerCase() !== 'w');
    var lo = lenIsLong ? lc : sc, sh = lenIsLong ? sc : lc;
    if (lo === 2 && sh === 2) return '4S';
    return [lo ? lo + 'L' : '', sh ? sh + 'S' : ''].filter(Boolean).join(' ');
  }
  function qrText(l) {
    var mat = String(l.material || '').replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
    if (mat.length > 44) mat = mat.slice(0, 44);
    return [l.scan, (l.cutW || l.W || '') + 'x' + (l.cutL || l.L || ''), mat, 'EB ' + (ebtLS(l) || 'NONE')].join(' | ');
  }

  function qrSvg(text, logo) {
    var q = root.qrcode(0, 'Q'); q.addData(String(text)); q.make();
    var n = q.getModuleCount(), m = 2, size = n + m * 2, d = '';
    // One rectangle per horizontal run of dark modules (not per module): same picture, a fraction
    // of the markup — 300 labels were ~3.6 MB of path data and made the print preview crawl.
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) {
      var c0 = c; while (c + 1 < n && q.isDark(r, c + 1)) c++;
      d += 'M' + (c0 + m) + ' ' + (r + m) + 'h' + (c - c0 + 1) + 'v1h-' + (c - c0 + 1) + 'z';
    }
    var s = '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/>';
    if (logo) {
      var w = Math.round(n * 0.26), x = (size - w) / 2;
      s += '<rect x="' + (x - 0.6) + '" y="' + (x - 0.6) + '" width="' + (w + 1.2) + '" height="' + (w + 1.2) + '" rx="1" fill="#fff"/>'
        + '<image href="' + e(logo) + '" x="' + x + '" y="' + x + '" width="' + w + '" height="' + w + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    return s + '</svg>';
  }

  // The piece to scale, length across. Banded edges are thick and red; the rest thin grey.
  // grain: 'length' | 'width' | '' — woodgrain/patterned boards get faint grain lines along that
  // direction, so the operator sees which way the grain runs relative to the banded edges.
  function pieceSvg(L, W, sc, lc, grain) {
    L = +L || 0; W = +W || 0;
    var bw = 64, bh = 34, k = (L && W) ? Math.min(bw / L, bh / W) : 1;
    var w = Math.max(10, L * k), h = Math.max(6, W * k), x = (bw - w) / 2 + 8, y = (bh - h) / 2 + 6;
    var on = '#dc2626', off = '#9ca3af', tw = 2.2, th = 0.6;
    var edge = function (x1, y1, x2, y2, b) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (b ? on : off) + '" stroke-width="' + (b ? tw : th) + '" stroke-linecap="square"/>'; };
    var s = '<svg class="pc" viewBox="0 0 80 48"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#f3f4f6"/>';
    if (grain === 'length' || grain === 'width') {
      // Wavy grain lines: each line is a gentle wave along the grain, its phase and depth varied a
      // little line to line so it reads as wood rather than ruled lines.
      var gl = '', step = 2.6, along = grain === 'length', len = along ? w : h, span = along ? h : w;
      var seg = 12, n = Math.max(2, Math.round(len / seg));
      for (var k = 0, off = step; off < span - 0.5; off += step, k++) {
        var amp = 0.4 + 0.3 * ((k * 7) % 3) / 2, ph = (k % 3) ? 1 : -1;
        var p = function (t, o) { return along ? (x + t) + ' ' + (y + o) : (x + o) + ' ' + (y + t); };
        gl += 'M' + p(0.6, off);
        for (var i = 0; i < n; i++) {
          var t0 = 0.6 + i * (len - 1.2) / n, t1 = 0.6 + (i + 1) * (len - 1.2) / n, sgn = (i % 2 ? -1 : 1) * ph;
          gl += 'Q' + p((t0 + t1) / 2, off + sgn * amp * 2) + ' ' + p(t1, off);
        }
      }
      s += '<path d="' + gl + '" fill="none" stroke="#b8a98f" stroke-width="0.35" stroke-linecap="round"/>';
    }
    s += edge(x, y, x + w, y, lc >= 1) + edge(x, y + h, x + w, y + h, lc >= 2);     // along the length
    s += edge(x, y, x, y + h, sc >= 2) + edge(x + w, y, x + w, y + h, sc >= 1);     // the ends (width)
    s += '<text x="' + (x + w / 2) + '" y="' + (y - 1.6) + '" font-size="4" text-anchor="middle" fill="#111">' + e(L) + '</text>';
    s += '<text x="' + (x - 1.6) + '" y="' + (y + h / 2) + '" font-size="4" text-anchor="end" dominant-baseline="middle" fill="#111">' + e(W) + '</text>';
    return s + '</svg>';
  }

  function labelHtml(l, logo, draft) {
    var banded = (+l.sc || 0) + (+l.lc || 0);
    return '<div class="lb">'
      + '<div class="top"><span class="nm">' + e(l.name) + '</span><span class="pn">' + e(l.p) + '</span></div>'
      + ((l.order || l.client || l.project) ? '<div class="cp">' + e([l.order, l.client, l.project].filter(Boolean).join(' · ')) + '</div>' : '')
      + '<div class="mid">' + (draft ? '<div class="dr">' + (draft === true ? 'DRAFT' : 'NOT FOR PRODUCTION') + '<small>' + (draft === true ? 'preview — not for production' : e(draft)) + '</small></div>' : qrSvg(qrText(l), logo)) + '<div class="rt">' + pieceSvg(l.L, l.W, l.sc, l.lc, l.grain)
      + '<div class="eb">' + (banded ? '<b style="color:#dc2626">━</b> edge band ' + e(ebtLS(l)) + (l.tape ? ' · ' + e(l.tape) : '') : 'no edge band') + '</div></div></div>'
      + '<div class="sz">Cut ' + e(l.cutW) + ' × ' + e(l.cutL) + '</div>'
      + '<div class="mt">' + e(l.material) + '</div>'
      + (l.work ? '<div class="wk">' + e(l.work) + '</div>' : '')
      + '<div class="ft"><span class="sc">' + e(l.scan) + (l.where ? ' · ' + e(l.where) : '') + '</span><span class="by">developed by RTmo</span></div>'
      + '</div>';
  }

  var CSS = '.jl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}'
    + '.lb{border:1px dashed #999;padding:4px 6px;font-family:Arial,Helvetica,sans-serif;font-size:8.5px;line-height:1.25;height:50mm;overflow:hidden;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column}'
    + '.lb .top{display:flex;justify-content:space-between;gap:4px}.lb .nm{font-weight:700;font-size:9.5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.lb .pn{font-weight:700;font-size:14px}'
    + '.lb .mid{display:flex;gap:4px;align-items:center;margin:2px 0}.lb .qr{width:24mm;height:24mm;flex:none}.lb .rt{flex:1;min-width:0}.lb .pc{width:100%;height:18mm}'
    + '.lb .eb{font-size:7.5px;color:#333;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.lb .sz{font-weight:700;font-size:10px}.lb .mt{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
    + '.lb .cp{font-size:7.5px;color:#333;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'
    + '.lb .dr{width:24mm;height:24mm;flex:none;border:1.5px dashed #b91c1c;color:#b91c1c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:700;font-size:14px;text-align:center;line-height:1.1}.lb .dr small{font-size:6.5px;font-weight:400;margin-top:3px;padding:0 2px}'
    + '.lb .wk{font-weight:700;color:#7c2d12}.lb .ft{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:4px;font-family:monospace;font-size:7px;color:#444}'
    + '.lb .by{font-family:Arial,Helvetica,sans-serif;font-size:5.5px;color:#9ca3af;white-space:nowrap}';

  root.JoLabels = { ebtLS: ebtLS,
    css: CSS, qrText: qrText, qrSvg: qrSvg, pieceSvg: pieceSvg, labelHtml: labelHtml,
    render: function (el, o) {
      if (!document.getElementById('jl-css')) { var st = document.createElement('style'); st.id = 'jl-css'; st.textContent = CSS; document.head.appendChild(st); }
      el.innerHTML = '<div class="jl-grid">' + (o.labels || []).map(function (l) { return labelHtml(l, o.logo || '', o.draft || false); }).join('') + '</div>';
    }
  };
})(typeof window !== 'undefined' ? window : this);
