let dashboard = null;
let selectedShipmentId = null;

const localImportsKey = 'logisticsLocalImports';

const pageMeta = {
  dashboard: ['Operations Dashboard', 'Live shipment status, carrier performance, RTO risk, and billing disputes.'],
  shipments: ['Shipments', 'Search, filter, and inspect every AWB from order to delivery or RTO.'],
  disputes: ['Disputes', 'Track wrong charges, claimed amount, recovery, and dispute status.'],
  reports: ['Reports', 'Audit-ready performance and cost validation snapshots.'],
  integrations: ['Integrations', 'Connect APIs and test ingestion flows safely.']
};

const statusLabels = {
  delivered: 'Delivered',
  out_for_delivery: 'Out for delivery',
  in_transit: 'In transit',
  picked_up: 'Picked up',
  rto_initiated: 'RTO initiated',
  rto_delivered: 'RTO delivered',
  delivery_attempted: 'Delivery attempted',
  exception: 'Exception'
};

function $(selector) {
  return document.querySelector(selector);
}

function formatInt(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function formatMoney(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDays(value) {
  return value === null || value === undefined ? 'Need dates' : `${Number(value).toFixed(1)} days`;
}

function badgeClass(status) {
  if (status === 'delivered') return 'good';
  if (String(status).startsWith('rto_') || status === 'exception') return 'danger';
  if (status === 'delivery_attempted' || status === 'out_for_delivery') return 'warn';
  return '';
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

function parseCsvLocal(content) {
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value)) rows.push(row);
  const headers = rows.shift() || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function field(row, names) {
  const cleaned = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', ''), value])
  );
  for (const name of names) {
    const value = cleaned[name.toLowerCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '')];
    if (value) return value;
  }
  return '';
}

function normalizeLocalStatus(rawStatus) {
  const value = String(rawStatus || '').toLowerCase();
  if (value.includes('deliver') && !value.includes('out')) return 'delivered';
  if (value.includes('rto') || value.includes('return')) return 'rto_initiated';
  if (value.includes('out')) return 'out_for_delivery';
  if (value.includes('transit')) return 'in_transit';
  if (value.includes('pick')) return 'picked_up';
  return value.replace(/[^a-z0-9]+/g, '_') || 'exception';
}

