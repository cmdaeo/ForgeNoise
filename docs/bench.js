(function () {
  if (!window.BENCH) return;
  const B = window.BENCH;

  // ── System info ────────────────────────────────────────────────
  const sys = B.system || {};
  const sysinfo = document.getElementById('sysinfo');
  const cells = [
    ['CPU',         sys.cpu ? `${sys.cpu.model} (${sys.cpu.cores} cores @ ${sys.cpu.speed} MHz)` : '-'],
    ['Node',        sys.node || '-'],
    ['V8',          sys.v8 || '-'],
    ['Platform',    sys.platform ? `${sys.platform} ${sys.release} (${sys.arch})` : '-'],
    ['Memory total', sys.memoryTotalGB ? `${sys.memoryTotalGB} GB` : '-'],
    ['Memory free',  sys.memoryFreeGB ? `${sys.memoryFreeGB} GB` : '-'],
    ['Timestamp',   sys.timestamp || '-'],
    ['Trials',      B.trials + ' per category'],
  ];
  for (const [k, v] of cells) {
    const div = document.createElement('div');
    div.className = 'cell';
    div.innerHTML = `<div class="k">${k}</div><div class="v">${escapeHtml(v)}</div>`;
    sysinfo.appendChild(div);
  }

  // ── Table ──────────────────────────────────────────────────────
  const tbody = document.querySelector('#bench-table tbody');
  const filterCat = document.getElementById('filter-cat');
  const filterLib = document.getElementById('filter-lib');
  const filterStatus = document.getElementById('filter-status');

  // Compute head-to-head ratios per category (ForgeNoise vs best other)
  const byCat = {};
  for (const row of B.table) {
    (byCat[row.Category] ||= []).push(row);
  }

  function render() {
    tbody.innerHTML = '';
    const catQ = filterCat.value.toLowerCase();
    const libQ = filterLib.value;
    const statQ = filterStatus.value;

    for (const row of B.table) {
      if (catQ && !row.Category.toLowerCase().includes(catQ)) continue;
      if (libQ && row.Library !== libQ) continue;
      if (statQ && row.Status !== statQ) continue;

      const tr = document.createElement('tr');
      const isForge = row.Library === 'ForgeNoise';
      const libClass = isForge ? 'lib-forge' : '';
      const statusClass = 'status-' + row.Status;

      tr.innerHTML = `
        <td>${escapeHtml(row.Category)}</td>
        <td class="${libClass}">${escapeHtml(row.Library)}</td>
        <td class="num">${row['Median op/s']}</td>
        <td class="num">${row.Min}</td>
        <td class="num">${row.Max}</td>
        <td class="num">${row['p50 ns'] || '-'}</td>
        <td class="num">${row['p95 ns'] || '-'}</td>
        <td class="num">${row['p99 ns'] || '-'}</td>
        <td class="num">${row['relMAD %']}</td>
        <td class="num">${row['CPU %'] || '-'}</td>
        <td class="num">${row['RSS MB'] || '-'}</td>
        <td class="num">${row['Sys CPU start→end'] || '-'}</td>
        <td>${escapeHtml(row['95% CI'])}</td>
        <td class="${statusClass}">${row.Status}</td>
      `;
      tbody.appendChild(tr);
    }
  }
  filterCat.addEventListener('input', render);
  filterLib.addEventListener('change', render);
  filterStatus.addEventListener('change', render);
  render();

  // ── Head-to-head bar chart ─────────────────────────────────────
  const canvas = document.getElementById('headtohead');
  const ctx = canvas.getContext('2d');

  // Categories that have at least 2 libraries
  const headToHead = [];
  for (const cat in byCat) {
    const rows = byCat[cat];
    if (rows.length < 2) continue;
    const forge = rows.find(r => r.Library === 'ForgeNoise');
    if (!forge) continue;
    const other = rows
      .filter(r => r.Library !== 'ForgeNoise')
      .map(r => ({ lib: r.Library, ops: parseFloat(r['Median op/s'].replace(/,/g, '')) }))
      .sort((a, b) => b.ops - a.ops)[0];
    if (!other) continue;
    const forgeOps = parseFloat(forge['Median op/s'].replace(/,/g, ''));
    headToHead.push({
      cat,
      otherLib: other.lib,
      forgeOps,
      otherOps: other.ops,
      ratio: forgeOps / other.ops,
    });
  }
  headToHead.sort((a, b) => b.ratio - a.ratio);

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width - 32;
    const H = canvas.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, W, H);

    const rowH = Math.min(28, (H - 30) / headToHead.length);
    const leftPad = 220;
    const rightPad = 20;
    const barW = W - leftPad - rightPad - 60;

    // Max ratio for scale (min 1, up to max)
    const maxRatio = Math.max(2.1, ...headToHead.map(h => h.ratio));

    for (let i = 0; i < headToHead.length; i++) {
      const h = headToHead[i];
      const y = 10 + i * rowH;

      // Category label
      ctx.fillStyle = '#e6e6e6';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(h.cat, leftPad - 12, y + rowH / 2);

      // 1.0 marker
      const x1 = leftPad + (1 / maxRatio) * barW;
      ctx.strokeStyle = '#333';
      ctx.beginPath();
      ctx.moveTo(x1, y + 2);
      ctx.lineTo(x1, y + rowH - 2);
      ctx.stroke();

      // Bar
      const barLen = (h.ratio / maxRatio) * barW;
      ctx.fillStyle = h.ratio >= 1 ? '#4caf50' : '#ef5350';
      ctx.fillRect(leftPad, y + 3, barLen, rowH - 6);

      // Ratio value
      ctx.fillStyle = '#e6e6e6';
      ctx.textAlign = 'left';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(h.ratio.toFixed(2) + '×', leftPad + barLen + 8, y + rowH / 2);

      // Other library name below category
      ctx.fillStyle = '#555';
      ctx.textAlign = 'right';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('vs ' + h.otherLib, leftPad - 12, y + rowH / 2 + 11);
    }

    // 1.0 marker label
    const x1 = leftPad + (1 / maxRatio) * barW;
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('1.0× (parity)', x1, H - 6);
  }

  window.addEventListener('resize', () => { ctx.setTransform(1, 0, 0, 1, 0, 0); drawChart(); });
  drawChart();

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
})();