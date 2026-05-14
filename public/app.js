/* ── Dermatouch Logistics Intelligence · app.js ── */

let dashboard = null;
let selectedShipmentId = null;
let disputePageSize = 50;

const LOCAL_KEY = 'logisticsLocalImports';

// ── Helpers ──────────────────────────────────────────────

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

// ── Status helpers ────────────────────────────────────────

const STATUS_LABELS = {
  delivered:          'Delivered',
  in_transit:         'In Transit',
  out_for_delivery:   'Out for Delivery',
  rto_initiated:      'RTO Initiated',
  rto_delivered:      'RTO Delivered',
  rto_in_transit:     'RTO In Transit',
  delivery_attempted: 'Attempted',
  picked_up:          'Picked Up',
  exception:          'Exception',
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

// ── Render: KPIs ─────────────────────────────────────────

function renderKPIs(t) {
  const deliveryRate = t.totalShipments
    ? ((t.delivered / t.totalShipments) * 100).toFixed(1)
    : '0.0';

  const cards = [
    {
      label: 'Total Billed',
      value: fmtMoney(t.totalBillingAmount),
      hint:  `Expected ${fmtMoney(t.expectedBillingAmount)}`,
      tone:  'k-gold',
    },
    {
      label: 'Overcharge / Refund',
      value: fmtMoney(t.refundAmount),
      hint:  `${fmtInt(t.wrongCharges)} charge errors`,
      tone:  'k-rose',
    },
    {
      label: 'Open Disputes',
      value: fmtInt(t.openDisputes),
      hint:  `Net variance ${fmtMoney(Math.abs(t.netOverbilling))} ${t.netOverbilling >= 0 ? 'overbilled' : 'underbilled'}`,
      tone:  'k-red',
    },
    {
      label: 'Total Shipments',
      value: fmtInt(t.totalShipments),
      hint:  `${fmtInt(t.delivered)} delivered · ${fmtInt(t.rto)} RTO`,
      tone:  'k-blue',
    },
    {
      label: 'Avg Delivery',
      value: fmtDays(t.avgDeliveryDays),
      hint:  `${deliveryRate}% delivery rate · ${fmtInt(t.inTransit)} in transit`,
      tone:  'k-green',
    },
  ];

  $('#kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi-card ${c.tone}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${c.value}</div>
      <div class="kpi-hint">${c.hint}</div>
    </div>
  `).join('');
}

// ── Render: Carrier Audit Table ──────────────────────────

function renderAuditTable(rows, totals) {
  const totalBilled = totals.totalBillingAmount || 1;

  $('#auditRows').innerHTML = rows.map(r => {
    const variance = r.overbillingAmount || (r.totalBillingAmount - r.expectedBillingAmount);
    const varAbs   = Math.abs(variance);
    const varClass = variance > 100 ? 'over' : variance < -100 ? 'under' : 'even';
    const varSign  = variance > 100 ? '+' : variance < -100 ? '−' : '';
    const varText  = varAbs > 10 ? `${varSign}${fmtMoney(varAbs)}` : '—';

    const billingShare = Math.min((r.totalBillingAmount / totalBilled) * 100, 100);
    const rtoColor  = r.rtoRate > 20 ? '#BE2E2E' : r.rtoRate > 10 ? '#B05A10' : '#1E7B48';
    const dispColor = r.disputeRate > 15 ? '#BE2E2E' : r.disputeRate > 5 ? '#B05A10' : '#9895A2';

    return `
      <tr data-carrier="${r.carrier}" title="Click to view ${r.carrier} details">
        <td>
          <div style="font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px">
            ${r.carrier}
            <span style="font-size:10px;color:var(--text-3);background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:1px 5px">View →</span>
          </div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">${fmtPct(billingShare)} of billing</div>
        </td>
        <td class="r num">${fmtInt(r.total)}</td>
        <td class="r num">${fmtMoney(r.totalBillingAmount)}</td>
        <td class="r num" style="color:var(--text-2)">${r.expectedBillingAmount > 0 ? fmtMoney(r.expectedBillingAmount) : '—'}</td>
        <td class="r">
          ${varAbs > 10
            ? `<span class="var-chip ${varClass}">${varText}</span>`
            : '<span class="num-zero">—</span>'}
        </td>
        <td class="r">
          <div class="bar-wrap">
            <span style="color:${dispColor};font-weight:600">${fmtInt(r.openDisputes)}</span>
            <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(r.disputeRate,100)}%;background:${dispColor}"></div></div>
          </div>
        </td>
        <td class="r num" style="color:var(--red)">${r.disputeAmount > 0 ? fmtMoney(r.disputeAmount) : '—'}</td>
        <td class="r">
          <div class="bar-wrap">
            <span style="color:${rtoColor};font-weight:600">${r.rtoRate}%</span>
            <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(r.rtoRate,100)}%;background:${rtoColor}"></div></div>
          </div>
        </td>
        <td class="r num" style="color:var(--text-2)">${fmtDays(r.avgDeliveryDays)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9" class="loading-cell">No carrier data available</td></tr>';

  // Click to open carrier page
  document.querySelectorAll('#auditRows tr[data-carrier]').forEach(row => {
    row.addEventListener('click', () => openCarrierPage(row.dataset.carrier));
  });

  // Summary badge
  const totalVariance = rows.reduce((s, r) => s + (r.overbillingAmount || 0), 0);
  $('#billingBadge').innerHTML = totalVariance > 100
    ? `<span class="var-chip over">+${fmtMoney(totalVariance)} net overbilled</span>`
    : totalVariance < -100
    ? `<span class="var-chip under">${fmtMoney(Math.abs(totalVariance))} net underbilled</span>`
    : '';
}

// ── Carrier Detail Page ───────────────────────────────────

let carrierShipRows = [];
let carrierChargesMap = new Map();

async function openCarrierPage(carrierName) {
  const perf = dashboard.carrierPerformance.find(c => c.carrier === carrierName);

  // Show page immediately with loading state
  const page = $('#carrierPage');
  $('#carrierPageTitle').textContent = carrierName;
  $('#carrierPageBadge').textContent = perf
    ? `${fmtInt(perf.total)} shipments · ${fmtPct(perf.total / (dashboard.totals.totalShipments || 1) * 100)} of volume`
    : 'Loading…';
  $('#carrierLoadingBadge').textContent = 'Loading data…';
  $('#carrierKpis').innerHTML = '';
  $('#carrierZoneRows').innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:20px">Loading…</td></tr>';
  $('#carrierDisputeList').innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-3)">Loading…</div>';
  $('#carrierShipRows').innerHTML = '<tr><td colspan="7" class="loading-cell">Loading shipments…</td></tr>';
  page.classList.add('open');
  page.scrollTop = 0;

  let data;
  try {
    const r = await fetch(`/api/carriers/${encodeURIComponent(carrierName)}/details`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    data = await r.json();
  } catch (err) {
    $('#carrierLoadingBadge').textContent = 'Load error';
    toast('Failed to load carrier data');
    return;
  }

  $('#carrierLoadingBadge').textContent = `${fmtInt(data.totalShipments)} total shipments`;

  // ── KPIs — use server-computed aggregates (full dataset, not 2000-row sample)
  const totalBilled     = data.totalBilled;
  const totalOvercharge = data.totalOvercharge;
  const totalRTO        = data.totalRTO;
  const totalDelivered  = data.totalDelivered;
  const rtoRate         = data.rtoRate;

  const kpis = [
    { label: 'Total Shipments',  value: fmtInt(data.totalShipments),   hint: `${fmtInt(totalDelivered)} delivered`, cls: '' },
    { label: 'Total Billed',     value: fmtMoney(totalBilled),          hint: `across all ${fmtInt(data.totalShipments)} shipments`, cls: '' },
    { label: 'Total Overcharge', value: fmtMoney(totalOvercharge),      hint: totalOvercharge > 100 ? 'Raise disputes' : 'Within limits', cls: totalOvercharge > 100 ? 'red' : 'green' },
    { label: 'Open Disputes',    value: fmtInt(data.totalOpenDisputes), hint: `${fmtMoney(data.totalAtRisk)} at risk`, cls: data.totalOpenDisputes > 0 ? 'red' : 'green' },
    { label: 'RTO Rate',         value: fmtPct(rtoRate),                hint: `${fmtInt(totalRTO)} returns`, cls: rtoRate > 20 ? 'red' : rtoRate > 10 ? 'amber' : 'green' },
    { label: 'Avg Delivery',     value: fmtDays(perf?.avgDeliveryDays), hint: 'Pickup → Delivered', cls: '' },
  ];
  $('#carrierKpis').innerHTML = kpis.map(k => `
    <div class="c-kpi ${k.cls}">
      <div class="c-kpi-label">${k.label}</div>
      <div class="c-kpi-value">${k.value}</div>
      <div class="c-kpi-hint">${k.hint}</div>
    </div>
  `).join('');

  // ── Zone breakdown table
  const zones = data.zoneBreakdown || [];
  const totalZoneShips = zones.reduce((s, z) => s + z.total, 0);
  const totalZoneOC    = zones.reduce((s, z) => s + z.overcharge, 0);

  $('#carrierZoneSub').textContent = `${fmtInt(data.totalShipments)} shipments · ${fmtMoney(totalZoneOC)} total overcharge`;
  $('#carrierZoneRows').innerHTML = zones.slice(0, 20).map(z => `
    <tr>
      <td>${z.zone}</td>
      <td class="r">${fmtInt(z.total)}</td>
      <td class="r" style="color:${z.overcharge > 0 ? 'var(--red)' : 'var(--text-3)'}">${z.overcharge > 0 ? fmtMoney(z.overcharge) : '—'}</td>
      <td class="r" style="color:${z.disputes > 0 ? 'var(--red)' : 'var(--text-3)'}">${fmtInt(z.disputes)}</td>
      <td class="r" style="color:${z.rto > 0 ? 'var(--amber)' : 'var(--text-3)'}">${fmtInt(z.rto)}</td>
    </tr>
  `).join('') + (zones.length ? `
    <tr>
      <td>TOTAL</td>
      <td class="r">${fmtInt(totalZoneShips)}</td>
      <td class="r" style="color:var(--red);font-weight:700">${fmtMoney(totalZoneOC)}</td>
      <td class="r"></td>
      <td class="r"></td>
    </tr>` : '<tr><td colspan="5" style="text-align:center;color:var(--text-3);padding:16px">No zone data</td></tr>');

  // ── Zone overcharge bar chart
  const topZones = zones.filter(z => z.overcharge > 0).slice(0, 8);
  drawOverchargeBarChart('zoneChart', topZones.map(z => z.zone.slice(0,12)), topZones.map(z => z.overcharge), '#BC6070');

  // ── Weight slab bar chart
  const wb = data.weightBreakdown || {};
  const wLabels = Object.keys(wb);
  const wValues = wLabels.map(k => wb[k].overcharge || 0);
  drawOverchargeBarChart('weightChart', wLabels, wValues, '#9B7240');

  // ── Disputes
  $('#carrierDisputeSub').textContent = `${fmtInt(data.totalOpenDisputes)} open · ${fmtMoney(data.totalAtRisk)} at risk`;
  const shipById = new Map(data.shipments.map(s => [s.id, s]));
  $('#carrierDisputeList').innerHTML = data.disputes.length
    ? data.disputes.map(d => {
        const ship = shipById.get(d.shipmentId);
        return `
          <div class="c-dispute-item">
            <div>
              <div class="c-dispute-awb">${ship?.awb || d.shipmentId?.slice(0,12) || '—'}</div>
              <div class="c-dispute-meta">${ship?.destinationRegion || '—'} · ${(d.disputeNote || '').slice(0, 60)}</div>
            </div>
            <div class="c-dispute-amt">${fmtMoney(d.claimedAmount)}</div>
          </div>
        `;
      }).join('')
    : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:13px">No open disputes</div>';

  // ── Shipments table
  carrierShipRows = data.shipments;
  carrierChargesMap = new Map();
  for (const c of data.charges) carrierChargesMap.set(c.shipmentId, c);
  renderCarrierShipments();
}

function drawOverchargeBarChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr   = window.devicePixelRatio || 1;
  const cssW  = canvas.parentElement.offsetWidth - 32 || 300;
  const cssH  = parseInt(canvas.getAttribute('height')) || 180;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!values.length || values.every(v => v === 0)) {
    ctx.fillStyle = '#9895A2';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No overcharges recorded', cssW / 2, cssH / 2);
    return;
  }

  const maxVal  = Math.max(...values, 1);
  const count   = values.length;
  const padL = 8, padR = 8, padT = 24, padB = 30;
  const chartW  = cssW - padL - padR;
  const chartH  = cssH - padT - padB;
  const gap     = 6;
  const barW    = Math.max(16, (chartW - (count - 1) * gap) / count);

  // Grid line
  ctx.strokeStyle = '#E5DDD3';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL + chartW, padT); ctx.stroke();

  values.forEach((v, i) => {
    const bh   = Math.max(2, (v / maxVal) * chartH);
    const x    = padL + i * (barW + gap);
    const y    = padT + chartH - bh;

    // Bar with rounded top
    ctx.fillStyle = color;
    ctx.globalAlpha = v > 0 ? 1 : 0.25;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh, [3, 3, 0, 0]);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Value label above bar
    if (v > 0) {
      ctx.fillStyle = '#1B1820';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      const valStr = v >= 1000 ? '₹' + (v / 1000).toFixed(1) + 'k' : '₹' + Math.round(v);
      ctx.fillText(valStr, x + barW / 2, y - 5);
    }

    // X-axis label
    ctx.fillStyle = '#9895A2';
    ctx.font = '500 9.5px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i] || '', x + barW / 2, cssH - 6);
  });
}

