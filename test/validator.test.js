import assert from 'node:assert/strict';
import test from 'node:test';
import { STORED_HASHES, catalogHash, columnsOf, hashMismatches } from '../src/catalog.js';
import { render } from '../src/metrics.js';
import { validate } from '../src/validator.js';

const join = `SELECT sum(b.count)
FROM carl_an.t_auct_total_an a
JOIN carl_an.t_auct_bids_an b ON a.id_auction = b.id_auction`;

test('lot snapshot may join bid snapshot on id_auction', () => {
  assert.equal(validate(join).ok, true, validate(join).errors.join('; '));
});

for (const name of ['v_auct_total_an', 'v_auct_bids_an', 'v_prof_total_an', 'auct_total_an', 'auct_bids_an', 'amo_data', 'amo_json']) {
  test(`${name} is rejected`, () => {
    const checked = validate(`SELECT id_auction FROM carl_an.${name}`);
    assert.equal(checked.ok, false);
    assert.match(checked.errors.join(' '), /запрещено/);
  });
}

test('lots made from reports by a user pass the validator', () => {
  const rendered = render({
    metric: { agg: 'count' },
    grain: 'auction',
    mart: 'carl_an.v_lot_from_report_an',
    time: { column: 'dt_create', from: '2026-01-01', to: '2026-02-01' },
    filters: [{ column: 'id_user', op: '=', value: 4 }],
  });
  assert.equal(validate(rendered.sql).ok, true, validate(rendered.sql).errors.join('; '));
  assert.match(rendered.sql, /v_lot_from_report_an/);
  assert.match(rendered.sql, /id_user = 4/);
  assert.match(rendered.sql, /dt_create >= '2026-01-01'/);
});

test('a v_ name outside the catalog is missing from the allowlist', () => {
  const checked = validate('SELECT key FROM carl_an.v_inspect_an');
  assert.equal(checked.ok, false);
  assert.match(checked.errors.join(' '), /вне allowlist/);
  assert.doesNotMatch(checked.errors.join(' '), /запрещено/);
});

test('buyer and seller slices are not joined', () => {
  const checked = validate(`SELECT b.id_profile
FROM carl_an.prof_buy b
JOIN carl_an.prof_sel s ON b.id_profile = s.id_profile`);
  assert.equal(checked.ok, false);
  assert.match(checked.errors.join(' '), /prof_buy/);
});

test('a second statement, SELECT *, and a mutation are rejected', () => {
  assert.equal(validate('SELECT id_user FROM carl_an.users; SELECT id_user FROM carl_an.users').ok, false);
  assert.equal(validate('SELECT * FROM carl_an.users').ok, false);
  assert.equal(validate('UPDATE carl_an.users SET is_deleted = \'Y\'').ok, false);
  assert.equal(validate('SELECT id_profile FROM carl_an.prof_buy WHERE "?column?" IS NULL').ok, false);
});

test('buyer bids and purchases may use the profile, lot and bid tables', () => {
  const sql = `SELECT p.id_profile,
       coalesce((
         SELECT sum(b.count)::bigint
         FROM carl_an.t_auct_bids_an b
         JOIN carl_an.t_auct_total_an a ON a.id_auction = b.id_auction
         WHERE b.id_profile_bid = p.id_profile
           AND a.id_profile_seller IN (19760, 2)
       ), 0) AS bid_events,
       (
         SELECT count(*)::bigint
         FROM carl_an.t_auct_total_an a
         WHERE a.id_profile_leader = p.id_profile
           AND a.id_profile_seller IN (19760, 2)
       ) AS bought_lots
FROM carl_an.prof_buy p`;
  assert.equal(validate(sql).ok, true, validate(sql).errors.join('; '));
});

test('a third relation outside the buyer triple is rejected', () => {
  const sql = `SELECT u.id_user
FROM carl_an.users u
JOIN carl_an.t_auct_bids_an b ON b.id_user_bid = u.id_user
JOIN carl_an.t_auct_total_an a ON a.id_auction = b.id_auction`;
  assert.equal(validate(sql).ok, false);
  assert.match(validate(sql).errors.join(' '), /тройка/);
});

test('stored wpl2 hashes match the column snapshot', () => {
  for (const [name, hash] of Object.entries(STORED_HASHES)) {
    assert.equal(catalogHash(columnsOf(name)), hash);
  }
  assert.deepEqual(hashMismatches(STORED_HASHES), []);
  assert.deepEqual(hashMismatches({ ...STORED_HASHES, users: 'deadbeef' }), ['users']);
});
