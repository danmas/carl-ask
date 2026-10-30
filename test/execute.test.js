import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createConnectionSet } from '../src/connections.js';
import { createStore } from '../src/dialogue.js';
import { fileJournal } from '../src/journal.js';
import { buildParsePrompt, buildSqlPrompt } from '../src/prompt.js';
import { createApp } from '../src/server.js';

const readySlots = {
  metric: { agg: 'list' },
  grain: 'auction',
  mart: 'carl_an.t_auct_total_an',
  filters: [{ column: 'status', op: '=', value: 'ACTIVE' }],
  dimensions: [],
  assumptions: [],
  missing: [],
  params: {},
  refusal: null,
  period_stated: false,
};

function parser() {
  return {
    async slots() { return structuredClone(readySlots); },
    async delta() { return {}; },
    async sql() { throw new Error('модель не вызывается при выполнении'); },
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function harness(run) {
  const calls = [];
  const connections = {
    list() {
      return {
        connections: [
          { name: 'wpl2', host: '192.168.1.22', port: 5432, database: 'carlinkng', user: 'carl', optional: false, readOnly: true, requireWriteConfirm: false, executable: true },
          { name: 'prod_rw', host: '127.0.0.1', port: 6666, database: 'carlinkng', user: 'carl_reader', optional: true, readOnly: false, requireWriteConfirm: true, executable: false },
        ],
        query: { statementTimeoutMs: 15000, maxRows: 500 },
      };
    },
    executable(name) {
      return name === 'wpl2';
    },
    secrets() { return ['s3cret']; },
    info() { return '192.168.1.22:5432/carlinkng'; },
    async run(name, sql) {
      calls.push({ name, sql });
      return run(name, sql);
    },
  };
  return { connections, calls };
}

test('execute rejects client SQL, a write connection, the wrong phase and a missing name', async () => {
  const { connections, calls } = harness(async () => {
    throw new Error('запрос не должен открыться');
  });
  const store = createStore(parser());
  const server = createApp(store, { connections });
  const port = await listen(server);
  try {
    const listed = await fetch(`http://127.0.0.1:${port}/api/connections`);
    const catalog = await listed.json();
    assert.equal(catalog.connections.find((item) => item.name === 'prod_rw').executable, false);
    assert.equal(JSON.stringify(catalog).includes('s3cret'), false);

    const opened = await fetch(`http://127.0.0.1:${port}/api/dialogues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: 'активные лоты' }),
    });
    const early = await opened.json();
    const tooSoon = await fetch(`http://127.0.0.1:${port}/api/dialogues/${early.id}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection: 'wpl2' }),
    });
    assert.equal(tooSoon.status, 409);

    const confirmed = await fetch(`http://127.0.0.1:${port}/api/dialogues/${early.id}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const ready = await confirmed.json();
    assert.equal(ready.phase, 'sql_ready');
    assert.equal(ready.execution, null);
    assert.equal(calls.length, 0);

    const injected = await fetch(`http://127.0.0.1:${port}/api/dialogues/${early.id}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection: 'wpl2', sql: 'SELECT 1', maxRows: 999999 }),
    });
    assert.equal(injected.status, 400);

    const write = await fetch(`http://127.0.0.1:${port}/api/dialogues/${early.id}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection: 'prod_rw', confirmWrite: true }),
    });
    assert.equal(write.status, 400);

    const missing = await fetch(`http://127.0.0.1:${port}/api/dialogues/${early.id}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connection: 'no-such' }),
    });
    assert.equal(missing.status, 400);
    assert.equal(calls.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('accepted SQL runs on the named connection and a database error stays on the snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carl-ask-exec-'));
  let fail = false;
  const { connections, calls } = harness(async (_name, sql) => {
    if (fail || sql.includes('s3cret')) {
      const error = new Error('password s3cret failed');
      error.code = '28P01';
      error.elapsedMs = 4;
      throw error;
    }
    return {
      fields: [{ name: 'id', dataTypeID: 23 }, { name: 'id', dataTypeID: 23 }],
      rows: [[7, null]],
      rowCount: 1,
      truncated: false,
      elapsedMs: 12,
      connectionInfo: '192.168.1.22:5432/carlinkng',
    };
  });
  const store = createStore(parser(), fileJournal(dir));
  const opened = await store.open('активные лоты');
  const ready = await store.confirm(opened.id);
  const done = await store.execute(ready.id, { connection: 'wpl2', maxRows: 999999 }, connections);
  assert.equal(done.phase, 'sql_ready');
  assert.equal(calls[0].sql, ready.sql);
  assert.equal(calls[0].name, 'wpl2');
  assert.deepEqual(done.execution.rows, [[7, null]]);
  assert.equal(done.execution.fields[1].name, 'id');

  fail = true;
  const broken = await store.execute(ready.id, { connection: 'wpl2' }, connections);
  assert.equal(broken.phase, 'sql_ready');
  assert.equal(broken.execution.error.code, '28P01');
  assert.equal(broken.execution.error.message.includes('s3cret'), false);
  assert.deepEqual(broken.execution.rows, []);

  const rows = JSON.parse(readFileSync(join(dir, 'journal.json'), 'utf8'));
  const executed = rows.filter((row) => row.event === 'execute');
  assert.equal(executed.length, 2);
  assert.equal(executed[0].connection, 'wpl2');
  assert.equal(executed[0].rowCount, 1);
  assert.equal(executed[1].error, '28P01');
  assert.match(executed[1].error_message, /failed/);
  assert.equal(executed[1].snapshot.execution.error_message.includes('s3cret'), false);
  assert.equal(JSON.stringify(executed).includes('[[7,null]]') || JSON.stringify(executed).includes('[[7, null]]'), false);
  assert.equal(JSON.stringify(rows).includes('s3cret'), false);
});

test('model prompts do not carry connection settings', () => {
  const text = `${buildParsePrompt('сколько продано')}\n${buildSqlPrompt({ plain: 'карточка' }, [])}`;
  assert.equal(text.includes('PG_PASSWORD'), false);
  assert.equal(text.includes('connectionString'), false);
  assert.equal(text.includes('password'), false);
});

test('connection list from a file-shaped config hides the password', () => {
  const set = createConnectionSet({
    connections: {
      wpl2: { host: '192.168.1.22', port: 5432, database: 'carlinkng', user: 'carl', password: 's3cret', readOnly: true },
    },
    query: { statementTimeoutMs: 15000, maxRows: 500 },
  }, {});
  assert.equal(JSON.stringify(set.list()).includes('s3cret'), false);
  assert.equal(set.poolNames().length, 0);
});
