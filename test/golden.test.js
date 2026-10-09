import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from '../src/dialogue.js';
import { render } from '../src/metrics.js';
import { buildParsePrompt, FEW_SHOT } from '../src/prompt.js';
import { REFUSAL_TEXT } from '../src/refusals.js';
import { validate } from '../src/validator.js';

const PHRASES = {
  1: 'Список текущих (активных) лотов по вину',
  2: 'Сколько продано за прошлый месяц легковушек',
  3: 'Сегментировать базу покупателей (кто за последние два года делал ставки на легковые, строительную технику, сельхоз технику) в ямало-ненецком, тюменской области, Ханты-мансийском',
  4: 'ФЛ, чей депозит более 0, но менее 40 000, и ИП, чей депозит более 0, но менее 80 000',
  5: 'Пользователи, кто был не позже 2 лет назад, со всеми профилями и ролями в профилях',
  6: 'Выгрузка покупателей (юр и физ лица), зарегистрированных с сентября 2022 по январь 2023 включительно',
  7: 'Кол-во ставок профиля за период',
  8: 'Кол-во покупок профиля за период',
  9: 'Выгрузка по покупателям-профилям: количество купленных автомобилей и комиссия, которую покупатели заплатили. Нарастающим итогом с начала работы платформы и за 22 год',
  10: 'Отчет — все ставки профиля',
};

const base = {
  dimensions: [],
  assumptions: [],
  missing: [],
  params: {},
  refusal: null,
};

