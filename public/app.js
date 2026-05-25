/* ── Dermatouch Operations Command · app.js ── */

const _pageStartMS = Date.now(); // reliable page-load timestamp (not performance.now)

let dashboard = null;
let selectedShipmentId = null;
let disputePageSize = 50;
let currentPage = 'dashboard';
let activePeriod = 'All';

// ── Period Filter Helpers ────────────────────────────────────────────────────

function getFilteredCarriers() {
  if (!dashboard) return [];
  const all = dashboard.carrierPerformance || [];
  if (activePeriod === 'All') return all;
  return all.filter(c => {
    const p = c.referenceAudit?.period || c.period || '';
    return p === activePeriod;
  });
}

function getFilteredTotals() {
  if (!dashboard) return dashboard?.totals || {};
  if (activePeriod === 'All') return dashboard.totals;
  const carriers = getFilteredCarriers();
  const totalShipments  = carriers.reduce((s, c) => s + (c.total || 0), 0);
  const totalBilled     = carriers.reduce((s, c) => s + (c.totalBillingAmount || 0), 0);
  const refundAmount    = carriers.reduce((s, c) => s + (c.overbillingAmount || 0), 0);
  const openDisputes    = carriers.reduce((s, c) => s + (c.openDisputes || 0), 0);
  const delivered       = carriers.reduce((s, c) => s + (c.delivered || 0), 0);
  const rto             = carriers.reduce((s, c) => s + (c.rto || 0), 0);
  return {
    ...dashboard.totals,
    totalShipments,
    totalBillingAmount: totalBilled,
    refundAmount,
    openDisputes,
    delivered,
    rto,
    inTransit: dashboard.totals.inTransit || 0,
  };
}

function populatePeriodFilter() {
  const sel = document.getElementById('periodFilter');
  if (!sel || !dashboard) return;
  const periods = [...new Set(
    (dashboard.carrierPerformance || [])
      .map(c => c.referenceAudit?.period || c.period || '')
      .filter(Boolean)
  )].sort();
  sel.innerHTML = `<option value="All">All Periods</option>` +
    periods.map(p => `<option value="${p}"${activePeriod === p ? ' selected' : ''}>${p}</option>`).join('');
}
const LOCAL_KEY = 'logisticsLocalImports';

// ── Helpers ──────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }

function fmtInt(v)   { return Number(v || 0).toLocaleString('en-IN'); }
function fmtMoney(v) { return '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function fmtDays(v)  { return (v == null) ? '—' : Number(v).toFixed(1) + ' d'; }
function fmtPct(v)   { return Number(v || 0).toFixed(1) + '%'; }

function toast(msg) {
  const el = $('#toastNotif');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

// Splash stays visible until SVG drawing completes: ~900ms icon + ~1500ms text + buffer
const INTRO_MIN_MS = 6500;

function finishIntro() {
  document.body.classList.add('app-ready');
  const intro = $('#appIntro');
  if (!intro || intro.classList.contains('hide')) return;
  const elapsed   = Date.now() - _pageStartMS;   // true ms since page load
  const remaining = Math.max(0, INTRO_MIN_MS - elapsed);
  window.setTimeout(() => {
    intro.classList.add('hide');
    window.setTimeout(() => intro.remove(), 520);
  }, remaining + 380);
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  delivered: 'Delivered', in_transit: 'In Transit', out_for_delivery: 'Out for Delivery',
  rto_initiated: 'RTO Initiated', rto_delivered: 'RTO Delivered', rto_in_transit: 'RTO In Transit',
  delivery_attempted: 'Attempted', picked_up: 'Picked Up', exception: 'Exception',
};
function statusLabel(s) { return STATUS_LABELS[s] || s; }
function statusBadgeClass(s) {
  if (s === 'delivered')        return 'badge-delivered';
  if (s === 'out_for_delivery') return 'badge-transit';
  if (s === 'in_transit' || s === 'picked_up') return 'badge-transit';
  if (s === 'delivery_attempted') return 'badge-attempted';
  if (String(s).startsWith('rto_')) return 'badge-rto';
  if (s === 'exception')        return 'badge-exception';
  return 'badge-neutral';
}

// ── Router ────────────────────────────────────────────────────────────────────

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  orders:    'Orders',
  shipments: 'Shipments',
  returns:   'Returns & RTO',
  inventory: 'Inventory',
  billing:   'Carrier Billing',
  disputes:  'Disputes',
  finance:   'Finance & COD',
  import:    'Import Data',
  analytics: 'Analytics',
  ndr:       'NDR Management',
  pincode:   'Pincode Intelligence',
  reports:   'Reports',
  settings:  'Settings',
};

function navigate(pageId) {
  if (pageId === currentPage) return;
  currentPage = pageId;

  // Update sidebar
  document.querySelectorAll('.sb-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === pageId);
  });

  // Show/hide pages
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('hidden', el.id !== `page-${pageId}`);
  });

  // Update topbar title
  $('#pageTitle').textContent = PAGE_TITLES[pageId] || pageId;

  // Render page-specific content if needed
  if (dashboard) {
    if (pageId === 'orders')    renderOrdersPage();
    if (pageId === 'returns')   renderReturnsPage();
    if (pageId === 'inventory') renderInventoryPage();
    if (pageId === 'billing')   renderBillingPage();
    if (pageId === 'disputes')  renderFullDisputesPage();
    if (pageId === 'finance')   renderFinancePage();
    if (pageId === 'analytics') renderAnalyticsPage();
    if (pageId === 'ndr')       renderNdrPage();
    if (pageId === 'pincode')   renderPincodePage();
    if (pageId === 'reports')   renderReportsPage();
    if (pageId === 'settings')  renderSettingsPage();
  }
}

// ── Render: KPIs (Dashboard) ──────────────────────────────────────────────────

function renderKPIs(t) {
  const deliveryRate = t.totalShipments ? ((t.delivered / t.totalShipments) * 100).toFixed(1) : '0.0';
  const rtoRate      = t.totalShipments ? ((t.rto / t.totalShipments) * 100).toFixed(1) : '0.0';

  const cards = [
    { label: 'Total Shipments',   value: fmtInt(t.totalShipments),    hint: `${fmtInt(t.delivered)} delivered`,           tone: 'k-blue' },
    { label: 'Total Billed',      value: fmtMoney(t.totalBillingAmount), hint: `Across all ${fmtInt(t.totalShipments)} shipments`, tone: 'k-gold' },
    { label: 'Total Overcharge',  value: fmtMoney(t.refundAmount),     hint: 'Raise disputes',                            tone: 'k-rose' },
    { label: 'Open Disputes',     value: fmtInt(t.openDisputes),       hint: `${fmtMoney(t.refundAmount)} at risk`,       tone: 'k-red' },
    { label: 'RTO Rate',          value: fmtPct(rtoRate),              hint: `${fmtInt(t.rto)} returns`,                  tone: Number(rtoRate) > 20 ? 'k-red' : Number(rtoRate) > 12 ? 'k-amber' : 'k-green' },
    { label: 'Avg Delivery',      value: fmtDays(t.avgDeliveryDays),   hint: `${deliveryRate}% delivery rate`,             tone: 'k-green' },
  ];

  $('#kpiGrid').innerHTML = cards.map((c, i) => `
    <div class="kpi-card ${c.tone}" style="animation-delay:${i * 0.06}s">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-hint">${c.hint}</div>
    </div>
  `).join('');

  // Nav badges
  const rtoBadge = $('#navRtoBadge');
  const dispBadge = $('#navDisputeBadge');
  if (rtoBadge && Number(rtoRate) > 15) rtoBadge.textContent = fmtPct(rtoRate);
  if (dispBadge && t.openDisputes > 0) dispBadge.textContent = fmtInt(t.openDisputes);
}

// ── Render: Carrier Audit Table ───────────────────────────────────────────────

function renderAuditTable(rows, totals, tbodyId = 'auditRows') {
  const totalBilled = totals.totalBillingAmount || 1;
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  tbody.innerHTML = rows.map(r => {
    const variance  = r.overbillingAmount || (r.totalBillingAmount - r.expectedBillingAmount);
    const varAbs    = Math.abs(variance);
    const varClass  = variance > 100 ? 'over' : variance < -100 ? 'under' : 'even';
    const varSign   = variance > 100 ? '+' : variance < -100 ? '−' : '';
    const varText   = varAbs > 10 ? `${varSign}${fmtMoney(varAbs)}` : '—';
    const billingShare = Math.min((r.totalBillingAmount / totalBilled) * 100, 100);
    const rtoColor  = r.rtoRate > 20 ? '#BE2E2E' : r.rtoRate > 10 ? '#B05A10' : '#1E7B48';
    const dispColor = r.disputeRate > 15 ? '#BE2E2E' : r.disputeRate > 5 ? '#B05A10' : '#9895A2';

    // If carrier has shipments but 0 delivered AND 0 RTO → tracking data incomplete
    const trackingMissing = r.total > 0 && r.delivered === 0 && r.rto === 0;
    const rtoCell = trackingMissing
      ? `<span style="color:var(--text-3);font-style:italic;font-size:12px">No tracking</span>`
      : `<div class="bar-wrap">
           <span style="color:${rtoColor};font-weight:600">${r.rtoRate}%</span>
           <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(r.rtoRate,100)}%;background:${rtoColor}"></div></div>
         </div>`;

    const shortRow = tbodyId === 'auditRows';
    if (shortRow) {
      return `
        <tr data-carrier="${r.carrier}">
          <td>
            <div style="font-weight:600;display:flex;align-items:center;gap:6px">
              ${r.carrier}
              <span style="font-size:10px;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:1px 5px">→</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${fmtPct(billingShare)} of billing</div>
          </td>
          <td class="r num">${fmtInt(r.total)}</td>
          <td class="r num">${fmtMoney(r.totalBillingAmount)}</td>
          <td class="r" title="Negative = carrier billed less than rate card. Positive = carrier overcharged you.">
            ${varAbs > 10 ? `<span class="var-chip ${varClass}">${varText}</span>` : '<span class="num-zero">—</span>'}
          </td>
          <td class="r">
            <div class="bar-wrap">
              <span style="color:${dispColor};font-weight:600">${fmtInt(r.openDisputes)}</span>
              <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(r.disputeRate,100)}%;background:${dispColor}"></div></div>
            </div>
          </td>
          <td class="r">${rtoCell}</td>
          <td class="r num" style="color:var(--text-2)">${trackingMissing ? '—' : fmtDays(r.avgDeliveryDays)}</td>
        </tr>`;
    } else {
      return `
        <tr data-carrier="${r.carrier}">
          <td>
            <div style="font-weight:600;display:flex;align-items:center;gap:6px">
              ${r.carrier}
              <span style="font-size:10px;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:1px 5px">View →</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">${fmtPct(billingShare)} of billing</div>
          </td>
          <td class="r num">${fmtInt(r.total)}</td>
          <td class="r num">${fmtMoney(r.totalBillingAmount)}</td>
          <td class="r num" style="color:var(--text-2)">${r.expectedBillingAmount > 0 ? fmtMoney(r.expectedBillingAmount) : '—'}</td>
          <td class="r" title="Negative = carrier billed less than rate card. Positive = carrier overcharged you.">
            ${varAbs > 10 ? `<span class="var-chip ${varClass}">${varText}</span>` : '<span class="num-zero">—</span>'}
          </td>
          <td class="r">
            <div class="bar-wrap">
              <span style="color:${dispColor};font-weight:600">${fmtInt(r.openDisputes)}</span>
              <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(r.disputeRate,100)}%;background:${dispColor}"></div></div>
            </div>
          </td>
          <td class="r num" style="color:var(--red)">${r.disputeAmount > 0 ? fmtMoney(r.disputeAmount) : '—'}</td>
          <td class="r">${rtoCell}</td>
          <td class="r num" style="color:var(--text-2)">${trackingMissing ? '—' : fmtDays(r.avgDeliveryDays)}</td>
        </tr>`;
    }
  }).join('') || `<tr><td colspan="9" class="loading-cell">No carrier data available</td></tr>`;

  document.querySelectorAll(`#${tbodyId} tr[data-carrier]`).forEach(row => {
    row.addEventListener('click', () => openCarrierPage(row.dataset.carrier));
  });

  const totalVariance = rows.reduce((s, r) => s + (r.overbillingAmount || 0), 0);
  const badge = tbodyId === 'auditRows' ? '#billingBadge' : '#billingBadge2';
  const badgeEl = $(badge);
  if (badgeEl) badgeEl.innerHTML = totalVariance > 100
    ? `<span class="var-chip over">+${fmtMoney(totalVariance)} net overbilled</span>`
    : '';
}

// ── Render: Signals ───────────────────────────────────────────────────────────

function renderSignals(t) {
  const total = t.totalShipments || 1;
  const signals = [
    { label: 'Delivery Rate', value: fmtPct((t.delivered / total) * 100), hint: `${fmtInt(t.delivered)} of ${fmtInt(total)}`, barColor: '#1E7B48', barPct: Math.min((t.delivered / total) * 100, 100) },
    { label: 'RTO Exposure',  value: fmtPct((t.rto / total) * 100), hint: `${fmtInt(t.rto)} returns`, barColor: (t.rto/total)>.2 ? '#BE2E2E' : (t.rto/total)>.1 ? '#B05A10' : '#1E7B48', barPct: Math.min((t.rto/total)*100,100) },
    { label: 'In Transit',    value: fmtInt(t.inTransit), hint: `${fmtPct((t.inTransit/total)*100)} of total`, barColor: '#1C52B8', barPct: Math.min((t.inTransit/total)*500,100) },
    { label: 'Dispute Load',  value: fmtPct((t.openDisputes/total)*100), hint: `${fmtMoney(t.refundAmount)} recoverable`, barColor: (t.openDisputes/total)>.15 ? '#BE2E2E' : '#9895A2', barPct: Math.min((t.openDisputes/total)*300,100) },
  ];
  $('#signalGrid').innerHTML = signals.map(s => `
    <div class="signal-card">
      <div class="signal-label">${s.label}</div>
      <div class="signal-value">${s.value}</div>
      <div class="signal-hint">${s.hint}</div>
      <div class="signal-bar"><div class="signal-bar-fill" style="width:${s.barPct}%;background:${s.barColor}"></div></div>
    </div>
  `).join('');
}

// ── Render: Status Chart ──────────────────────────────────────────────────────

function renderStatusChart() {
  const summary = dashboard.statusSummary || {};
  const entries = Object.entries(summary).filter(([, v]) => v > 0);
  if (!entries.length) return;
  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  const colors = { Delivered:'#1E7B48', Moving:'#1C52B8', RTO:'#BE2E2E', Exceptions:'#B05A10', 'Lost/Damaged':'#5C5860' };

  const canvas = $('#statusChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssH = 140, cssW = canvas.parentElement.clientWidth || 400;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const max = Math.max(...values, 1);
  const count = values.length, pad = 16;
  const barW = Math.max(24, (cssW - pad * 2 - (count - 1) * 10) / count);
  const chartH = cssH - 42;
  values.forEach((v, i) => {
    const bh = Math.max(2, (v / max) * chartH);
    const x = pad + i * (barW + 10), y = chartH - bh;
    ctx.fillStyle = colors[labels[i]] || '#9895A2';
    ctx.beginPath(); ctx.roundRect(x, y, barW, bh, [4,4,0,0]); ctx.fill();
    ctx.fillStyle = '#1B1820'; ctx.font = '600 11px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(fmtInt(v), x + barW / 2, y - 6);
    ctx.fillStyle = '#9895A2'; ctx.font = '500 10px Inter,sans-serif';
    ctx.fillText(String(labels[i]).slice(0,10), x + barW / 2, cssH - 6);
  });
}

// ── Render: Bar Chart (overcharge) ────────────────────────────────────────────

function drawOverchargeBarChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const cssW = (canvas.parentElement.offsetWidth || 320) - 8;
  const cssH = parseInt(canvas.getAttribute('height')) || 180;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!values.length || values.every(v => v === 0)) {
    ctx.fillStyle = '#9895A2'; ctx.font = '13px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No overcharges recorded', cssW / 2, cssH / 2); return;
  }

  const maxVal = Math.max(...values, 1);
  const count  = values.length;
  const padL=8, padR=8, padT=26, padB=32;
  const chartW = cssW - padL - padR;
  const chartH = cssH - padT - padB;
  const gap    = 6;
  const barW   = Math.max(14, (chartW - (count-1)*gap) / count);

  ctx.strokeStyle = '#E5DDD3'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL+chartW, padT); ctx.stroke();

  values.forEach((v, i) => {
    const bh = Math.max(2, (v / maxVal) * chartH);
    const x  = padL + i * (barW + gap);
    const y  = padT + chartH - bh;
    ctx.fillStyle = color; ctx.globalAlpha = v > 0 ? 1 : 0.25;
    ctx.beginPath(); ctx.roundRect(x, y, barW, bh, [3,3,0,0]); ctx.fill();
    ctx.globalAlpha = 1;
    if (v > 0) {
      ctx.fillStyle = '#1B1820'; ctx.font = '600 10px Inter,sans-serif'; ctx.textAlign = 'center';
      const valStr = v >= 1000 ? '₹' + (v/1000).toFixed(1) + 'k' : '₹' + Math.round(v);
      ctx.fillText(valStr, x + barW/2, y - 5);
    }
    ctx.fillStyle = '#9895A2'; ctx.font = '500 9.5px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText((labels[i] || '').slice(0,10), x + barW/2, cssH - 6);
  });
}

