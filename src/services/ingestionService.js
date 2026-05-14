import { randomUUID } from 'node:crypto';
import { normalizeStatus, isRtoStatus } from '../domain/statusNormalizer.js';
import { readJson, writeJson } from '../storage/jsonStore.js';

export async function ingestShipmentEvent(input) {
  const data = await readJson();
  const shipment = data.shipments.find(item => item.awb === input.awb);

  if (!shipment) {
    return { ok: false, status: 404, error: `Shipment not found for AWB ${input.awb}` };
  }

  const source = input.source || 'manual_api';
  const sourceEventId =
    input.sourceEventId ||
    `${source}:${input.awb}:${input.rawStatus}:${input.eventTime}`;

  const alreadyExists = data.events.some(
    event => event.source === source && event.sourceEventId === sourceEventId
  );

  if (alreadyExists) {
    return { ok: true, duplicate: true, shipment };
  }

  const normalizedStatus = input.normalizedStatus || normalizeStatus(input.rawStatus);
  const event = {
    id: randomUUID(),
    shipmentId: shipment.id,
    source,
    sourceEventId,
    rawStatus: input.rawStatus,
    normalizedStatus,
    eventLocation: input.location || '',
    eventTime: input.eventTime || new Date().toISOString(),
    payload: input.metadata || {}
  };

  data.events.push(event);
  shipment.currentStatus = normalizedStatus;
  shipment.lastEventAt = event.eventTime;
  shipment.rtoFlag = shipment.rtoFlag || isRtoStatus(normalizedStatus);

  if (normalizedStatus === 'delivery_attempted') {
    shipment.deliveryAttempts += 1;
  }

  if (normalizedStatus === 'delivered') {
    shipment.actualDeliveryDate = event.eventTime.slice(0, 10);
  }

  data.auditLogs.push({
    id: randomUUID(),
    actorId: 'system',
    action: 'shipment_event_ingested',
    entityType: 'shipment',
    entityId: shipment.id,
    beforeState: null,
    afterState: event,
    createdAt: new Date().toISOString()
  });

  await writeJson(data);
  return { ok: true, shipment, event };
}
