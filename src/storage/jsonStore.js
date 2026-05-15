import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDir = path.resolve('data');
const dbPath = path.join(dataDir, 'database.json');

const seed = {
  orders: [],
  carriers: [
    { id: 'car_delhivery', name: 'Delhivery', code: 'delhivery', active: true },
    { id: 'car_shadowfax', name: 'Shadowfax', code: 'shadowfax', active: true },
    { id: 'car_xpressbees', name: 'XpressBees', code: 'xpressbees', active: true },
    { id: 'car_dtdc', name: 'DTDC', code: 'dtdc', active: true }
  ],
  shipments: [],
  events: [],
  charges: [],
  rateCards: [],
  referenceAudits: [],
  disputes: [],
  auditLogs: []
};

export async function ensureSeedData() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(dbPath, 'utf8');
  } catch {
    await writeJson(seed);
  }
}

export async function readJson() {
  const content = await readFile(dbPath, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    const repaired = extractFirstJsonObject(content);
    if (!repaired) throw new Error('Database file is not valid JSON and could not be repaired.');
    return JSON.parse(repaired);
  }
}

export async function writeJson(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

function extractFirstJsonObject(content) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (!started) {
      if (char === '{') {
        started = true;
        depth = 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      return content.slice(0, index + 1);
    }
  }

  return null;
}
