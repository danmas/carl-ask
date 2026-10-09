import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(join(root, 'data', 'columns.json'), 'utf8'));

export const SNAPSHOT_DATE = snapshot.snapshot;

export const RELATIONS = Object.keys(snapshot.tables);

export const FORBIDDEN = [
  'v_auct_total_an',
  'v_auct_bids_an',
  'v_prof_total_an',
  'auct_total_an',
  'auct_bids_an',
  'amo_data',
  'amo_json',
];

export const JOIN_TRIPLES = [
  {
    tables: ['prof_buy', 't_auct_total_an', 't_auct_bids_an'],
    keys: [
      ['id_auction', 'id_auction'],
      ['id_profile_bid', 'id_profile'],
      ['id_profile_leader', 'id_profile'],
    ],
  },
];

export const JOIN_PAIRS = [
  { a: 't_auct_total_an', b: 't_auct_bids_an', keys: [['id_auction', 'id_auction']] },
  { a: 't_auct_total_an', b: 'prof_total_an', keys: [['id_profile_seller', 'id_profile'], ['id_profile_leader', 'id_profile']] },
  { a: 't_auct_total_an', b: 'prof_sel', keys: [['id_profile_seller', 'id_profile'], ['id_profile_leader', 'id_profile']] },
  { a: 't_auct_total_an', b: 'prof_buy', keys: [['id_profile_seller', 'id_profile'], ['id_profile_leader', 'id_profile']] },
  { a: 't_auct_bids_an', b: 'prof_total_an', keys: [['id_profile_bid', 'id_profile']] },
  { a: 't_auct_bids_an', b: 'prof_sel', keys: [['id_profile_bid', 'id_profile']] },
  { a: 't_auct_bids_an', b: 'prof_buy', keys: [['id_profile_bid', 'id_profile']] },
  { a: 't_auct_bids_an', b: 'users', keys: [['id_user_bid', 'id_user']] },
  { a: 'prof_total_an', b: 'users', keys: [['id_user_owner', 'id_user']] },
  { a: 'prof_sel', b: 'users', keys: [['id_user_owner', 'id_user']] },
  { a: 'prof_buy', b: 'users', keys: [['id_user_owner', 'id_user']] },
];

export const TIME_COLUMNS = ['dt_end', 'dt_change_status', 'dt_start', 'dt_active', 'dt_approve', 'dt_create'];

export const STORED_HASHES = snapshot.hashes;

export function columnsOf(relation) {
  return snapshot.tables[relation] || [];
}

export function columnNames(relation) {
  return new Set(columnsOf(relation).map((c) => c.name));
}

export function catalogHash(columns) {
  const payload = columns.map((c) => `${c.name}|${c.type}|${c.ordinal}`).join(',');
  return createHash('md5').update(payload).digest('hex');
}

export function hashMismatches(freshHashes) {
  const names = new Set([...Object.keys(STORED_HASHES), ...Object.keys(freshHashes)]);
  const diffs = [];
  for (const name of names) {
    if (STORED_HASHES[name] !== freshHashes[name]) diffs.push(name);
  }
  return diffs;
}

export function relationName(mart) {
  if (!mart) return '';
  return String(mart).replace(/^carl_an\./, '');
}
