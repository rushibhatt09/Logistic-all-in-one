import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from '../src/storage/jsonStore.js';
import { importData, recalculateDisputes } from '../src/services/importService.js';
import { readImportFile } from './read-import-file.js';

const data = await readJson();
data.charges = [];
data.disputes = data.disputes.filter(dispute => dispute.reason !== 'charge_variance');
await writeJson(data);

const shipmentsDir = path.resolve('imports', 'shipments');
const files = await readdir(shipmentsDir);
let totalRows = 0;

for (const file of files) {
  if (!/\.(csv|json|xlsx|xls)$/i.test(file)) continue;
  const filePath = path.join(shipmentsDir, file);
  const { format, content } = await readImportFile(filePath);
  const result = await importData({
    type: 'shipments',
    format,
    content,
    sourceName: file
  });
  totalRows += result.rows;
  console.log(`${file}: rebuilt finance from ${result.rows} rows, charges created ${result.chargesCreated || 0}`);
}

const validation = await recalculateDisputes();
console.log(`Done. Rebuilt finance from ${totalRows} shipment rows.`);
console.log(`Validated with ${validation.rateCards} rate rules and created ${validation.disputesCreated} overbilling disputes.`);