// ── Render: Zone Chart (Main Dashboard) ──────────────────────────────────────

function renderMainZoneChart() {
  // Aggregate zone data from carrier performance (rough estimate)
  const zoneMap = new Map();
  for (const c of dashboard.carrierPerformance || []) {
    const zone = c.carrier;
    const oc = Math.max(0, c.overbillingAmount || 0);
    if (oc > 0) zoneMap.set(zone, (zoneMap.get(zone) || 0) + oc);
  }
  const sorted = [...zoneMap.entries()].sort((a,b) => b[1]-a[1]).slice(0, 6);
  drawOverchargeBarChart('zoneChartMain', sorted.map(e=>e[0]), sorted.map(e=>e[1]), '#BC6070');
}

// ── Render: Disputes ──────────────────────────────────────────────────────────

function renderDisputes() {
  const shipById = new Map(dashboard.shipments.map(s => [s.id, s]));
  const disputes = [...dashboard.disputes].filter(d => d.status === 'open')
    .sort((a, b) => (b.claimedAmount || 0) - (a.claimedAmount || 0));

  const total = disputes.length;
  const showing = Math.min(disputePageSize, total);
  const slice = disputes.slice(0, showing);

  $('#disputeSub').textContent = `${fmtInt(total)} open · ${fmtMoney(disputes.reduce((s,d)=>s+(d.claimedAmount||0),0))} at risk`;

  const loadBtn = $('#loadMoreDisputes');
  if (total > showing) { loadBtn.style.display='inline-flex'; loadBtn.textContent=`Load more (${total-showing} remaining)`; }
  else loadBtn.style.display = 'none';

  $('#disputeList').innerHTML = slice.map(d => {
    const ship = shipById.get(d.shipmentId);
    const awb  = ship?.awb || d.shipmentId?.slice(0,10) || '—';
    const carrier = ship?.carrier || '—';
    return `
      <div class="dispute-item">
        <div class="dispute-left">
          <div class="dispute-awb">${awb}</div>
          <div class="dispute-meta">${carrier} · ${d.reason?.replace(/_/g,' ') || 'charge variance'}</div>
        </div>
        <div class="dispute-right">
          <span class="dispute-amount">${fmtMoney(d.claimedAmount)}</span>
          <span class="badge badge-open">${d.status}</span>
          <button class="btn btn-sm btn-outline" data-dispute-id="${d.id}" data-next-status="submitted">Submit</button>
        </div>
      </div>`;
  }).join('') || '<div class="detail-empty">No open disputes — all clear.</div>';

  document.querySelectorAll('[data-dispute-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch(`/api/disputes/${btn.dataset.disputeId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:btn.dataset.nextStatus}) });
      toast('Dispute marked as submitted');
      await boot(false);
    });
  });
}

// ── Render: Shipments ─────────────────────────────────────────────────────────

function currentRows() {
  const q = ($('#search')?.value || '').toLowerCase();
  const carrier = $('#carrierFilter')?.value || '';
  const status  = $('#statusFilter')?.value  || '';
  return dashboard.shipments.filter(s => {
    const hay = `${s.awb} ${s.carrier} ${s.currentStatus} ${s.destinationRegion || ''}`.toLowerCase();
    return (!q || hay.includes(q)) && (!carrier || s.carrier === carrier) && (!status || s.currentStatus === status);
  });
}