function applyLocalImport(type, format, content) {
  const rows = format === 'json' ? JSON.parse(content) : parseCsvLocal(content);
  const stored = JSON.parse(localStorage.getItem(localImportsKey) || '{"shipments":[],"charges":[],"auditLogs":[]}');
  const now = new Date().toISOString();

  if (type === 'charges') {
    rows.forEach(row => {
      const awb = field(row, ['awb', 'awbNumber', 'trackingNumber', 'waybill']);
      const shipment = dashboard.shipments.find(item => item.awb === awb);
      if (!shipment) return;
      const billedAmount = Number(field(row, ['billedAmount', 'chargedAmount', 'amount', 'billAmount', 'invoiceAmount', 'totalAmount', 'freightCharge', 'totalCharge', 'netAmount']) || 0);
      const expectedAmount = Number(field(row, ['expectedAmount', 'rateAmount', 'agreedAmount', 'contractRate', 'expectedCharge']) || 0);
      const varianceAmount = Number((billedAmount - expectedAmount).toFixed(2));
      const charge = {
        id: `local_chg_${Date.now()}_${Math.random()}`,
        shipmentId: shipment.id,
        carrierId: shipment.carrierId,
        chargeType: field(row, ['billType', 'chargeType', 'type']) || 'invoice',
        billedAmount,
        expectedAmount,
        varianceAmount,
        invoiceId: field(row, ['invoiceId', 'invoice', 'invoiceNumber', 'billNumber']) || '',
        billingDate: field(row, ['billingDate', 'date']) || now.slice(0, 10)
      };
      stored.charges.push(charge);
      dashboard.charges.push(charge);
      if (Math.abs(varianceAmount) > 10) {
        dashboard.disputes.push({
          id: `local_dsp_${Date.now()}_${Math.random()}`,
          shipmentId: shipment.id,
          chargeId: charge.id,
          status: 'open',
          reason: 'charge_variance',
          disputeNote: `Billed ${billedAmount}, expected ${expectedAmount}. Variance ${varianceAmount}.`,
          claimedAmount: Math.abs(varianceAmount),
          recoveredAmount: 0,
          openedAt: now
        });
      }
    });
  } else {
    rows.forEach(row => {
      const awb = field(row, ['awb', 'awbNumber', 'trackingNumber', 'waybill']);
      if (!awb) return;
      const carrier = field(row, ['carrier', 'courier', 'courierName', 'carrierName']) || 'Unknown';
      const existing = dashboard.shipments.find(item => item.awb === awb);
      const shipment = {
        id: existing?.id || `local_shp_${Date.now()}_${Math.random()}`,
        orderId: field(row, ['orderId', 'order', 'externalOrderId', 'shopifyOrderId']),
        awb,
        carrierId: carrier.toLowerCase(),
        carrier,
        currentStatus: normalizeLocalStatus(field(row, ['status', 'currentStatus', 'shipmentStatus', 'latestStatus'])),
        destinationRegion: field(row, ['zone', 'region', 'destinationRegion', 'state', 'city']),
        destinationPincode: field(row, ['pincode', 'pinCode', 'destinationPincode']),
        originCity: field(row, ['originCity', 'origin']),
        sellerCompanyName: field(row, ['sellerCompanyName', 'seller', 'companyName']),
        externalShipmentId: field(row, ['shipmentId', 'shipmentID']),
        billType: field(row, ['billType']),
        paymentType: field(row, ['paymentType', 'payment']),
        promisedDeliveryDate: field(row, ['promisedDeliveryDate', 'expectedDeliveryDate', 'edd']) || null,
        actualDeliveryDate: field(row, ['actualDeliveryDate', 'deliveredDate']) || null,
        rtoFlag: ['yes', 'true', '1'].includes(String(field(row, ['rto', 'rtoFlag'])).toLowerCase()),
        deliveryAttempts: Number(field(row, ['attempts', 'deliveryAttempts']) || 0),
        lastEventAt: field(row, ['lastEventAt', 'updatedAt', 'eventTime']) || now,
        order: { externalOrderId: field(row, ['orderId', 'order', 'externalOrderId', 'shopifyOrderId']) || '-' }
      };
      if (existing) Object.assign(existing, shipment);
      else dashboard.shipments.push(shipment);
      stored.shipments.push(shipment);
    });
  }

  const audit = {
    action: 'local_data_imported',
    entityType: type,
    createdAt: now,
    afterState: { rows: rows.length }
  };
  stored.auditLogs.push(audit);
  dashboard.auditLogs = [audit, ...(dashboard.auditLogs || [])];
  localStorage.setItem(localImportsKey, JSON.stringify(stored));
  recomputeDashboardTotals();
  return { rows: rows.length };
}

