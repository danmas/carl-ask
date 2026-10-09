import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/dialogue.js';
import { fileJournal } from '../src/journal.js';

test('journal appends the dialogue and strips the model key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'carl-ask-'));
  const previous = process.env.CARL_ASK_MODEL_KEY;
  process.env.CARL_ASK_MODEL_KEY = 'secret-key';
  try {
    const journal = fileJournal(dir);
    const store = createStore({
      async slots() {
        return {
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
      },
      async delta() { return {}; },
      async sql() { return 'SELECT 1'; },
    }, journal);
    const opened = await store.open('секрет secret-key в вопросе');
    await store.confirm(opened.id);
    const rows = JSON.parse(readFileSync(join(dir, 'journal.json'), 'utf8'));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].event, 'open');
    assert.equal(rows[1].event, 'confirm');
    assert.equal(rows[1].snapshot.phase, 'sql_ready');
    assert.equal(JSON.stringify(rows).includes('secret-key'), false);
    assert.match(JSON.stringify(rows), /\[redacted\]/);
  } finally {
    if (previous === undefined) delete process.env.CARL_ASK_MODEL_KEY;
    else process.env.CARL_ASK_MODEL_KEY = previous;
  }
});