function renderShipments() {
  const rows = currentRows();
  const db = $('#dataBanner'); if (db) db.textContent = `Database: ${fmtInt(dashboard.totals.totalShipments)} shipments · showing ${fmtInt(rows.length)} rows · KPIs use full dataset`;
  const ss = $('#shipmentSub'); if (ss) ss.textContent = `${fmtInt(dashboard.totals.totalShipments)} total · ${fmtInt(dashboard.totals.delivered)} delivered · ${fmtInt(dashboard.totals.rto)} RTO`;
  const tbody = $('#shipRows'); if (!tbody) return;
  tbody.innerHTML = rows.map(s => `
    <tr class="clickable ${s.id===selectedShipmentId?'selected':''}" data-sid="${s.id}">
      <td><strong>${s.awb}</strong></td>
      <td style="color:var(--text-2)">${s.order?.externalOrderId || '—'}</td>
      <td>${s.carrier || '—'}</td>
      <td><span class="badge ${statusBadgeClass(s.currentStatus)}">${statusLabel(s.currentStatus)}</span></td>
      <td style="color:var(--text-2)">${s.destinationRegion || '—'}</td>
      <td class="c">${s.deliveryAttempts || 0}</td>
      <td class="c">${s.rtoFlag ? '<span class="badge badge-rto">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="loading-cell">No shipments match filters</td></tr>';

  document.querySelectorAll('[data-sid]').forEach(row => {
    row.addEventListener('click', () => { selectedShipmentId = row.dataset.sid; renderShipments(); renderDetail(); });
  });
}

function fillCarrierFilter() {
  const sel = $('#carrierFilter'); if (!sel) return;
  const cur = sel.value;
  // Use carrierPerformance (all carriers) — not the 1000-row shipments slice
  const carriers = (dashboard.carrierPerformance || []).map(p => p.carrier).filter(Boolean).sort();
  sel.innerHTML = '<option value="">All carriers</option>' + carriers.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = carriers.includes(cur) ? cur : '';
}

function renderDetail() {
  const dp = $('#detailPanel'); if (!dp) return;
  const s = dashboard.shipments.find(s => s.id === selectedShipmentId);
  if (!s) { dp.innerHTML = '<div class="detail-empty">Select a shipment<br>to view details</div>'; return; }
  const charges  = dashboard.charges.filter(c => c.shipmentId === s.id);
  const disputes = dashboard.disputes.filter(d => d.shipmentId === s.id);
  dp.innerHTML = `
    <div class="detail-title">${s.awb}</div>
    <div class="detail-grid">
      <div class="df"><span>Carrier</span><strong>${s.carrier || '—'}</strong></div>
      <div class="df"><span>Status</span><strong>${statusLabel(s.currentStatus)}</strong></div>
      <div class="df"><span>Region</span><strong>${s.destinationRegion || '—'}</strong></div>
      <div class="df"><span>Order</span><strong>${s.order?.externalOrderId || '—'}</strong></div>
      <div class="df"><span>Promised</span><strong>${s.promisedDeliveryDate || '—'}</strong></div>
      <div class="df"><span>Delivered</span><strong>${s.actualDeliveryDate || '—'}</strong></div>
    </div>
    <div class="mini-section"><h3>Charges (${charges.length})</h3>
      ${charges.length ? charges.map(c => `<p>${c.chargeType}: billed ${fmtMoney(c.billedAmount)}, expected ${c.expectedAmount!=null?fmtMoney(c.expectedAmount):'—'}, variance <strong style="color:${(c.varianceAmount||0)>10?'var(--red)':'var(--green)'}">${fmtMoney(c.varianceAmount)}</strong></p>`).join('') : '<p>No charges recorded</p>'}
    </div>
    <div class="mini-section"><h3>Disputes (${disputes.length})</h3>
      ${disputes.length ? disputes.map(d => `<p><span class="badge badge-${d.status}">${d.status}</span> ${fmtMoney(d.claimedAmount)} — ${d.disputeNote||''}</p>`).join('') : '<p>No disputes</p>'}
    </div>`;
}

// ── Carrier Detail Page ───────────────────────────────────────────────────────

let carrierShipRows = [];
let carrierChargesMap = new Map();

async function openCarrierPage(carrierName) {
  const perf = dashboard.carrierPerformance.find(c => c.carrier === carrierName);
  const page = $('#carrierPage');
  $('#carrierPageTitle').textContent = carrierName;
  $('#carrierPageBadge').textContent = perf ? `${fmtInt(perf.total)} shipments · ${fmtPct(perf.total/(dashboard.totals.totalShipments||1)*100)} of volume` : 'Loading…';
  $('#carrierLoadingBadge').textContent = 'Loading data…';
  $('#carrierKpis').innerHTML = '';
  $('#carrierZoneRows').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:20px">Loading…</td></tr>';
  $('#carrierDisputeList').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3)">Loading…</div>';
  $('#carrierShipRows').innerHTML = '<tr><td colspan="7" class="loading-cell">Loading shipments…</td></tr>';
  page.classList.add('open'); page.scrollTop = 0;

  let data;
  try {
    const r = await fetch(`/api/carriers/${encodeURIComponent(carrierName)}/details`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (err) { $('#carrierLoadingBadge').textContent = 'Load error'; toast('Failed to load carrier data'); return; }

  $('#carrierLoadingBadge').textContent = data.referenceAudit
    ? `${data.referenceAudit.confidence === 'excluded_by_user_review' ? 'Review needed' : 'Confirmed audit'} · ${data.referenceAudit.period || ''}`
    : `${fmtInt(data.totalShipments)} total shipments`;

  const kpis = [
    { label:'Total Shipments', value:fmtInt(data.totalShipments),     hint:`${fmtInt(data.totalDelivered)} delivered`, cls:'' },
    { label:'Total Billed',    value:fmtMoney(data.totalBilled),       hint:`across all shipments`, cls:'' },
    { label:data.referenceAudit?'Confirmed Claim':'Total Overcharge', value:fmtMoney(data.totalOvercharge), hint:data.referenceAudit?`${data.referenceAudit.period||''} ref audit`:data.totalOvercharge>100?'Raise disputes':'Within limits', cls:data.totalOvercharge>100?'red':'green' },
    { label:data.referenceAudit?'Audit Errors':'Open Disputes', value:fmtInt(data.totalOpenDisputes), hint:`${fmtMoney(data.totalAtRisk)} at risk`, cls:data.totalOpenDisputes>0?'red':'green' },
    { label:'RTO Rate',        value:fmtPct(data.rtoRate),            hint:`${fmtInt(data.totalRTO)} returns`, cls:data.rtoRate>20?'red':data.rtoRate>10?'amber':'green' },
    { label:'Avg Delivery',    value:fmtDays(perf?.avgDeliveryDays),  hint:'Pickup → Delivered', cls:'' },
  ];
  $('#carrierKpis').innerHTML = kpis.map(k => `
    <div class="c-kpi ${k.cls}">
      <div class="c-kpi-label">${k.label}</div>
      <div class="c-kpi-value">${k.value}</div>
      <div class="c-kpi-hint">${k.hint}</div>
    </div>`).join('');

  const zones = data.zoneBreakdown || [];
  const totalZoneOC = zones.reduce((s,z) => s+z.overcharge, 0);
  $('#carrierZoneSub').textContent = `${fmtInt(data.totalShipments)} shipments · ${fmtMoney(totalZoneOC)} total overcharge`;
  $('#carrierZoneRows').innerHTML = zones.slice(0,20).map(z => `
    <tr>
      <td>${z.zone}</td>
      <td class="r">${fmtInt(z.total)}</td>
      <td class="r" style="color:${z.overcharge>0?'var(--red)':'var(--text-3)'}">${z.overcharge>0?fmtMoney(z.overcharge):'—'}</td>
      <td class="r" style="color:${z.disputes>0?'var(--red)':'var(--text-3)'}">${fmtInt(z.disputes)}</td>
      <td class="r" style="color:${z.rto>0?'var(--amber)':'var(--text-3)'}">${fmtInt(z.rto)}</td>
    </tr>`).join('') + (zones.length ? `<tr><td>TOTAL</td><td class="r">${fmtInt(zones.reduce((s,z)=>s+z.total,0))}</td><td class="r" style="color:var(--red);font-weight:700">${fmtMoney(totalZoneOC)}</td><td class="r"></td><td class="r"></td></tr>` : '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:16px">No zone data</td></tr>');

  const topZones = zones.filter(z=>z.overcharge>0).slice(0,8);
  drawOverchargeBarChart('zoneChart', topZones.map(z=>z.zone.slice(0,12)), topZones.map(z=>z.overcharge), '#BC6070');
  const wb = data.weightBreakdown || {};
  const wLabels = Object.keys(wb);
  drawOverchargeBarChart('weightChart', wLabels, wLabels.map(k=>wb[k].overcharge||0), '#9B7240');

  $('#carrierDisputeSub').textContent = `${fmtInt(data.totalOpenDisputes)} open · ${fmtMoney(data.totalAtRisk)} at risk`;
  const shipById = new Map(data.shipments.map(s=>[s.id,s]));
  const referenceShipLabel = data.referenceAudit ? data.referenceAudit.carrier : null;
  $('#carrierDisputeList').innerHTML = data.disputes.length
    ? data.disputes.map(d => {
        const ship = shipById.get(d.shipmentId);
        return `<div class="c-dispute-item"><div><div class="c-dispute-awb">${ship?.awb||referenceShipLabel||d.shipmentId?.slice(0,12)||'—'}</div><div class="c-dispute-meta">${ship?.destinationRegion||'—'} · ${(d.disputeNote||'').slice(0,60)}</div></div><div class="c-dispute-amt">${fmtMoney(d.claimedAmount)}</div></div>`;
      }).join('')
    : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No open disputes</div>';

  carrierShipRows = data.shipments;
  carrierChargesMap = new Map();
  for (const c of data.charges) carrierChargesMap.set(c.shipmentId, c);
  renderCarrierShipments();
}

function renderCarrierShipments() {
  const q = ($('#carrierSearch')?.value || '').toLowerCase();
  const status = $('#carrierStatusFilter')?.value || '';
  const oc = $('#carrierOCFilter')?.value || '';
  const filtered = carrierShipRows.filter(s => {
    const hay = `${s.awb} ${s.destinationRegion||''} ${s.currentStatus}`.toLowerCase();
    const charge = carrierChargesMap.get(s.id);
    const isOver = charge && Number(charge.varianceAmount||0) > 10;
    return (!q || hay.includes(q)) && (!status || s.currentStatus===status) && (!oc || (oc==='over'?isOver:!isOver));
  });
  const sub = $('#carrierShipSub');
  if (sub) sub.textContent = carrierShipRows.length ? `${fmtInt(carrierShipRows.length)} total · showing ${fmtInt(filtered.length)}` : 'No raw shipment rows imported · showing reference audit only';
  const tbody = $('#carrierShipRows'); if (!tbody) return;
  tbody.innerHTML = filtered.slice(0,500).map(s => {
    const c = carrierChargesMap.get(s.id);
    const ov = c ? Number(c.varianceAmount||0) : null;
    return `<tr>
      <td><strong>${s.awb}</strong></td>
      <td style="color:var(--text-2)">${s.order?.externalOrderId||'—'}</td>
      <td><span class="badge ${statusBadgeClass(s.currentStatus)}">${statusLabel(s.currentStatus)}</span></td>
      <td style="color:var(--text-2)">${s.destinationRegion||'—'}</td>
      <td class="r num">${c?fmtMoney(c.billedAmount):'—'}</td>
      <td class="r num">${ov!==null ? (ov>10?`<span style="color:var(--red);font-weight:600">${fmtMoney(ov)}</span>`:'<span style="color:var(--text-3)">—</span>') : '—'}</td>
      <td class="c">${s.rtoFlag?'<span class="badge badge-rto">Yes</span>':'<span class="badge badge-neutral">No</span>'}</td>
    </tr>`;
  }).join('') + (filtered.length>500?`<tr><td colspan="7" class="loading-cell">Showing first 500 of ${fmtInt(filtered.length)}</td></tr>`:'')
  || '<tr><td colspan="7" class="loading-cell">No shipments match filters</td></tr>';
}

function closeCarrierPage() { $('#carrierPage').classList.remove('open'); }

// ── Page: ORDERS (demo data) ──────────────────────────────────────────────────

function renderOrdersPage() {
  // Demo data based on Dermatouch profile
  const totalOrders = 7284, gmv = 6731840, aov = 924, codPct = 62;
  const kpis = [
    { label:'Total Orders',    value:fmtInt(totalOrders),   hint:'Last 30 days',            tone:'k-blue' },
    { label:'Gross Revenue',   value:fmtMoney(gmv),          hint:'Before returns & cancels', tone:'k-gold' },
    { label:'Avg Order Value', value:fmtMoney(aov),          hint:'Per transaction',          tone:'k-green' },
    { label:'COD Orders',      value:fmtPct(codPct),         hint:`${fmtInt(totalOrders*codPct/100)} orders COD`, tone:'k-amber' },
    { label:'Prepaid Orders',  value:fmtPct(100-codPct),     hint:'Card / UPI / Netbanking',  tone:'k-blue' },
    { label:'Cancelled',       value:'3.2%',                 hint:'232 orders cancelled',     tone:'k-rose' },
  ];
  const grid = $('#ordersKpiGrid');
  if (grid) grid.innerHTML = kpis.map((c,i) => `
    <div class="kpi-card ${c.tone}" style="animation-delay:${i*.06}s">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-hint">${c.hint}</div>
    </div>`).join('');

  // Daily orders line chart
  const lineCanvas = document.getElementById('ordersLineChart');
  if (lineCanvas) {
    const seed = [230,198,312,287,264,198,176,320,341,298,263,289,247,192,315,338,296,271,310,255,197,182,285,304,268,241,293,319,287,244];
    drawLineChart(lineCanvas, seed, '#9B7240');
  }

  // COD vs Prepaid donut
  const wrap = $('#codPrepaidWrap');
  if (wrap) {
    const codOrders = Math.round(totalOrders * codPct / 100);
    const prepOrders = totalOrders - codOrders;
    wrap.innerHTML = `
      <canvas id="donutChart" width="160" height="160" style="flex-shrink:0"></canvas>
      <div class="donut-labels">
        <div class="donut-legend-item"><div class="donut-dot" style="background:#9B7240"></div><div class="donut-legend-label">COD (Cash on Delivery)</div><div class="donut-legend-val">${fmtInt(codOrders)}</div></div>
        <div class="donut-legend-item"><div class="donut-dot" style="background:#1C52B8"></div><div class="donut-legend-label">Prepaid (Card / UPI)</div><div class="donut-legend-val">${fmtInt(prepOrders)}</div></div>
      </div>`;
    drawDonut('donutChart', [codPct, 100-codPct], ['#9B7240','#1C52B8']);
  }

  // Top products
  const products = [
    { name:'AHA BHA Face Wash', sku:'DT-FW-01', orders:1842, revenue:fmtMoney(1842*599), ret:'6.2%', retCls:'red' },
    { name:'Vitamin C Serum 30ml', sku:'DT-SR-02', orders:1560, revenue:fmtMoney(1560*899), ret:'3.8%', retCls:'green' },
    { name:'Niacinamide Moisturizer', sku:'DT-MO-03', orders:1224, revenue:fmtMoney(1224*799), ret:'4.1%', retCls:'green' },
    { name:'SPF 50+ Sunscreen', sku:'DT-SN-04', orders:984, revenue:fmtMoney(984*699), ret:'2.9%', retCls:'green' },
    { name:'Retinol Night Cream', sku:'DT-NC-05', orders:721, revenue:fmtMoney(721*1199), ret:'7.4%', retCls:'red' },
    { name:'Kojic Acid Soap (2-pack)', sku:'DT-SP-06', orders:612, revenue:fmtMoney(612*349), ret:'5.1%', retCls:'red' },
    { name:'Hyaluronic Acid Toner', sku:'DT-TO-07', orders:341, revenue:fmtMoney(341*749), ret:'3.3%', retCls:'green' },
  ];
  const pt = $('#topProductsTable');
  if (pt) pt.innerHTML = `
    <div class="product-table-row" style="padding:6px 0 10px;border-bottom:1px solid var(--border)">
      <div class="row-head-label">Product</div>
      <div class="row-head-label" style="text-align:right">Orders</div>
      <div class="row-head-label" style="text-align:right">Revenue</div>
      <div class="row-head-label" style="text-align:right">Return%</div>
    </div>` +
    products.map(p => `
      <div class="product-table-row">
        <div><div class="product-name">${p.name}</div><div class="product-sku">${p.sku}</div></div>
        <div class="product-stat">${fmtInt(p.orders)}</div>
        <div class="product-stat">${p.revenue}</div>
        <div class="product-stat ${p.retCls}">${p.ret}</div>
      </div>`).join('');

  // State bar chart
  const stateCanvas = document.getElementById('stateBarChart');
  if (stateCanvas) {
    const stateLabels = ['Maharashtra','Delhi','Karnataka','UP','Tamil Nadu','Gujarat','Rajasthan','West Bengal'];
    const stateVals   = [2048,1382,1060,870,654,528,412,330];
    drawHBarChart(stateCanvas, stateLabels, stateVals, '#1C52B8');
  }
}

function drawLineChart(canvas, data, color) {
  const dpr  = window.devicePixelRatio || 1;
  const cssW = (canvas.parentElement.offsetWidth || 400) - 8;
  const cssH = parseInt(canvas.getAttribute('height')) || 200;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL=36, padR=12, padT=16, padB=28;
  const chartW = cssW - padL - padR, chartH = cssH - padT - padB;
  const maxVal = Math.max(...data), minVal = Math.min(...data);
  const range  = maxVal - minVal || 1;
  const n = data.length;

  // Grid lines
  ctx.strokeStyle = '#E5DDD3'; ctx.lineWidth = 1;
  [0,.25,.5,.75,1].forEach(t => {
    const y = padT + chartH * t;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+chartW, y); ctx.stroke();
    const val = Math.round(maxVal - range * t);
    ctx.fillStyle = '#9895A2'; ctx.font = '9.5px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtInt(val), padL-4, y+3.5);
  });

  const pts = data.map((v,i) => ({ x: padL + (i/(n-1))*chartW, y: padT + chartH*(1-(v-minVal)/range) }));

  // Fill area
  ctx.beginPath(); ctx.moveTo(pts[0].x, padT+chartH);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, padT+chartH); ctx.closePath();
  ctx.fillStyle = color + '1A'; ctx.fill();

  // Line
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

  // X labels (every 5 days)
  ctx.fillStyle = '#9895A2'; ctx.font = '9.5px Inter,sans-serif'; ctx.textAlign = 'center';
  data.forEach((v, i) => {
    if (i % 5 === 0) ctx.fillText(`D${i+1}`, pts[i].x, cssH - 6);
  });
}

function drawDonut(canvasId, data, colors) {
  const canvas = document.getElementById(canvasId); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 160, cx = size/2, cy = size/2, r = 58, innerR = 36;
  canvas.width = size; canvas.height = size;
  ctx.clearRect(0,0,size,size);
  const total = data.reduce((a,b)=>a+b,0);
  let angle = -Math.PI/2;
  data.forEach((v,i) => {
    const sweep = (v/total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,angle,angle+sweep); ctx.closePath();
    ctx.fillStyle = colors[i]; ctx.fill();
    angle += sweep;
  });
  ctx.beginPath(); ctx.arc(cx,cy,innerR,0,Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = '#1B1820'; ctx.font = '700 14px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(data[0]+'%', cx, cy);
}

function drawHBarChart(canvas, labels, values, color) {
  const dpr  = window.devicePixelRatio || 1;
  const cssW = (canvas.parentElement.offsetWidth || 400) - 8;
  const cssH = parseInt(canvas.getAttribute('height')) || 200;
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const maxVal = Math.max(...values, 1);
  const count  = values.length;
  const barH   = Math.max(14, (cssH - (count+1)*6) / count);
  const padL   = 100, padR = 50, padT = 8;
  values.forEach((v, i) => {
    const y = padT + i * (barH + 6);
    const bw = Math.max(2, (v/maxVal)*(cssW-padL-padR));
    ctx.fillStyle = color + '22';
    ctx.fillRect(padL, y, cssW-padL-padR, barH);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(padL, y, bw, barH, [0,3,3,0]); ctx.fill();
    ctx.fillStyle = '#5C5860'; ctx.font = '11px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(labels[i], padL-6, y + barH/2 + 4);
    ctx.fillStyle = '#1B1820'; ctx.font = '600 11px Inter,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(fmtInt(v), padL + bw + 6, y + barH/2 + 4);
  });
}

// ── Page: RETURNS & RTO ───────────────────────────────────────────────────────

function renderReturnsPage() {
  const carriers = dashboard.carrierPerformance || [];
  const totals   = dashboard.totals;
  const rtoRate  = totals.totalShipments ? ((totals.rto / totals.totalShipments) * 100) : 0;

  const kpis = [
    { label:'Total RTO',        value:fmtInt(totals.rto),        hint:'Returned to origin',                tone:'k-red' },
    { label:'Overall RTO Rate', value:fmtPct(rtoRate),           hint:'Across all carriers',               tone: rtoRate > 20 ? 'k-red' : 'k-amber' },
    { label:'Avg RTO Cost',     value:'₹89',                     hint:'Per returned shipment (fwd+RTO)',   tone:'k-amber' },
    { label:'Total RTO Loss',   value:fmtMoney(totals.rto * 89), hint:'Estimated recovery cost',           tone:'k-rose' },
    { label:'Best Carrier RTO', value: (() => { const best = carriers.filter(c=>c.rtoRate>0).sort((a,b)=>a.rtoRate-b.rtoRate)[0]; return best ? fmtPct(best.rtoRate) : '—'; })(), hint: (() => { const best = carriers.filter(c=>c.rtoRate>0).sort((a,b)=>a.rtoRate-b.rtoRate)[0]; return best?.carrier || '—'; })(), tone:'k-green' },
    { label:'Worst Carrier RTO',value: (() => { const worst = [...carriers].sort((a,b)=>b.rtoRate-a.rtoRate)[0]; return worst ? fmtPct(worst.rtoRate) : '—'; })(), hint: (() => { const worst = [...carriers].sort((a,b)=>b.rtoRate-a.rtoRate)[0]; return worst?.carrier || '—'; })(), tone:'k-red' },
  ];
  const grid = $('#returnsKpiGrid');
  if (grid) grid.innerHTML = kpis.map((c,i) => `
    <div class="kpi-card ${c.tone}" style="animation-delay:${i*.06}s">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-hint">${c.hint}</div>
    </div>`).join('');

  // RTO by carrier table
  const ct = $('#rtoCarrierTable');
  if (ct) {
    const sorted = [...carriers].filter(c=>c.total>0).sort((a,b)=>b.rtoRate-a.rtoRate);
    ct.innerHTML = `
      <div class="rto-carrier-row" style="padding:4px 0 8px;border-bottom:1px solid var(--border)">
        <div class="row-head-label">Carrier</div>
        <div class="row-head-label" style="text-align:right">Shipments</div>
        <div class="row-head-label" style="text-align:right">RTO Count</div>
        <div class="row-head-label" style="text-align:right">RTO Rate</div>
        <div class="row-head-label" style="text-align:right">Est. Loss</div>
      </div>` +
      sorted.map(c => {
        const rateColor = c.rtoRate > 25 ? 'var(--red)' : c.rtoRate > 15 ? 'var(--amber)' : 'var(--green)';
        return `<div class="rto-carrier-row">
          <div style="font-weight:600">${c.carrier}</div>
          <div style="text-align:right;color:var(--text-2)">${fmtInt(c.total)}</div>
          <div style="text-align:right;color:var(--text-2)">${fmtInt(c.rto)}</div>
          <div style="text-align:right;font-weight:700;color:${rateColor}">${fmtPct(c.rtoRate)}</div>
          <div style="text-align:right;color:var(--red)">${fmtMoney(c.rto * 89)}</div>
        </div>`;
      }).join('');
  }

  // RTO cost bar chart
  const rtoCanvas = document.getElementById('rtoCostChart');
  if (rtoCanvas) {
    const sorted = [...carriers].filter(c=>c.rto>0).sort((a,b)=>b.rto-a.rto).slice(0,6);
    drawOverchargeBarChart('rtoCostChart', sorted.map(c=>c.carrier), sorted.map(c=>c.rto*89), '#BC6070');
  }

  // Zone breakdown (demo)
  const zt = $('#rtoZoneTable');
  if (zt) {
    const zones = [
      { zone:'Tier 3 Cities', rto:2841, total:8120, rate:'35.0%', rateVal:35 },
      { zone:'North East India', rto:980, total:2340, rate:'41.9%', rateVal:42 },
      { zone:'J&K / Hill Areas', rto:542, total:1280, rate:'42.3%', rateVal:42 },
      { zone:'Bihar / Jharkhand', rto:1824, total:5640, rate:'32.3%', rateVal:32 },
      { zone:'Metro Cities', rto:1240, total:14820, rate:'8.4%', rateVal:8 },
      { zone:'Tier 1 Cities', rto:1820, total:18640, rate:'9.8%', rateVal:10 },
    ].sort((a,b) => b.rateVal - a.rateVal);
    zt.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 80px 80px 100px;gap:14px;padding:4px 0 8px;border-bottom:1px solid var(--border)">
        <div class="row-head-label">Region / Zone</div>
        <div class="row-head-label" style="text-align:right">Ships</div>
        <div class="row-head-label" style="text-align:right">RTO</div>
        <div class="row-head-label" style="text-align:right">Rate</div>
      </div>` +
      zones.map(z => {
        const c = z.rateVal > 35 ? 'var(--red)' : z.rateVal > 20 ? 'var(--amber)' : 'var(--green)';
        return `<div style="display:grid;grid-template-columns:1fr 80px 80px 100px;gap:14px;padding:10px 0;border-bottom:1px solid var(--border-2)">
          <div style="font-weight:500">${z.zone}</div>
          <div style="text-align:right;color:var(--text-2)">${fmtInt(z.total)}</div>
          <div style="text-align:right;color:var(--text-2)">${fmtInt(z.rto)}</div>
          <div style="text-align:right;font-weight:700;color:${c}">${z.rate}</div>
        </div>`;
      }).join('');
  }

  // Return reasons
  const rr = $('#rtoReasonsWrap');
  if (rr) {
    const reasons = [
      { label:'Customer not available',  pct: 34 },
      { label:'Address not found',       pct: 22 },
      { label:'Customer refused delivery',pct:18 },
      { label:'Payment dispute (COD)',   pct: 12 },
      { label:'Delivery attempts exceeded',pct:8 },
      { label:'Wrong address / pincode', pct:  6 },
    ];
    rr.innerHTML = reasons.map(r => `
      <div class="rto-reason-item">
        <div class="rto-reason-label">${r.label}</div>
        <div class="rto-reason-bar"><div class="rto-reason-fill" style="width:${r.pct}%"></div></div>
        <div class="rto-reason-pct">${r.pct}%</div>
      </div>`).join('');
  }
}

// ── Page: INVENTORY (demo data) ───────────────────────────────────────────────

const INVENTORY_DATA = [
  { name:'AHA BHA Face Wash 100ml', sku:'DT-FW-01', stock:1840, reorder:400, sold30d:1842, max:3000 },
  { name:'Vitamin C Serum 30ml',    sku:'DT-SR-02', stock:620,  reorder:300, sold30d:1560, max:2000 },
  { name:'Niacinamide Moisturizer', sku:'DT-MO-03', stock:2840, reorder:400, sold30d:1224, max:3000 },
  { name:'SPF 50+ Sunscreen 50ml',  sku:'DT-SN-04', stock:48,   reorder:200, sold30d:984,  max:2000 },
  { name:'Retinol Night Cream',     sku:'DT-NC-05', stock:142,  reorder:200, sold30d:721,  max:2000 },
  { name:'Kojic Acid Soap 2-pack',  sku:'DT-SP-06', stock:3240, reorder:300, sold30d:612,  max:3000 },
  { name:'Hyaluronic Acid Toner',   sku:'DT-TO-07', stock:680,  reorder:200, sold30d:341,  max:2000 },
  { name:'Under Eye Cream 15ml',    sku:'DT-UE-08', stock:88,   reorder:150, sold30d:298,  max:1500 },
  { name:'Clay Face Mask 100g',     sku:'DT-FM-09', stock:490,  reorder:200, sold30d:184,  max:1500 },
  { name:'Lip Serum 10ml',          sku:'DT-LS-10', stock:2180, reorder:200, sold30d:96,   max:2000 },
];