function renderCarrierShipments() {
  const q      = ($('#carrierSearch')?.value || '').toLowerCase();
  const status = $('#carrierStatusFilter')?.value || '';
  const oc     = $('#carrierOCFilter')?.value || '';

  const filtered = carrierShipRows.filter(s => {
    const hay = `${s.awb} ${s.destinationRegion || ''} ${s.currentStatus}`.toLowerCase();
    const charge = carrierChargesMap.get(s.id);
    const isOver = charge && Number(charge.varianceAmount || 0) > 10;
    return (!q || hay.includes(q)) &&
           (!status || s.currentStatus === status) &&
           (!oc || (oc === 'over' ? isOver : !isOver));
  });

  $('#carrierShipSub').textContent =
    `${fmtInt(carrierShipRows.length)} total · showing ${fmtInt(filtered.length)}`;

  $('#carrierShipRows').innerHTML = filtered.slice(0, 500).map(s => {
    const c = carrierChargesMap.get(s.id);
    const overcharge = c ? Number(c.varianceAmount || 0) : null;
    return `
      <tr>
        <td><strong>${s.awb}</strong></td>
        <td style="color:var(--text-2)">${s.order?.externalOrderId || '—'}</td>
        <td><span class="badge ${statusBadgeClass(s.currentStatus)}">${statusLabel(s.currentStatus)}</span></td>
        <td style="color:var(--text-2)">${s.destinationRegion || '—'}</td>
        <td class="r num">${c ? fmtMoney(c.billedAmount) : '—'}</td>
        <td class="r num">${overcharge !== null
          ? overcharge > 10
            ? `<span style="color:var(--red);font-weight:600">${fmtMoney(overcharge)}</span>`
            : '<span style="color:var(--text-3)">—</span>'
          : '—'}</td>
        <td class="c">${s.rtoFlag ? '<span class="badge badge-rto">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
      </tr>
    `;
  }).join('') + (filtered.length > 500 ? `<tr><td colspan="7" class="loading-cell">Showing first 500 of ${fmtInt(filtered.length)} rows</td></tr>` : '')
    || '<tr><td colspan="7" class="loading-cell">No shipments match filters</td></tr>';
}

