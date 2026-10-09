import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAnswers, createStore } from '../src/dialogue.js';
import { guardPhrase } from '../src/guard.js';
import { validate } from '../src/validator.js';

const exposure = 'Сколько длилась в среднем экспозиция легковушек в августе ?';

test('sale status stays when the phrase says sold', () => {
  const slots = guardPhrase('Сколько продано за прошлый месяц легковушек', {
    filters: [{ column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] }],
    assumptions: [],
    metric: { agg: 'count', field: '*' },
    params: {},
  });
  assert.equal(slots.filters.some((filter) => filter.column === 'status'), true);
  assert.equal(slots.params.exposure, undefined);
});

test('exposure drops an unstated sale filter and asks for the two dates', async () => {
  const store = createStore({
    async slots() {
      return {
        metric: { agg: 'avg', field: 'dt_end' },
        grain: 'auction',
        mart: 'carl_an.t_auct_total_an',
        time: null,
        filters: [
          { column: 'object_type_top_name', op: '=', value: 'Легковые автомобили' },
          { column: 'status', op: 'IN', value: ['SUCCESS', 'BUYNOW'] },
        ],
        assumptions: ['Экспозиция = dt_end - dt_start', 'Продажа = статусы SUCCESS и BUYNOW'],
        missing: ['time'],
        period_stated: true,
        params: {},
      };
    },
  });
  const snap = await store.open(exposure);
  assert.equal(snap.slots.filters.some((filter) => filter.column === 'status'), false);
  assert.equal(snap.slots.filters[0].column, 'object_type_top_name');
  assert.equal(snap.slots.metric.field, undefined);
  assert.equal(snap.questions.some((question) => question.slot === 'exposure'), true);
  assert.equal(snap.questions.some((question) => question.slot === 'metric.field'), false);
  assert.equal(snap.assumptions.some((line) => /Продажа = статусы/.test(line)), false);
  assert.match(snap.assumptions.join('\n'), /все статусы/);

  const answered = store.answer(snap.id, {
    exposure: { from: 'dt_start', to: 'dt_end' },
    time: { column: 'dt_active', from: '2026-08-01', to: '2026-09-01', all_time: false },
  });
  assert.equal(answered.phase, 'awaiting_confirm');
  assert.equal(answered.slots.filters.some((filter) => filter.column === 'status'), false);
  assert.match(answered.assumptions.join('\n'), /Длительность = dt_end − dt_start/);
  assert.equal(answered.card.params.exposure_from, 'dt_start');
  assert.equal(answered.card.params.exposure_to, 'dt_end');
});

test('segmentation is a list, and a bid date on buyers is dropped', () => {
  const slots = guardPhrase('сегментировать базу покупателей', {
    metric: { agg: 'count', field: null },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    time: { column: 'last_bid_set', from: '2024-10-08', to: '2026-10-08' },
    filters: [],
    assumptions: [],
    missing: ['id_profile', 'metric.field'],
    params: {},
  });
  assert.equal(slots.metric.agg, 'list');
  assert.equal(slots.metric.field, undefined);
  assert.equal(slots.time.column, null);
  assert.equal(slots.time.from, '2024-10-08');
  assert.equal(slots.missing.includes('id_profile'), false);
});

test('deposit thresholds are a list, not a count, and do not invent a period', async () => {
  const store = createStore({
    async slots() {
      return {
        metric: { agg: 'count', field: null },
        grain: 'profile',
        mart: 'carl_an.prof_total_an',
        time: null,
        filters: [
          { column: 'is_deleted', op: '=', value: false },
          { column: 'prof_categ_buy', op: '=', value: 'Private customer' },
          { column: 'deposit_balance', op: '>', value: 0 },
          { column: 'deposit_balance', op: '<', value: 40000 },
        ],
        assumptions: ['Депозит = balance_reserv + balance_summ'],
        missing: [],
        period_stated: false,
        params: { fl_min: 0, fl_max: 40000, ip_min: 0, ip_max: 80000 },
      };
    },
  });
  const snap = await store.open('ФЛ, чей депозит более 0, но менее 40 000\nи ИП, чей депозит более 0, но менее 80 000');
  assert.equal(snap.phase, 'awaiting_confirm');
  assert.equal(snap.questions.length, 0);
  assert.equal(snap.slots.metric.agg, 'list');
  assert.equal(snap.slots.metric.field, 'deposit_balance');
  assert.equal(snap.slots.filters.some((filter) => filter.column === 'prof_categ_buy'), false);
  assert.match(snap.reading, /Список профилей по депозиту/);
  assert.match(snap.reading, /40000/);
  assert.match(snap.reading, /80000/);
  assert.equal(snap.reading.includes('Период не задан'), false);
  assert.equal(snap.reading.includes('Количество профилей'), false);
  assert.equal(snap.card.metric_id, 'deposit_thresholds');
});