function stockStatus(stock, reorder) {
  if (stock < 50)      return { label:'Critical', cls:'critical', chipCls:'chip-critical', color:'#BE2E2E' };
  if (stock < reorder) return { label:'Low Stock', cls:'low',     chipCls:'chip-low',      color:'#B05A10' };
  if (stock > 2000)    return { label:'Overstock', cls:'overstock',chipCls:'chip-overstock',color:'#1C52B8' };
  return { label:'Healthy', cls:'healthy', chipCls:'chip-healthy', color:'#1E7B48' };
}

function renderInventoryPage() {
  const filterVal = $('#invFilter')?.value || '';
  let data = INVENTORY_DATA;
  if (filterVal === 'critical') data = data.filter(d => d.stock < 50);
  else if (filterVal === 'low') data = data.filter(d => d.stock < d.reorder);
  else if (filterVal === 'healthy') data = data.filter(d => d.stock >= d.reorder && d.stock <= 2000);
  else if (filterVal === 'overstock') data = data.filter(d => d.stock > 2000);

  const totalSKUs   = INVENTORY_DATA.length;
  const lowStockCnt = INVENTORY_DATA.filter(d => d.stock < d.reorder).length;
  const criticalCnt = INVENTORY_DATA.filter(d => d.stock < 50).length;
  const overstockCnt= INVENTORY_DATA.filter(d => d.stock > 2000).length;
  const turnover    = (INVENTORY_DATA.reduce((s,d)=>s+d.sold30d,0) / INVENTORY_DATA.reduce((s,d)=>s+d.stock,0)).toFixed(1);

  const grid = $('#invKpiGrid');
  if (grid) grid.innerHTML = [
    { label:'Total SKUs',      value:fmtInt(totalSKUs),   hint:'Active products',            tone:'k-blue' },
    { label:'Low Stock',       value:fmtInt(lowStockCnt), hint:'Below reorder level',         tone: lowStockCnt > 2 ? 'k-amber' : 'k-green' },
    { label:'Critical Stock',  value:fmtInt(criticalCnt), hint:'< 50 units remaining',        tone: criticalCnt > 0 ? 'k-red' : 'k-green' },
    { label:'Overstock',       value:fmtInt(overstockCnt),hint:'> 2000 units, slow moving',   tone:'k-amber' },
    { label:'Turnover Ratio',  value:turnover + 'x',      hint:'30-day units sold / on hand', tone:'k-gold' },
    { label:'Units Sold (30d)',value:fmtInt(INVENTORY_DATA.reduce((s,d)=>s+d.sold30d,0)), hint:'Across all SKUs', tone:'k-green' },
  ].map((c,i) => `<div class="kpi-card ${c.tone}" style="animation-delay:${i*.06}s"><div class="kpi-label">${c.label}</div><div class="kpi-value">${c.value}</div><div class="kpi-hint">${c.hint}</div></div>`).join('');

  const invTable = $('#inventoryTable');
  if (!invTable) return;
  invTable.innerHTML = `
    <div class="stock-row stock-row-head">
      <div>Product</div><div style="text-align:right">Stock</div>
      <div style="text-align:right">Reorder At</div><div>Stock Level</div>
      <div style="text-align:right">Sold (30d)</div>
    </div>` +
    data.map(d => {
      const st = stockStatus(d.stock, d.reorder);
      const pct = Math.min((d.stock / d.max) * 100, 100);
      const barColor = st.color;
      const daysLeft = d.sold30d > 0 ? Math.round((d.stock / (d.sold30d / 30))) : 99;
      return `<div class="stock-row">
        <div>
          <div class="sku-name">${d.name}</div>
          <div class="sku-code">${d.sku} · ${daysLeft < 99 ? daysLeft + ' days stock' : 'Slow mover'}</div>
        </div>
        <div class="stock-qty ${st.cls}" style="text-align:right">${fmtInt(d.stock)}</div>
        <div style="text-align:right;color:var(--text-3);font-size:13px">${fmtInt(d.reorder)}</div>
        <div class="stock-bar-wrap">
          <div class="stock-bar-track"><div class="stock-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
          <span class="stock-status-chip ${st.chipCls}">${st.label}</span>
        </div>
        <div style="text-align:right;font-size:13px;font-variant-numeric:tabular-nums;color:var(--text-2)">${fmtInt(d.sold30d)}</div>
      </div>`;
    }).join('') || '<div style="padding:32px;text-align:center;color:var(--text-3)">No SKUs match filter</div>';
}

// ── Page: CARRIER BILLING (full version) ─────────────────────────────────────

function renderBillingPage() {
  renderAuditTable(dashboard.carrierPerformance, dashboard.totals, 'auditRows2');
  // Zone & weight charts from aggregated carrier data
  const allCarrierZones = [];
  const carriers = dashboard.carrierPerformance || [];
  carriers.forEach(c => { allCarrierZones.push({ zone: c.carrier, oc: Math.max(0, c.overbillingAmount || 0) }); });
  const sorted = allCarrierZones.filter(z=>z.oc>0).sort((a,b)=>b.oc-a.oc);
  drawOverchargeBarChart('zoneChartBilling', sorted.map(z=>z.zone), sorted.map(z=>z.oc), '#BC6070');
  // Weight: demo breakdown
  const wLabels = ['0-500g','501g-1kg','1-2kg','2-5kg','>5kg'];
  const wVals   = [450000, 95000, 42000, 18000, 8000];
  drawOverchargeBarChart('weightChartBilling', wLabels, wVals, '#9B7240');
}

// ── Page: DISPUTES (full) ─────────────────────────────────────────────────────

function renderFullDisputesPage() {
  const totals = dashboard.totals;
  const kpis = [
    { label:'Open Disputes',    value:fmtInt(totals.openDisputes), hint:'Awaiting action',          tone:'k-red' },
    { label:'At Risk Amount',   value:fmtMoney(totals.refundAmount), hint:'Total claimable',         tone:'k-rose' },
    { label:'Recovered',        value:fmtMoney(totals.recoveredAmount||0), hint:'Amount recovered', tone:'k-green' },
    { label:'Recovery Rate',    value:totals.refundAmount > 0 ? fmtPct((totals.recoveredAmount||0)/totals.refundAmount*100) : '0%', hint:'Recovered / total at risk', tone:'k-gold' },
  ];
  const grid = $('#dispKpiGrid');
  if (grid) grid.innerHTML = kpis.map((c,i) => `<div class="kpi-card ${c.tone}" style="animation-delay:${i*.06}s"><div class="kpi-label">${c.label}</div><div class="kpi-value">${c.value}</div><div class="kpi-hint">${c.hint}</div></div>`).join('');

  const filterVal = $('#dispStatusFilter')?.value || 'open';
  const shipById  = new Map(dashboard.shipments.map(s=>[s.id,s]));
  const filtered  = [...dashboard.disputes]
    .filter(d => !filterVal || d.status === filterVal)
    .sort((a,b) => (b.claimedAmount||0)-(a.claimedAmount||0));

  const sub = $('#disputeSubFull');
  if (sub) sub.textContent = `${fmtInt(filtered.length)} disputes · ${fmtMoney(filtered.reduce((s,d)=>s+(d.claimedAmount||0),0))} total`;

  const list = $('#fullDisputeList');
  if (!list) return;
  list.innerHTML = filtered.slice(0,200).map(d => {
    const ship = shipById.get(d.shipmentId);
    const awb  = ship?.awb || d.shipmentId?.slice(0,10) || '—';
    const carrier = ship?.carrier || '—';
    return `
      <div class="dispute-item">
        <div class="dispute-left">
          <div class="dispute-awb">${awb}</div>
          <div class="dispute-meta">${carrier} · ${d.reason?.replace(/_/g,' ')||'charge variance'} · <span class="badge badge-${d.status}">${d.status}</span></div>
        </div>
        <div class="dispute-right">
          <span class="dispute-amount">${fmtMoney(d.claimedAmount)}</span>
          ${d.status === 'open' ? `<button class="btn btn-sm btn-outline" data-dispute-id="${d.id}" data-next-status="submitted">Submit</button>` : ''}
          ${d.status === 'submitted' ? `<button class="btn btn-sm btn-outline" data-dispute-id="${d.id}" data-next-status="recovered">Recovered</button>` : ''}
        </div>
      </div>`;
  }).join('') + (filtered.length > 200 ? `<div style="text-align:center;padding:16px;color:var(--text-3);font-size:13px">Showing 200 of ${fmtInt(filtered.length)}</div>` : '')
  || '<div class="detail-empty">No disputes match this filter.</div>';

  document.querySelectorAll('[data-dispute-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch(`/api/disputes/${btn.dataset.disputeId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:btn.dataset.nextStatus}) });
      toast('Dispute status updated');
      await boot(false);
    });
  });
}

// ── Page: FINANCE & COD ───────────────────────────────────────────────────────

function renderFinancePage() {
  const totals   = dashboard.totals;
  const carriers = dashboard.carrierPerformance || [];

  const kpis = [
    { label:'Total Billed',     value:fmtMoney(totals.totalBillingAmount), hint:'All carriers',          tone:'k-gold' },
    { label:'Net Overcharge',   value:fmtMoney(totals.refundAmount),        hint:'Raise disputes to recover', tone:'k-rose' },
    { label:'Recovered',        value:fmtMoney(totals.recoveredAmount||0),  hint:'Credited by carriers',  tone:'k-green' },
    { label:'COD Collected',    value:'₹38,42,800',                         hint:'Last 30 days',          tone:'k-blue' },
    { label:'Pending Remit',    value:'₹12,40,200',                         hint:'Expected by Fri 16 May',tone:'k-amber' },
    { label:'Net Cash Flow',    value:'₹26,02,600',                         hint:'COD cleared this week',  tone:'k-green' },
  ];
  const grid = $('#finKpiGrid');
  if (grid) grid.innerHTML = kpis.map((c,i) => `<div class="kpi-card ${c.tone}" style="animation-delay:${i*.06}s"><div class="kpi-label">${c.label}</div><div class="kpi-value">${c.value}</div><div class="kpi-hint">${c.hint}</div></div>`).join('');

  // Carrier P&L
  const fct = $('#finCarrierTable');
  if (fct) {
    fct.innerHTML = `
      <div class="fin-carrier-row" style="padding:4px 0 8px;border-bottom:1px solid var(--border)">
        <div class="row-head-label">Carrier</div>
        <div class="row-head-label" style="text-align:right">Billed ₹</div>
        <div class="row-head-label" style="text-align:right">Expected ₹</div>
        <div class="row-head-label" style="text-align:right">Variance ₹</div>
        <div class="row-head-label" style="text-align:right">Status</div>
      </div>` +
      carriers.map(c => {
        const variance = c.overbillingAmount || 0;
        const varColor = variance > 500 ? 'var(--red)' : variance > 0 ? 'var(--amber)' : 'var(--green)';
        return `<div class="fin-carrier-row">
          <div style="font-weight:600">${c.carrier}</div>
          <div style="text-align:right;font-variant-numeric:tabular-nums">${fmtMoney(c.totalBillingAmount)}</div>
          <div style="text-align:right;color:var(--text-2)">${c.expectedBillingAmount>0?fmtMoney(c.expectedBillingAmount):'—'}</div>
          <div style="text-align:right;font-weight:600;color:${varColor}">${variance>10?'+'+fmtMoney(variance):variance<-10?fmtMoney(variance):'—'}</div>
          <div style="text-align:right"><span class="badge ${variance > 500 ? 'badge-rto' : variance > 0 ? 'badge-open' : 'badge-delivered'}">${variance > 500 ? 'Dispute' : variance > 0 ? 'Review' : 'OK'}</span></div>
        </div>`;
      }).join('');
  }

  // COD Remittance
  const crt = $('#codRemittanceTable');
  if (crt) {
    const weeks = [
      { week:'Apr 14–20', carrier:'XpressBees', collected:'₹8,42,400', remitted:'₹8,42,400', status:'done',    due:'Apr 26' },
      { week:'Apr 21–27', carrier:'Delhivery',  collected:'₹6,18,200', remitted:'₹6,18,200', status:'done',    due:'May 1' },
      { week:'Apr 28–May 4', carrier:'All',     collected:'₹9,84,600', remitted:'₹9,84,600', status:'done',    due:'May 8' },
      { week:'May 5–11',  carrier:'All',        collected:'₹11,24,800',remitted:'₹11,24,800',status:'done',    due:'May 14' },
      { week:'May 12–18', carrier:'All',        collected:'₹12,40,200',remitted:'Pending',    status:'pending', due:'May 16' },
    ];
    crt.innerHTML = `
      <div class="cod-row" style="padding:4px 0 8px;border-bottom:1px solid var(--border)">
        <div class="row-head-label">Week</div>
        <div class="row-head-label" style="grid-column:span 2">Carrier / COD Collected</div>
        <div class="row-head-label" style="text-align:right">Remitted</div>
        <div class="row-head-label" style="text-align:right">Status</div>
      </div>` +
      weeks.map(w => `<div class="cod-row">
        <div style="font-size:12px;color:var(--text-2)">${w.week}</div>
        <div style="grid-column:span 2"><div style="font-size:13px;font-weight:500">${w.carrier}</div><div style="font-size:11px;color:var(--text-3)">${w.collected}</div></div>
        <div style="text-align:right;font-size:13px;font-weight:500">${w.remitted}</div>
        <div style="text-align:right"><span class="remit-status ${w.status}">${w.status === 'done' ? '✓ Cleared' : '⏳ Pending'}</span></div>
      </div>`).join('');
  }

  // Dispute Recovery
  const drt = $('#disputeRecoveryTable');
  if (drt) {
    drt.innerHTML = `
      <div class="recovery-row" style="padding:4px 0 8px;border-bottom:1px solid var(--border)">
        <div class="row-head-label">Carrier</div>
        <div class="row-head-label" style="text-align:right">Disputes</div>
        <div class="row-head-label" style="text-align:right">Claimed ₹</div>
        <div class="row-head-label" style="text-align:right">Stage</div>
        <div class="row-head-label" style="text-align:right">Recovered ₹</div>
      </div>` +
      carriers.filter(c=>c.openDisputes>0||c.disputeAmount>0).map(c => `<div class="recovery-row">
        <div style="font-weight:600">${c.carrier}</div>
        <div style="text-align:right;color:var(--text-2)">${fmtInt(c.openDisputes)}</div>
        <div style="text-align:right;color:var(--red);font-weight:600">${fmtMoney(c.disputeAmount)}</div>
        <div style="text-align:right"><span class="badge badge-open">Open</span></div>
        <div style="text-align:right;color:var(--green)">—</div>
      </div>`).join('') || '<div style="padding:24px;text-align:center;color:var(--text-3)">No disputes to recover</div>';
  }

  // Billing trend (demo)
  const btCanvas = document.getElementById('billingTrendChart');
  if (btCanvas) {
    const months = ['Jan','Feb','Mar','Apr','May'];
    const vals   = [780000, 820000, 940000, 1080000, 1241000];
    drawLineChart(btCanvas, vals, '#9B7240');
  }
}

// ── Activity Log ──────────────────────────────────────────────────────────────

function renderActivityLog() {
  const logs = dashboard.auditLogs || [];
  const el = $('#auditLog'); if (!el) return;
  el.innerHTML = logs.length
    ? logs.map(l => `<div class="activity-item"><strong>${l.action.replace(/_/g,' ')}</strong><span>${l.entityType} · ${new Date(l.createdAt).toLocaleString('en-IN')}</span></div>`).join('')
    : '<div class="activity-item"><strong>No activity yet</strong><span>Imports and actions will appear here</span></div>';
}

// ── AI Chatbot ────────────────────────────────────────────────────────────────

let chatHistory = [];

