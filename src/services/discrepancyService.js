import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../storage/jsonStore.js';

const DEFAULT_VARIANCE_THRESHOLD = 10;

export async function validateCharge(input) {
  const data = await readJson();
  const shipment = data.shipments.find(item => item.id === input.shipmentId || item.awb === input.awb);

  if (!shipment) {
    return { ok: false, status: 404, error: 'Shipment not found for charge validation' };
  }

  const carrierId = input.carrierId || shipment.carrierId;
  const expectedAmount = Number(input.expectedAmount);
  const billedAmount = Number(input.billedAmount);
  const varianceAmount = Number((billedAmount - expectedAmount).toFixed(2));

  const charge = {
    id: randomUUID(),
    shipmentId: shipment.id,
    carrierId,
    chargeType: input.chargeType || 'forward',
    billedAmount,
    expectedAmount,
    varianceAmount,
    invoiceId: input.invoiceId || '',
    billingDate: input.billingDate || new Date().toISOString().slice(0, 10)
  };

  data.charges.push(charge);

  let dispute = null;
  const threshold = Number(input.threshold || DEFAULT_VARIANCE_THRESHOLD);

  if (Math.abs(varianceAmount) > threshold) {
    dispute = {
      id: randomUUID(),
      shipmentId: shipment.id,
      chargeId: charge.id,
      status: 'open',
      reason: 'charge_variance',
      disputeNote: `Billed ${billedAmount}, expected ${expectedAmount}. Variance ${varianceAmount}.`,
      claimedAmount: Math.abs(varianceAmount),
      recoveredAmount: 0,
      openedAt: new Date().toISOString()
    };
    data.disputes.push(dispute);
  }

  await writeJson(data);
  return { ok: true, charge, dispute };
}
