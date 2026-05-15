import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { ingestShipmentEvent } from '../services/ingestionService.js';
import { validateCharge } from '../services/discrepancyService.js';
import { getDashboardSummary } from '../services/reportService.js';
import { importData, recalculateDisputes } from '../services/importService.js';

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
  return _anthropic;
}

function normalizeCarrierName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('xpress') || lower.includes('busy')) return 'XpressBees';
  if (lower.includes('delhivery')) return 'Delhivery';
  if (lower.includes('shadow')) return 'Shadowfax';
  if (lower.includes('dtdc')) return 'DTDC';
  if (lower.includes('swift')) return 'GoSwift';
  if (lower.includes('ats') || lower.includes('amazon')) return 'Amazon ATS';
  return String(name || '').trim();
}

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

  if (req.method === 'POST' && url.pathname === '/api/recalculate') {
    const result = await recalculateDisputes();
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  // ── Carrier detail page ───────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/api/carriers/') && url.pathname.endsWith('/details')) {
    const carrierName = decodeURIComponent(url.pathname.split('/')[3]);
    const data = await readJson();
    const carrierById  = new Map(data.carriers.map(c => [c.id, c]));
    const orderById    = new Map((data.orders || []).map(o => [o.id, o]));
    const referenceAudit = (data.referenceAudits || []).find(audit => normalizeCarrierName(audit.carrier) === carrierName);

    // All shipments for this carrier
    const shipments = data.shipments
      .filter(s => normalizeCarrierName(carrierById.get(s.carrierId)?.name) === carrierName)
      .map(s => {
        const ord = orderById.get(s.orderId);
        return {
          id: s.id, awb: s.awb, carrierId: s.carrierId,
          currentStatus: s.currentStatus, destinationRegion: s.destinationRegion,
          rtoFlag: s.rtoFlag, deliveryAttempts: s.deliveryAttempts,
          chargedWeightGrams: s.chargedWeightGrams,
          carrier: carrierById.get(s.carrierId)?.name || 'Unknown',
          order: ord ? { externalOrderId: ord.externalOrderId } : null,
        };
      });

    const shipIds = new Set(shipments.map(s => s.id));
    const shipMap = new Map(shipments.map(s => [s.id, s]));

    // Charges for those shipments
    const charges = (data.charges || []).filter(c => shipIds.has(c.shipmentId));

    // Disputes for those shipments
    const disputes = (data.disputes || []).filter(d => shipIds.has(d.shipmentId));

    // Zone breakdown with overcharge
    const zoneMap = new Map();
    for (const s of shipments) {
      const zone = s.destinationRegion || 'Unknown';
      if (!zoneMap.has(zone)) zoneMap.set(zone, { zone, total: 0, delivered: 0, rto: 0, disputes: 0, billedAmount: 0, overcharge: 0 });
      const z = zoneMap.get(zone);
      z.total++;
      if (s.currentStatus === 'delivered') z.delivered++;
      if (s.rtoFlag || String(s.currentStatus).startsWith('rto_')) z.rto++;
    }
    // Layer in charge overcharges
    for (const c of charges) {
      const s = shipMap.get(c.shipmentId);
      if (!s) continue;
      const zone = s.destinationRegion || 'Unknown';
      const z = zoneMap.get(zone);
      if (!z) continue;
      z.billedAmount += Number(c.billedAmount || 0);
      if (Number(c.varianceAmount || 0) > 10) z.overcharge += Number(c.varianceAmount || 0);
    }
    for (const d of disputes) {
      if (d.status !== 'open') continue;
      const s = shipMap.get(d.shipmentId);
      if (!s) continue;
      const zone = s.destinationRegion || 'Unknown';
      const z = zoneMap.get(zone);
      if (z) z.disputes++;
    }
    const zoneBreakdown = [...zoneMap.values()]
      .map(z => ({ ...z, billedAmount: Math.round(z.billedAmount * 100) / 100, overcharge: Math.round(z.overcharge * 100) / 100 }))
      .sort((a, b) => b.overcharge - a.overcharge || b.total - a.total);

    // Weight-slab overcharge breakdown
    const weightBuckets = { '0-500g': { billed: 0, overcharge: 0, count: 0 }, '501g-1kg': { billed: 0, overcharge: 0, count: 0 }, '1-2kg': { billed: 0, overcharge: 0, count: 0 }, '2-5kg': { billed: 0, overcharge: 0, count: 0 }, '>5kg': { billed: 0, overcharge: 0, count: 0 } };
    for (const c of charges) {
      const s = shipMap.get(c.shipmentId);
      const wg = c.chargedWeightGrams || s?.chargedWeightGrams || 0;
      const bucket = wg <= 500 ? '0-500g' : wg <= 1000 ? '501g-1kg' : wg <= 2000 ? '1-2kg' : wg <= 5000 ? '2-5kg' : '>5kg';
      if (weightBuckets[bucket]) {
        weightBuckets[bucket].billed += Number(c.billedAmount || 0);
        weightBuckets[bucket].overcharge += Math.max(0, Number(c.varianceAmount || 0));
        weightBuckets[bucket].count++;
      }
    }

    // Compute accurate aggregates from ALL data before slicing
    const totalDelivered  = shipments.filter(s => s.currentStatus === 'delivered').length;
    const totalRTO        = shipments.filter(s => s.rtoFlag || String(s.currentStatus).startsWith('rto_')).length;
    const totalBilled     = charges.reduce((s, c) => s + Number(c.billedAmount || 0), 0);
    let totalOvercharge = charges.filter(c => Number(c.varianceAmount || 0) > 10)
                                    .reduce((s, c) => s + Number(c.varianceAmount || 0), 0);
    const openDisputes    = disputes.filter(d => d.status === 'open');
    let totalAtRisk     = openDisputes.reduce((s, d) => s + Number(d.claimedAmount || 0), 0);
    let totalOpenDisputes = openDisputes.length;
    let effectiveTotalShipments = shipments.length;
    let effectiveZoneBreakdown = zoneBreakdown;
    let effectiveDisputes = openDisputes.sort((a, b) => (b.claimedAmount || 0) - (a.claimedAmount || 0)).slice(0, 500);

    if (referenceAudit?.trusted !== false) {
      effectiveTotalShipments = Number(referenceAudit.shipmentsAudited || shipments.length);
      totalOvercharge = Number(referenceAudit.claimAmount || totalOvercharge || 0);
      totalAtRisk = totalOvercharge;
      totalOpenDisputes = Number(referenceAudit.errorCount || totalOpenDisputes || 0);

      if (!effectiveZoneBreakdown.length && totalOpenDisputes > 0) {
        effectiveZoneBreakdown = [{
          zone: `${referenceAudit.period || 'Reference'} audit`,
          total: effectiveTotalShipments,
          delivered: 0,
          rto: 0,
          disputes: totalOpenDisputes,
          billedAmount: 0,
          overcharge: Math.round(totalOvercharge * 100) / 100
        }];
      }

      if (!effectiveDisputes.length && totalOpenDisputes > 0) {
        effectiveDisputes = [{
          id: `ref_${carrierName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          shipmentId: '',
          status: 'open',
          reason: 'confirmed_reference_audit',
          disputeNote: `${referenceAudit.period || ''} approved audit: ${totalOpenDisputes} confirmed billing errors.`,
          claimedAmount: totalOvercharge,
          recoveredAmount: 0,
          openedAt: new Date().toISOString()
        }];
      }
    } else if (referenceAudit) {
      totalOvercharge = 0;
      totalAtRisk = 0;
      totalOpenDisputes = 0;
    }

    sendJson(res, 200, {
      carrier: carrierName,
      totalShipments: effectiveTotalShipments,
      totalDelivered,
      totalRTO,
      totalBilled:     Math.round(totalBilled * 100) / 100,
      totalOvercharge: Math.round(totalOvercharge * 100) / 100,
      totalOpenDisputes,
      totalAtRisk:     Math.round(totalAtRisk * 100) / 100,
      rtoRate:         effectiveTotalShipments ? Math.round(totalRTO / effectiveTotalShipments * 1000) / 10 : 0,
      referenceAudit: referenceAudit || null,
      shipments: shipments.slice(0, 2000),
      charges: charges.slice(0, 2000),
      disputes: effectiveDisputes,
      zoneBreakdown: effectiveZoneBreakdown,
      weightBreakdown: weightBuckets,
    });
    return;
  }

  // ── AI Chat ──────────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    if (!process.env.ANTHROPIC_API_KEY) {
      sendJson(res, 200, { reply: '⚠️ Add your ANTHROPIC_API_KEY to the environment to enable the AI assistant. Create a .env file with: ANTHROPIC_API_KEY=sk-ant-...' });
      return;
    }
    const { messages, context } = await readBody(req);
    try {
      const systemPrompt = `You are a logistics intelligence assistant for Dermatouch (a skincare D2C brand in India). You help analyze shipping performance, billing disputes, carrier overcharges, and logistics operations.

Current dashboard context:
${JSON.stringify(context || {}, null, 2)}

Be concise, data-driven, and actionable. Use ₹ for rupees. When mentioning carriers use: Delhivery, Shadowfax, XpressBees, GoSwift, DTDC, Amazon ATS. Focus on practical recommendations the logistics/finance team can act on today.`;

      const response = await getAnthropic().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      sendJson(res, 200, { reply: response.content[0]?.text || 'No response' });
    } catch (err) {
      sendJson(res, 200, { reply: `AI error: ${err.message}` });
    }
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
