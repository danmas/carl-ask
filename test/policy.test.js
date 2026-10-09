import assert from 'node:assert/strict';
import test from 'node:test';
import { allGaps, next } from '../src/policy.js';
import { REFUSAL_TEXT } from '../src/refusals.js';

test('round 1 asks at most three of five gaps and skips a filled slot', () => {
  const slots = {
    metric: { agg: 'count' },
    grain: 'auction',
    mart: null,
    time: null,
    period_stated: true,
    filters: [],
    params: {},
    missing: ['metric.agg', 'grain', 'mart', 'metric.field', 'time'],
  };
  const gaps = allGaps(slots);
  assert.equal(gaps.includes('grain'), false);
  assert.equal(gaps.includes('metric.agg'), false);
  assert.ok(gaps.length >= 3);
  const decision = next(slots, 0);
  assert.equal(decision.phase, 'clarifying');
  assert.ok(decision.questions.length <= 3);
  assert.equal(decision.questions.some((q) => q.slot === 'grain'), false);
});

test('phrase 9 after two rounds assumes dt_end and shows it', () => {
  const decision = next({
    metric: { agg: 'list' },
    grain: 'profile',
    mart: 'carl_an.t_auct_total_an',
    dimensions: ['id_profile_leader', 'applied_commission'],
    filters: [{ column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] }],
    time: { all_time: true, from: '2022-01-01', to: '2023-01-01' },
    period_stated: true,
    params: {},
    missing: ['time'],
  }, 2);
  assert.equal(decision.phase, 'awaiting_confirm');
  assert.equal(decision.patch.time.column, 'dt_end');
  assert.match(decision.assumptions.join(' '), /dt_end/);
});

test('second round ends on the confirmation card', () => {
  const slots = {
    metric: { agg: 'count', field: '*' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    time: null,
    period_stated: true,
    filters: [{ column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] }],
    params: {},
    missing: [],
  };
  const decision = next(slots, 2);
  assert.equal(decision.phase, 'awaiting_confirm');
  assert.equal(decision.questions.length, 0);
  assert.match(decision.assumptions.join(' '), /не выбрано/);
});

test('questions name the known period instead of the slot protocol', () => {
  const decision = next({
    metric: { agg: 'count' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    time: { column: null, from: '2026-08-01', to: '2026-09-01' },
    period_stated: true,
    filters: [],
    params: {},
    missing: ['metric.field', 'time'],
  }, 0);
  const text = decision.questions.map((q) => q.text).join('\n');
  assert.match(text, /2026-08-01/);
  assert.match(text, /количество лотов/);
  assert.equal(text.includes('all_time'), false);
  assert.equal(text.includes('deposit_balance'), false);
});

test('a list without a period does not ask for aggregation, field, or time', () => {
  const slots = {
    metric: { agg: 'list' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    period_stated: false,
    filters: [{ column: 'status', op: '=', value: 'ACTIVE' }],
    params: {},
    missing: [],
  };
  const gaps = allGaps(slots);
  assert.equal(gaps.includes('metric.agg'), false);
  assert.equal(gaps.includes('metric.field'), false);
  assert.equal(gaps.includes('time'), false);
  assert.equal(next(slots, 0).phase, 'awaiting_confirm');
});

test('unknown refusal code does not fail the turn', () => {
  const slots = {
    metric: { agg: 'list' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    filters: [{ column: 'status', op: '=', value: 'ACTIVE' }],
    params: {},
    missing: [],
    refusal: { code: 'MADE_UP' },
  };
  const decision = next(slots, 0);
  assert.equal(decision.phase, 'awaiting_confirm');
  assert.equal(decision.refusal, undefined);
});

test('a refusal code sent as text stops before any question', () => {
  const decision = next({
    metric: { agg: 'count' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    filters: [],
    params: {},
    missing: ['id_profile', 'metric.field'],
    refusal: 'MART_MISSING_TYPE_PARENT',
  }, 0);
  assert.equal(decision.phase, 'failed');
  assert.equal(decision.questions.length, 0);
  assert.match(decision.refusal.text, /150/);
});

test('the model cannot force a profile-id question', () => {
  const gaps = allGaps({
    metric: { agg: 'count', field: '*' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    time: { column: 'dt_create', from: '2024-10-08', to: '2026-10-08' },
    filters: [],
    params: {},
    missing: ['id_profile'],
    period_stated: true,
  });
  assert.equal(gaps.includes('id_profile'), false);
});

test('a count question names the grain', () => {
  const decision = next({
    metric: { agg: 'count' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    time: { column: 'dt_create', from: '2024-10-08', to: '2026-10-08' },
    period_stated: true,
    filters: [],
    params: {},
    missing: ['metric.field'],
  }, 0);
  assert.match(decision.questions[0].text, /количество профилей/);
  assert.equal(decision.questions.some((q) => q.slot === 'id_profile'), false);
});

test('a known refusal stops with the fixed text', () => {
  const decision = next({
    metric: { agg: 'list' },
    grain: 'profile',
    mart: 'carl_an.users',
    filters: [],
    params: {},
    missing: [],
    refusal: { code: 'COLUMN_ABSENT', text: 'модель не пишет эту фразу' },
  }, 0);
  assert.equal(decision.phase, 'failed');
  assert.equal(decision.refusal.text, REFUSAL_TEXT.COLUMN_ABSENT);
  assert.equal(decision.questions.length, 0);
});