function closeCarrierPage() {
  $('#carrierPage').classList.remove('open');
}

// ── AI Chatbot ────────────────────────────────────────────

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
  const msg   = input.value.trim();
  if (!msg) return;

  input.value = '';
  $('#chatSend').disabled = true;
  chatAddMessage('user', msg);

  const typing = document.createElement('div');
  typing.className = 'chat-msg assistant typing';
  typing.innerHTML = '<div class="chat-bubble-msg">Thinking…</div>';
  $('#chatMessages').appendChild(typing);
  $('#chatMessages').scrollTop = 9999;

  try {
    const context = dashboard ? {
      totalShipments: dashboard.totals.totalShipments,
      delivered:      dashboard.totals.delivered,
      rto:            dashboard.totals.rto,
      openDisputes:   dashboard.totals.openDisputes,
      totalBilled:    dashboard.totals.totalBillingAmount,
      overcharge:     dashboard.totals.refundAmount,
      carriers:       dashboard.carrierPerformance?.map(c => ({
        carrier: c.carrier,
        shipments: c.total,
        overcharge: c.overbillingAmount || 0,
        disputes: c.openDisputes,
        rtoRate: c.rtoRate,
      })),
    } : {};

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        context,
      }),
    });
    const data = await r.json();
    typing.remove();
    chatAddMessage('assistant', data.reply || 'No response');
  } catch {
    typing.remove();
    chatAddMessage('assistant', 'Error: could not reach the server.');
  } finally {
    $('#chatSend').disabled = false;
    input.focus();
  }
}

