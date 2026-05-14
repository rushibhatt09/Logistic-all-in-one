import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { ingestShipmentEvent } from '../services/ingestionService.js';
import { validateCharge } from '../services/discrepancyService.js';
import { getDashboardSummary } from '../services/reportService.js';
import { importData } from '../services/importService.js';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [
    headers.join(','),
    ...rows.map(row => headers.map(header => escape(row[header])).join(','))
  ].join('\n');
}

export async function handleApiRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'logistics-dashboard' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard/summary') {
    sendJson(res, 200, await getDashboardSummary());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/shipments') {
    const data = await readJson();
    sendJson(res, 200, data.shipments);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/disputes') {
    const data = await readJson();
    sendJson(res, 200, data.disputes);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/exports/shipments.csv') {
    const data = await readJson();
    const carrierById = new Map(data.carriers.map(carrier => [carrier.id, carrier.name]));
    const orderById = new Map(data.orders.map(order => [order.id, order.externalOrderId]));
    const rows = data.shipments.map(shipment => ({
      awb: shipment.awb,
      order: orderById.get(shipment.orderId) || '',
      carrier: carrierById.get(shipment.carrierId) || '',
      status: shipment.currentStatus,
      region: shipment.destinationRegion,
      attempts: shipment.deliveryAttempts,
      rto: shipment.rtoFlag ? 'yes' : 'no',
      lastEventAt: shipment.lastEventAt || ''
    }));
    sendText(res, 200, toCsv(rows), 'text/csv; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ingest/events') {
    const result = await ingestShipmentEvent(await readBody(req));
    sendJson(res, result.status || 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/charges/validate') {
    const result = await validateCharge(await readBody(req));
    sendJson(res, result.status || 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import') {
    const result = await importData(await readBody(req));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/disputes/')) {
    const disputeId = url.pathname.split('/').at(-1);
    const body = await readBody(req);
    const data = await readJson();
    const dispute = data.disputes.find(item => item.id === disputeId);

    if (!dispute) {
      sendJson(res, 404, { error: 'Dispute not found' });
      return;
    }

    const beforeState = { ...dispute };
    dispute.status = body.status || dispute.status;
    dispute.recoveredAmount = body.recoveredAmount ?? dispute.recoveredAmount;
    dispute.resolvedAt = dispute.status === 'closed' || dispute.status === 'recovered'
      ? new Date().toISOString()
      : dispute.resolvedAt;

    data.auditLogs.push({
      id: randomUUID(),
      actorId: 'demo_user',
      action: 'dispute_updated',
      entityType: 'dispute',
      entityId: dispute.id,
      beforeState,
      afterState: dispute,
      createdAt: new Date().toISOString()
    });

    await writeJson(data);
    sendJson(res, 200, { ok: true, dispute });
    return;
  }

  sendJson(res, 404, { error: 'API route not found' });
}