function recomputeDashboardTotals() {
  dashboard.totals = {
    totalShipments: dashboard.shipments.length,
    delivered: dashboard.shipments.filter(item => item.currentStatus === 'delivered').length,
    inTransit: dashboard.shipments.filter(item => ['picked_up', 'in_transit', 'at_hub', 'out_for_delivery'].includes(item.currentStatus)).length,
    rto: dashboard.shipments.filter(item => item.rtoFlag || String(item.currentStatus).startsWith('rto_')).length,
    openDisputes: dashboard.disputes.filter(item => item.status === 'open').length,
    wrongCharges: dashboard.charges.filter(item => Math.abs(item.varianceAmount) > 10).length
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function currentRows() {
  const search = $('#search').value.toLowerCase();
  const carrier = $('#carrierFilter').value;
  const status = $('#statusFilter').value;

  return dashboard.shipments.filter(item => {
    const haystack = `${item.awb} ${item.carrier} ${item.currentStatus} ${item.destinationRegion}`.toLowerCase();
    return (!search || haystack.includes(search)) &&
      (!carrier || item.carrier === carrier) &&
      (!status || item.currentStatus === status);
  });
}

function renderMetrics(totals) {
  const hasFinance = totals.totalBillingAmount !== undefined && totals.totalRefundAmount !== undefined;
  const items = [
    ['Total Billing', hasFinance ? formatMoney(totals.totalBillingAmount) : 'Restart server', 'Courier billed amount', 'neutral'],
    ['Est. Refund', hasFinance ? formatMoney(totals.estimatedRefundAmount || totals.totalRefundAmount) : 'Restart server', totals.confirmedRefundAmount ? `${formatMoney(totals.confirmedRefundAmount)} confirmed` : 'Needs reference audit to confirm', 'warn'],
    ['Open Disputes', formatInt(totals.openDisputes), `${formatInt(totals.wrongCharges)} charge errors`, 'danger'],
    ['Total Shipments', formatInt(totals.totalShipments), `${formatInt(totals.delivered)} delivered`, 'info'],
    ['Avg Delivery', totals.avgDeliveryDays !== undefined ? formatDays(totals.avgDeliveryDays) : 'Restart server', `${formatInt(totals.deliveryDaysSample)} shipments with dates`, 'good']
  ];

  $('#metrics').innerHTML = items
    .map(([label, value, hint, tone]) => `
      <button class="metric ${tone}" data-metric="${label}">
        <span><i></i>${label}</span>
        <strong>${value}</strong>
        <small>${hint}</small>
      </button>
    `)
    .join('');
}

function renderCarrierRows(rows) {
  const rankedRows = [...rows].sort((a, b) =>
    (b.disputeRate - a.disputeRate) ||
    (b.disputeAmount - a.disputeAmount) ||
    (b.rtoRate - a.rtoRate)
  );

  $('#carrierRows').innerHTML = rankedRows
    .map(row => `
      <tr>
        <td>${row.carrier}</td>
        <td>${row.total}</td>
        <td>${row.delivered}</td>
        <td>${row.avgDeliveryDays === null || row.avgDeliveryDays === undefined ? 'No dates' : `${formatDays(row.avgDeliveryDays)} (${formatInt(row.deliveryDaysCount)})`}</td>
        <td>
          <div class="progress-cell">
            <span>${row.rtoRate}%</span>
            <div class="progress"><b style="width:${Math.min(row.rtoRate, 100)}%"></b></div>
          </div>
        </td>
        <td>
          <div class="progress-cell">
            <span>${row.disputeRate}%</span>
            <div class="progress danger"><b style="width:${Math.min(row.disputeRate, 100)}%"></b></div>
          </div>
        </td>
        <td>${formatInt(row.openDisputes)}</td>
        <td>${formatMoney(row.disputeAmount)}</td>
      </tr>
    `)
    .join('');
}

function renderSignals() {
  const totals = dashboard.totals;
  const rtoRate = totals.totalShipments ? Math.round((totals.rto / totals.totalShipments) * 100) : 0;
  const disputeRate = totals.totalShipments ? Math.round((totals.openDisputes / totals.totalShipments) * 100) : 0;
  const deliveredRate = totals.totalShipments ? Math.round((totals.delivered / totals.totalShipments) * 100) : 0;

  const signals = [
    ['Delivery Completion', `${deliveredRate}%`, 'Delivered shipments against total visible shipments', 'good'],
    ['RTO Exposure', `${rtoRate}%`, rtoRate > 15 ? 'High return exposure needs review' : 'Return exposure is under watch', rtoRate > 15 ? 'danger' : 'warn'],
    ['Dispute Load', `${disputeRate}%`, `${formatMoney(totals.estimatedRefundAmount || totals.totalRefundAmount)} estimated recoverable`, disputeRate > 10 ? 'danger' : 'info'],
    ['Expected Billing', formatMoney(totals.expectedBillingAmount), `${formatMoney(totals.netOverbilling)} net overbilling signal`, 'neutral']
  ];

  $('#signalGrid').innerHTML = signals.map(([title, value, detail, tone]) => `
    <div class="signal ${tone}">
      <span>${title}</span>
      <strong>${value}</strong>
      <p>${detail}</p>
    </div>
  `).join('');
}

function renderShipments() {
  const rows = currentRows();
  $('#dataBanner').textContent =
    `Database has ${dashboard.totals.totalShipments.toLocaleString()} shipments. The table displays ${rows.length.toLocaleString()} rows at a time for speed; KPIs and graphs use the full dataset.`;

  $('#shipmentRows').innerHTML = rows
    .map(item => `
      <tr class="clickable-row ${item.id === selectedShipmentId ? 'selected' : ''}" data-shipment-id="${item.id}">
        <td><strong>${item.awb}</strong></td>
        <td>${item.order?.externalOrderId || '-'}</td>
        <td>${item.carrier}</td>
        <td><span class="badge ${badgeClass(item.currentStatus)}">${statusLabels[item.currentStatus] || item.currentStatus}</span></td>
        <td>${item.destinationRegion || '-'}</td>
        <td>${item.deliveryAttempts}</td>
        <td>${item.rtoFlag ? '<span class="badge danger">Yes</span>' : '<span class="badge good">No</span>'}</td>
      </tr>
    `)
    .join('');

  document.querySelectorAll('[data-shipment-id]').forEach(row => {
    row.addEventListener('click', () => {
      selectedShipmentId = row.dataset.shipmentId;
      renderShipments();
      renderShipmentDetail();
    });
  });

  const exceptions = rows.filter(item => item.rtoFlag || item.deliveryAttempts > 1 || item.currentStatus === 'exception');
  $('#exceptionList').innerHTML = exceptions.length
    ? exceptions.map(item => `
        <button class="exception" data-jump-shipment="${item.id}">
          <strong>${item.awb} - ${item.carrier}</strong>
          <span>Status: ${statusLabels[item.currentStatus] || item.currentStatus}</span>
          <span>Region: ${item.destinationRegion || '-'} | Attempts: ${item.deliveryAttempts}</span>
        </button>
      `).join('')
    : '<div class="exception"><strong>No urgent exceptions</strong><span>Current filtered shipments look clean.</span></div>';

  document.querySelectorAll('[data-jump-shipment]').forEach(button => {
    button.addEventListener('click', () => {
      selectedShipmentId = button.dataset.jumpShipment;
      switchPage('shipments');
      renderShipments();
      renderShipmentDetail();
    });
  });
}

function renderShipmentDetail() {
  const shipment = dashboard.shipments.find(item => item.id === selectedShipmentId);
  if (!shipment) {
    $('#shipmentDetailBody').innerHTML = '<div class="detail-empty">No shipment selected.</div>';
    return;
  }

  const charges = dashboard.charges.filter(item => item.shipmentId === shipment.id);
  const disputes = dashboard.disputes.filter(item => item.shipmentId === shipment.id);
  $('#shipmentDetailBody').innerHTML = `
    <div class="detail-grid">
      <div><span>AWB</span><strong>${shipment.awb}</strong></div>
      <div><span>Order</span><strong>${shipment.order?.externalOrderId || '-'}</strong></div>
      <div><span>Carrier</span><strong>${shipment.carrier}</strong></div>
      <div><span>Status</span><strong>${statusLabels[shipment.currentStatus] || shipment.currentStatus}</strong></div>
      <div><span>Promised</span><strong>${shipment.promisedDeliveryDate || '-'}</strong></div>
      <div><span>Actual</span><strong>${shipment.actualDeliveryDate || '-'}</strong></div>
    </div>
    <div class="mini-section">
      <h3>Charges</h3>
      ${charges.length ? charges.map(charge => `
        <p>${charge.chargeType}: billed ${charge.billedAmount}, expected ${charge.expectedAmount}, variance ${charge.varianceAmount}</p>
      `).join('') : '<p>No charges added yet.</p>'}
    </div>
    <div class="mini-section">
      <h3>Disputes</h3>
      ${disputes.length ? disputes.map(dispute => `
        <p>${dispute.status}: ${dispute.disputeNote}</p>
      `).join('') : '<p>No disputes for this shipment.</p>'}
    </div>
  `;
}

function renderDisputes() {
  const shipmentById = new Map(dashboard.shipments.map(item => [item.id, item]));
  $('#disputeRows').innerHTML = dashboard.disputes
    .map(dispute => {
      const shipment = shipmentById.get(dispute.shipmentId);
      return `
        <tr>
          <td>${dispute.id.slice(0, 8)}</td>
          <td><strong>${shipment?.awb || '-'}</strong></td>
          <td>${dispute.reason}</td>
          <td>${dispute.claimedAmount}</td>
          <td><span class="badge ${dispute.status === 'open' ? 'warn' : 'good'}">${dispute.status}</span></td>
          <td>
            <button class="ghost compact" data-dispute-action="${dispute.id}" data-status="${dispute.status === 'open' ? 'submitted' : 'recovered'}">
              ${dispute.status === 'open' ? 'Mark Submitted' : 'Mark Recovered'}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  document.querySelectorAll('[data-dispute-action]').forEach(button => {
    button.addEventListener('click', async () => {
      await fetch(`/api/disputes/${button.dataset.disputeAction}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: button.dataset.status })
      });
      toast('Dispute updated');
      await boot(false);
      renderDisputes();
    });
  });
}

