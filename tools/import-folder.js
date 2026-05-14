import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { importData } from '../src/services/importService.js';
import { readImportFile } from './read-import-file.js';

const root = path.resolve('imports');
const groups = [
  { type: 'shipments', dir: path.join(root, 'shipments') },
  { type: 'charges', dir: path.join(root, 'charges') },
  { type: 'rateCards', dir: path.join(root, 'rate-cards') }
];

let totalFiles = 0;
let totalRows = 0;

for (const group of groups) {
  let files = [];
  try {
    files = await readdir(group.dir);
  } catch {
    continue;
  }

  for (const file of files) {
    if (/\.(png|jpg|jpeg|webp)$/i.test(file)) {
      console.log(`${file}: image rate card detected. Built-in image rates are already available, but editable rate cards should be CSV/XLSX.`);
      continue;
    }
    if (!/\.(csv|json|xlsx|xls)$/i.test(file)) continue;
    const filePath = path.join(group.dir, file);
    const { format, content } = await readImportFile(filePath);
    const importType = group.type === 'charges' && looksLikeRateCard(file, content) ? 'rateCards' : group.type;
    const result = await importData({
      type: importType,
      format,
      content,
      sourceName: file
    });

    totalFiles += 1;
    totalRows += result.rows;
    console.log(`${file}: imported ${result.rows} ${importType} rows, created ${result.created}, updated ${result.updated}`);
  }
}

if (totalFiles === 0) {
  console.log('No CSV/JSON/XLSX files found. Put files inside imports/shipments or imports/charges.');
} else {
  console.log(`Done. Imported ${totalRows} rows from ${totalFiles} file(s).`);
}

function looksLikeRateCard(file, content) {
  const name = file.toLowerCase();
  if (name.includes('rate')) return true;
  const sample = String(content || '').slice(0, 2000).toLowerCase();
  return (
    sample.includes('first500') ||
    sample.includes('expectedamount') ||
    sample.includes('baserate') ||
    sample.includes('additionalamount') ||
    sample.includes('codpercent')
  );
}
