import assert from 'node:assert/strict';
import test from 'node:test';
import { runReadOnly } from '../src/query.js';

function fakeClient(fetched, { failDeclare = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(arg, params) {
      const text = typeof arg === 'string' ? arg : arg.text;
      calls.push({ text, params, rowMode: arg?.rowMode });
      if (failDeclare && text.startsWith('DECLARE')) {
        const error = new Error('cancel');
        error.code = '57014';
        throw error;
      }
      if (typeof arg === 'object') return fetched;
      return { rows: [], fields: [] };
    },
  };
}

test('read-only transaction uses the server cap and keeps duplicate names', async () => {
  const client = fakeClient({
    fields: [
      { name: 'id', dataTypeID: 23 },
      { name: 'id', dataTypeID: 23 },
    ],
    rows: [[1, 10], [2, 20], [3, 30]],
  });
  const result = await runReadOnly(client, 'SELECT a.id, b.id FROM a, b;', { statementTimeoutMs: 20, maxRows: 2 });
  assert.deepEqual(result.fields.map((field) => field.name), ['id', 'id']);
  assert.deepEqual(result.rows, [[1, 10], [2, 20]]);
  assert.equal(result.rowCount, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(client.calls.map((call) => call.text), [
    'BEGIN READ ONLY',
    'SELECT set_config($1, $2, true)',
    'DECLARE carl_ask_cursor NO SCROLL CURSOR FOR SELECT a.id, b.id FROM a, b',
    'FETCH 3 FROM carl_ask_cursor',
    'COMMIT',
  ]);
  assert.deepEqual(client.calls[1].params, ['statement_timeout', '20']);
  assert.equal(client.calls[3].rowMode, 'array');
});

test('zero rows still return driver fields', async () => {
  const client = fakeClient({
    fields: [{ name: 'n', dataTypeID: 23 }, { name: 'title', dataTypeID: 25 }],
    rows: [],
  });
  const result = await runReadOnly(client, 'SELECT 1 AS n, \'\' AS title', { maxRows: 500, statementTimeoutMs: 15000 });
  assert.equal(result.fields.length, 2);
  assert.deepEqual(result.rows, []);
  assert.equal(result.truncated, false);
});

test('defaults are 15s and 500 rows, and a failure rolls back', async () => {
  const ok = fakeClient({ fields: [{ name: 'n', dataTypeID: 23 }], rows: [[1]] });
  await runReadOnly(ok, 'SELECT 1');
  assert.equal(ok.calls[1].params[1], '15000');
  assert.equal(ok.calls[3].text, 'FETCH 501 FROM carl_ask_cursor');

  const client = fakeClient({ fields: [], rows: [] }, { failDeclare: true });
  await assert.rejects(() => runReadOnly(client, 'SELECT 1'), { code: '57014' });
  assert.equal(client.calls.at(-1).text, 'ROLLBACK');
  assert.equal(client.calls.some((call) => call.text === 'COMMIT'), false);
});