function renderReports() {
  const totalVariance = dashboard.charges.reduce((sum, charge) => sum + Number(charge.varianceAmount || 0), 0);
  const claimAmount = dashboard.disputes.reduce((sum, dispute) => sum + Number(dispute.claimedAmount || 0), 0);
  const recovered = dashboard.disputes.reduce((sum, dispute) => sum + Number(dispute.recoveredAmount || 0), 0);
  const unvalidatedCharges = dashboard.totals.unvalidatedCharges || 0;

  $('#reportCards').innerHTML = `
    <div><span>Total billing</span><strong>${formatMoney(dashboard.totals.totalBillingAmount)}</strong></div>
    <div><span>Expected billing</span><strong>${formatMoney(dashboard.totals.expectedBillingAmount)}</strong></div>
    <div><span>Total variance</span><strong>${formatMoney(totalVariance)}</strong></div>
    <div><span>Estimated refund</span><strong>${formatMoney(dashboard.totals.estimatedRefundAmount || claimAmount - recovered)}</strong></div>
    <div><span>Confirmed refund</span><strong>${formatMoney(dashboard.totals.confirmedRefundAmount)}</strong></div>
    <div><span>Recovered</span><strong>${formatMoney(recovered)}</strong></div>
    <div><span>Charges needing rate card</span><strong>${unvalidatedCharges.toLocaleString()}</strong></div>
  `;

  drawChargeChart();
}

