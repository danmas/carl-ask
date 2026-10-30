import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStore } from '../src/dialogue.js';
import { fileJournal, presentJournal } from '../src/journal.js';

test('journal view is newest first and drops the prompt', () => {
  const rows = presentJournal([
    {
      at: '2026-10-30T10:00:00.000Z',
      event: 'open',
      dialogue_id: 'a',
      utterance: 'первый',
      prompt: 'SECRET-PROMPT',
      snapshot: { utterance: 'первый', phase: 'clarifying', turns: [], card: { plain: 'понимание 1' } },
    },
    {
      at: '2026-10-30T11:00:00.000Z',
      event: 'open',
      dialogue_id: 'b',
      utterance: 'второй',
      prompt: 'SECRET-PROMPT',
      snapshot: { utterance: 'второй', phase: 'failed', refusal: { code: 'COLUMN_ABSENT', text: 'колонки ИНН нет' } },
    },
    {
      at: '2026-10-30T10:05:00.000Z',
      event: 'answer',
      dialogue_id: 'a',
      snapshot: {
        utterance: 'первый',
        phase: 'awaiting_confirm',
        turns: [{ round: 1, questions: [{ text: 'кто', answer_label: 'все' }] }],
        card: { plain: 'понимание 1' },
      },
    },
  ]);
  assert.equal(rows[0].utterance, 'второй');
  assert.equal(rows[1].utterance, 'первый');
  assert.equal(rows[1].phase, 'awaiting_confirm');
  assert.equal(rows[1].turns[0].questions[0].answer_label, 'все');
  assert.equal(JSON.stringify(rows).includes('SECRET-PROMPT'), false);
});

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