test('«все» does not become a profile id', () => {
  const slots = applyAnswers({
    metric: { agg: 'count', field: '*' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    filters: [],
    params: {},
    missing: ['id_profile'],
  }, { id_profile: 'все' });
  assert.equal(slots.filters.some((filter) => filter.column === 'id_profile_leader'), false);
});

test('all profile roles skip unused subscriber and keep buyer flags', async () => {
  const roles = await createStore({
    async slots() {
      return {
        metric: { agg: 'count', field: null },
        grain: 'user',
        mart: 'carl_an.users',
        time: { column: 'dt_last_login', from: '2024-10-08', to: null },
        filters: [],
        assumptions: [],
        missing: [],
        period_stated: true,
        refusal: 'COLUMN_ABSENT',
        params: {},
      };
    },
  }).open('Пользователи, кто был не позже 2 лет назад со всеми профилями и ролями в профилях');
  assert.equal(roles.phase, 'awaiting_confirm');
  assert.equal(roles.refusal, null);
  assert.equal(roles.slots.params.profile_roles, true);
  assert.equal(roles.slots.time.column, 'dt_last_login');
  assert.equal(roles.slots.time.from, '2024-10-08');
  assert.equal(roles.slots.metric.agg, 'list');

  const buyers = guardPhrase('сколько покупателей', {
    metric: { agg: 'count' },
    grain: 'profile',
    mart: 'carl_an.prof_buy',
    filters: [{ column: 'is_buyer', op: '=', value: true }],
    assumptions: [],
    missing: [],
    refusal: null,
    params: {},
  });
  assert.equal(buyers.refusal, null);
});

test('buyer export with seller ids keeps bids and purchases', async () => {
  const utterance = 'сделать выгрузку покупателей (юр и физ лица)\n, зарегистрированных с сентября 2022 по январь 2023 включительно\n, с количеством ставок и покупок по продавцу Арвал (ID 19760 и 2)';
  const store = createStore({
    async slots() {
      return {
        metric: { agg: 'list', field: null },
        grain: 'profile',
        mart: 'carl_an.prof_buy',
        time: { column: 'dt_create', from: '2022-09-01', to: '2023-02-01' },
        filters: [{ column: 'is_deleted', op: '=', value: 'false' }],
        assumptions: ['Продавец Арвал — id_profile_seller IN (19760, 2)'],
        missing: ['metric.field', 'time.column'],
        period_stated: true,
        refusal: null,
        params: {},
      };
    },
  });
  const opened = await store.open(utterance);
  assert.equal(opened.phase, 'awaiting_confirm');
  assert.deepEqual(opened.slots.params.seller_ids, ['19760', '2']);
  assert.equal(opened.questions.length, 0);
  assert.match(opened.reading, /19760 и 2/);
  assert.match(opened.reading, /без прокси/);
  const ready = await store.confirm(opened.id);
  assert.equal(ready.card.metric_id, 'buyer_seller_activity');
  assert.match(ready.sql, /19760, 2/);
  assert.match(ready.sql, /sum\(b\.count\)/);
  assert.match(ready.sql, /> 0 OR/);
  assert.match(ready.sql, /SUCCESS/);
  assert.deepEqual(opened.slots.filters.find((filter) => filter.column === 'id_profile_seller').value, ['19760', '2']);
  assert.equal(ready.sql.includes('SET_PROXY'), false);
  assert.equal(validate(ready.sql).ok, true, validate(ready.sql).errors.join('; '));
});

test('a string refusal on the buyer segment asks nothing', async () => {
  const store = createStore({
    async slots() {
      return {
        metric: { agg: 'count', field: null },
        grain: 'profile',
        mart: 'carl_an.prof_buy',
        time: { column: 'last_bid_set', from: '2024-10-08', to: '2026-10-08' },
        filters: [{ column: 'region', op: 'IN', value: ['Тюменская область'] }],
        assumptions: [],
        missing: ['id_profile'],
        period_stated: true,
        refusal: 'MART_MISSING_TYPE_PARENT',
        params: {},
      };
    },
  });
  const snap = await store.open('сегментировать базу покупателей за два года');
  assert.equal(snap.phase, 'failed');
  assert.equal(snap.questions.length, 0);
  assert.match(snap.refusal.text, /150/);
  assert.equal(snap.reading.includes('api/api_supp.sql'), false);
  assert.match(snap.reading, /Список профилей/);
});

test('duration sql is an average of a date difference and passes the validator', () => {
  const sql = `SELECT avg(dt_end - dt_start) FROM carl_an.t_auct_total_an WHERE object_type_top_name = 'Легковые автомобили' AND dt_active >= '2026-08-01' AND dt_active < '2026-09-01'`;
  const checked = validate(sql);
  assert.deepEqual(checked.errors, []);
  assert.equal(sql.includes('SUCCESS'), false);
});
