import { readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const pythonExe = 'C:\\Users\\micro\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';

export async function readImportFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const lower = absolutePath.toLowerCase();

  if (lower.endsWith('.csv')) {
    const buffer = await readFile(absolutePath);
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      const tempPath = path.join(os.tmpdir(), `${path.basename(absolutePath, path.extname(absolutePath))}-${Date.now()}.xlsx`);
      await writeFile(tempPath, buffer);
      try {
        return excelToJson(tempPath);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    }
    return { format: 'csv', content: buffer.toString('utf8') };
  }

  if (lower.endsWith('.json')) {
    return { format: 'json', content: await readFile(absolutePath, 'utf8') };
  }

  if (lower.endsWith('.xlsx')) {
    return excelToJson(absolutePath);
  }

  if (lower.endsWith('.xls')) {
    throw new Error('Old .xls files are not supported yet. Please open it in Excel and Save As .xlsx, then import again.');
  }

  throw new Error('Unsupported file type. Use .csv, .json, or .xlsx.');
}

function excelToJson(absolutePath) {
  const result = spawnSync(
    pythonExe,
    ['tools\\xlsx-to-json.py', absolutePath],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Excel conversion failed');
  }

  return { format: 'json', content: result.stdout };
}
