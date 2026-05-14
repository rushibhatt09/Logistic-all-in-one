import { readJson } from '../storage/jsonStore.js';

export async function getDashboardSummary() {
  const data = await readJson();
  const carrierById = new Map(data.carriers.map(carrier => [carrier.id, carrier]));
  const orderById = new Map(data.orders.map(order => [order.id, order]));
  const shipmentsById = new Map(data.shipments.map(shipment => [shipment.id, shipment]));
  const performanceByCarrier = new Map();
  const statusCounts = {};
  const statusSummary = {
    Delivered: 0,
    Moving: 0,
    Exceptions: 0,
    'Lost/Damaged': 0,
    RTO: 0
  };

  const totals = {
    totalShipments: data.shipments.length,
    delivered: 0,
    inTransit: 0,
    rto: 0,
    openDisputes: data.disputes.filter(item => item.status === 'open').length,
    wrongCharges: data.charges.filter(item => Number(item.varianceAmount || 0) > 10).length,
    chargeErrors: data.charges.filter(item => Math.abs(Number(item.varianceAmount || 0)) > 10).length,
    unvalidatedCharges: data.charges.filter(item => item.expectedAmount === null || item.expectedAmount === undefined).length,
    totalBillingAmount: roundMoney(data.charges.reduce((sum, charge) => sum + Number(charge.billedAmount || 0), 0)),
    expectedBillingAmount: roundMoney(data.charges.reduce((sum, charge) => sum + Number(charge.expectedAmount || 0), 0)),
    estimatedRefundAmount: roundMoney(data.charges
      .filter(charge => Number(charge.varianceAmount || 0) > 10)
      .reduce((sum, charge) => sum + Number(charge.varianceAmount || 0), 0)),
    confirmedRefundAmount: roundMoney(data.charges
      .filter(charge => Number(charge.varianceAmount || 0) > 10 && charge.rateCardSource !== 'image rate card')
      .reduce((sum, charge) => sum + Number(charge.varianceAmount || 0), 0)),
    recoveredAmount: roundMoney(data.disputes.reduce((sum, dispute) => sum + Number(dispute.recoveredAmount || 0), 0)),
    netOverbilling: 0,
    avgDeliveryDays: null,
    deliveryDaysSample: 0
  };
  totals.totalRefundAmount = totals.confirmedRefundAmount || totals.estimatedRefundAmount;
  totals.netOverbilling = roundMoney(totals.totalBillingAmount - totals.expectedBillingAmount);

  for (const shipment of data.shipments) {
    statusCounts[shipment.currentStatus] = (statusCounts[shipment.currentStatus] || 0) + 1;
    if (shipment.currentStatus === 'delivered') totals.delivered += 1;
    if (['picked_up', 'in_transit', 'at_hub', 'out_for_delivery'].includes(shipment.currentStatus)) totals.inTransit += 1;
    if (shipment.rtoFlag || String(shipment.currentStatus).startsWith('rto_')) totals.rto += 1;

    const group = statusGroup(shipment);
    statusSummary[group] += 1;

    const carrierName = normalizeCarrierName(carrierById.get(shipment.carrierId)?.name || 'Unknown');
    if (!performanceByCarrier.has(carrierName)) {
      performanceByCarrier.set(carrierName, {
        carrier: carrierName,
        total: 0,
        delivered: 0,
        rto: 0,
        openDisputes: 0,
        disputeAmount: 0,
        totalBillingAmount: 0,
        expectedBillingAmount: 0,
        deliveryDaysTotal: 0,
        deliveryDaysCount: 0
      });
    }

    const performance = performanceByCarrier.get(carrierName);
    performance.total += 1;
    if (shipment.currentStatus === 'delivered') performance.delivered += 1;
    if (shipment.rtoFlag || String(shipment.currentStatus).startsWith('rto_')) performance.rto += 1;
    const days = deliveryDays(shipment);
    if (days !== null) {
      performance.deliveryDaysTotal += days;
      performance.deliveryDaysCount += 1;
      totals.avgDeliveryDays = (totals.avgDeliveryDays || 0) + days;
    }
  }
  const totalDeliveryDayRows = [...performanceByCarrier.values()].reduce((sum, item) => sum + item.deliveryDaysCount, 0);
  totals.deliveryDaysSample = totalDeliveryDayRows;
  totals.avgDeliveryDays = totalDeliveryDayRows ? roundMoney(totals.avgDeliveryDays / totalDeliveryDayRows) : null;

  for (const charge of data.charges) {
    const carrierName = normalizeCarrierName(carrierById.get(charge.carrierId)?.name || 'Unknown');
    const performance = performanceByCarrier.get(carrierName);
    if (!performance) continue;
    performance.totalBillingAmount += Number(charge.billedAmount || 0);
    performance.expectedBillingAmount += Number(charge.expectedAmount || 0);
  }

  for (const dispute of data.disputes) {
    if (dispute.status !== 'open') continue;
    const shipment = shipmentsById.get(dispute.shipmentId);
    if (!shipment) continue;
    const carrierName = normalizeCarrierName(carrierById.get(shipment.carrierId)?.name || 'Unknown');
    const performance = performanceByCarrier.get(carrierName);
    if (performance) {
      performance.openDisputes += 1;
      performance.disputeAmount += Number(dispute.claimedAmount || 0);
    }
  }

  const carrierPerformance = [...performanceByCarrier.values()]
    .map(performance => ({
      ...performance,
      rtoRate: performance.total ? Math.round((performance.rto / performance.total) * 100) : 0,
      disputeRate: performance.total ? Math.round((performance.openDisputes / performance.total) * 100) : 0,
      avgDeliveryDays: performance.deliveryDaysCount ? roundMoney(performance.deliveryDaysTotal / performance.deliveryDaysCount) : null,
      totalBillingAmount: roundMoney(performance.totalBillingAmount),
      expectedBillingAmount: roundMoney(performance.expectedBillingAmount),
      disputeAmount: roundMoney(performance.disputeAmount),
      overbillingAmount: roundMoney(performance.totalBillingAmount - performance.expectedBillingAmount)
    }))
    .sort((a, b) => b.total - a.total);

  const shipments = data.shipments.slice(0, 1000).map(shipment => ({
    ...shipment,
    carrier: carrierById.get(shipment.carrierId)?.name || 'Unknown',
    order: orderById.get(shipment.orderId)
  }));

  return {
    totals,
    carrierPerformance,
    statusCounts,
    statusSummary,
    shipments,
    disputes: data.disputes.slice(-1000),
    charges: data.charges.slice(-1000),
    auditLogs: data.auditLogs.slice(-20).reverse(),
    freshness: {
      lastEventAt: data.events
        .map(event => event.eventTime)
        .sort()
        .at(-1) || null
    }
  };
}

