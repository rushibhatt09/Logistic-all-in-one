import path from 'node:path';
import { importData } from '../src/services/importService.js';
import { readImportFile } from './read-import-file.js';

const filePath = process.argv[2];

if (!filePath) {
  console.error('Please drag a Busybees CSV/XLSX file onto import-busybees.bat or pass the file path.');
  process.exit(1);
}

const absolutePath = path.resolve(filePath);
const { format, content } = await readImportFile(absolutePath);
const result = await importData({
  type: 'shipments',
  format,
  content,
  sourceName: path.basename(absolutePath)
});

console.log(`Imported ${result.rows} rows.`);
console.log(`Created ${result.created} shipments.`);
console.log(`Updated ${result.updated} shipments.`);
