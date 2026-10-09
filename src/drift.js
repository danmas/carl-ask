import { spawnSync } from 'node:child_process';
import { catalogHash, hashMismatches, STORED_HASHES } from './catalog.js';

const TABLES = Object.keys(STORED_HASHES);

export function hashesFromRows(rows) {
  const grouped = {};
  for (const row of rows) {
    (grouped[row.table] ||= []).push(row);
  }
  const hashes = {};
  for (const table of Object.keys(grouped)) {
    const columns = grouped[table].sort((a, b) => a.ordinal - b.ordinal);
    hashes[table] = catalogHash(columns);
  }
  return hashes;
}

function liveRows() {
  const sql = `SELECT table_name, ordinal_position, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'carl_an' AND table_name IN (${TABLES.map((name) => `'${name}'`).join(',')})
ORDER BY table_name, ordinal_position`;
  const run = spawnSync('psql', ['-A', '-F', '|', '--pset', 'footer=off', '-c', sql], {
    encoding: 'utf8',
    env: process.env,
  });
  if (run.status !== 0) {
    throw new Error(run.stderr || 'psql не выполнился');
  }
  return run.stdout.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
    const [table, ordinal, name, type] = line.split('|');
    return { table, ordinal: Number(ordinal), name, type };
  });
}

if (process.argv[1] && process.argv[1].endsWith('drift.js')) {
  const diffs = hashMismatches(hashesFromRows(liveRows()));
  if (diffs.length) {
    console.error(`drift: ${diffs.join(', ')}`);
    process.exit(1);
  }
  console.log('drift: хеши wpl2 совпали со снимком');
}