function wireChatbot() {
  const bubble = $('#chatBubble');
  const win    = $('#chatWindow');

  bubble.addEventListener('click', () => win.classList.toggle('open'));
  $('#chatClose').addEventListener('click', () => win.classList.remove('open'));

  $('#chatSend').addEventListener('click', chatSend);
  $('#chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); }
  });
}

// ── Render: Signals ──────────────────────────────────────

function renderSignals(t) {
  const total = t.totalShipments || 1;
  const deliveryRate  = ((t.delivered / total) * 100);
  const rtoRate       = ((t.rto / total) * 100);
  const disputeRate   = ((t.openDisputes / total) * 100);
  const inTransitRate = ((t.inTransit / total) * 100);

  const signals = [
    {
      label: 'Delivery Rate',
      value: fmtPct(deliveryRate),
      hint:  `${fmtInt(t.delivered)} of ${fmtInt(total)} delivered`,
      barColor: '#1E7B48',
      barPct: Math.min(deliveryRate, 100),
    },
    {
      label: 'RTO Exposure',
      value: fmtPct(rtoRate),
      hint:  `${fmtInt(t.rto)} returns initiated`,
      barColor: rtoRate > 20 ? '#BE2E2E' : rtoRate > 10 ? '#B05A10' : '#1E7B48',
      barPct: Math.min(rtoRate, 100),
    },
    {
      label: 'In Transit',
      value: fmtInt(t.inTransit),
      hint:  `${fmtPct(inTransitRate)} of total`,
      barColor: '#1C52B8',
      barPct: Math.min(inTransitRate * 5, 100),
    },
    {
      label: 'Dispute Load',
      value: fmtPct(disputeRate),
      hint:  `${fmtMoney(t.refundAmount)} recoverable`,
      barColor: disputeRate > 15 ? '#BE2E2E' : disputeRate > 5 ? '#B05A10' : '#9895A2',
      barPct: Math.min(disputeRate * 3, 100),
    },
  ];

  $('#signalGrid').innerHTML = signals.map(s => `
    <div class="signal-card">
      <div class="signal-label">${s.label}</div>
      <div class="signal-value">${s.value}</div>
      <div class="signal-hint">${s.hint}</div>
      <div class="signal-bar">
        <div class="signal-bar-fill" style="width:${s.barPct}%;background:${s.barColor}"></div>
      </div>
    </div>
  `).join('');
}

// ── Render: Status Chart ─────────────────────────────────

