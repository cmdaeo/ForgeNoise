'use strict';
// Zero-dependency SVG builder for paper figures. Open in any browser;
// convert to PNG/PDF with `rsvg-convert`, `magick`, or Inkscape.

class SVG {
  constructor(w, h, bg = '#ffffff') {
    this.w = w; this.h = h; this.bg = bg;
    this.els = [];
  }

  _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  text(x, y, str, { size = 12, anchor = 'start', color = '#000', weight = 'normal', family = 'Helvetica, Arial, sans-serif' } = {}) {
    this.els.push(`<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" text-anchor="${anchor}" fill="${color}" font-weight="${weight}">${this._esc(str)}</text>`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#000', width = 1, dash = '' } = {}) {
    const d = dash ? ` stroke-dasharray="${dash}"` : '';
    this.els.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${d} />`);
    return this;
  }

  rect(x, y, w, h, { fill = 'none', stroke = 'none', sw = 1 } = {}) {
    this.els.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`);
    return this;
  }

  circle(cx, cy, r, { fill = '#000', stroke = 'none', sw = 1 } = {}) {
    this.els.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`);
    return this;
  }

  polyline(pts, { stroke = '#000', width = 1, fill = 'none' } = {}) {
    const d = pts.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
    this.els.push(`<polyline points="${d}" stroke="${stroke}" stroke-width="${width}" fill="${fill}" />`);
    return this;
  }

  save(filePath) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}">
<rect width="${this.w}" height="${this.h}" fill="${this.bg}" />
${this.els.join('\n')}
</svg>`;
    require('fs').writeFileSync(filePath, svg);
  }
}

module.exports = SVG;