function renderAuditLog() {
  const logs = dashboard.auditLogs || [];
  $('#auditLog').innerHTML = logs.length
    ? logs.map(log => `
      <div class="audit-item">
        <strong>${log.action}</strong>
        <span>${log.entityType} | ${new Date(log.createdAt).toLocaleString()}</span>
      </div>
    `).join('')
    : '<div class="audit-item"><strong>No audit actions yet</strong><span>Uploads and changes will appear here.</span></div>';
}

function fillCarrierFilter(shipments) {
  const selected = $('#carrierFilter').value;
  const carriers = [...new Set(shipments.map(item => item.carrier))].sort();
  $('#carrierFilter').innerHTML = '<option value="">All carriers</option>' +
    carriers.map(name => `<option value="${name}">${name}</option>`).join('');
  $('#carrierFilter').value = selected;
}

function drawBarChart(canvasId, labels, values, color) {
  const canvas = $(`#${canvasId}`);
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cssHeight = Number(canvas.dataset.chartHeight || canvas.getAttribute('height') || 220);
  canvas.dataset.chartHeight = String(cssHeight);
  canvas.style.height = `${cssHeight}px`;
  canvas.width = rect.width * dpr;
  canvas.height = cssHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width;
  const height = cssHeight;
  ctx.clearRect(0, 0, width, height);
  const max = Math.max(...values, 1);
  const gap = 18;
  const barWidth = Math.max(26, (width - gap * (values.length + 1)) / Math.max(values.length, 1));

  labels.forEach((label, index) => {
    const barHeight = (values[index] / max) * (height - 70);
    const x = gap + index * (barWidth + gap);
    const y = height - barHeight - 36;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = '#18212f';
    ctx.font = '13px Segoe UI';
    ctx.fillText(String(values[index]), x, y - 8);
    ctx.fillStyle = '#697486';
    ctx.fillText(label.slice(0, 12), x, height - 12);
  });
}

function drawStatusChart() {
  const summary = dashboard.statusSummary || {
    Delivered: dashboard.totals.delivered || 0,
    Moving: dashboard.totals.inTransit || 0,
    Exceptions: Math.max(
      0,
      (dashboard.totals.totalShipments || 0) -
        (dashboard.totals.delivered || 0) -
        (dashboard.totals.inTransit || 0) -
        (dashboard.totals.rto || 0)
    ),
    RTO: dashboard.totals.rto || 0
  };
  const entries = Object.entries(summary).filter(([, value]) => value > 0);
  const labels = entries.map(([label]) => label);
  const values = entries.map(([, value]) => value);
  drawBarChart('statusChart', labels, values, '#0f766e');
}

function drawCarrierChart() {
  drawBarChart(
    'carrierChart',
    dashboard.carrierPerformance.slice(0, 8).map(item => item.carrier),
    dashboard.carrierPerformance.slice(0, 8).map(item => item.total),
    '#2563eb'
  );
}

function drawChargeChart() {
  drawBarChart(
    'chargeChart',
    dashboard.charges.map(item => item.invoiceId || item.chargeType),
    dashboard.charges.map(item => Math.abs(Number(item.varianceAmount || 0))),
    '#b45309'
  );
}

function renderCharts() {
  drawStatusChart();
  drawCarrierChart();
  if ($('#chargeChart')) drawChargeChart();
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(section => section.classList.remove('active'));
  $(`#${page}Page`).classList.add('active');
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#pageTitle').textContent = pageMeta[page][0];
  $('#pageSubtitle').textContent = pageMeta[page][1];
  if (page === 'disputes') renderDisputes();
  if (page === 'reports') renderReports();
  if (page === 'integrations') renderAuditLog();
  if (page === 'dashboard') renderCharts();
}