function renderStatusChart() {
  const summary = dashboard.statusSummary || {};
  const entries = Object.entries(summary).filter(([, v]) => v > 0);
  if (!entries.length) return;

  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v);
  const colors = {
    'Delivered':    '#1E7B48',
    'Moving':       '#1C52B8',
    'RTO':          '#BE2E2E',
    'Exceptions':   '#B05A10',
    'Lost/Damaged': '#5C5860',
  };

  const canvas = $('#statusChart');
  if (!canvas) return;
  const ctx   = canvas.getContext('2d');
  const dpr   = window.devicePixelRatio || 1;
  const cssH  = 160;
  const cssW  = canvas.parentElement.clientWidth || 400;

  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const max   = Math.max(...values, 1);
  const count = values.length;
  const pad   = 16;
  const barW  = Math.max(24, (cssW - pad * 2 - (count - 1) * 10) / count);
  const chartH = cssH - 42;

  values.forEach((v, i) => {
    const bh = Math.max(2, (v / max) * chartH);
    const x  = pad + i * (barW + 10);
    const y  = chartH - bh;
    const color = colors[labels[i]] || '#9895A2';

    // Bar
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh, [4, 4, 0, 0]);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#1B1820';
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fmtInt(v), x + barW / 2, y - 6);

    // Category label
    ctx.fillStyle = '#9895A2';
    ctx.font = '500 10px Inter, sans-serif';
    const lbl = String(labels[i]).slice(0, 10);
    ctx.fillText(lbl, x + barW / 2, cssH - 6);
  });
}

// ── Render: Disputes ─────────────────────────────────────

function renderDisputes() {
  const shipById = new Map(dashboard.shipments.map(s => [s.id, s]));
  const disputes = [...dashboard.disputes]
    .filter(d => d.status === 'open')
    .sort((a, b) => (b.claimedAmount || 0) - (a.claimedAmount || 0));

  const total = disputes.length;
  const showing = Math.min(disputePageSize, total);
  const slice   = disputes.slice(0, showing);

  $('#disputeSub').textContent =
    `${fmtInt(total)} open · ${fmtMoney(disputes.reduce((s, d) => s + (d.claimedAmount || 0), 0))} at risk`;

  const loadBtn = $('#loadMoreDisputes');
  if (total > showing) {
    loadBtn.style.display = 'inline-flex';
    loadBtn.textContent = `Load more (${total - showing} remaining)`;
  } else {
    loadBtn.style.display = 'none';
  }

  $('#disputeList').innerHTML = slice.map(d => {
    const ship = shipById.get(d.shipmentId);
    const awb  = ship?.awb || d.shipmentId?.slice(0, 10) || '—';
    const carrier = ship?.carrier || '—';
    return `
      <div class="dispute-item">
        <div class="dispute-left">
          <div class="dispute-awb">${awb}</div>
          <div class="dispute-meta">${carrier} · ${d.reason?.replace(/_/g, ' ') || 'charge variance'}</div>
        </div>
        <div class="dispute-right">
          <span class="dispute-amount">${fmtMoney(d.claimedAmount)}</span>
          <span class="badge badge-open">${d.status}</span>
          <button class="btn btn-sm btn-outline" data-dispute-id="${d.id}" data-next-status="submitted">
            Submit
          </button>
        </div>
      </div>
    `;
  }).join('') || '<div class="detail-empty">No open disputes — all clear.</div>';

  document.querySelectorAll('[data-dispute-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch(`/api/disputes/${btn.dataset.disputeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.nextStatus }),
      });
      toast('Dispute marked as submitted');
      await boot(false);
    });
  });
}

// ── Render: Shipments ────────────────────────────────────

function currentRows() {
  const q       = $('#search').value.toLowerCase();
  const carrier = $('#carrierFilter').value;
  const status  = $('#statusFilter').value;

  return dashboard.shipments.filter(s => {
    const hay = `${s.awb} ${s.carrier} ${s.currentStatus} ${s.destinationRegion || ''}`.toLowerCase();
    return (!q || hay.includes(q)) &&
           (!carrier || s.carrier === carrier) &&
           (!status  || s.currentStatus === status);
  });
}

