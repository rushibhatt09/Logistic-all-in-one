const statusMap = new Map([
  ['ofd', 'out_for_delivery'],
  ['out for delivery', 'out_for_delivery'],
  ['delivered', 'delivered'],
  ['shipment delivered', 'delivered'],
  ['delivery attempted', 'delivery_attempted'],
  ['failed delivery', 'delivery_attempted'],
  ['picked up', 'picked_up'],
  ['in transit', 'in_transit'],
  ['rto initiated', 'rto_initiated'],
  ['return to origin', 'rto_initiated'],
  ['rto delivered', 'rto_delivered'],
  ['rtsd', 'rto_delivered'],
  ['in_return_process', 'rto_in_transit'],
  ['in return process', 'rto_in_transit'],
  ['lost', 'lost'],
  ['damaged', 'damaged'],
  ['cancelled', 'cancelled']
]);

export function normalizeStatus(rawStatus) {
  const key = String(rawStatus || '').trim().toLowerCase();
  if (statusMap.has(key)) return statusMap.get(key);
  if (key.includes('return') || key.includes('rto')) return 'rto_in_transit';
  if (key.includes('deliver') && !key.includes('out')) return 'delivered';
  if (key.includes('transit')) return 'in_transit';
  if (key.includes('out')) return 'out_for_delivery';
  if (key.includes('pick')) return 'picked_up';
  return 'exception';
}

export function isRtoStatus(status) {
  return String(status).startsWith('rto_');
}