function chatAddMessage(role, text) {
  chatHistory.push({ role, content: text });
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.innerHTML = `<div class="chat-bubble-msg">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
  $('#chatMessages').appendChild(el);
  $('#chatMessages').scrollTop = 9999;
  return el;
}

async function chatSend() {
  const input = $('#chatInput');
  const msg = input.value.trim(); if (!msg) return;
  input.value = ''; $('#chatSend').disabled = true;
  chatAddMessage('user', msg);
  const typing = document.createElement('div');
  typing.className = 'chat-msg assistant typing';
  typing.innerHTML = '<div class="chat-bubble-msg">Thinking…</div>';
  $('#chatMessages').appendChild(typing); $('#chatMessages').scrollTop = 9999;
  try {
    const context = dashboard ? { totalShipments:dashboard.totals.totalShipments, delivered:dashboard.totals.delivered, rto:dashboard.totals.rto, openDisputes:dashboard.totals.openDisputes, totalBilled:dashboard.totals.totalBillingAmount, overcharge:dashboard.totals.refundAmount, carriers:dashboard.carrierPerformance?.map(c=>({carrier:c.carrier,shipments:c.total,overcharge:c.overbillingAmount||0,disputes:c.openDisputes,rtoRate:c.rtoRate})) } : {};
    const r = await fetch('/api/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages:chatHistory,context}) });
    const data = await r.json();
    typing.remove(); chatAddMessage('assistant', data.reply || 'No response');
  } catch { typing.remove(); chatAddMessage('assistant', 'Error: could not reach the server.'); }
  finally { $('#chatSend').disabled = false; input.focus(); }
}

function wireChatbot() {
  const bubble = $('#chatBubble'), win = $('#chatWindow');
  bubble.addEventListener('click', () => win.classList.toggle('open'));
  $('#chatClose').addEventListener('click', () => win.classList.remove('open'));
  $('#chatSend').addEventListener('click', chatSend);
  $('#chatInput').addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();chatSend();} });
}

// ── Recompute totals ──────────────────────────────────────────────────────────

function recomputeTotals() {
  const d = dashboard;
  d.totals = {
    totalShipments: d.shipments.length,
    delivered:      d.shipments.filter(s=>s.currentStatus==='delivered').length,
    inTransit:      d.shipments.filter(s=>['picked_up','in_transit','at_hub','out_for_delivery'].includes(s.currentStatus)).length,
    rto:            d.shipments.filter(s=>s.rtoFlag||String(s.currentStatus).startsWith('rto_')).length,
    openDisputes:   d.disputes.filter(s=>s.status==='open').length,
    wrongCharges:   d.charges.filter(c=>Math.abs(Number(c.varianceAmount||0))>10).length,
    totalBillingAmount: d.charges.reduce((s,c)=>s+Number(c.billedAmount||0),0),
    expectedBillingAmount:d.charges.reduce((s,c)=>s+Number(c.expectedAmount||0),0),
    refundAmount:   d.charges.filter(c=>Number(c.varianceAmount||0)>10).reduce((s,c)=>s+Number(c.varianceAmount||0),0),
    recoveredAmount:d.disputes.reduce((s,dp)=>s+Number(dp.recoveredAmount||0),0),
    netOverbilling: 0, avgDeliveryDays: d.totals.avgDeliveryDays, deliveryDaysSample: d.totals.deliveryDaysSample,
  };
  d.totals.netOverbilling = d.totals.totalBillingAmount - d.totals.expectedBillingAmount;
}

// ── Local CSV fallback ────────────────────────────────────────────────────────

function parseCsvLocal(content) {
  const rows=[]; let cell='', row=[], inQ=false;
  for (let i=0;i<content.length;i++) {
    const ch=content[i],nx=content[i+1];
    if (ch==='"'&&nx==='"'){cell+='"';i++;}
    else if(ch==='"'){inQ=!inQ;}
    else if(ch===','&&!inQ){row.push(cell.trim());cell='';}
    else if((ch==='\n'||ch==='\r')&&!inQ){if(ch==='\r'&&nx==='\n')i++;row.push(cell.trim());if(row.some(v=>v))rows.push(row);row=[];cell='';}
    else{cell+=ch;}
  }
  row.push(cell.trim());if(row.some(v=>v))rows.push(row);
  const headers=rows.shift()||[];
  return rows.map(vals=>Object.fromEntries(headers.map((h,i)=>[h,vals[i]||''])));
}
function fieldOf(row,names){const norm=Object.fromEntries(Object.entries(row).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]+/g,''),v]));for(const n of names){const v=norm[n.toLowerCase().replace(/[^a-z0-9]+/g,'')];if(v)return v;}return '';}
function normalizeLocalStatus(raw){const v=String(raw||'').toLowerCase();if(v.includes('deliver')&&!v.includes('out'))return 'delivered';if(v.includes('rto')||v.includes('return'))return 'rto_initiated';if(v.includes('out'))return 'out_for_delivery';if(v.includes('transit'))return 'in_transit';if(v.includes('pick'))return 'picked_up';return v.replace(/[^a-z0-9]+/g,'_')||'exception';}

function applyLocalImport(type, format, content) {
  const rows = format==='json' ? JSON.parse(content) : parseCsvLocal(content);
  const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)||'{"shipments":[],"charges":[],"auditLogs":[]}');
  const now = new Date().toISOString();
  if (type==='charges') {
    rows.forEach(row => {
      const awb=fieldOf(row,['awb','awbNumber','trackingNumber','waybill']);
      const ship=dashboard.shipments.find(s=>s.awb===awb);if(!ship)return;
      const billed=Number(fieldOf(row,['billedAmount','chargedAmount','amount','grandTotal','totalAmount','costInclGst','grossAmount','freightCharges','freight_charges'])||0);
      const expRaw=fieldOf(row,['expectedAmount','rateAmount','agreedAmount','contractRate']);
      const expected=expRaw===''?null:Number(expRaw);
      const variance=expected!==null?Number((billed-expected).toFixed(2)):null;
      const charge={id:`local_chg_${Date.now()}_${Math.random()}`,shipmentId:ship.id,carrierId:ship.carrierId,chargeType:fieldOf(row,['billType','chargeType','type'])||'invoice',billedAmount:billed,expectedAmount:expected,varianceAmount:variance,invoiceId:fieldOf(row,['invoiceId','invoice','invoiceNumber'])||'',billingDate:fieldOf(row,['billingDate','date'])||now.slice(0,10)};
      stored.charges.push(charge);dashboard.charges.push(charge);
      if(variance!==null&&Math.abs(variance)>10){const d={id:`local_dsp_${Date.now()}_${Math.random()}`,shipmentId:ship.id,chargeId:charge.id,status:'open',reason:'charge_variance',disputeNote:`Billed ${billed}, expected ${expected}. Variance ${variance}.`,claimedAmount:Math.abs(variance),recoveredAmount:0,openedAt:now};dashboard.disputes.push(d);}
    });
  } else {
    rows.forEach(row=>{
      const awb=fieldOf(row,['awb','awbNumber','trackingNumber','waybill']);if(!awb)return;
      const carrier=fieldOf(row,['carrier','courier','courierName'])||'Unknown';
      const existing=dashboard.shipments.find(s=>s.awb===awb);
      const ship={id:existing?.id||`local_shp_${Date.now()}_${Math.random()}`,awb,carrierId:carrier.toLowerCase(),carrier,currentStatus:normalizeLocalStatus(fieldOf(row,['status','currentStatus','shipmentStatus'])),destinationRegion:fieldOf(row,['zone','region','destinationRegion','state','city']),destinationPincode:fieldOf(row,['pincode','pinCode']),rtoFlag:['yes','true','1'].includes(String(fieldOf(row,['rto','rtoFlag'])).toLowerCase()),deliveryAttempts:Number(fieldOf(row,['attempts','deliveryAttempts'])||0),lastEventAt:now,order:{externalOrderId:fieldOf(row,['orderId','order','externalOrderId'])||'—'}};
      if(existing)Object.assign(existing,ship);else dashboard.shipments.push(ship);
      stored.shipments.push(ship);
    });
  }
  stored.auditLogs.push({action:'local_import',entityType:type,createdAt:now,afterState:{rows:rows.length}});
  dashboard.auditLogs=[{action:'local_import',entityType:type,createdAt:now},...(dashboard.auditLogs||[])];
  localStorage.setItem(LOCAL_KEY,JSON.stringify(stored));
  recomputeTotals();
  return {rows:rows.length};
}

async function apiPost(path, body={}) {
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),30000);
  try { return await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl.signal}); }
  finally { clearTimeout(timer); }
}

// ── Render All (Dashboard) ────────────────────────────────────────────────────

function renderAll() {
  populatePeriodFilter();
  const filteredTotals   = getFilteredTotals();
  const filteredCarriers = getFilteredCarriers();
  renderKPIs(filteredTotals);
  renderAuditTable(filteredCarriers, filteredTotals, 'auditRows');
  renderSignals(filteredTotals);
  renderStatusChart();
  renderDisputes();
  renderMainZoneChart();
  renderOMSVolume();
  fillCarrierFilter();
  renderShipments();
  renderDetail();
  renderActivityLog();

  $('#freshness').textContent = dashboard.freshness?.lastEventAt
    ? `Last event: ${new Date(dashboard.freshness.lastEventAt).toLocaleString('en-IN')}`
    : 'No events yet';
}

// ── OMS Volume Panel ─────────────────────────────────────────────────────────

function renderOMSVolume() {
  const section = $('#omsVolumeSection');
  if (!section || !dashboard?.omsVolume) return;
  section.style.display = '';

  const oms   = dashboard.omsVolume;
  const risk  = dashboard.financialRisk;
  const grid  = $('#omsVolumeGrid');
  const rgrid = $('#financialRiskGrid');

  // Build month cards
  const months = Object.entries(oms).sort((a, b) => a[0].localeCompare(b[0]));
  grid.innerHTML = months.map(([period, d]) => {
    const delPct = d.totalOrders ? (d.delivered / d.totalOrders * 100).toFixed(1) : '0.0';
    const rtoPct = d.totalOrders ? (d.rto / d.totalOrders * 100).toFixed(1) : '0.0';
    const codPct = d.totalOrders ? (d.codOrders / d.totalOrders * 100).toFixed(1) : '0.0';
    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px">
        <div style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${period}</div>
        <div style="font-size:22px;font-weight:700;color:var(--text);margin-bottom:6px">${fmtInt(d.totalOrders)}</div>
        <div style="font-size:11px;color:var(--text-2);margin-bottom:2px">total orders dispatched</div>
        <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
          <span style="font-size:11px;background:#E8F5E9;color:#1E7B48;border-radius:4px;padding:2px 7px;font-weight:600">Del ${delPct}%</span>
          <span style="font-size:11px;background:#FDE8E8;color:#BE2E2E;border-radius:4px;padding:2px 7px;font-weight:600">RTO ${rtoPct}%</span>
          <span style="font-size:11px;background:#E8F0FE;color:#1C52B8;border-radius:4px;padding:2px 7px;font-weight:600">COD ${codPct}%</span>
        </div>
      </div>`;
  }).join('');

  // Totals card
  const totalOrders = months.reduce((s, [, d]) => s + d.totalOrders, 0);
  grid.innerHTML += `
    <div style="background:var(--navy,#0D1B2A);border-radius:var(--radius-sm);padding:14px 16px">
      <div style="font-size:11px;font-weight:700;color:#C9A84C;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Mar + Apr Total</div>
      <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:6px">${fmtInt(totalOrders)}</div>
      <div style="font-size:11px;color:#aaa;margin-bottom:2px">orders (2 months)</div>
      <div style="font-size:10px;color:#888;margin-top:8px">Source: All Facility OMS Export</div>
    </div>`;

  // Financial risk table
  if (risk && rgrid) {
    const riskItems = [
      { label: 'Lost Shipments',    icon: '📦', ...risk.lost,            bg: '#FDE8E8', clr: '#BE2E2E' },
      { label: 'Failed Delivery',   icon: '⚠️', ...risk.failed_delivery, bg: '#FFF8E1', clr: '#B05A10' },
      { label: 'Pickup Pending',    icon: '⏳', ...risk.pickup_pending,  bg: '#FFF8E1', clr: '#B05A10' },
      { label: 'Damaged',           icon: '🔴', ...risk.damaged,         bg: '#FDE8E8', clr: '#BE2E2E' },
    ];
    const totalRisk = riskItems.reduce((s, r) => s + (r.codAtRisk || 0), 0);
    rgrid.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:left;padding:6px 8px;color:var(--text-3);font-size:11px">Status</th>
            <th style="text-align:right;padding:6px 8px;color:var(--text-3);font-size:11px">Orders</th>
            <th style="text-align:right;padding:6px 8px;color:var(--text-3);font-size:11px">COD at Risk</th>
          </tr>
        </thead>
        <tbody>
          ${riskItems.map(r => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px 8px;color:${r.clr};font-weight:600">${r.label}</td>
            <td style="padding:8px 8px;text-align:right;color:var(--text)">${fmtInt(r.count || 0)}</td>
            <td style="padding:8px 8px;text-align:right;color:${r.clr};font-weight:600">₹${fmtInt(r.codAtRisk || 0)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--surface-2,#F7F5F0)">
            <td style="padding:8px 8px;font-weight:700;color:var(--text)">TOTAL AT RISK</td>
            <td style="padding:8px 8px;text-align:right;font-weight:700;color:var(--text)">${fmtInt(riskItems.reduce((s,r)=>s+(r.count||0),0))}</td>
            <td style="padding:8px 8px;text-align:right;font-weight:700;color:#BE2E2E">₹${fmtInt(totalRisk)}</td>
          </tr>
        </tfoot>
      </table>`;
  }
}

// ── Demo Data ─────────────────────────────────────────────────────────────────

const NDR_DATA = [
  { awb:'14345150601001', name:'Priya Sharma',    city:'Jaipur',    state:'Rajasthan',   carrier:'Delhivery',  days:3, attempts:2, reason:'Not available', status:'pending',   phone:'98765XXXXX' },
  { awb:'14345150601002', name:'Rahul Verma',     city:'Patna',     state:'Bihar',       carrier:'Shadowfax',  days:5, attempts:3, reason:'Wrong address', status:'pending',   phone:'87654XXXXX' },
  { awb:'14345150601003', name:'Anita Patel',     city:'Surat',     state:'Gujarat',     carrier:'XpressBees', days:2, attempts:1, reason:'Door locked',   status:'called',    phone:'76543XXXXX' },
  { awb:'14345150601004', name:'Deepak Singh',    city:'Lucknow',   state:'UP',          carrier:'Delhivery',  days:4, attempts:2, reason:'Refused',       status:'rto',       phone:'65432XXXXX' },
  { awb:'14345150601005', name:'Meera Nair',      city:'Kochi',     state:'Kerala',      carrier:'Delhivery',  days:1, attempts:1, reason:'Not available', status:'reattempt', phone:'54321XXXXX' },
  { awb:'14345150601006', name:'Amit Kumar',      city:'Ranchi',    state:'Jharkhand',   carrier:'Shadowfax',  days:6, attempts:3, reason:'Wrong address', status:'rto',       phone:'43210XXXXX' },
  { awb:'14345150601007', name:'Sunita Devi',     city:'Bhopal',    state:'MP',          carrier:'XpressBees', days:2, attempts:2, reason:'Not available', status:'pending',   phone:'32109XXXXX' },
  { awb:'14345150601008', name:'Vikram Shah',     city:'Ahmedabad', state:'Gujarat',     carrier:'Delhivery',  days:1, attempts:1, reason:'Door locked',   status:'delivered', phone:'21098XXXXX' },
  { awb:'14345150601009', name:'Pooja Yadav',     city:'Varanasi',  state:'UP',          carrier:'Shadowfax',  days:4, attempts:2, reason:'Not available', status:'pending',   phone:'10987XXXXX' },
  { awb:'14345150601010', name:'Rajesh Gupta',    city:'Nagpur',    state:'Maharashtra', carrier:'XpressBees', days:3, attempts:2, reason:'Refused',       status:'pending',   phone:'09876XXXXX' },
  { awb:'14345150601011', name:'Kavita Joshi',    city:'Indore',    state:'MP',          carrier:'Delhivery',  days:2, attempts:1, reason:'Not available', status:'called',    phone:'98761XXXXX' },
  { awb:'14345150601012', name:'Manoj Tiwari',    city:'Allahabad', state:'UP',          carrier:'Shadowfax',  days:7, attempts:3, reason:'Wrong address', status:'rto',       phone:'87652XXXXX' },
  { awb:'14345150601013', name:'Ritu Agarwal',    city:'Jodhpur',   state:'Rajasthan',   carrier:'XpressBees', days:1, attempts:1, reason:'Door locked',   status:'reattempt', phone:'76541XXXXX' },
  { awb:'14345150601014', name:'Suresh Rao',      city:'Hyderabad', state:'Telangana',   carrier:'Delhivery',  days:3, attempts:2, reason:'Not available', status:'delivered', phone:'65430XXXXX' },
  { awb:'14345150601015', name:'Neha Mishra',     city:'Guwahati',  state:'Assam',       carrier:'Shadowfax',  days:5, attempts:2, reason:'Refused',       status:'pending',   phone:'54320XXXXX' },
];

const PINCODE_DATA = [
  { pincode:'110001', city:'New Delhi',   state:'Delhi',       carrier:'Delhivery',  ships:4821, rto:386, trend:'↑' },
  { pincode:'400001', city:'Mumbai',      state:'Maharashtra', carrier:'XpressBees', ships:6234, rto:436, trend:'→' },
  { pincode:'700001', city:'Kolkata',     state:'West Bengal', carrier:'Shadowfax',  ships:2891, rto:780, trend:'↑' },
  { pincode:'600001', city:'Chennai',     state:'Tamil Nadu',  carrier:'Delhivery',  ships:3102, rto:403, trend:'↓' },
  { pincode:'500001', city:'Hyderabad',   state:'Telangana',   carrier:'XpressBees', ships:2744, rto:302, trend:'→' },
  { pincode:'800001', city:'Patna',       state:'Bihar',       carrier:'Shadowfax',  ships:1823, rto:729, trend:'↑' },
  { pincode:'226001', city:'Lucknow',     state:'UP',          carrier:'Shadowfax',  ships:2156, rto:754, trend:'↑' },
  { pincode:'302001', city:'Jaipur',      state:'Rajasthan',   carrier:'Delhivery',  ships:3421, rto:513, trend:'→' },
  { pincode:'380001', city:'Ahmedabad',   state:'Gujarat',     carrier:'Delhivery',  ships:4102, rto:369, trend:'↓' },
  { pincode:'411001', city:'Pune',        state:'Maharashtra', carrier:'XpressBees', ships:3876, rto:465, trend:'→' },
  { pincode:'831001', city:'Jamshedpur',  state:'Jharkhand',   carrier:'Shadowfax',  ships:891,  rto:374, trend:'↑' },
  { pincode:'462001', city:'Bhopal',      state:'MP',          carrier:'XpressBees', ships:1432, rto:487, trend:'↑' },
  { pincode:'395001', city:'Surat',       state:'Gujarat',     carrier:'Delhivery',  ships:2891, rto:260, trend:'↓' },
  { pincode:'560001', city:'Bengaluru',   state:'Karnataka',   carrier:'XpressBees', ships:5234, rto:366, trend:'→' },
  { pincode:'641001', city:'Coimbatore',  state:'Tamil Nadu',  carrier:'Delhivery',  ships:1102, rto:253, trend:'↓' },
];

const blacklistedPincodes = new Set(['800001','226001','831001']);

const MONTHLY_REVENUE = [
  { month:'Nov', revenue:4821000, orders:5214, rtoLoss:890000, shipping:612000 },
  { month:'Dec', revenue:7234000, orders:7823, rtoLoss:1340000, shipping:918000 },
  { month:'Jan', revenue:6102000, orders:6601, rtoLoss:1130000, shipping:775000 },
  { month:'Feb', revenue:5891000, orders:6372, rtoLoss:1090000, shipping:748000 },
  { month:'Mar', revenue:6734000, orders:7284, rtoLoss:1245000, shipping:854000 },
  { month:'Apr', revenue:7102000, orders:7681, rtoLoss:1312000, shipping:901000 },
];

const PRODUCT_PERF = [
  { name:'AHA BHA Face Wash 100ml',    sku:'DT-FW-01', orders:1842, revenue:2763000, rto:221, rtoRate:12, avgRating:4.6 },
  { name:'Vitamin C Serum 30ml',       sku:'DT-SR-02', orders:1560, revenue:3120000, rto:234, rtoRate:15, avgRating:4.7 },
  { name:'Niacinamide Moisturizer',    sku:'DT-MO-03', orders:1224, revenue:2203200, rto:318, rtoRate:26, avgRating:4.3 },
  { name:'SPF 50+ Sunscreen 50ml',     sku:'DT-SN-04', orders:984,  revenue:1869600, rto:256, rtoRate:26, avgRating:4.5 },
  { name:'Retinol Night Cream',        sku:'DT-NC-05', orders:721,  revenue:1514100, rto:209, rtoRate:29, avgRating:4.4 },
  { name:'Kojic Acid Soap 2-pack',     sku:'DT-SP-06', orders:341,  revenue:374100,  rto:116, rtoRate:34, avgRating:4.1 },
];

const SLA_DATA = [
  { carrier:'Delhivery',  zone:'Metro',  promised:'1-2d', actual:2.1, slaHit:91, onTime:true  },
  { carrier:'Delhivery',  zone:'ROI',    promised:'3-5d', actual:4.2, slaHit:87, onTime:true  },
  { carrier:'Shadowfax',  zone:'Metro',  promised:'1-2d', actual:3.8, slaHit:61, onTime:false },
  { carrier:'Shadowfax',  zone:'ROI',    promised:'3-5d', actual:6.1, slaHit:54, onTime:false },
  { carrier:'XpressBees', zone:'Metro',  promised:'2-3d', actual:2.9, slaHit:78, onTime:true  },
  { carrier:'XpressBees', zone:'ROI',    promised:'4-6d', actual:5.4, slaHit:72, onTime:true  },
  { carrier:'GoSwift',    zone:'Metro',  promised:'1-2d', actual:4.2, slaHit:48, onTime:false },
  { carrier:'DTDC',       zone:'Metro',  promised:'2-3d', actual:null, slaHit:null, onTime:null },
];

// ── Page: Analytics ───────────────────────────────────────────────────────────

function renderAnalyticsPage() {
  const el = $('#page-analytics'); if (!el) return;
  const totalRevenue  = MONTHLY_REVENUE.reduce((s,m)=>s+m.revenue,0);
  const totalShipping = MONTHLY_REVENUE.reduce((s,m)=>s+m.shipping,0);
  const totalRtoLoss  = MONTHLY_REVENUE.reduce((s,m)=>s+m.rtoLoss,0);
  const netProfit     = totalRevenue - totalShipping - totalRtoLoss;
  const margin        = ((netProfit/totalRevenue)*100).toFixed(1);

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card k-green"><div class="kpi-label">GROSS REVENUE (6M)</div><div class="kpi-value">${fmtMoney(totalRevenue)}</div><div class="kpi-hint">Across all channels</div></div>
      <div class="kpi-card k-amber"><div class="kpi-label">SHIPPING COST (6M)</div><div class="kpi-value">${fmtMoney(totalShipping)}</div><div class="kpi-hint">${((totalShipping/totalRevenue)*100).toFixed(1)}% of revenue</div></div>
      <div class="kpi-card k-rose"><div class="kpi-label">RTO LOSS (6M)</div><div class="kpi-value">${fmtMoney(totalRtoLoss)}</div><div class="kpi-hint">${((totalRtoLoss/totalRevenue)*100).toFixed(1)}% of revenue</div></div>
      <div class="kpi-card k-blue"><div class="kpi-label">NET PROFIT (6M)</div><div class="kpi-value">${fmtMoney(netProfit)}</div><div class="kpi-hint">${margin}% margin</div></div>
      <div class="kpi-card k-gold"><div class="kpi-label">BEST MONTH</div><div class="kpi-value">December</div><div class="kpi-hint">₹72.3L revenue</div></div>
      <div class="kpi-card"><div class="kpi-label">AVG ORDER VALUE</div><div class="kpi-value">₹924</div><div class="kpi-hint">Stable last 3 months</div></div>
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="card" style="grid-column:1/-1">
        <div class="card-head"><div><div class="card-title">Monthly Revenue vs RTO Loss</div><div class="card-sub">6-month trend</div></div></div>
        <canvas id="analyticsRevenueChart" height="90"></canvas>
      </div>
    </div>

    <div class="dash-grid" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Product Performance</div><div class="card-sub">Revenue · orders · RTO rate</div></div></div>
        <table class="data-table">
          <thead><tr><th>Product</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">RTO%</th><th class="r">Rating</th></tr></thead>
          <tbody>
            ${PRODUCT_PERF.map(p=>`
              <tr>
                <td><div style="font-weight:600;font-size:13px">${p.name}</div><div style="font-size:11px;color:var(--text-3)">${p.sku}</div></td>
                <td class="r num">${fmtInt(p.orders)}</td>
                <td class="r num">${fmtMoney(p.revenue)}</td>
                <td class="r"><span style="color:${p.rtoRate>25?'var(--red)':p.rtoRate>15?'var(--amber)':'var(--green)'};font-weight:600">${p.rtoRate}%</span></td>
                <td class="r"><span style="color:var(--accent)">★</span> ${p.avgRating}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="card-title">P&L Breakdown</div><div class="card-sub">Where money goes each month</div></div></div>
        <canvas id="analyticsPLChart" height="180"></canvas>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
          ${[
            {label:'Gross Revenue',color:'#4CAF50',val:totalRevenue},
            {label:'Shipping Cost',color:'#FF9800',val:totalShipping},
            {label:'RTO Loss',     color:'#f44336',val:totalRtoLoss},
            {label:'Net Profit',   color:'#2196F3',val:netProfit},
          ].map(i=>`
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:13px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:10px;height:10px;border-radius:2px;background:${i.color}"></div>
                <span style="color:var(--text-2)">${i.label}</span>
              </div>
              <strong>${fmtMoney(i.val)}</strong>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  setTimeout(()=>{
    // Revenue vs RTO bar chart
    const rev = MONTHLY_REVENUE;
    const ctx1 = document.getElementById('analyticsRevenueChart');
    if(ctx1){
      const c = ctx1.getContext('2d');
      const W = ctx1.parentElement.offsetWidth - 32; ctx1.width = W; ctx1.height = 120;
      const bw = Math.floor(W/(rev.length*2+1)); const gap = bw;
      const maxV = Math.max(...rev.map(m=>m.revenue));
      const H = 90;
      rev.forEach((m,i)=>{
        const x = gap + i*(bw*2+gap);
        const rh = Math.round((m.revenue/maxV)*H);
        const lh = Math.round((m.rtoLoss/maxV)*H);
        c.fillStyle='#4CAF50'; c.fillRect(x, H-rh, bw, rh);
        c.fillStyle='#f44336'; c.fillRect(x+bw+2, H-lh, bw, lh);
        c.fillStyle='var(--text-3)'; c.font='10px Inter,sans-serif'; c.textAlign='center';
        c.fillText(m.month, x+bw, H+12);
      });
      // Legend
      c.fillStyle='#4CAF50'; c.fillRect(0,H+18,10,8);
      c.fillStyle='var(--text-2)'; c.font='11px Inter,sans-serif'; c.textAlign='left';
      c.fillText('Revenue',14,H+26);
      c.fillStyle='#f44336'; c.fillRect(80,H+18,10,8);
      c.fillStyle='var(--text-2)'; c.fillText('RTO Loss',94,H+26);
    }
    // P&L pie
    const ctx2 = document.getElementById('analyticsPLChart');
    if(ctx2){
      const c = ctx2.getContext('2d'); const W2=ctx2.parentElement.offsetWidth-32;
      ctx2.width=W2; ctx2.height=120;
      const segs=[{v:totalShipping,col:'#FF9800'},{v:totalRtoLoss,col:'#f44336'},{v:netProfit,col:'#2196F3'}];
      const total2=segs.reduce((s,x)=>s+x.v,0);
      const cx=W2/2, cy=55, r=48; let angle=-Math.PI/2;
      segs.forEach(seg=>{
        const sweep=(seg.v/total2)*2*Math.PI;
        c.beginPath(); c.moveTo(cx,cy); c.arc(cx,cy,r,angle,angle+sweep); c.closePath();
        c.fillStyle=seg.col; c.fill();
        angle+=sweep;
      });
      c.beginPath(); c.arc(cx,cy,28,0,2*Math.PI); c.fillStyle='var(--surface-1)'; c.fill();
      c.fillStyle='var(--text-1)'; c.font='bold 13px Inter,sans-serif'; c.textAlign='center';
      c.fillText(margin+'%',cx,cy+5);
      c.fillStyle='var(--text-3)'; c.font='10px Inter,sans-serif'; c.fillText('margin',cx,cy+18);
    }
  },50);
}

// ── Page: NDR Management ──────────────────────────────────────────────────────

function renderNdrPage() {
  const el = $('#page-ndr'); if (!el) return;
  const pending   = NDR_DATA.filter(x=>x.status==='pending').length;
  const called    = NDR_DATA.filter(x=>x.status==='called').length;
  const reattempt = NDR_DATA.filter(x=>x.status==='reattempt').length;
  const delivered = NDR_DATA.filter(x=>x.status==='delivered').length;
  const rto       = NDR_DATA.filter(x=>x.status==='rto').length;

  // Update sidebar NDR badge
  const badge = $('#navNdrBadge');
  if (badge) badge.textContent = pending > 0 ? pending : '';

  const statusChip = s => {
    const map = { pending:'chip-amber', called:'chip-blue', reattempt:'chip-blue', delivered:'chip-green', rto:'chip-red' };
    const label = { pending:'Pending', called:'Called', reattempt:'Re-attempt', delivered:'Delivered', rto:'RTO' };
    return `<span class="status-chip ${map[s]||''}">${label[s]||s}</span>`;
  };

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card k-amber"><div class="kpi-label">PENDING ACTION</div><div class="kpi-value" style="color:var(--amber)">${pending}</div><div class="kpi-hint">Need immediate call</div></div>
      <div class="kpi-card k-blue"><div class="kpi-label">CALLED / SCHEDULED</div><div class="kpi-value">${called + reattempt}</div><div class="kpi-hint">Follow-up in progress</div></div>
      <div class="kpi-card k-green"><div class="kpi-label">SAVED → DELIVERED</div><div class="kpi-value" style="color:var(--green)">${delivered}</div><div class="kpi-hint">Converted from NDR</div></div>
      <div class="kpi-card k-rose"><div class="kpi-label">CONVERTED TO RTO</div><div class="kpi-value" style="color:var(--red)">${rto}</div><div class="kpi-hint">Lost shipments</div></div>
      <div class="kpi-card"><div class="kpi-label">TOTAL NDR</div><div class="kpi-value">${NDR_DATA.length}</div><div class="kpi-hint">Last 7 days</div></div>
      <div class="kpi-card k-green"><div class="kpi-label">SAVE RATE</div><div class="kpi-value" style="color:var(--green)">${Math.round((delivered/(delivered+rto))*100)}%</div><div class="kpi-hint">NDR → Delivery conversion</div></div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-head">
        <div><div class="card-title">Non-Delivery Report Queue</div><div class="card-sub">Action required · sorted by days pending</div></div>
        <div style="display:flex;gap:8px">
          <button class="btn-sm" onclick="this.closest('.card').querySelectorAll('tr[data-status=pending]').forEach(r=>r.style.display='')">Show Pending</button>
          <button class="btn-sm" onclick="document.querySelectorAll('#ndrTable tr').forEach(r=>r.style.display='')">Show All</button>
        </div>
      </div>
      <table class="data-table" id="ndrTable">
        <thead><tr><th>AWB</th><th>Customer</th><th>City</th><th>Carrier</th><th class="r">Days</th><th class="r">Attempts</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${NDR_DATA.map(n=>`
            <tr data-status="${n.status}">
              <td class="num" style="font-weight:600">${n.awb.slice(-8)}</td>
              <td>${n.name}<div style="font-size:11px;color:var(--text-3)">${n.phone}</div></td>
              <td>${n.city}<div style="font-size:11px;color:var(--text-3)">${n.state}</div></td>
              <td>${n.carrier}</td>
              <td class="r"><span style="color:${n.days>=5?'var(--red)':n.days>=3?'var(--amber)':'var(--text-1)'};font-weight:600">${n.days}d</span></td>
              <td class="r">${n.attempts}</td>
              <td style="font-size:12px;color:var(--text-2)">${n.reason}</td>
              <td>${statusChip(n.status)}</td>
              <td>
                ${n.status==='pending'||n.status==='called' ? `
                  <div style="display:flex;gap:4px">
                    <button class="btn-sm btn-green" title="Mark re-attempt">📞 Call</button>
                    <button class="btn-sm" title="Schedule re-attempt">🔄</button>
                    <button class="btn-sm btn-red" title="Mark RTO">✕</button>
                  </div>` : '—'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Page: Pincode Intelligence ────────────────────────────────────────────────

function renderPincodePage() {
  const el = $('#page-pincode'); if (!el) return;
  const sorted = [...PINCODE_DATA].sort((a,b)=>(b.rto/b.ships)-(a.rto/a.ships));
  const highRisk = sorted.filter(p=>(p.rto/p.ships)>0.25).length;
  const blCount  = blacklistedPincodes.size;
  const avgRtoHighRisk = sorted.filter(p=>(p.rto/p.ships)>0.25).reduce((s,p)=>s+(p.rto/p.ships),0) / Math.max(highRisk,1);

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">PINCODES SERVED</div><div class="kpi-value">${fmtInt(PINCODE_DATA.length)}+</div><div class="kpi-hint">Across India</div></div>
      <div class="kpi-card k-rose"><div class="kpi-label">HIGH-RISK ZONES</div><div class="kpi-value" style="color:var(--red)">${highRisk}</div><div class="kpi-hint">>25% RTO rate</div></div>
      <div class="kpi-card k-amber"><div class="kpi-label">BLACKLISTED</div><div class="kpi-value" style="color:var(--amber)">${blCount}</div><div class="kpi-hint">COD blocked</div></div>
      <div class="kpi-card k-rose"><div class="kpi-label">AVG RTO (HIGH-RISK)</div><div class="kpi-value" style="color:var(--red)">${(avgRtoHighRisk*100).toFixed(0)}%</div><div class="kpi-hint">Zones >25% RTO</div></div>
      <div class="kpi-card k-green"><div class="kpi-label">SAFE ZONES</div><div class="kpi-value" style="color:var(--green)">${sorted.filter(p=>(p.rto/p.ships)<0.15).length}</div><div class="kpi-hint"><15% RTO rate</div></div>
      <div class="kpi-card"><div class="kpi-label">TOTAL SHIPMENTS</div><div class="kpi-value">${fmtInt(PINCODE_DATA.reduce((s,p)=>s+p.ships,0))}</div><div class="kpi-hint">Tracked pincodes</div></div>
    </div>

    <div class="dash-grid" style="margin-top:20px">
      <div class="card" style="grid-column:1/-1">
        <div class="card-head"><div><div class="card-title">Pincode RTO Intelligence</div><div class="card-sub">Sort by RTO rate · blacklist to block COD orders</div></div></div>
        <table class="data-table">
          <thead><tr><th>Pincode</th><th>City</th><th>State</th><th>Best Carrier</th><th class="r">Shipments</th><th class="r">RTO Count</th><th class="r">RTO%</th><th class="r">Trend</th><th>Risk</th><th>COD Block</th></tr></thead>
          <tbody id="pincodeTableBody">
            ${sorted.map(p=>{
              const rate = (p.rto/p.ships);
              const pct  = (rate*100).toFixed(0);
              const risk = rate>0.35?'High':rate>0.25?'Medium':rate>0.15?'Low':'Safe';
              const riskColor = rate>0.35?'chip-red':rate>0.25?'chip-amber':rate>0.15?'chip-blue':'chip-green';
              const isBlacklisted = blacklistedPincodes.has(p.pincode);
              return `<tr>
                <td class="num" style="font-weight:600">${p.pincode}</td>
                <td style="font-weight:500">${p.city}</td>
                <td style="color:var(--text-2);font-size:12px">${p.state}</td>
                <td>${p.carrier}</td>
                <td class="r num">${fmtInt(p.ships)}</td>
                <td class="r num" style="color:var(--red)">${fmtInt(p.rto)}</td>
                <td class="r"><strong style="color:${rate>0.25?'var(--red)':rate>0.15?'var(--amber)':'var(--green)'}">${pct}%</strong></td>
                <td class="r" style="font-size:16px">${p.trend}</td>
                <td><span class="status-chip ${riskColor}">${risk}</span></td>
                <td><label class="toggle-switch"><input type="checkbox" ${isBlacklisted?'checked':''} onchange="toggleBlacklist('${p.pincode}',this.checked)"><span class="toggle-slider"></span></label></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Page: Reports ─────────────────────────────────────────────────────────────

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function generateReport(key) {
  const sh = (dashboard?.shipments || []);
  const cp = (dashboard?.carrierPerformance || []);
  if (key === 'shipments') {
    const rows = [['AWB / ID','Status','Carrier','Region','Billed (₹)','Created']];
    sh.forEach(s => rows.push([s.id||'',s.status||'',s.carrierId||'',s.destinationRegion||'',s.billedAmount||'',s.createdAt||'']));
    downloadCSV('Shipment_Register.csv', rows);
  } else if (key === 'billing') {
    const rows = [['Carrier','Shipments','Billed (₹)','Expected (₹)','Variance (₹)','Disputes','Overcharge (₹)','Period']];
    cp.forEach(c => rows.push([c.carrier,c.total,c.totalBillingAmount,c.expectedBillingAmount||0,(c.overbillingAmount||0),c.openDisputes,c.overbillingAmount||0,c.referenceAudit?.period||'']));
    downloadCSV('Billing_Audit_Report.csv', rows);
  } else if (key === 'rto') {
    const rtoRows = sh.filter(s => (s.status||'').toLowerCase().includes('rto') || (s.status||'').toLowerCase().includes('return'));
    const rows = [['AWB / ID','Carrier','Region','Billed (₹)','Created']];
    rtoRows.forEach(s => rows.push([s.id||'',s.carrierId||'',s.destinationRegion||'',s.billedAmount||'',s.createdAt||'']));
    downloadCSV('RTO_Analysis_Report.csv', rows);
  } else if (key === 'ndr') {
    const rows = [['AWB','Customer','City','State','Carrier','Days Pending','Attempts','Reason','Status','Phone']];
    NDR_DATA.forEach(n => rows.push([n.awb,n.name,n.city,n.state,n.carrier,n.days,n.attempts,n.reason,n.status,n.phone]));
    downloadCSV('NDR_Pending_Report.csv', rows);
  } else if (key === 'pincode') {
    const rows = [['Pincode','City','State','Carrier','Shipments','RTO','RTO%','Trend']];
    PINCODE_DATA.forEach(p => rows.push([p.pincode,p.city,p.state,p.carrier,p.ships,p.rto,((p.rto/p.ships)*100).toFixed(1)+'%',p.trend]));
    downloadCSV('Pincode_RTO_Report.csv', rows);
  } else if (key === 'pl') {
    const rows = [['Month','Revenue (₹)','Orders','Shipping Cost (₹)','RTO Loss (₹)','Net Margin (₹)']];
    MONTHLY_REVENUE.forEach(m => rows.push([m.month,m.revenue,m.orders,m.shipping,m.rtoLoss,m.revenue-m.shipping-m.rtoLoss]));
    downloadCSV('Monthly_PL_Summary.csv', rows);
  }
}

function renderReportsPage() {
  const el = $('#page-reports'); if (!el) return;
  el.innerHTML = `
    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Download Reports</div><div class="card-sub">Export data as CSV or PDF</div></div></div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          ${[
            {icon:'📦',title:'Shipment Register',    desc:'All shipments · AWB · status · carrier · dates',            ext:'CSV', key:'shipments'},
            {icon:'💰',title:'Billing Audit Report', desc:'Billed vs rate card · variance · overcharge per carrier',   ext:'CSV', key:'billing'},
            {icon:'↩️',title:'RTO Analysis Report',  desc:'All returned shipments · reason · carrier · cost',          ext:'CSV', key:'rto'},
            {icon:'⚠️',title:'NDR Pending Report',   desc:'Unactioned failed deliveries · contact details',            ext:'CSV', key:'ndr'},
            {icon:'🗺️',title:'Pincode RTO Report',   desc:'High-risk zones · blacklist recommendations',               ext:'CSV', key:'pincode'},
            {icon:'📊',title:'Monthly P&L Summary',  desc:'Revenue · shipping cost · RTO loss · net margin',           ext:'CSV', key:'pl'},
          ].map(r=>`
            <div class="report-row">
              <div style="font-size:22px">${r.icon}</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:13.5px">${r.title}</div>
                <div style="font-size:12px;color:var(--text-3);margin-top:2px">${r.desc}</div>
              </div>
              <span style="font-size:11px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:2px 7px;color:var(--text-3);font-weight:600">${r.ext}</span>
              <button class="btn-sm" data-report="${r.key}">Download</button>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="card-title">Weekly Email Report</div><div class="card-sub">Auto-send every Monday to owners</div></div></div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:14px">
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Recipients</label>
            <div style="display:flex;flex-direction:column;gap:6px" id="recipientList">
              ${['rushi.bhatt@dermatouch.com','owner@dermatouch.com'].map(email=>`
                <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-2);border-radius:8px;font-size:13px">
                  <span style="flex:1">${email}</span>
                  <span style="font-size:10px;background:#E8F5E9;color:#2E7D32;padding:2px 7px;border-radius:5px;font-weight:600">Active</span>
                </div>`).join('')}
              <div style="display:flex;gap:8px;margin-top:4px">
                <input type="email" id="newEmailInput" placeholder="Add email address..." style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--surface-1);color:var(--text-1);outline:none">
                <button class="btn-sm btn-green" id="addEmailBtn">+ Add</button>
              </div>
            </div>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Schedule</label>
            <select style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--surface-1);color:var(--text-1)">
              <option selected>Every Monday at 9:00 AM</option>
              <option>Every Friday at 6:00 PM</option>
              <option>Daily at 8:00 AM</option>
              <option>1st of every month</option>
            </select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:var(--text-2);display:block;margin-bottom:8px">Include in report</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
              ${['Shipment summary','RTO rates by carrier','Billing overcharges','Pending disputes','NDR action items','Pincode risk alerts'].map(item=>`
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                  <input type="checkbox" checked style="accent-color:var(--accent)"> ${item}
                </label>`).join('')}
            </div>
          </div>
          <button class="btn-primary" id="saveScheduleBtn">Save Schedule</button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><div><div class="card-title">Carrier SLA Tracker</div><div class="card-sub">Promised delivery time vs actual — last 30 days</div></div></div>

      <table class="data-table">
        <thead><tr><th>Carrier</th><th>Zone</th><th>Promised</th><th class="r">Actual Avg</th><th class="r">SLA Hit%</th><th>Performance</th></tr></thead>
        <tbody>
          ${SLA_DATA.map(s=>`
            <tr>
              <td style="font-weight:600">${s.carrier}</td>
              <td style="color:var(--text-2)">${s.zone}</td>
              <td style="color:var(--text-3)">${s.promised}</td>
              <td class="r" style="font-weight:600;color:${s.actual?s.onTime?'var(--green)':'var(--red)':'var(--text-3)'}">${s.actual?s.actual+'d':'N/A'}</td>
              <td class="r"><strong style="color:${s.slaHit?s.slaHit>=80?'var(--green)':s.slaHit>=60?'var(--amber)':'var(--red)':'var(--text-3)'}">${s.slaHit!=null?s.slaHit+'%':'N/A'}</strong></td>
              <td>
                ${s.slaHit!=null?`<div class="mini-bar" style="width:100px;display:inline-block"><div class="mini-bar-fill" style="width:${s.slaHit}%;background:${s.slaHit>=80?'var(--green)':s.slaHit>=60?'var(--amber)':'var(--red)'}"></div></div>`:'<span style="color:var(--text-3);font-size:12px">No tracking data</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  // Wire Download buttons
  el.querySelectorAll('button[data-report]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.report;
      toast('Downloading ' + btn.closest('.report-row').querySelector('[style*="font-weight:600"]').textContent.trim() + '…');
      generateReport(key);
    });
  });

  // Wire + Add email button
  const addBtn = el.querySelector('#addEmailBtn');
  const emailInput = el.querySelector('#newEmailInput');
  if (addBtn && emailInput) {
    addBtn.addEventListener('click', () => {
      const val = emailInput.value.trim();
      if (!val || !val.includes('@')) { toast('Enter a valid email address'); return; }
      const list = el.querySelector('#recipientList');
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface-2);border-radius:8px;font-size:13px';
      div.innerHTML = `<span style="flex:1">${val}</span><span style="font-size:10px;background:#E8F5E9;color:#2E7D32;padding:2px 7px;border-radius:5px;font-weight:600">Active</span>`;
      list.insertBefore(div, list.querySelector('div:last-child'));
      emailInput.value = '';
      toast('✅ ' + val + ' added');
    });
  }

  // Wire Save Schedule button
  el.querySelector('#saveScheduleBtn')?.addEventListener('click', () => {
    toast('✅ Weekly report schedule saved!');
  });
}

// ── Page: Settings ────────────────────────────────────────────────────────────

function renderSettingsPage() {
  const el = $('#page-settings'); if (!el) return;
  el.innerHTML = `
    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Team Members</div><div class="card-sub">Manage who can access the dashboard</div></div></div>
        <div style="display:flex;flex-direction:column;gap:0;margin-top:8px">
          ${[
            {name:'Rushi Bhatt',   email:'rushi.bhatt@dermatouch.com',   role:'Admin',     avatar:'RB', active:true},
            {name:'Admin',         email:'admin@dermatouch.com',          role:'Admin',     avatar:'AD', active:true},
            {name:'Rahul Sharma',  email:'rahul.sharma@dermatouch.com',   role:'Finance',   avatar:'RS', active:false},
            {name:'Priya Joshi',   email:'priya.joshi@dermatouch.com',    role:'Operations',avatar:'PJ', active:false},
          ].map(u=>`
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
              <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#9B7240,#BC6070);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${u.avatar}</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:13.5px">${u.name}</div>
                <div style="font-size:12px;color:var(--text-3)">${u.email}</div>
              </div>
              <span style="font-size:11px;background:var(--surface-2);border:1px solid var(--border);padding:3px 9px;border-radius:5px;font-weight:600;color:var(--text-2)">${u.role}</span>
              <span style="font-size:11px;padding:3px 9px;border-radius:5px;font-weight:600;${u.active?'background:#E8F5E9;color:#2E7D32':'background:var(--surface-2);color:var(--text-3)'}">${u.active?'Active':'Invite Sent'}</span>
            </div>`).join('')}
        </div>
        <button class="btn-primary" id="inviteBtn" style="margin-top:14px;width:100%">+ Invite Team Member</button>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="card-title">Integrations</div><div class="card-sub">Connect your store and tools</div></div></div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
          ${[
            {name:'Shopify',         icon:'🛍️', desc:'Sync orders, products, revenue', status:'Connect'},
            {name:'WooCommerce',     icon:'🔧', desc:'WordPress store integration',    status:'Connect'},
            {name:'WhatsApp (WABA)', icon:'💬', desc:'Send alerts & NDR follow-ups',   status:'Connect'},
            {name:'Email (SMTP)',    icon:'📧', desc:'Weekly reports, alerts',         status:'Connected', connected:true},
            {name:'Razorpay',        icon:'💳', desc:'COD remittance reconciliation',  status:'Connect'},
            {name:'Unicommerce',     icon:'📦', desc:'Inventory & order management',   status:'Connect'},
          ].map(i=>`
            <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border)">
              <div style="font-size:22px">${i.icon}</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:13px">${i.name}</div>
                <div style="font-size:12px;color:var(--text-3)">${i.desc}</div>
              </div>
              <button class="btn-sm ${i.connected?'btn-green':''}" data-integration="${i.name}" data-connected="${i.connected?'1':''}">${i.status}</button>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="dash-grid" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Carrier Configuration</div><div class="card-sub">Rate cards · credentials · zones</div></div></div>
        <table class="data-table">
          <thead><tr><th>Carrier</th><th>API Status</th><th>Rate Card</th><th>Last Sync</th><th>Action</th></tr></thead>
          <tbody>
            ${[
              {name:'Delhivery',  api:'Connected',   rc:'Uploaded', sync:'Today 9:14 AM'},
              {name:'Shadowfax',  api:'Connected',   rc:'Uploaded', sync:'Today 9:14 AM'},
              {name:'XpressBees', api:'Connected',   rc:'Uploaded', sync:'Today 9:14 AM'},
              {name:'Amazon ATS', api:'No API',      rc:'Missing',  sync:'Never'},
              {name:'GoSwift',    api:'Connected',   rc:'Uploaded', sync:'2 days ago'},
              {name:'DTDC',       api:'Error',       rc:'Uploaded', sync:'Failed'},
            ].map(c=>`
              <tr>
                <td style="font-weight:600">${c.name}</td>
                <td><span class="status-chip ${c.api==='Connected'?'chip-green':c.api==='No API'?'chip-blue':'chip-red'}">${c.api}</span></td>
                <td><span class="status-chip ${c.rc==='Uploaded'?'chip-green':'chip-amber'}">${c.rc}</span></td>
                <td style="font-size:12px;color:var(--text-3)">${c.sync}</td>
                <td><button class="btn-sm" data-configure="${c.name}">Configure</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  // Wire Settings buttons
  el.querySelector('#inviteBtn')?.addEventListener('click', () => toast('✉️ Invite sent!'));
  el.querySelectorAll('button[data-integration]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.integration;
      const connected = btn.dataset.connected === '1';
      toast(name + (connected ? ' is already connected!' : ' integration coming soon!'));
    });
  });
  el.querySelectorAll('button[data-configure]').forEach(btn => {
    btn.addEventListener('click', () => toast('Opening ' + btn.dataset.configure + ' settings…'));
  });
}

// ── Helper: Toggle blacklist ──────────────────────────────────────────────────

window.toggleBlacklist = function(pincode, checked) {
  if (checked) {
    blacklistedPincodes.add(pincode);
    toast('📍 ' + pincode + ' blacklisted — COD orders will be blocked');
  } else {
    blacklistedPincodes.delete(pincode);
    toast('✅ ' + pincode + ' removed from blacklist');
  }
};

// ── Boot ──────────────────────────────────────────────────────────────────────

async function loadCurrentUser() {
  try {
    const r = await fetch('/api/auth/me');
    if (r.status === 401) { window.location.replace('/login.html'); return; }
    if (!r.ok) return;
    const user = await r.json();
    // Update sidebar user info with real session data
    const avatarEl = $('.sb-avatar');
    const nameEl   = $('.sb-user-name');
    const roleEl   = $('.sb-user-role');
    if (avatarEl) avatarEl.textContent = user.avatar || 'RB';
    if (nameEl)   nameEl.textContent   = user.name   || 'User';
    if (roleEl)   roleEl.textContent   = user.title  || user.role || 'Team Member';
  } catch (e) { console.warn('Could not load user info:', e.message); }
}

async function boot(showToast = true) {
  try {
    const r = await fetch('/api/dashboard/summary');
    if (r.status === 401) { window.location.replace('/login.html'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    dashboard = await r.json();
    renderAll();
    finishIntro();
    if (showToast) toast('Dashboard refreshed');
  } catch (err) {
    console.error('Boot error:', err);
    if (!dashboard) {
      finishIntro();
      document.body.innerHTML = '<main style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif"><div style="text-align:center;color:#5C5860"><p style="font-size:18px;font-weight:600;margin-bottom:8px">Dashboard failed to load</p><p style="font-size:14px">Start the server with <code>start-dashboard.bat</code> and refresh.</p></div></main>';
    }
  }
}

// ── Wire Events ───────────────────────────────────────────────────────────────

function wireEvents() {
  // Sidebar navigation
  document.querySelectorAll('.sb-item').forEach(item => {
    item.addEventListener('click', e => { e.preventDefault(); navigate(item.dataset.page); });
  });

  // Sidebar collapse toggle
  $('#sidebarToggle')?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sb-collapsed', sidebar.classList.contains('collapsed'));
  });

  // Mobile menu toggle
  $('#menuBtn')?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sb-collapsed', sidebar.classList.contains('collapsed'));
  });

  // Carrier detail
  $('#carrierBackBtn').addEventListener('click', closeCarrierPage);
  document.addEventListener('keydown', e => { if (e.key==='Escape') closeCarrierPage(); });
  $('#carrierSearch').addEventListener('input', renderCarrierShipments);
  $('#carrierStatusFilter').addEventListener('change', renderCarrierShipments);
  $('#carrierOCFilter')?.addEventListener('change', renderCarrierShipments);

  // Period filter
  document.getElementById('periodFilter')?.addEventListener('change', e => {
    activePeriod = e.target.value;
    const filteredTotals   = getFilteredTotals();
    const filteredCarriers = getFilteredCarriers();
    renderKPIs(filteredTotals);
    renderAuditTable(filteredCarriers, filteredTotals, 'auditRows');
    renderSignals(filteredTotals);
    renderMainZoneChart();
  });

  // Variance column tooltip
  const varInfoBtn = $('#varianceInfoBtn');
  const floatTip   = $('#floatTooltip');
  if (varInfoBtn && floatTip) {
    varInfoBtn.addEventListener('mouseenter', e => {
      floatTip.innerHTML =
        '<strong style="display:block;margin-bottom:6px;font-size:13.5px">Billed vs Rate Card</strong>' +
        '<span style="color:#E8C97A;font-weight:600">− Negative</span> = carrier charged <em>less</em> than rate card<br>' +
        '<span style="color:#E57373;font-weight:600">+ Positive</span> = carrier <em>overcharged</em> you — claim it back';
      const r = varInfoBtn.getBoundingClientRect();
      floatTip.style.display = 'block';
      const tw = floatTip.offsetWidth;
      floatTip.style.left = Math.min(r.left, window.innerWidth - tw - 12) + 'px';
      floatTip.style.top  = (r.bottom + 8) + 'px';
    });
    varInfoBtn.addEventListener('mouseleave', () => { floatTip.style.display = 'none'; });
  }

  // Top bar actions
  $('#refreshBtn').addEventListener('click', () => boot(true));
  $('#exportBtn').addEventListener('click', () => { window.location.href = '/api/exports/shipments.csv'; });

  $('#recalcBtn').addEventListener('click', async () => {
    const btn = $('#recalcBtn'); btn.disabled = true; btn.textContent = '…';
    toast('Recalculating disputes against rate cards…');
    try {
      const r = await apiPost('/api/recalculate');
      if (r.ok) { const res=await r.json(); await boot(false); toast(`Done — ${res.chargesValidated||0} charges validated, ${res.disputesCreated||0} new disputes`); }
      else toast('Recalculate failed');
    } catch { toast('Server unavailable'); }
    finally { btn.disabled=false; btn.textContent='Recalculate'; }
  });

  // Shipment filters
  $('#search')?.addEventListener('input', renderShipments);
  $('#carrierFilter')?.addEventListener('change', renderShipments);
  $('#statusFilter')?.addEventListener('change', renderShipments);
  $('#clearFiltersBtn')?.addEventListener('click', () => { $('#search').value=''; $('#carrierFilter').value=''; $('#statusFilter').value=''; renderShipments(); toast('Filters cleared'); });

  // Disputes
  $('#loadMoreDisputes').addEventListener('click', () => { disputePageSize += 50; renderDisputes(); });

  // Dispute status filter (full page)
  $('#dispStatusFilter')?.addEventListener('change', renderFullDisputesPage);

  // Inventory filter
  $('#invFilter')?.addEventListener('change', renderInventoryPage);

  // Resize
  window.addEventListener('resize', () => { if (dashboard) { renderStatusChart(); } });

  // Upload form
  $('#uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form=new FormData(e.currentTarget);
    const btn=e.currentTarget.querySelector('button[type="submit"]');
    const status=$('#uploadStatus');
    btn.disabled=true; btn.textContent='Uploading…'; status.textContent='Reading file…';
    let content=String(form.get('content')||'').trim();
    const file=form.get('file');
    if (!content&&(!file||!file.name)){toast('Choose a file or paste CSV data');status.textContent='No data provided.';btn.disabled=false;btn.textContent='Upload & Audit';return;}
    try {
      if (!content) content=await file.text();
      status.textContent='Sending to audit engine…';
      const r=await apiPost('/api/import',{type:form.get('type'),format:form.get('format'),content});
      if (!r.ok){if(r.status===404){toast('Server needs restart');status.textContent='Import route inactive.';return;}let msg='Upload failed.';try{msg=(await r.json()).error||msg;}catch{}toast(msg);status.textContent=msg;return;}
      const data=await r.json();
      toast(`Imported ${data.rows} rows`);
      status.textContent=`Imported ${data.rows} rows — created ${data.created??'?'}, updated ${data.updated??'?'}.`;
      await boot(false);
    } catch(err) {
      try{const local=applyLocalImport(form.get('type'),form.get('format'),content);renderAll();toast(`Imported ${local.rows} rows locally`);status.textContent=`Server offline — ${local.rows} rows imported in browser.`;}
      catch{const msg=err.name==='AbortError'?'Server did not respond.':'Upload failed.';toast(msg);status.textContent=msg;}
    } finally { btn.disabled=false; btn.textContent='Upload & Audit'; }
  });
}

// ── Logo Drawing Animation ────────────────────────────────────────────────────

// ── 1. SPLASH: real SVG stroke-dashoffset drawing with glowing pen ───────────
async function drawSVGLogo() {
  const wrap    = document.getElementById('introDrawWrap');
  const finalImg = document.getElementById('introLogoFinal');
  if (!wrap) return;

  // Hide the final PNG immediately so only the SVG is visible during drawing
  if (finalImg) { finalImg.style.opacity = '0'; finalImg.style.animation = 'none'; }

  try {
    // Fetch the traced SVG (generated by trace-logo.mjs, served as static file)
    const resp = await fetch('/dermatouch-logo.svg');
    if (!resp.ok) throw new Error('SVG not found');
    const svgText = await resp.text();

    // Parse + inject into DOM
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl  = svgDoc.querySelector('svg');
    if (!svgEl) throw new Error('Invalid SVG');

    // Inject glow filter + pen tip group into SVG
    svgEl.insertAdjacentHTML('afterbegin', `
      <defs>
        <filter id="dtPenGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
          <feColorMatrix in="blur" type="matrix"
            values="1 0.7 0 0 0  0.6 0.45 0 0 0  0 0.1 0 0 0  0 0 0 2.2 0"
            result="goldGlow"/>
          <feMerge><feMergeNode in="goldGlow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g id="dtPenTip" opacity="0" filter="url(#dtPenGlow)">
        <circle id="dtPenHalo" r="9"  fill="rgba(200,160,60,0.35)"/>
        <circle id="dtPenCore" r="3.5" fill="#fff8d0"/>
      </g>
    `);

    svgEl.style.cssText = 'width:100%;height:100%;display:block;overflow:visible;color:#2b2b2b';
    wrap.appendChild(svgEl);

    // ── Set up all paths as invisible (dashoffset = full length) ─────────────
    const allPaths   = [...svgEl.querySelectorAll('.dt-stroke')];
    const iconPaths  = allPaths.filter(p => p.classList.contains('dt-icon'));
    const textGroup  = svgEl.querySelector('#dtTextGroup');
    const penTip     = svgEl.querySelector('#dtPenTip');
    const penHalo    = svgEl.querySelector('#dtPenHalo');
    const penCore    = svgEl.querySelector('#dtPenCore');

    // Hide icon paths for stroke animation
    iconPaths.forEach(p => {
      const len = p.getTotalLength();
      p.style.strokeDasharray  = len;
      p.style.strokeDashoffset = len;
    });

    // Hide text group entirely until sweep begins
    if (textGroup) textGroup.style.clipPath = 'inset(0 100% 0 0)';

    // ── Easing ────────────────────────────────────────────────────────────────
    function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

    // ── Animate one path: stroke draws from start→end with live pen tip ───────
    function animatePath(path, duration) {
      return new Promise(resolve => {
        const len = path.getTotalLength();
        const t0  = performance.now();

        (function step(now) {
          const t    = Math.min(1, (now - t0) / duration);
          const ease = easeInOut(t);
          path.style.strokeDashoffset = len * (1 - ease);

          // Move glowing pen tip to the current draw position
          const pt = path.getPointAtLength(len * ease);
          penHalo.setAttribute('cx', pt.x); penHalo.setAttribute('cy', pt.y);
          penCore.setAttribute('cx', pt.x); penCore.setAttribute('cy', pt.y);
          penTip.setAttribute('opacity', '1');

          if (t < 1) requestAnimationFrame(step);
          else { penTip.setAttribute('opacity', '0'); resolve(); }
        })(t0);
      });
    }

    // ── Draw icon paths (D mark) sequentially ────────────────────────────────
    const ICON_MS = 2200;
    const TEXT_MS = 3500;
    const totalIconLen = iconPaths.reduce((s, p) => s + p.getTotalLength(), 0) || 1;

    for (const p of iconPaths) {
      await animatePath(p, Math.max(60, ICON_MS * p.getTotalLength() / totalIconLen));
    }

    // Brief glowing pause between D mark and text
    await new Promise(r => setTimeout(r, 300));

    // ── Sweep text left-to-right with clip-path + travelling pen tip ─────────
    if (textGroup) {
      await new Promise(resolve => {
        const t0 = performance.now();
        // Text spans SVG x: 0 → 554, baseline y ≈ 195 (mid-height of text block)
        const TEXT_X0 = 0, TEXT_X1 = 554, TEXT_Y = 195;
        (function step(now) {
          const t    = Math.min(1, (now - t0) / TEXT_MS);
          const ease = easeInOut(t);
          // Reveal text from left to right
          textGroup.style.clipPath = `inset(0 ${Math.round((1 - ease) * 100)}% 0 0)`;
          // Move glowing pen tip along baseline
          const px = TEXT_X0 + ease * (TEXT_X1 - TEXT_X0);
          penHalo.setAttribute('cx', px); penHalo.setAttribute('cy', TEXT_Y);
          penCore.setAttribute('cx', px); penCore.setAttribute('cy', TEXT_Y);
          penTip.setAttribute('opacity', '1');
          if (t < 1) requestAnimationFrame(step);
          else { penTip.setAttribute('opacity', '0'); textGroup.style.clipPath = ''; resolve(); }
        })(performance.now());
      });
    }

    // ── Drawing complete: golden afterglow pulse, then reveal PNG ─────────────
    penTip.setAttribute('opacity', '0');

    // Glow flash on completed SVG
    svgEl.style.transition = 'filter 120ms ease';
    svgEl.style.filter = 'drop-shadow(0 0 8px rgba(200,160,60,0.7))';
    await new Promise(r => setTimeout(r, 130));
    svgEl.style.filter = 'drop-shadow(0 0 0px rgba(200,160,60,0))';

    // Fade in final PNG, fade out SVG overlay
    await new Promise(r => setTimeout(r, 200));
    if (finalImg) {
      finalImg.style.transition = 'opacity 380ms ease';
      finalImg.style.opacity    = '1';
      setTimeout(() => { finalImg.style.animation = ''; }, 400); // restore float
    }
    wrap.style.transition = 'opacity 380ms ease 60ms';
    wrap.style.opacity    = '0';
    setTimeout(() => { wrap.style.display = 'none'; }, 500);

  } catch (err) {
    // Graceful fallback: just show the PNG
    console.warn('SVG drawing animation failed, showing PNG:', err);
    if (finalImg) { finalImg.style.transition = 'opacity 300ms ease'; finalImg.style.opacity = '1'; finalImg.style.animation = ''; }
    wrap.style.display = 'none';
  }
}

// ── 2. SIDEBAR: clip-path sweep + glow (unchanged) ───────────────────────────
function animateSidebarLogo() {
  const drawWrap = document.querySelector('.sb-logo-draw');
  const sbPen    = document.querySelector('.sb-draw-pen');
  const sbLogo   = document.querySelector('.sb-logo');
  if (!drawWrap || !sbPen || !sbLogo) return;

  const run = () => {
    const w    = drawWrap.getBoundingClientRect().width || 90;
    const DUR  = 2200, DELAY = 350, EASE = 'cubic-bezier(0.4,0,0.2,1)';
    drawWrap.style.transition = 'none';
    drawWrap.style.clipPath   = 'inset(0 100% 0 0)';
    sbPen.style.transition = 'none'; sbPen.style.left = '0px'; sbPen.style.opacity = '0';
    void drawWrap.getBoundingClientRect();
    setTimeout(() => {
      drawWrap.style.transition = `clip-path ${DUR}ms ${EASE}`;
      sbPen.style.transition    = `left ${DUR}ms ${EASE}`;
      sbPen.style.opacity = '1';
      setTimeout(() => {
        drawWrap.style.clipPath = 'inset(0 0% 0 0)';
        sbPen.style.left = w + 'px';
        setTimeout(() => { sbPen.style.transition = 'opacity 350ms ease'; sbPen.style.opacity = '0'; }, Math.round(DUR * 0.85));
        setTimeout(() => {
          sbLogo.style.transition = 'none';
          sbLogo.style.filter = 'brightness(0) invert(1) drop-shadow(0 0 16px rgba(232,201,122,1))';
          void sbLogo.getBoundingClientRect();
          sbLogo.style.transition = 'filter 1600ms ease-out';
          sbLogo.style.filter = 'brightness(0) invert(1) drop-shadow(0 0 0px rgba(232,201,122,0))';
          setTimeout(() => { sbLogo.style.transition = ''; sbLogo.style.filter = ''; }, 1650);
        }, DUR + 80);
        setTimeout(() => { drawWrap.style.transition = ''; drawWrap.style.clipPath = ''; }, DUR + 1800);
      }, 20);
    }, DELAY);
  };

  if (sbLogo.complete && sbLogo.naturalWidth > 0) setTimeout(run, 80);
  else sbLogo.addEventListener('load', () => setTimeout(run, 80), { once: true });
}

function animateLogo() {
  drawSVGLogo();          // splash screen — real SVG stroke animation
  animateSidebarLogo();   // sidebar — clip-path sweep (logo too small for stroke)
}

// ── Start ─────────────────────────────────────────────────────────────────────
wireEvents();
wireChatbot();
loadCurrentUser();
animateLogo();
boot(false);