async function boot(showMessage = true) {
  const response = await fetch('/api/dashboard/summary');
  dashboard = await response.json();
  renderMetrics(dashboard.totals);
  renderCarrierRows(dashboard.carrierPerformance);
  renderSignals();
  fillCarrierFilter(dashboard.shipments);
  renderShipments();
  renderShipmentDetail();
  renderDisputes();
  renderReports();
  renderAuditLog();
  renderCharts();

  $('#freshness').textContent =
    dashboard.freshness.lastEventAt
      ? `Last event: ${new Date(dashboard.freshness.lastEventAt).toLocaleString()}`
      : 'No events yet';

  if (showMessage) toast('Dashboard refreshed');
}

function downloadCsv() {
  window.location.href = '/api/exports/shipments.csv';
}

function wireEvents() {
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
  $('#refreshBtn').addEventListener('click', () => boot());
  $('#exportBtn').addEventListener('click', downloadCsv);

  document.querySelectorAll('[data-page]').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.page));
  });

  document.querySelectorAll('[data-page-jump]').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.pageJump));
  });

  $('#eventForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/ingest/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual_demo',
        sourceEventId: `demo_${Date.now()}`,
        awb: form.get('awb'),
        rawStatus: form.get('rawStatus'),
        eventTime: new Date().toISOString(),
        location: form.get('location')
      })
    });
    toast('Tracking event added');
    await boot(false);
  });

  $('#chargeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await fetch('/api/charges/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        awb: form.get('awb'),
        chargeType: 'manual_check',
        billedAmount: Number(form.get('billedAmount')),
        expectedAmount: Number(form.get('expectedAmount')),
        invoiceId: `MANUAL-${Date.now()}`
      })
    });
    toast('Charge checked and dispute created if needed');
    await boot(false);
  });

  $('#uploadForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get('file');
    const uploadStatus = $('#uploadStatus');
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');

    submitButton.disabled = true;
    submitButton.textContent = 'Uploading...';
    uploadStatus.textContent = 'Reading file...';

    let content = String(form.get('content') || '').trim();

    if (!content && (!file || !file.name)) {
      toast('Please choose a file or paste CSV data');
      uploadStatus.textContent = 'No file or pasted data selected.';
      submitButton.disabled = false;
      submitButton.textContent = 'Upload & Audit';
      return;
    }

    try {
      if (!content) content = await file.text();
      uploadStatus.textContent = 'Sending data to audit engine...';

      const result = await fetchWithTimeout('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.get('type'),
          format: form.get('format'),
          content
        })
      });

      if (!result.ok) {
        if (result.status === 404) {
          toast('Server restart required. Use restart-dashboard.bat');
          uploadStatus.textContent = 'Backend import route is not active. Restart required.';
          return;
        }

        let message = 'Upload failed. Check file format.';
        try {
          const error = await result.json();
          message = error.error || message;
        } catch {
          // Keep the friendly fallback when server does not return JSON.
        }

        toast(message);
        uploadStatus.textContent = message;
        return;
      }

      const summary = await result.json();
      toast(`Imported ${summary.rows} rows`);
      uploadStatus.textContent = `Imported ${summary.rows} rows. Created ${summary.created}, updated ${summary.updated}.`;
      await boot(false);
      renderAuditLog();
    } catch (error) {
      try {
        const localSummary = applyLocalImport(form.get('type'), form.get('format'), content);
        renderMetrics(dashboard.totals);
        renderShipments();
        renderDisputes();
        renderReports();
        renderAuditLog();
        renderCharts();
        toast(`Imported ${localSummary.rows} rows locally`);
        uploadStatus.textContent = `Server was unavailable, so ${localSummary.rows} rows were imported locally in this browser.`;
        return;
      } catch {
        // Fall through to the original user-facing error.
      }

      const message = error.name === 'AbortError'
        ? 'Server did not respond. Restart dashboard server.'
        : 'Upload failed before reaching server.';
      toast(message);
      uploadStatus.textContent = message;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Upload & Audit';
    }
  });

  window.addEventListener('resize', () => {
    if (dashboard) renderCharts();
  });
}

wireEvents();
boot(false).catch(error => {
  console.error(error);
  document.body.innerHTML = '<main class="app"><h1>Dashboard failed to load</h1><p>Please check the server window.</p></main>';
});