function renderShipments() {
  const rows = currentRows();

  $('#dataBanner').textContent =
    `Database: ${fmtInt(dashboard.totals.totalShipments)} shipments · showing ${fmtInt(rows.length)} rows · KPIs use full dataset`;

  $('#shipmentSub').textContent =
    `${fmtInt(dashboard.totals.totalShipments)} total · ${fmtInt(dashboard.totals.delivered)} delivered · ${fmtInt(dashboard.totals.rto)} RTO`;

  $('#shipRows').innerHTML = rows.map(s => `
    <tr class="clickable ${s.id === selectedShipmentId ? 'selected' : ''}" data-sid="${s.id}">
      <td><strong>${s.awb}</strong></td>
      <td style="color:var(--text-2)">${s.order?.externalOrderId || '—'}</td>
      <td>${s.carrier || '—'}</td>
      <td><span class="badge ${statusBadgeClass(s.currentStatus)}">${statusLabel(s.currentStatus)}</span></td>
      <td style="color:var(--text-2)">${s.destinationRegion || '—'}</td>
      <td class="c">${s.deliveryAttempts || 0}</td>
      <td class="c">
        ${s.rtoFlag
          ? '<span class="badge badge-rto">Yes</span>'
          : '<span class="badge badge-neutral">No</span>'}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="loading-cell">No shipments match the current filters</td></tr>';

  document.querySelectorAll('[data-sid]').forEach(row => {
    row.addEventListener('click', () => {
      selectedShipmentId = row.dataset.sid;
      renderShipments();
      renderDetail();
    });
  });
}

function fillCarrierFilter() {
  const sel = $('#carrierFilter');
  const cur = sel.value;
  const carriers = [...new Set(dashboard.shipments.map(s => s.carrier).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">All carriers</option>' +
    carriers.map(c => `<option value="${c}">${c}</option>`).join('');
  sel.value = cur;
}

// ── Render: Shipment Detail ──────────────────────────────

function renderDetail() {
  const s = dashboard.shipments.find(s => s.id === selectedShipmentId);
  if (!s) {
    $('#detailPanel').innerHTML = '<div class="detail-empty">Select a shipment<br>to view details</div>';
    return;
  }

  const charges  = dashboard.charges.filter(c => c.shipmentId === s.id);
  const disputes = dashboard.disputes.filter(d => d.shipmentId === s.id);

  $('#detailPanel').innerHTML = `
    <div class="detail-title">${s.awb}</div>
    <div class="detail-grid">
      <div class="df"><span>Carrier</span><strong>${s.carrier || '—'}</strong></div>
      <div class="df"><span>Status</span><strong>${statusLabel(s.currentStatus)}</strong></div>
      <div class="df"><span>Region</span><strong>${s.destinationRegion || '—'}</strong></div>
      <div class="df"><span>Order</span><strong>${s.order?.externalOrderId || '—'}</strong></div>
      <div class="df"><span>Promised</span><strong>${s.promisedDeliveryDate || '—'}</strong></div>
      <div class="df"><span>Delivered</span><strong>${s.actualDeliveryDate || '—'}</strong></div>
    </div>
    <div class="mini-section">
      <h3>Charges (${charges.length})</h3>
      ${charges.length
        ? charges.map(c => `
            <p>${c.chargeType}: billed ${fmtMoney(c.billedAmount)},
            expected ${c.expectedAmount != null ? fmtMoney(c.expectedAmount) : '—'},
            variance <strong style="color:${(c.varianceAmount || 0) > 10 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(c.varianceAmount)}</strong></p>
          `).join('')
        : '<p>No charges recorded</p>'}
    </div>
    <div class="mini-section">
      <h3>Disputes (${disputes.length})</h3>
      ${disputes.length
        ? disputes.map(d => `<p><span class="badge badge-${d.status}">${d.status}</span> ${fmtMoney(d.claimedAmount)} — ${d.disputeNote || ''}</p>`).join('')
        : '<p>No disputes</p>'}
    </div>
  `;
}

// ── Render: Activity Log ─────────────────────────────────

function renderActivityLog() {
  const logs = dashboard.auditLogs || [];
  $('#auditLog').innerHTML = logs.length
    ? logs.map(l => `
        <div class="activity-item">
          <strong>${l.action.replace(/_/g, ' ')}</strong>
          <span>${l.entityType} · ${new Date(l.createdAt).toLocaleString('en-IN')}</span>
        </div>
      `).join('')
    : '<div class="activity-item"><strong>No activity yet</strong><span>Imports and actions will appear here</span></div>';
}

// ── Recompute totals after local import ──────────────────

function recomputeTotals() {
  const d = dashboard;
  d.totals = {
    totalShipments:    d.shipments.length,
    delivered:         d.shipments.filter(s => s.currentStatus === 'delivered').length,
    inTransit:         d.shipments.filter(s => ['picked_up','in_transit','at_hub','out_for_delivery'].includes(s.currentStatus)).length,
    rto:               d.shipments.filter(s => s.rtoFlag || String(s.currentStatus).startsWith('rto_')).length,
    openDisputes:      d.disputes.filter(s => s.status === 'open').length,
    wrongCharges:      d.charges.filter(c => Math.abs(Number(c.varianceAmount || 0)) > 10).length,
    totalBillingAmount:  d.charges.reduce((s, c) => s + Number(c.billedAmount || 0), 0),
    expectedBillingAmount: d.charges.reduce((s, c) => s + Number(c.expectedAmount || 0), 0),
    refundAmount:      d.charges.filter(c => Number(c.varianceAmount || 0) > 10).reduce((s, c) => s + Number(c.varianceAmount || 0), 0),
    recoveredAmount:   d.disputes.reduce((s, dp) => s + Number(dp.recoveredAmount || 0), 0),
    netOverbilling:    0,
    avgDeliveryDays:   d.totals.avgDeliveryDays,
    deliveryDaysSample: d.totals.deliveryDaysSample,
  };
  d.totals.netOverbilling = d.totals.totalBillingAmount - d.totals.expectedBillingAmount;
}

// ── Local CSV fallback (no server) ───────────────────────

function parseCsvLocal(content) {
  const rows = [];
  let cell = '', row = [], inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i], nx = content[i + 1];
    if (ch === '"' && nx === '"') { cell += '"'; i++; }
    else if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { row.push(cell.trim()); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && nx === '\n') i++;
      row.push(cell.trim());
      if (row.some(v => v)) rows.push(row);
      row = []; cell = '';
    } else { cell += ch; }
  }
  row.push(cell.trim());
  if (row.some(v => v)) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(vals => Object.fromEntries(headers.map((h, i) => [h, vals[i] || ''])));
}

function fieldOf(row, names) {
  const norm = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]+/g, ''), v])
  );
  for (const n of names) {
    const v = norm[n.toLowerCase().replace(/[^a-z0-9]+/g, '')];
    if (v) return v;
  }
  return '';
}

function normalizeLocalStatus(raw) {
  const v = String(raw || '').toLowerCase();
  if (v.includes('deliver') && !v.includes('out')) return 'delivered';
  if (v.includes('rto') || v.includes('return')) return 'rto_initiated';
  if (v.includes('out')) return 'out_for_delivery';
  if (v.includes('transit')) return 'in_transit';
  if (v.includes('pick')) return 'picked_up';
  return v.replace(/[^a-z0-9]+/g, '_') || 'exception';
}

function applyLocalImport(type, format, content) {
  const rows = format === 'json' ? JSON.parse(content) : parseCsvLocal(content);
  const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{"shipments":[],"charges":[],"auditLogs":[]}');
  const now = new Date().toISOString();

  if (type === 'charges') {
    rows.forEach(row => {
      const awb  = fieldOf(row, ['awb','awbNumber','trackingNumber','waybill']);
      const ship = dashboard.shipments.find(s => s.awb === awb);
      if (!ship) return;
      const billed   = Number(fieldOf(row, ['billedAmount','chargedAmount','amount','grandTotal','totalAmount','costInclGst','grossAmount','freightCharges','freight_charges']) || 0);
      const expRaw   = fieldOf(row, ['expectedAmount','rateAmount','agreedAmount','contractRate']);
      const expected = expRaw === '' ? null : Number(expRaw);
      const variance = expected !== null ? Number((billed - expected).toFixed(2)) : null;
      const charge = {
        id: `local_chg_${Date.now()}_${Math.random()}`,
        shipmentId: ship.id,
        carrierId:  ship.carrierId,
        chargeType: fieldOf(row, ['billType','chargeType','type']) || 'invoice',
        billedAmount: billed, expectedAmount: expected, varianceAmount: variance,
        invoiceId:  fieldOf(row, ['invoiceId','invoice','invoiceNumber']) || '',
        billingDate: fieldOf(row, ['billingDate','date']) || now.slice(0, 10),
      };
      stored.charges.push(charge);
      dashboard.charges.push(charge);
      if (variance !== null && Math.abs(variance) > 10) {
        const d = { id: `local_dsp_${Date.now()}_${Math.random()}`, shipmentId: ship.id, chargeId: charge.id, status: 'open', reason: 'charge_variance', disputeNote: `Billed ${billed}, expected ${expected}. Variance ${variance}.`, claimedAmount: Math.abs(variance), recoveredAmount: 0, openedAt: now };
        dashboard.disputes.push(d);
      }
    });
  } else {
    rows.forEach(row => {
      const awb = fieldOf(row, ['awb','awbNumber','trackingNumber','waybill']);
      if (!awb) return;
      const carrier  = fieldOf(row, ['carrier','courier','courierName']) || 'Unknown';
      const existing = dashboard.shipments.find(s => s.awb === awb);
      const ship = {
        id: existing?.id || `local_shp_${Date.now()}_${Math.random()}`,
        awb, carrierId: carrier.toLowerCase(), carrier,
        currentStatus: normalizeLocalStatus(fieldOf(row, ['status','currentStatus','shipmentStatus'])),
        destinationRegion: fieldOf(row, ['zone','region','destinationRegion','state','city']),
        destinationPincode: fieldOf(row, ['pincode','pinCode']),
        rtoFlag: ['yes','true','1'].includes(String(fieldOf(row, ['rto','rtoFlag'])).toLowerCase()),
        deliveryAttempts: Number(fieldOf(row, ['attempts','deliveryAttempts']) || 0),
        lastEventAt: now,
        order: { externalOrderId: fieldOf(row, ['orderId','order','externalOrderId']) || '—' },
      };
      if (existing) Object.assign(existing, ship);
      else dashboard.shipments.push(ship);
      stored.shipments.push(ship);
    });
  }

  stored.auditLogs.push({ action: 'local_import', entityType: type, createdAt: now, afterState: { rows: rows.length } });
  dashboard.auditLogs = [{ action: 'local_import', entityType: type, createdAt: now }, ...(dashboard.auditLogs || [])];
  localStorage.setItem(LOCAL_KEY, JSON.stringify(stored));
  recomputeTotals();
  return { rows: rows.length };
}

// ── Fetch wrapper ────────────────────────────────────────

async function apiPost(path, body = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}

// ── Render everything ────────────────────────────────────

function renderAll() {
  renderKPIs(dashboard.totals);
  renderAuditTable(dashboard.carrierPerformance, dashboard.totals);
  renderSignals(dashboard.totals);
  renderStatusChart();
  renderDisputes();
  fillCarrierFilter();
  renderShipments();
  renderDetail();
  renderActivityLog();

  $('#freshness').textContent = dashboard.freshness?.lastEventAt
    ? `Last event: ${new Date(dashboard.freshness.lastEventAt).toLocaleString('en-IN')}`
    : 'No events yet';
}

// ── Boot ─────────────────────────────────────────────────

async function boot(showToast = true) {
  try {
    const r = await fetch('/api/dashboard/summary');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    dashboard = await r.json();
    renderAll();
    if (showToast) toast('Dashboard refreshed');
  } catch (err) {
    console.error('Boot error:', err);
    if (!dashboard) {
      document.body.innerHTML =
        '<main style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,sans-serif">' +
        '<div style="text-align:center;color:#5C5860"><p style="font-size:18px;font-weight:600;margin-bottom:8px">Dashboard failed to load</p>' +
        '<p style="font-size:14px">Start the server with <code>start-dashboard.bat</code> and refresh.</p></div></main>';
    }
  }
}

// ── Events ───────────────────────────────────────────────

function wireEvents() {

  $('#carrierBackBtn').addEventListener('click', closeCarrierPage);

  // Close carrier page on Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCarrierPage(); });

  $('#carrierSearch').addEventListener('input', renderCarrierShipments);
  $('#carrierStatusFilter').addEventListener('change', renderCarrierShipments);
  $('#carrierOCFilter')?.addEventListener('change', renderCarrierShipments);

  $('#refreshBtn').addEventListener('click', () => boot(true));

  $('#exportBtn').addEventListener('click', () => { window.location.href = '/api/exports/shipments.csv'; });

  $('#recalcBtn').addEventListener('click', async () => {
    const btn = $('#recalcBtn');
    btn.disabled = true;
    btn.textContent = '⟳ Recalculating…';
    toast('Recalculating disputes against rate cards…');
    try {
      const r = await apiPost('/api/recalculate');
      if (r.ok) {
        const result = await r.json();
        await boot(false);
        toast(`Done — ${result.chargesValidated || 0} charges validated, ${result.disputesCreated || 0} new disputes`);
      } else {
        toast('Recalculate failed — check server');
      }
    } catch {
      toast('Server unavailable');
    } finally {
      btn.disabled = false;
      btn.textContent = '⟳ Recalculate';
    }
  });

  $('#search').addEventListener('input', renderShipments);
  $('#carrierFilter').addEventListener('change', renderShipments);
  $('#statusFilter').addEventListener('change', renderShipments);
  $('#clearFiltersBtn').addEventListener('click', () => {
    $('#search').value = '';
    $('#carrierFilter').value = '';
    $('#statusFilter').value = '';
    renderShipments();
    toast('Filters cleared');
  });

  $('#loadMoreDisputes').addEventListener('click', () => {
    disputePageSize += 50;
    renderDisputes();
  });

  window.addEventListener('resize', () => {
    if (dashboard) renderStatusChart();
  });

  // Upload form
  $('#uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form   = new FormData(e.currentTarget);
    const btn    = e.currentTarget.querySelector('button[type="submit"]');
    const status = $('#uploadStatus');

    btn.disabled = true;
    btn.textContent = 'Uploading…';
    status.textContent = 'Reading file…';

    let content = String(form.get('content') || '').trim();

    const file = form.get('file');
    if (!content && (!file || !file.name)) {
      toast('Choose a file or paste CSV data');
      status.textContent = 'No data provided.';
      btn.disabled = false;
      btn.textContent = 'Upload & Audit';
      return;
    }

    try {
      if (!content) content = await file.text();
      status.textContent = 'Sending to audit engine…';

      const r = await apiPost('/api/import', {
        type:    form.get('type'),
        format:  form.get('format'),
        content,
      });

      if (!r.ok) {
        if (r.status === 404) {
          toast('Server needs restart — use restart-dashboard.bat');
          status.textContent = 'Import route inactive — restart required.';
          return;
        }
        let msg = 'Upload failed — check file format.';
        try { msg = (await r.json()).error || msg; } catch {}
        toast(msg);
        status.textContent = msg;
        return;
      }

      const data = await r.json();
      toast(`Imported ${data.rows} rows`);
      status.textContent = `Imported ${data.rows} rows — created ${data.created ?? '?'}, updated ${data.updated ?? '?'}.`;
      await boot(false);

    } catch (err) {
      // Fallback: local browser import
      try {
        const local = applyLocalImport(form.get('type'), form.get('format'), content);
        renderAll();
        toast(`Imported ${local.rows} rows locally`);
        status.textContent = `Server offline — ${local.rows} rows imported in browser.`;
      } catch {
        const msg = err.name === 'AbortError'
          ? 'Server did not respond — restart dashboard.'
          : 'Upload failed before reaching server.';
        toast(msg);
        status.textContent = msg;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload & Audit';
    }
  });
}

// ── Start ────────────────────────────────────────────────
wireEvents();
wireChatbot();
boot(false);