function deliveryDays(shipment) {
  if (shipment.currentStatus !== 'delivered') return null;
  const start = parseDate(shipment.pickupDate);
  const end = parseDate(shipment.actualDeliveryDate);
  if (!start || !end || end < start) return null;
  const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, days);
}

function parseDate(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/^="/, '').replace(/"$/, '');
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function statusGroup(shipment) {
  const status = String(shipment.currentStatus || '');
  if (status === 'delivered') return 'Delivered';
  if (shipment.rtoFlag || status.startsWith('rto_')) return 'RTO';
  if (['lost', 'damaged'].includes(status)) return 'Lost/Damaged';
  if (['picked_up', 'in_transit', 'at_hub', 'out_for_delivery'].includes(status)) return 'Moving';
  return 'Exceptions';
}

function normalizeCarrierName(name) {
  const value = String(name || 'Unknown').trim();
  const lower = value.toLowerCase();
  if (lower.includes('xpress')) return 'XpressBees';
  if (lower.includes('delhivery')) return 'Delhivery';
  if (lower.includes('shadow')) return 'Shadowfax';
  if (lower.includes('dtdc')) return 'DTDC';
  if (lower.includes('swift')) return 'GoSwift';
  if (lower.includes('ats') || lower.includes('amazon')) return 'Amazon ATS';
  if (lower.includes('busy')) return 'Busybees';
  return value;
}
