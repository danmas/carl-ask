import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/dialogue.js';
import { createApp } from '../src/server.js';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('the page and the JSON snapshot show the same phase', async () => {
  const store = createStore({
    async slots() {
      return {
        metric: { agg: 'count', field: '*' },
        grain: 'auction',
        mart: 'carl_an.t_auct_total_an',
        period_stated: true,
        time: null,
        filters: [{ column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] }],
        dimensions: [],
        assumptions: [],
        missing: ['time'],
        params: {},
        refusal: null,
      };
    },
    async delta() { return {}; },
    async sql() { return 'SELECT 1'; },
  });
  const server = createApp(store);
  const port = await listen(server);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.equal(page.headers.get('content-type').includes('text/html'), true);
    assert.match(html, /Фаза/);
    assert.match(html, /id="user-connection"/);
    assert.match(html, /id="user-execute"/);

    const devPage = await fetch(`http://127.0.0.1:${port}/dev`);
    assert.equal(devPage.status, 200);
    assert.equal(devPage.headers.get('content-type').includes('text/html'), true);

    const userPage = await fetch(`http://127.0.0.1:${port}/user`);
    assert.equal(userPage.status, 200);
    assert.equal(userPage.headers.get('content-type').includes('text/html'), true);
    const opened = await fetch(`http://127.0.0.1:${port}/api/dialogues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: 'сколько продано' }),
    });
    const snapshot = await opened.json();
    assert.equal(snapshot.phase, 'clarifying');
    assert.equal(snapshot.reasoning, false);
    assert.equal(snapshot.model.effort, 'none');
    assert.equal(snapshot.round, 1);
    assert.deepEqual(snapshot.missing.includes('time') ? ['time'] : snapshot.questions.map((q) => q.slot), ['time']);
    const reasoned = await fetch(`http://127.0.0.1:${port}/api/dialogues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utterance: 'сколько продано', reasoning: true }),
    });
    const withReasoning = await reasoned.json();
    assert.equal(withReasoning.reasoning, true);
    assert.equal(withReasoning.model.effort, null);
    const missing = await fetch(`http://127.0.0.1:${port}/api/dialogues/${snapshot.id}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(missing.status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the debug tab reads the question corpus', async () => {
  const server = createApp();
  const port = await listen(server);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.match(html, /id="tab-debug"/);
    assert.match(html, /Отладка/);
    assert.match(html, /id="tab-journal"/);
    assert.match(html, /Журнал/);
    const journal = await fetch(`http://127.0.0.1:${port}/api/journal`);
    assert.equal(journal.status, 200);
    const journalBody = await journal.json();
    assert.equal(Array.isArray(journalBody.dialogues), true);
    const corpus = await fetch(`http://127.0.0.1:${port}/api/corpus`);
    assert.equal(corpus.status, 200);
    const body = await corpus.json();
    assert.equal(body.items.length, 151);
    assert.equal(typeof body.items[0].question, 'string');
    assert.equal(typeof body.items[0].sql, 'string');
    assert.equal(typeof body.verified, 'object');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
