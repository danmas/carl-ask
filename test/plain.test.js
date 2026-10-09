import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCard } from '../src/card.js';

test('exposure is described without sale status or column names', () => {
  const card = buildCard({
    metric: { agg: 'avg', field: 'dt_end - dt_start' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    filters: [{ column: 'object_type_top_name', op: '=', value: 'Легковые автомобили' }],
    time: { column: 'dt_active', from: '2026-08-01', to: '2026-09-01' },
    params: { exposure: true, exposure_from: 'dt_start', exposure_to: 'dt_end' },
    assumptions: [
      'Экспозиция — все статусы лота. Фильтр продажи не ставился: во фразе нет продажи.',
      'Длительность = dt_end − dt_start.',
    ],
  });
  assert.match(card.plain, /Средняя длительность экспозиции/);
  assert.match(card.plain, /старт торгов/);
  assert.match(card.plain, /окончание торгов/);
  assert.match(card.plain, /Легковые автомобили/);
  assert.match(card.plain, /1 августа 2026/);
  assert.match(card.plain, /1 сентября 2026/);
  assert.match(card.plain, /Статус лота любой/);
  assert.match(card.plain, /переход в активные/);
  assert.match(card.plain, /Удалённые лоты отдельно не отсекались/);
  assert.doesNotMatch(card.plain, /SUCCESS|BUYNOW|dt_|t_auct|is_deleted/);
});

test('a sale count names sold lots, the status-change date, and deleted lots', () => {
  const card = buildCard({
    metric: { agg: 'count', field: '*' },
    grain: 'auction',
    mart: 'carl_an.t_auct_total_an',
    filters: [
      { column: 'status', op: 'in', value: ['SUCCESS', 'BUYNOW'] },
      { column: 'object_type_top_name', op: '=', value: 'Легковые автомобили' },
    ],
    time: { column: 'dt_change_status', from: '2026-09-01', to: '2026-10-01' },
    params: {},
  });
  assert.match(card.plain, /Сколько лотов продано/);
  assert.match(card.plain, /Только проданные/);
  assert.match(card.plain, /последняя смена статуса/);
  assert.match(card.plain, /Удалённые лоты входят/);
  assert.doesNotMatch(card.plain, /dt_|SUCCESS|t_auct/);
});
