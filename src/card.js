import { relationName } from './catalog.js';
import { deletedLots, matchMetric } from './metrics.js';
import { plainText } from './plain.js';

const FRESHNESS = {
  t_auct_total_an: 'Пересборка carl_an.prepare_update_auct_total_an, ночь около 03:00. В analytics_table_refresh_log своей строки нет. Дата журнала профилей сюда не подставляется.',
  t_auct_bids_an: 'Та же пересборка prepare_update_auct_total_an, что у лотов. В analytics_table_refresh_log строки для ставок нет.',
  prof_total_an: 'job_name update_prof_total_an. Свежесть — max(finished_at) этой строки на момент вопроса, не дата из карточки.',
  prof_sel: 'job_name update_prof_total_an. Свежесть — max(finished_at) этой строки на момент вопроса, не дата из карточки.',
  prof_buy: 'job_name update_prof_total_an. Свежесть — max(finished_at) этой строки на момент вопроса, не дата из карточки.',
  users: 'job_name update_users_an, target_table users. Свежесть — max(finished_at) на момент вопроса.',
};

export function buildCard(slots, assumptions = []) {
  const mart = relationName(slots.mart);
  const metricId = matchMetric(slots);
  const notes = [];
  const deleted = metricId ? deletedLots(metricId, slots) : null;
  if (metricId === 'active_lots') notes.push('В выдаче есть VIN.');
  if (metricId === 'deposit_thresholds' || metricId === 'buyer_registration_period') notes.push('Телефона, почты и имени в колонках нет.');
  if (metricId === 'buyer_registration_period') notes.push('Удалённые профили включены.');
  if (metricId === 'buyer_seller_activity') notes.push('В выдаче есть имя профиля. Телефона и почты нет.');
  if (metricId === 'profile_bid_count') notes.push('Сумма count. SET_PROXY в count нет. Время — last_bid_set.');
  if (metricId === 'users_with_profile_roles') notes.push('Телефона, почты и имени в колонках нет.');
  else if (mart === 'users') notes.push('В выдаче могут быть телефон и почта.');
  const shown = assumptions.length ? assumptions : (slots.assumptions || []);
  return {
    plain: plainText(slots, { metricId, deleted, assumptions: shown }),
    mart: slots.mart || null,
    grain: slots.grain || null,
    metric: slots.metric || null,
    metric_id: metricId,
    dimensions: slots.dimensions || [],
    filters: slots.filters || [],
    time: slots.time || null,
    freshness: FRESHNESS[mart] || null,
    assumptions: shown,
    deleted_lots: deleted,
    notes,
    params: slots.params || {},
  };
}
