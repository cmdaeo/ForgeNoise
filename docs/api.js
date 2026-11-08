(function () {
  const root = document.getElementById('api-root');
  if (!root || !window.FORGE_API) return;

  const frag = document.createDocumentFragment();
  for (const group of window.FORGE_API) {
    const h = document.createElement('h2');
    h.textContent = group.name;
    frag.appendChild(h);

    const wrap = document.createElement('div');
    wrap.className = 'api-group';
    for (const item of group.items) {
      const div = document.createElement('div');
      div.className = 'api-item';
      div.innerHTML = `
        <div class="sig">${escapeHtml(item.sig)} <span class="ret">→ ${escapeHtml(item.ret)}</span></div>
        <div class="desc">${escapeHtml(item.desc)}</div>
        ${item.range ? `<div class="range">range: ${escapeHtml(item.range)}</div>` : ''}
      `;
      wrap.appendChild(div);
    }
    frag.appendChild(wrap);
  }
  root.appendChild(frag);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
})();