const INITIAL = {
  1: {
    ...base,
    metric: { agg: 'list' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    period_stated: false,
    filters: [
      { column: 'status', op: '=', value: 'ACTIVE' },
      { column: 'is_deleted', op: '=', value: 'N' },
    ],
  },
  2: {
    ...base,
    metric: { agg: 'count', field: '*' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    period_stated: true,
    missing: ['time'],
    filters: [
      { column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] },
      { column: 'object_type_top_name', op: '=', value: 'Легковые автомобили' },
    ],
  },
  3: {
    ...base,
    metric: { agg: 'list' },
    grain: 'profile',
    mart: 'carl_an.t_auct_total_an',
    period_stated: true,
    refusal: { code: 'MART_MISSING_TYPE_PARENT' },
  },
  4: {
    ...base,
    metric: { agg: 'list', field: 'deposit_balance' },
    grain: 'profile',
    mart: null,
    period_stated: false,
    missing: ['mart'],
    params: { fl_min: 0, fl_max: 40000, ip_min: 0, ip_max: 80000 },
  },
  5: {
    ...base,
    metric: { agg: 'list' },
    grain: 'user',
    mart: 'carl_an.users',
    period_stated: true,
    refusal: { code: 'COLUMN_ABSENT' },
  },
  6: {
    ...base,
    metric: { agg: 'list' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    period_stated: true,
    time: { column: 'dt_create', from: '2022-09-01', to: '2023-02-01' },
  },
  7: {
    ...base,
    metric: { agg: 'sum', field: 'count' },
    grain: 'bid_profile',
    mart: 'carl_an.t_auct_bids_an',
    period_stated: true,
    missing: ['id_profile', 'time', 'id_profile_seller'],
  },
  8: {
    ...base,
    metric: { agg: 'count', field: '*' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    period_stated: true,
    missing: ['id_profile', 'time', 'id_profile_seller'],
    filters: [{ column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] }],
  },
  9: {
    ...base,
    metric: { agg: 'list' },
    grain: 'profile',
    mart: 'carl_an.t_auct_total_an',
    period_stated: true,
    dimensions: ['id_profile_leader', 'applied_commission'],
    filters: [
      { column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] },
      { column: 'is_deleted', op: '=', value: 'N' },
    ],
    time: { all_time: true, from: '2022-01-01', to: '2023-01-01' },
    missing: ['time'],
  },
  10: {
    ...base,
    metric: { agg: 'list' },
    grain: 'bid_profile',
    mart: 'carl_an.t_auct_bids_an',
    refusal: { code: 'NO_BID_TAPE' },
  },
};

function parser() {
  return {
    async slots({ utterance }) {
      const id = Object.entries(PHRASES).find(([, text]) => text === utterance)?.[0];
      return structuredClone(INITIAL[id]);
    },
    async delta() {
      return { mart: 'carl_an.prof_buy', filters: [{ column: 'is_buyer', op: '=', value: true }] };
    },
    calls: { sql: 0 },
    async sql() {
      this.calls.sql += 1;
      return 'DELETE FROM carl_an.users';
    },
  };
}

test('few-shot is empty and the prompt does not carry the holdout or a connection string', () => {
  assert.deepEqual(FEW_SHOT, []);
  const prompt = buildParsePrompt('сколько лотов');
  for (const text of Object.values(PHRASES)) assert.equal(prompt.includes(text), false);
  assert.equal(prompt.includes('192.168.1.22'), false);
  assert.equal(prompt.includes('postgresql://'), false);
  assert.match(prompt, /t_auct_total_an/);
});

test('phrase 1 confirms to active_lots without questions', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[1]);
  assert.equal(opened.phase, 'awaiting_confirm');
  assert.equal(opened.questions.length, 0);
  assert.equal(opened.card.deleted_lots, 'исключены');
  assert.match(opened.card.notes.join(' '), /VIN/);
  const ready = await store.confirm(opened.id);
  assert.equal(ready.phase, 'sql_ready');
  assert.equal(ready.card.metric_id, 'active_lots');
  assert.match(ready.sql, /status = 'ACTIVE'/);
  assert.match(ready.sql, /is_deleted = 'N'/);
  assert.equal(ready.sql.includes('LIMIT'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 2 takes the scripted time column and keeps deleted lots', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[2]);
  assert.equal(opened.phase, 'clarifying');
  assert.equal(opened.round, 1);
  assert.deepEqual(opened.questions.map((q) => q.slot), ['time']);
  const answered = store.answer(opened.id, {
    time: { column: 'dt_change_status', from: '2026-09-01', to: '2026-10-01' },
  });
  assert.equal(answered.phase, 'awaiting_confirm');
  assert.equal(answered.turns.length, 1);
  assert.equal(answered.turns[0].questions[0].slot, 'time');
  assert.match(answered.turns[0].questions[0].answer_label, /смена статуса/);
  assert.equal(answered.card.deleted_lots, 'включены');
  const ready = await store.confirm(opened.id);
  assert.equal(ready.card.metric_id, 'sales_count_by_period');
  assert.match(ready.sql, /dt_change_status >= '2026-09-01'/);
  assert.match(ready.sql, /dt_change_status < '2026-10-01'/);
  assert.match(ready.sql, /Легковые автомобили/);
  assert.equal(ready.sql.includes('is_deleted'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrases 3 and 10 refuse with the fixed text and no SQL', async () => {
  const store = createStore(parser());
  for (const [id, code] of [[3, 'MART_MISSING_TYPE_PARENT'], [10, 'NO_BID_TAPE']]) {
    const opened = await store.open(PHRASES[id]);
    assert.equal(opened.phase, 'failed');
    assert.equal(opened.refusal.code, code);
    assert.equal(opened.refusal.text, REFUSAL_TEXT[code]);
    assert.equal(opened.sql, null);
    assert.equal(opened.questions.length, 0);
    assert.equal(opened.slots.grain !== undefined, true);
  }
});

test('phrase 5 lists users with buyer and seller flags and skips subscriber', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[5]);
  assert.equal(opened.phase, 'awaiting_confirm');
  assert.equal(opened.refusal, null);
  assert.equal(opened.slots.time.column, 'dt_last_login');
  assert.match(opened.reading, /Подписчик не используется/);
  const ready = await store.confirm(opened.id);
  assert.equal(ready.phase, 'sql_ready');
  assert.equal(ready.card.metric_id, 'users_with_profile_roles');
  assert.match(ready.sql, /dt_last_login/);
  assert.match(ready.sql, /is_seller/);
  assert.match(ready.sql, /is_buyer/);
  assert.match(ready.sql, /id_user_owner = u\.id_user/);
  assert.equal(ready.sql.includes('subscriber'), false);
  assert.equal(ready.sql.includes('phone'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 4 scripted mart is all profiles', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[4]);
  assert.deepEqual(opened.questions.map((q) => q.slot), ['mart']);
  const answered = store.answer(opened.id, { mart: 'prof_total_an' });
  const ready = await store.confirm(answered.id);
  assert.equal(ready.card.metric_id, 'deposit_thresholds');
  assert.match(ready.sql, /carl_an\.prof_total_an/);
  assert.match(ready.sql, /deposit_balance/);
  assert.match(ready.sql, /> 0/);
  assert.match(ready.sql, /< 40000/);
  assert.match(ready.sql, /< 80000/);
  assert.equal(ready.sql.includes('phone'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 6 lists buyers registered in the half-open window', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[6]);
  assert.equal(opened.phase, 'awaiting_confirm');
  assert.match(opened.card.notes.join(' '), /Удалённые профили включены/);
  const ready = await store.confirm(opened.id);
  assert.equal(ready.card.metric_id, 'buyer_registration_period');
  assert.match(ready.sql, /dt_create >= '2022-09-01'/);
  assert.match(ready.sql, /dt_create < '2023-02-01'/);
  assert.equal(ready.sql.includes('19760'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 7 sums bid events for the scripted profile', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[7]);
  assert.deepEqual(opened.questions.map((q) => q.slot), ['time', 'id_profile', 'id_profile_seller']);
  const answered = store.answer(opened.id, {
    time: { column: 'last_bid_set', from: '2024-01-01', to: '2026-01-01' },
    id_profile: '14663',
    id_profile_seller: '',
  });
  const ready = await store.confirm(answered.id);
  assert.equal(ready.card.metric_id, 'profile_bid_count');
  assert.match(ready.sql, /sum\(b\.count\)/);
  assert.match(ready.sql, /id_profile_bid = 14663/);
  assert.equal(ready.sql.includes('JOIN'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 8 counts purchases and includes deleted lots', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[8]);
  const answered = store.answer(opened.id, {
    time: { column: 'dt_end', from: '2022-01-01', to: '2023-01-01' },
    id_profile: '19625',
    id_profile_seller: '',
  });
  assert.equal(answered.card.deleted_lots, 'включены');
  const ready = await store.confirm(answered.id);
  assert.equal(ready.card.metric_id, 'profile_purchase_count');
  assert.match(ready.sql, /id_profile_leader = 19625/);
  assert.match(ready.sql, /dt_end >= '2022-01-01'/);
  assert.equal(ready.sql.includes("is_deleted = 'N'"), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('phrase 9 shows the dt_end assumption and excludes deleted lots', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[9]);
  assert.equal(opened.questions.some((q) => q.slot === 'time'), true);
  const answered = store.answer(opened.id, {
    time: { column: 'dt_end', all_time: true, from: '2022-01-01', to: '2023-01-01' },
  });
  assert.equal(answered.card.deleted_lots, 'исключены');
  const ready = await store.confirm(answered.id);
  assert.equal(ready.card.metric_id, 'buyer_purchases_and_commission');
  assert.match(ready.sql, /bought_year/);
  assert.match(ready.sql, /commission_year/);
  assert.match(ready.sql, /is_deleted = 'N'/);
  assert.match(ready.sql, /dt_end >= '2022-01-01'/);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('rejection replaces only the slots in the delta', async () => {
  const store = createStore(parser());
  const opened = await store.open(PHRASES[2]);
  const answered = store.answer(opened.id, {
    time: { column: 'dt_change_status', from: '2026-09-01', to: '2026-10-01' },
  });
  const rejected = await store.reject(answered.id, 'это покупатели, не продавцы');
  assert.equal(rejected.phase === 'sql_ready', false);
  assert.equal(rejected.sql, null);
  assert.equal(rejected.slots.time.from, '2026-09-01');
  assert.equal(rejected.slots.time.column, null);
  assert.equal(rejected.questions.some((q) => q.slot === 'time'), true);
  assert.equal(rejected.slots.mart, 'carl_an.prof_buy');
});

test('free SQL stops after the second validator failure and does not execute', async () => {
  const model = parser();
  const store = createStore(model);
  const opened = await store.open(PHRASES[1]);
  opened.slots.metric.agg = 'avg';
  const foreign = createStore({
    async slots() {
      return {
        ...base,
        metric: { agg: 'avg', field: 'summa_lead' },
        grain: 'auction',
        mart: 'carl_an.t_auct_total_an',
        time: { column: 'dt_end', from: '2026-01-01', to: '2026-02-01' },
        filters: [],
      };
    },
    async delta() { return {}; },
    async sql() { return 'UPDATE carl_an.t_auct_total_an SET status = \'FAILED\''; },
  });
  const started = await foreign.open('средняя ставка');
  assert.equal(started.phase, 'awaiting_confirm');
  const failed = await foreign.confirm(started.id);
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.sql, null);
  assert.equal(failed.refusal, null);
  assert.ok(failed.validator_errors.length > 0);
});

test('catalog render does not call the free-SQL parser', async () => {
  const model = parser();
  const store = createStore(model);
  const opened = await store.open(PHRASES[1]);
  await store.confirm(opened.id);
  assert.equal(model.calls.sql, 0);
  const rendered = render(INITIAL[6]);
  assert.equal(rendered.metric_id, 'buyer_registration_period');
});
