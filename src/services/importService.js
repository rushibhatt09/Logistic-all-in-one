import { randomUUID } from 'node:crypto';
import { normalizeStatus, isRtoStatus } from '../domain/statusNormalizer.js';
import { readJson, writeJson } from '../storage/jsonStore.js';

const DEFAULT_RATE_CARDS = buildDefaultRateCards();

function parseCsv(content) {
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
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);

  const headers = rows.shift()?.map(header => header.trim()) || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function readField(row, names) {
  const normalized = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizeFieldName(key), cleanFieldValue(value)])
  );
  for (const name of names) {
    const value = normalized[normalizeFieldName(name)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cleanFieldValue(value) {
  let text = String(value ?? '').trim();
  if (text.startsWith('="') && text.endsWith('"')) text = text.slice(2, -1);
  if (text.startsWith('=') && text.length > 1) text = text.slice(1);
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  return text.trim();
}

function getOrCreateCarrier(data, nameOrCode) {
  const value = String(nameOrCode || 'Unknown').trim();
  const code = value.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown';
  let carrier = data.carriers.find(item => item.code === code || item.name.toLowerCase() === value.toLowerCase());

  if (!carrier) {
    carrier = { id: `car_${randomUUID()}`, name: value, code, active: true };
    data.carriers.push(carrier);
  }

  return carrier;
}

function getOrCreateCarrierFast(data, carrierByCode, nameOrCode) {
  const value = String(nameOrCode || 'Unknown').trim();
  const code = value.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'unknown';
  let carrier = carrierByCode.get(code);

  if (!carrier) {
    carrier = { id: `car_${randomUUID()}`, name: value, code, active: true };
    data.carriers.push(carrier);
    carrierByCode.set(code, carrier);
  }

  return carrier;
}

function getOrCreateOrder(data, externalOrderId, row = {}) {
  const orderId = String(externalOrderId || `ORDER-${Date.now()}`).trim();
  let order = data.orders.find(item => item.externalOrderId === orderId);

  if (!order) {
    order = {
      id: `ord_${randomUUID()}`,
      externalOrderId: orderId,
      customerRegion: readField(row, ['region', 'customerRegion', 'state', 'destinationRegion', 'zone', 'city']) || '',
      orderValue: Number(readField(row, ['orderValue', 'amount', 'value', 'invoiceAmount', 'billedAmount']) || 0),
      paymentType: readField(row, ['paymentType', 'payment', 'codPrepaid']) || '',
      status: readField(row, ['orderStatus', 'status']) || 'created',
      createdAt: readField(row, ['createdAt', 'orderDate', 'date']) || new Date().toISOString()
    };
    data.orders.push(order);
  }

  return order;
}

function getOrCreateOrderFast(data, orderByExternalId, externalOrderId, row = {}) {
  const orderId = String(externalOrderId || `ORDER-${Date.now()}-${randomUUID()}`).trim();
  let order = orderByExternalId.get(orderId);

  if (!order) {
    order = {
      id: `ord_${randomUUID()}`,
      externalOrderId: orderId,
      customerRegion: readField(row, ['region', 'customerRegion', 'state', 'destinationRegion', 'destinationState', 'zone', 'city', 'destinationCity']) || '',
      orderValue: Number(readField(row, ['orderValue', 'amount', 'value', 'productValue', 'product_value', 'invoiceAmount', 'billedAmount']) || 0),
      paymentType: readField(row, ['paymentType', 'packageType', 'package_type', 'codPrepaid', 'paymentMode', 'payment_mode', 'payment', 'type']) || '',
      status: readField(row, ['orderStatus', 'status']) || 'created',
      createdAt: readField(row, ['createdAt', 'orderDate', 'pickupDate', 'pickedDate', 'pickup_date', 'date']) || new Date().toISOString()
    };
    data.orders.push(order);
    orderByExternalId.set(order.externalOrderId, order);
  }

  return order;
}

function importShipments(data, rows, sourceName = '') {
  let created = 0;
  let updated = 0;
  const shipmentByAwb = new Map(data.shipments.map(shipment => [shipment.awb, shipment]));
  const orderByExternalId = new Map(data.orders.map(order => [order.externalOrderId, order]));
  const carrierByCode = new Map(data.carriers.map(carrier => [carrier.code, carrier]));

  rows.forEach(row => {
    const awb = readField(row, ['awb', 'awbNumber', 'awb_number', 'trackingNumber', 'waybill', 'waybillNum', 'waybill_num', 'swiftId', 'swift_id', 'shipmentNumber', 'consignmentNo', 'consignment_no']);
    if (!awb) return;

    const carrier = getOrCreateCarrierFast(data, carrierByCode, readField(row, ['carrier', 'courier', 'courierName', 'carrierName']) || inferCarrierFromSource(sourceName));
    const order = getOrCreateOrderFast(data, orderByExternalId, readField(row, ['clientOrderId', 'client_order_id', 'orderId', 'order_id', 'order', 'orderNumber', 'externalOrderId', 'shopifyOrderId', 'zcustRef']), row);
    const rawStatus = readField(row, ['orderStatus', 'order_status', 'status', 'currentStatus', 'shipmentStatus', 'latestStatus']) || 'created';
    const currentStatus = normalizeStatus(rawStatus);
    const existing = shipmentByAwb.get(awb);
    const pickupDate = readField(row, ['pickupDate', 'pickup_date', 'pickedDate', 'picked_date', 'bookingDate', 'booking_date', 'billingDate', 'billing_date']) || null;
    const deliveredDate = readField(row, ['actualDeliveryDate', 'deliveredDate', 'deliveryDate', 'frd', 'pdd', 'last_updated', 'lastUpdated']);

    const payload = {
      orderId: order.id,
      awb,
      carrierId: carrier.id,
      currentStatus,
      destinationRegion: readField(row, ['zone', 'region', 'destinationRegion', 'destinationState', 'destination_state', 'state', 'destinationCategory', 'destinationCity', 'destination_city', 'city']),
      destinationPincode: readField(row, ['pincode', 'pinCode', 'destinationPincode', 'destinationPin', 'destination_pin']),
      originCity: readField(row, ['originCity', 'origin_city', 'originCenter', 'origin_center', 'origin']),
      sellerCompanyName: readField(row, ['sellerCompanyName', 'clientName', 'client_name', 'client', 'seller', 'companyName']),
      externalShipmentId: readField(row, ['shipmentId', 'shipmentID']),
      billType: readField(row, ['billType', 'direction']),
      paymentType: readField(row, ['paymentType', 'packageType', 'package_type', 'paymentMode', 'payment_mode', 'payment', 'type']),
      chargedWeightGrams: normalizeWeightToGrams(readField(row, ['chargedWeight', 'charged_weight', 'chargeableWeight', 'weight', 'actualWeight', 'weightInGms', 'weight_in_gms'])),
      promisedDeliveryDate: readField(row, ['promisedDeliveryDate', 'expectedDeliveryDate', 'edd']) || null,
      pickupDate,
      actualDeliveryDate: currentStatus === 'delivered' ? deliveredDate || null : null,
      rtoFlag: isRtoStatus(currentStatus) || ['yes', 'true', '1'].includes(String(readField(row, ['rto', 'rtoFlag'])).toLowerCase()),
      deliveryAttempts: Number(readField(row, ['attempts', 'deliveryAttempts']) || 0),
      lastEventAt: readField(row, ['lastEventAt', 'last_updated', 'lastUpdated', 'updatedAt', 'eventTime', 'pickupDate', 'pickup_date', 'bookingDate']) || new Date().toISOString()
    };

    if (existing) {
      Object.assign(existing, payload);
      updated += 1;
    } else {
      const createdShipment = { id: `shp_${randomUUID()}`, ...payload };
      data.shipments.push(createdShipment);
      shipmentByAwb.set(awb, createdShipment);
      created += 1;
    }
  });

  return { created, updated };
}

function importCharges(data, rows) {
  let created = 0;
  const shipmentByAwb = new Map(data.shipments.map(shipment => [shipment.awb, shipment]));
  const existingChargeKeys = new Set(data.charges.map(charge => `${charge.shipmentId}|${charge.invoiceId}|${charge.chargeType}|${charge.billedAmount}`));

  rows.forEach(row => {
    const awb = readField(row, ['awb', 'awbNumber', 'awb_number', 'trackingNumber', 'waybill', 'waybillNum', 'waybill_num', 'swiftId', 'swift_id', 'shipmentNumber', 'consignmentNo', 'consignment_no']);
    const shipment = shipmentByAwb.get(awb);
    if (!shipment) return;

    const billedAmount = Number(readField(row, ['billedAmount', 'chargedAmount', 'billAmount', 'invoiceAmount', 'costInclGst', 'cost', 'grandTotal', 'totalCharges', 'total_charges', 'grossAmount', 'gross_amount', 'total', 'subTotal', 'totalAmount', 'total_amount', 'amount', 'freightCharge', 'freightCharges', 'freight_charges', 'totalCharge', 'netAmount']) || 0);
    const expectedRaw = readField(row, ['expectedAmount', 'rateAmount', 'agreedAmount', 'contractRate', 'expectedCharge']);
    const expectedAmount = expectedRaw === '' ? null : Number(expectedRaw);
    if (!billedAmount || billedAmount < 0) return;
    const varianceAmount = Number((billedAmount - expectedAmount).toFixed(2));
    const charge = {
      id: `chg_${randomUUID()}`,
      shipmentId: shipment.id,
      carrierId: shipment.carrierId,
      chargeType: readField(row, ['billType', 'chargeType', 'type', 'direction']) || 'invoice',
      billedAmount,
      expectedAmount,
      varianceAmount: expectedAmount === null ? null : varianceAmount,
      chargedWeightGrams: normalizeWeightToGrams(readField(row, ['chargedWeight', 'charged_weight', 'chargeableWeight', 'weight', 'actualWeight', 'weightInGms', 'weight_in_gms'])),
      zone: readField(row, ['zone', 'destinationZone', 'destination_zone', 'destinationCategory']) || shipment.destinationRegion || '',
      paymentType: readField(row, ['paymentType', 'packageType', 'package_type', 'paymentMode', 'payment_mode', 'payment', 'type']) || shipment.paymentType || '',
      invoiceId: readField(row, ['invoiceId', 'invoice', 'invoiceNumber', 'billNumber', 'serialNumber', 'serial_number']) || '',
      billingDate: readField(row, ['billingDate', 'date', 'pickupDate', 'pickup_date']) || new Date().toISOString().slice(0, 10)
    };
    const chargeKey = `${charge.shipmentId}|${charge.invoiceId}|${charge.chargeType}|${charge.billedAmount}`;
    if (existingChargeKeys.has(chargeKey)) return;

    data.charges.push(charge);
    existingChargeKeys.add(chargeKey);
    created += 1;

    if (expectedAmount !== null && varianceAmount > 10) {
      data.disputes.push({
        id: `dsp_${randomUUID()}`,
        shipmentId: shipment.id,
        chargeId: charge.id,
        status: 'open',
        reason: 'charge_variance',
        disputeNote: `Billed ${billedAmount}, expected ${expectedAmount}. Variance ${varianceAmount}.`,
        claimedAmount: Math.abs(varianceAmount),
        recoveredAmount: 0,
        openedAt: new Date().toISOString()
      });
    }
  });

  return { created, updated: 0 };
}

function importRateCards(data, rows, sourceName = '') {
  data.rateCards ||= [];
  let created = 0;
  let updated = 0;
  const existing = new Map(data.rateCards.map(rate => [rateCardKey(rate), rate]));

  for (const row of rows) {
    const carrier = readField(row, ['carrier', 'courier', 'partner', 'logisticsPartner']);
    const zone = readField(row, ['zone', 'rateZone', 'destinationZone']);
    const firstAmount = toNumber(readField(row, ['first500Amount', 'first500', 'baseAmount', 'baseRate', 'rate', 'expectedAmount', 'forwardRate']));
    if (!carrier || !zone || firstAmount === null) continue;

    const rate = {
      id: `rate_${randomUUID()}`,
      carrier: canonicalCarrierName(carrier),
      zone,
      serviceType: normalizeServiceType(readField(row, ['serviceType', 'billType', 'type', 'flow']) || 'forward'),
      firstWeightGrams: normalizeWeightToGrams(readField(row, ['firstWeightGrams', 'firstWeight', 'weightSlabGrams', 'weightSlab'])) || 500,
      firstAmount,
      additionalWeightGrams: normalizeWeightToGrams(readField(row, ['additionalWeightGrams', 'additionalWeight', 'addWeight'])) || 500,
      additionalAmount: toNumber(readField(row, ['additionalAmount', 'additional500Amount', 'addOnRate', 'addRate'])) ?? firstAmount,
      codFlat: toNumber(readField(row, ['codFlat', 'codCharge', 'codCharges'])) ?? 0,
      codPercent: toNumber(readField(row, ['codPercent', 'codPercentage', 'cod%'])) ?? 0,
      taxPercent: toNumber(readField(row, ['taxPercent', 'gstPercent', 'gst'])) ?? 0,
      sourceName
    };

    const key = rateCardKey(rate);
    if (existing.has(key)) {
      Object.assign(existing.get(key), rate, { id: existing.get(key).id });
      updated += 1;
    } else {
      data.rateCards.push(rate);
      existing.set(key, rate);
      created += 1;
    }
  }

  return { created, updated };
}

export function applyRateCards(data, threshold = 10) {
  data.rateCards ||= [];
  data.disputes ||= [];
  const rates = [...DEFAULT_RATE_CARDS, ...data.rateCards];
  const shipmentsById = new Map(data.shipments.map(shipment => [shipment.id, shipment]));
  const ordersById = new Map((data.orders || []).map(order => [order.id, order]));
  const carriersById = new Map(data.carriers.map(carrier => [carrier.id, carrier]));
  const disputeByChargeId = new Map(data.disputes.filter(dispute => dispute.chargeId).map(dispute => [dispute.chargeId, dispute]));
  let updated = 0;
  let createdDisputes = 0;

  for (const charge of data.charges || []) {
    const shipment = shipmentsById.get(charge.shipmentId);
    if (!shipment) continue;

    const carrier = canonicalCarrierName(carriersById.get(charge.carrierId)?.name || '');
    const order = ordersById.get(shipment.orderId);
    const rate = findRate(rates, {
      carrier,
      zone: charge.zone || shipment.destinationRegion,
      serviceType: shipment.rtoFlag || String(shipment.currentStatus || '').startsWith('rto_') ? 'rto' : 'forward'
    });
    if (!rate) {
      if (charge.expectedAmount !== null || charge.varianceAmount !== null) {
        charge.expectedAmount = null;
        charge.varianceAmount = null;
        updated += 1;
      }
      continue;
    }

    const weightGrams = charge.chargedWeightGrams || shipment.chargedWeightGrams || 500;
    const codAmount = isCod(charge.paymentType || shipment.paymentType)
      ? Math.max(rate.codFlat || 0, ((order?.orderValue || 0) * (rate.codPercent || 0)) / 100)
      : 0;
    let expectedAmount = slabAmount(rate, weightGrams) + codAmount;
    if (rate.serviceType === 'rto' && rate.rtoFactor) {
      const fwdAmount = slabAmount(rate, weightGrams);
      expectedAmount = fwdAmount + fwdAmount * rate.rtoFactor; // forward leg + return leg
    }
    if (rate.taxPercent) expectedAmount *= 1 + (rate.taxPercent / 100);
    expectedAmount = roundMoney(expectedAmount);

    const varianceAmount = roundMoney((charge.billedAmount || 0) - expectedAmount);
    if (charge.expectedAmount !== expectedAmount || charge.varianceAmount !== varianceAmount) {
      charge.expectedAmount = expectedAmount;
      charge.varianceAmount = varianceAmount;
      charge.rateCardSource = rate.sourceName || 'built-in rate card';
      updated += 1;
    }

    if (varianceAmount > threshold) {
      if (disputeByChargeId.has(charge.id)) {
        const dispute = disputeByChargeId.get(charge.id);
        dispute.claimedAmount = Math.abs(varianceAmount);
        dispute.disputeNote = `Billed ${charge.billedAmount}, expected ${expectedAmount}. Variance ${varianceAmount}.`;
      } else {
        const dispute = {
          id: `dsp_${randomUUID()}`,
          shipmentId: shipment.id,
          chargeId: charge.id,
          status: 'open',
          reason: 'charge_variance',
          disputeNote: `Billed ${charge.billedAmount}, expected ${expectedAmount}. Variance ${varianceAmount}.`,
          claimedAmount: Math.abs(varianceAmount),
          recoveredAmount: 0,
          openedAt: new Date().toISOString()
        };
        data.disputes.push(dispute);
        disputeByChargeId.set(charge.id, dispute);
        createdDisputes += 1;
      }
    }
  }

  return { rateCards: rates.length, chargesValidated: updated, disputesCreated: createdDisputes };
}

export async function importData({ type, format, content, sourceName = '' }) {
  const data = await readJson();
  data.rateCards ||= [];
  const rows = format === 'json' ? JSON.parse(content) : parseCsv(content);
  const cleanRows = Array.isArray(rows) ? rows : [];

  let result;
  if (type === 'rateCards') {
    result = importRateCards(data, cleanRows, sourceName);
  } else if (type === 'charges') {
    result = importCharges(data, cleanRows);
  } else {
    result = importShipments(data, cleanRows, sourceName);
    const chargeResult = importCharges(data, cleanRows);
    result.chargesCreated = chargeResult.created;
  }

  const validation = applyRateCards(data);

  data.auditLogs.push({
    id: `aud_${randomUUID()}`,
    actorId: 'demo_user',
    action: 'data_imported',
    entityType: type,
    entityId: null,
    beforeState: null,
    afterState: { type, format, sourceName, rows: cleanRows.length, result, validation },
    createdAt: new Date().toISOString()
  });

  await writeJson(data);
  return { ok: true, type, format, rows: cleanRows.length, ...result, validation };
}

export async function recalculateDisputes() {
  const data = await readJson();
  data.rateCards ||= [];
  const removedDuplicateCharges = dedupeCharges(data);
  // Remove invalid charges (negative or zero billed amounts from old imports)
  const chargesBefore = data.charges.length;
  data.charges = data.charges.filter(c => Number(c.billedAmount || 0) > 0);
  const removedInvalidCharges = chargesBefore - data.charges.length;
  const previousDisputes = data.disputes.length;
  data.disputes = data.disputes.filter(dispute => dispute.reason !== 'charge_variance');
  const removedOldDisputes = previousDisputes - data.disputes.length;
  const validation = applyRateCards(data);
  validation.removedDuplicateCharges = removedDuplicateCharges;
  validation.removedInvalidCharges = removedInvalidCharges;
  validation.removedOldDisputes = removedOldDisputes;
  data.auditLogs.push({
    id: `aud_${randomUUID()}`,
    actorId: 'demo_user',
    action: 'rate_cards_recalculated',
    entityType: 'charges',
    entityId: null,
    beforeState: null,
    afterState: validation,
    createdAt: new Date().toISOString()
  });
  await writeJson(data);
  return validation;
}

function dedupeCharges(data) {
  const seen = new Set();
  const unique = [];
  let removed = 0;

  for (const charge of data.charges || []) {
    const key = `${charge.shipmentId}|${charge.invoiceId || ''}|${charge.chargeType || ''}|${charge.billedAmount}`;
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    unique.push(charge);
  }

  data.charges = unique;
  return removed;
}

function findRate(rates, { carrier, zone, serviceType }) {
  const carrierKey = normalizeKey(carrier);
  const zoneKey = normalizeZone(zone);
  const flow = normalizeServiceType(serviceType);
  return rates.find(rate =>
    normalizeKey(rate.carrier) === carrierKey &&
    normalizeZone(rate.zone) === zoneKey &&
    normalizeServiceType(rate.serviceType) === flow
  ) || rates.find(rate =>
    normalizeKey(rate.carrier) === carrierKey &&
    normalizeZone(rate.zone) === zoneKey &&
    normalizeServiceType(rate.serviceType) === 'forward'
  );
}

function slabAmount(rate, weightGrams) {
  const firstWeight = rate.firstWeightGrams || 500;
  const additionalWeight = rate.additionalWeightGrams || 500;
  const firstAmount = rate.firstAmount || 0;
  const additionalAmount = rate.additionalAmount ?? firstAmount;
  if (!weightGrams || weightGrams <= firstWeight) return firstAmount;
  return firstAmount + (Math.ceil((weightGrams - firstWeight) / additionalWeight) * additionalAmount);
}

function rateCardKey(rate) {
  return `${normalizeKey(rate.carrier)}|${normalizeZone(rate.zone)}|${normalizeServiceType(rate.serviceType)}`;
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizeWeightToGrams(value) {
  const number = toNumber(value);
  if (!number) return null;
  return number <= 50 ? Math.round(number * 1000) : Math.round(number);
}

function isCod(value) {
  const text = String(value || '').toLowerCase();
  // 'qr' and 'upi' are QR-code / UPI-on-delivery methods — still COD from a billing standpoint
  return text.includes('cod') || text === '1' || text.includes('qr') || text.includes('upi') || text.includes('cash');
}

function normalizeKey(value) {
  return canonicalCarrierName(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeZone(value) {
  const text = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const zoneMap = {
    // Single-letter codes: Delhivery A/B and GoSwift A/B/C/D/E all pass through this
    a: 'local', b: 'zonal', c: 'metro', d: 'roi', e: 'nejk', f: 'nejk',
    // Delhivery compound codes
    c1: 'c1', c2: 'c2', d1: 'd1', d2: 'd2',
    // XpressBees z-codes
    z1: 'withincity', z2: 'regional', z3: 'metro',
    z4: 'restindia', z5: 'restindia', z6: 'specialzones',
    // Shadowfax / named zones
    intracity: 'intracity', withincity: 'withincity',
    withinzone: 'withinzone', regional: 'regional',
    roi: 'roi', restofindia: 'restindia', restindia: 'restindia',
    specialzone: 'specialzones', specialzones: 'specialzones',
    metro: 'metro', local: 'local', zonal: 'zonal', nejk: 'nejk',
    // DTDC numeric-prefix zone codes (01_LOCAL → '01local' after strip)
    '01local': 'local',
    '02withinstate': 'zonal', '03withinzone': 'zonal',
    '04metrototmetro': 'metro', '04roitometro': 'metro',
    '05roia': 'roi', '06roib': 'roi',
    '07spldest': 'nejk', '07spl': 'nejk',
  };
  if (zoneMap[text]) return zoneMap[text];
  // Keyword fallbacks for any remaining DTDC-style or unknown codes
  if (text.includes('spl') || text.includes('jk') || text.includes('nejk')) return 'nejk';
  if (text.includes('roi')) return 'roi';
  if (text.includes('metro')) return 'metro';
  if (text.includes('local')) return 'local';
  if (text.includes('withinstate') || text.includes('withinzone') || text.includes('zonal')) return 'zonal';
  return text;
}

function normalizeServiceType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('rto') || text.includes('return')) return 'rto';
  return 'forward';
}

function canonicalCarrierName(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('xpress')) return 'XpressBees';
  if (text.includes('shadow') || text.includes('sfx')) return 'Shadowfax';
  if (text.includes('delhivery')) return 'Delhivery';
  if (text.includes('dtdc')) return 'DTDC';
  if (text.includes('swift')) return 'GoSwift';
  if (text.includes('ats') || text.includes('amazon')) return 'Amazon ATS';
  return String(value || 'Unknown').trim() || 'Unknown';
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildDefaultRateCards() {
  const rows = [];
  const add = (carrier, zone, firstAmount, additionalAmount, options = {}) => {
    rows.push({
      id: `builtin_${normalizeKey(carrier)}_${normalizeZone(zone)}_forward`,
      carrier,
      zone,
      serviceType: 'forward',
      firstWeightGrams: 500,
      firstAmount,
      additionalWeightGrams: 500,
      additionalAmount,
      codFlat: options.codFlat || 0,
      codPercent: options.codPercent || 0,
      taxPercent: options.taxPercent || 0,
      sourceName: 'image rate card'
    });
    if (options.rtoFactor) {
      rows.push({
        id: `builtin_${normalizeKey(carrier)}_${normalizeZone(zone)}_rto`,
        carrier,
        zone,
        serviceType: 'rto',
        firstWeightGrams: 500,
        firstAmount,
        additionalWeightGrams: 500,
        additionalAmount,
        rtoFactor: options.rtoFactor,
        sourceName: 'image rate card'
      });
    }
  };

  // Delhivery Surface — rates are pre-GST; billing CSVs expose gross_amount (pre-GST)
  [['A', 20, 18], ['B', 21, 20], ['C1', 30, 25], ['C2', 30, 25], ['D1', 34, 29], ['D2', 34, 29], ['E', 44, 34], ['F', 44, 34]]
    .forEach(([zone, first, extra]) => add('Delhivery', zone, first, extra, { codFlat: 14, codPercent: 1, rtoFactor: 0.5 }));

  // Shadowfax Standard Express — FSC (10%) billed as separate column in CSV; compare freight-to-freight
  [['Intracity', 21, 18], ['Within Zone', 26, 20], ['Metro', 36, 30], ['ROI', 40, 31], ['Special Zone', 50, 38]]
    .forEach(([zone, first, extra]) => add('Shadowfax', zone, first, extra, { codFlat: 15, codPercent: 1, rtoFactor: 0.6 }));

  // XpressBees Air — GST inclusive in rates; z1-z6 zone codes map via normalizeZone
  // No separate RTO rate cards: XpressBees RTO settlements are net-of-COD-reversal rows (billedAmount ~₹1)
  // which never exceed the dispute threshold. Forward charges are always evaluated against forward rates.
  [['Within City', 23, 20], ['Regional', 29, 22], ['Metro', 39, 29], ['Rest India', 43, 35], ['Special Zones', 51, 40]]
    .forEach(([zone, first, extra]) => add('XpressBees', zone, first, extra, { codFlat: 16, codPercent: 1.18 }));

  // Busybees routes through XpressBees — same rate card
  [['Within City', 23, 20], ['Regional', 29, 22], ['Metro', 39, 29], ['Rest India', 43, 35], ['Special Zones', 51, 40]]
    .forEach(([zone, first, extra]) => add('Busybees', zone, first, extra, { codFlat: 16, codPercent: 1.18 }));

  // DTDC Air 2025
  [['Local', 25, 11], ['Zonal', 29, 16], ['Metro', 36, 39], ['ROI', 39, 47], ['NE-JK', 52, 61]]
    .forEach(([zone, first, extra]) => add('DTDC', zone, first, extra, { codFlat: 20, codPercent: 1, rtoFactor: 1 }));

  // GoSwift Air 2025 — Cost (incl GST) billing; GST=18%; COD flat ~₹45 derived from billing data
  [['Local', 31, 31], ['Zonal', 36, 36], ['Metro', 49, 49], ['ROI', 53, 53], ['NE-JK', 68, 68]]
    .forEach(([zone, first, extra]) => add('GoSwift', zone, first, extra, { taxPercent: 18, codFlat: 45 }));

  // Amazon ATS Surface 2025
  [['Local', 20, 14], ['Zonal', 23, 14], ['Metro', 30, 25], ['ROI', 34, 29], ['NE-JK', 44, 34]]
    .forEach(([zone, first, extra]) => add('Amazon ATS', zone, first, extra, { codFlat: 14, codPercent: 1, rtoFactor: 0.55 }));

  return rows;
}

function inferCarrierFromSource(sourceName) {
  const value = String(sourceName || '').toLowerCase();
  if (value.includes('sfx') || value.includes('shadow')) return 'Shadowfax';
  if (value.includes('busy') || value.includes('xpress')) return 'XpressBees';
  if (value.includes('delhivery')) return 'Delhivery';
  if (value.includes('exd')) return 'Delhivery';
  if (value.includes('dtdc')) return 'DTDC';
  if (value.includes('swift')) return 'GoSwift';
  if (value.includes('ats') || value.includes('amazon')) return 'Amazon ATS';
  return 'Unknown';
}
