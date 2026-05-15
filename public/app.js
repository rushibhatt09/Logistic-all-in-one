/* ── Dermatouch Operations Command · app.js ── */

let dashboard = null;
let selectedShipmentId = null;
let disputePageSize = 50;
let currentPage = 'dashboard';
const LOCAL_KEY = 'logisticsLocalImports';

// ── Helpers ──────────────────────────────────────────────────────────────────

function $(sel) { return document.querySelector(sel); }

function fmtInt(v)   { return Number(v || 0).toLocaleString('en-IN'); }
function fmtMoney(v) { return '₹' + Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function fmtDays(v)  { return (v == null) ? '—' : Number(v).toFixed(1) + ' d'; }
function fmtPct(v)   { return Number(v || 0).toFixed(1) + '%'; }

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function finishIntro() {
  document.body.classList.add('app-ready');
  const intro = $('#appIntro');
  if (!intro || intro.classList.contains('hide')) return;
  window.setTimeout(() => {
    intro.classList.add('hide');
    window.setTimeout(() => intro.remove(), 520);
  }, 380);
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
  renderKPIs(dashboard.totals);
  renderAuditTable(dashboard.carrierPerformance, dashboard.totals, 'auditRows');
  renderSignals(dashboard.totals);
  renderStatusChart();
  renderDisputes();
  renderMainZoneChart();
  fillCarrierFilter();
  renderShipments();
  renderDetail();
  renderActivityLog();

  $('#freshness').textContent = dashboard.freshness?.lastEventAt
    ? `Last event: ${new Date(dashboard.freshness.lastEventAt).toLocaleString('en-IN')}`
    : 'No events yet';
}

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

// ── Start ─────────────────────────────────────────────────────────────────────
wireEvents();
wireChatbot();
loadCurrentUser();
boot(false);
