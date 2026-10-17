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
  function qrText(l) {
    var mat = String(l.material || '').replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
    if (mat.length > 44) mat = mat.slice(0, 44);
    return [l.scan, (l.cutL || l.L || '') + 'x' + (l.cutW || l.W || ''), mat, 'EB ' + (String(l.ebt || '').toUpperCase() || 'NONE')].join(' | ');
  }

  function qrSvg(text, logo) {
    var q = root.qrcode(0, 'Q'); q.addData(String(text)); q.make();
    var n = q.getModuleCount(), m = 2, size = n + m * 2, d = '';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += 'M' + (c + m) + ' ' + (r + m) + 'h1v1h-1z';
    var s = '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/>';
    if (logo) {
      var w = Math.round(n * 0.26), x = (size - w) / 2;
      s += '<rect x="' + (x - 0.6) + '" y="' + (x - 0.6) + '" width="' + (w + 1.2) + '" height="' + (w + 1.2) + '" rx="1" fill="#fff"/>'
        + '<image href="' + e(logo) + '" x="' + x + '" y="' + x + '" width="' + w + '" height="' + w + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    return s + '</svg>';
  }

  // The piece to scale, length across. Banded edges are thick and red; the rest thin grey.
  function pieceSvg(L, W, sc, lc) {
    L = +L || 0; W = +W || 0;
    var bw = 64, bh = 34, k = (L && W) ? Math.min(bw / L, bh / W) : 1;
    var w = Math.max(10, L * k), h = Math.max(6, W * k), x = (bw - w) / 2 + 8, y = (bh - h) / 2 + 6;
    var on = '#dc2626', off = '#9ca3af', tw = 2.2, th = 0.6;
    var edge = function (x1, y1, x2, y2, b) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (b ? on : off) + '" stroke-width="' + (b ? tw : th) + '" stroke-linecap="square"/>'; };
    var s = '<svg class="pc" viewBox="0 0 80 48"><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="#f3f4f6"/>';
    s += edge(x, y, x + w, y, lc >= 1) + edge(x, y + h, x + w, y + h, lc >= 2);     // along the length
    s += edge(x, y, x, y + h, sc >= 2) + edge(x + w, y, x + w, y + h, sc >= 1);     // the ends (width)
    s += '<text x="' + (x + w / 2) + '" y="' + (y - 1.6) + '" font-size="4" text-anchor="middle" fill="#111">' + e(L) + '</text>';
    s += '<text x="' + (x - 1.6) + '" y="' + (y + h / 2) + '" font-size="4" text-anchor="end" dominant-baseline="middle" fill="#111">' + e(W) + '</text>';
    return s + '</svg>';
  }

  function labelHtml(l, logo) {
    var banded = (+l.sc || 0) + (+l.lc || 0);
    return '<div class="lb">'
      + '<div class="top"><span class="nm">' + e(l.name) + '</span><span class="pn">' + e(l.p) + '</span></div>'
      + ((l.order || l.client || l.project) ? '<div class="cp">' + e([l.order, l.client, l.project].filter(Boolean).join(' · ')) + '</div>' : '')
      + '<div class="mid">' + qrSvg(qrText(l), logo) + '<div class="rt">' + pieceSvg(l.L, l.W, l.sc, l.lc)
      + '<div class="eb">' + (banded ? '<b style="color:#dc2626">━</b> edge band ' + e(l.ebt || '') + (l.tape ? ' · ' + e(l.tape) : '') : 'no edge band') + '</div></div></div>'
      + '<div class="sz">Cut ' + e(l.cutL) + ' × ' + e(l.cutW) + '</div>'
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
    + '.lb .wk{font-weight:700;color:#7c2d12}.lb .ft{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:4px;font-family:monospace;font-size:7px;color:#444}'
    + '.lb .by{font-family:Arial,Helvetica,sans-serif;font-size:5.5px;color:#9ca3af;white-space:nowrap}';

  root.JoLabels = {
    css: CSS, qrText: qrText, qrSvg: qrSvg, pieceSvg: pieceSvg, labelHtml: labelHtml,
    render: function (el, o) {
      if (!document.getElementById('jl-css')) { var st = document.createElement('style'); st.id = 'jl-css'; st.textContent = CSS; document.head.appendChild(st); }
      el.innerHTML = '<div class="jl-grid">' + (o.labels || []).map(function (l) { return labelHtml(l, o.logo || ''); }).join('') + '</div>';
    }
  };
})(typeof window !== 'undefined' ? window : this);
