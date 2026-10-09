import { TIME_COLUMNS, relationName } from './catalog.js';

function filters(slots) {
  return slots.filters || [];
}

function statusValues(slots) {
  const found = filters(slots).find((f) => f.column === 'status');
  if (!found) return [];
  return (Array.isArray(found.value) ? found.value : [found.value]).map(String);
}

function hasEq(slots, column) {
  return filters(slots).some((f) => f.column === column && (f.op === '=' || f.op === 'eq') && f.value !== undefined && f.value !== null && f.value !== '');
}

export function matchMetric(slots) {
  const mart = relationName(slots.mart);
  const agg = slots.metric?.agg;
  const field = slots.metric?.field;
  const dims = slots.dimensions || [];
  if (!agg || !mart) return null;
  if (field === 'deposit_balance' && (mart === 'prof_total_an' || mart === 'prof_buy')) return 'deposit_thresholds';
  if (agg === 'list' && mart === 't_auct_total_an' && statusValues(slots).includes('ACTIVE') && !statusValues(slots).includes('SUCCESS')) {
    return 'active_lots';
  }
  if (agg === 'list' && mart === 'prof_buy' && slots.params?.seller_ids?.length && slots.time?.column === 'dt_create') return 'buyer_seller_activity';
  if (agg === 'list' && mart === 'prof_buy' && slots.time?.column === 'dt_create') return 'buyer_registration_period';
  if (agg === 'list' && mart === 'users' && slots.params?.profile_roles) return 'users_with_profile_roles';
  if ((agg === 'sum' || field === 'count') && (mart === 't_auct_bids_an' || slots.grain === 'bid_profile')) return 'profile_bid_count';
  if (agg === 'count' && mart === 't_auct_total_an' && hasEq(slots, 'id_profile_leader')) return 'profile_purchase_count';
  if (agg === 'list' && mart === 't_auct_total_an' && (dims.includes('applied_commission') || dims.includes('id_profile_leader'))) {
    return 'buyer_purchases_and_commission';
  }
  if (agg === 'count' && mart === 't_auct_total_an' && statusValues(slots).includes('SUCCESS')) return 'sales_count_by_period';
  return null;
}

function lit(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!/^-?\d+(\.\d+)?$/.test(String(value))) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  return String(value);
}

function timeColumn(slots) {
  const column = slots.time?.column;
  if (!TIME_COLUMNS.includes(column)) {
    const error = new Error('Поле времени не из белого списка или пустое');
    error.code = 'PARAM';
    throw error;
  }
  return column;
}

function bounds(slots) {
  if (!slots.time?.from || !slots.time?.to) {
    const error = new Error('Границы периода пустые');
    error.code = 'PARAM';
    throw error;
  }
  return { from: lit(slots.time.from), to: lit(slots.time.to) };
}

function eqFilter(slots, column) {
  return filters(slots).find((f) => f.column === column && (f.op === '=' || f.op === 'eq'));
}

function profileId(slots, column) {
  const found = eqFilter(slots, column) || eqFilter(slots, 'id_profile');
  if (!found) {
    const error = new Error('Номер профиля пустой');
    error.code = 'PARAM';
    throw error;
  }
  if (!/^\d+$/.test(String(found.value))) {
    const error = new Error('Номер профиля не целое');
    error.code = 'PARAM';
    throw error;
  }
  return String(found.value);
}

function sellerId(slots) {
  if (Object.prototype.hasOwnProperty.call(slots.params || {}, 'id_profile_seller') && (slots.params.id_profile_seller === null || slots.params.id_profile_seller === '')) {
    return 'NULL';
  }
  const found = eqFilter(slots, 'id_profile_seller');
  if (!found) return 'NULL';
  if (!/^\d+$/.test(String(found.value))) {
    const error = new Error('Номер продавца не целое');
    error.code = 'PARAM';
    throw error;
  }
  return String(found.value);
}

function typeLit(slots) {
  const found = eqFilter(slots, 'object_type_top_name');
  return found ? lit(found.value) : 'NULL';
}

export function deletedLots(metricId, slots) {
  if (metricId === 'sales_count_by_period' || metricId === 'profile_purchase_count') return 'включены';
  if (metricId === 'active_lots' || metricId === 'buyer_purchases_and_commission') return 'исключены';
  if (metricId === 'profile_bid_count' && sellerId(slots) !== 'NULL') return 'включены';
  return null;
}

export function render(slots) {
  const id = matchMetric(slots);
  if (!id) return null;
  const sql = SQL[id](slots);
  return { metric_id: id, sql, deleted_lots: deletedLots(id, slots) };
}

const SQL = {
  sales_count_by_period(slots) {
    const column = timeColumn(slots);
    const { from, to } = bounds(slots);
    return `SELECT count(*)::bigint AS sold_lots
FROM carl_an.t_auct_total_an
WHERE status IN ('SUCCESS', 'BUYNOW')
  AND ${column} >= ${from}
  AND ${column} < ${to}
  AND (${typeLit(slots)} IS NULL OR object_type_top_name = ${typeLit(slots)});`;
  },
  active_lots() {
    return `SELECT id_auction,
       vin,
       mark,
       model,
       object_type_top_name,
       dt_start,
       dt_end
FROM carl_an.t_auct_total_an
WHERE status = 'ACTIVE'
  AND is_deleted = 'N';`;
  },
  deposit_thresholds(slots) {
    const mart = relationName(slots.mart);
    if (mart !== 'prof_total_an' && mart !== 'prof_buy') {
      const error = new Error('Витрина депозита не из белого списка');
      error.code = 'PARAM';
      throw error;
    }
    const p = slots.params || {};
    for (const key of ['fl_min', 'fl_max', 'ip_min', 'ip_max']) {
      if (!/^-?\d+$/.test(String(p[key]))) {
        const error = new Error('Порог депозита пустой');
        error.code = 'PARAM';
        throw error;
      }
    }
    return `SELECT id_profile,
       prof_categ_buy,
       is_company,
       is_indiv,
       balance_reserv,
       balance_summ,
       (coalesce(balance_reserv, 0) + coalesce(balance_summ, 0)) AS deposit_balance
FROM carl_an.${mart}
WHERE is_deleted = false
  AND (
        (prof_categ_buy = 'Private customer'
         AND (coalesce(balance_reserv, 0) + coalesce(balance_summ, 0)) > ${p.fl_min}
         AND (coalesce(balance_reserv, 0) + coalesce(balance_summ, 0)) < ${p.fl_max})
        OR
        (prof_categ_buy = 'Individual Entrepreneur'
         AND (coalesce(balance_reserv, 0) + coalesce(balance_summ, 0)) > ${p.ip_min}
         AND (coalesce(balance_reserv, 0) + coalesce(balance_summ, 0)) < ${p.ip_max})
      );`;
  },
  profile_bid_count(slots) {
    if (slots.time?.column !== 'last_bid_set') {
      const error = new Error('Время ставок — last_bid_set');
      error.code = 'PARAM';
      throw error;
    }
    const idProfile = profileId(slots, 'id_profile_bid');
    const { from, to } = bounds(slots);
    const seller = sellerId(slots);
    if (seller === 'NULL') {
      return `SELECT coalesce(sum(b.count), 0)::bigint AS bid_events
FROM carl_an.t_auct_bids_an b
WHERE b.id_profile_bid = ${idProfile}
  AND b.last_bid_set >= ${from}
  AND b.last_bid_set < ${to};`;
    }
    return `SELECT coalesce(sum(b.count), 0)::bigint AS bid_events
FROM carl_an.t_auct_bids_an b
JOIN carl_an.t_auct_total_an a ON a.id_auction = b.id_auction
WHERE b.id_profile_bid = ${idProfile}
  AND a.id_profile_seller = ${seller}
  AND b.last_bid_set >= ${from}
  AND b.last_bid_set < ${to};`;
  },
  buyer_purchases_and_commission(slots) {
    const column = timeColumn(slots);
    const from = lit(slots.time?.from || '2022-01-01');
    const to = lit(slots.time?.to || '2023-01-01');
    return `SELECT id_profile_leader,
       count(*)::bigint AS bought_all,
       coalesce(sum(applied_commission), 0)::bigint AS commission_all,
       count(*) FILTER (
           WHERE ${column} >= ${from}
             AND ${column} < ${to}
       )::bigint AS bought_year,
       coalesce(sum(applied_commission) FILTER (
           WHERE ${column} >= ${from}
             AND ${column} < ${to}
       ), 0)::bigint AS commission_year
FROM carl_an.t_auct_total_an
WHERE status IN ('SUCCESS', 'BUYNOW')
  AND is_deleted = 'N'
  AND id_profile_leader IS NOT NULL
  AND (${typeLit(slots)} IS NULL OR object_type_top_name = ${typeLit(slots)})
GROUP BY id_profile_leader;`;
  },
  users_with_profile_roles(slots) {
    if (slots.time?.column !== 'dt_last_login') {
      const error = new Error('Активность пользователя считается по dt_last_login');
      error.code = 'PARAM';
      throw error;
    }
    const { from, to } = bounds(slots);
    return `SELECT u.id_user,
       p.id_profile,
       p.is_seller,
       p.is_buyer
FROM carl_an.users u
JOIN carl_an.prof_total_an p ON p.id_user_owner = u.id_user
WHERE u.dt_last_login >= ${from}
  AND u.dt_last_login < ${to};`;
  },
  buyer_seller_activity(slots) {
    if (slots.time?.column !== 'dt_create') {
      const error = new Error('Регистрация считается по dt_create');
      error.code = 'PARAM';
      throw error;
    }
    const ids = slots.params?.seller_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !/^\d+$/.test(String(id)))) {
      const error = new Error('Номера продавцов пустые');
      error.code = 'PARAM';
      throw error;
    }
    const { from, to } = bounds(slots);
    const list = ids.join(', ');
    const bids = `coalesce((
           SELECT sum(b.count)::bigint
           FROM carl_an.t_auct_bids_an b
           JOIN carl_an.t_auct_total_an a ON a.id_auction = b.id_auction
           WHERE b.id_profile_bid = p.id_profile
             AND a.id_profile_seller IN (${list})
         ), 0)`;
    const buys = `(
           SELECT count(*)::bigint
           FROM carl_an.t_auct_total_an a
           WHERE a.status IN ('SUCCESS', 'BUYNOW')
             AND a.id_profile_leader = p.id_profile
             AND a.id_profile_seller IN (${list})
         )`;
    return `SELECT p.id_profile,
       p.is_company,
       p.is_indiv,
       p.dt_create,
       p.getprofsmartname2,
       ${bids} AS bid_events,
       ${buys} AS bought_lots
FROM carl_an.prof_buy p
WHERE p.dt_create >= ${from}
  AND p.dt_create < ${to}
  AND (${bids} > 0 OR ${buys} > 0);`;
  },
  buyer_registration_period(slots) {
    if (slots.time?.column !== 'dt_create') {
      const error = new Error('Регистрация считается по dt_create');
      error.code = 'PARAM';
      throw error;
    }
    const { from, to } = bounds(slots);
    return `SELECT id_profile,
       is_company,
       is_indiv,
       dt_create
FROM carl_an.prof_buy
WHERE dt_create >= ${from}
  AND dt_create < ${to};`;
  },
  profile_purchase_count(slots) {
    const column = timeColumn(slots);
    const { from, to } = bounds(slots);
    const idProfile = profileId(slots, 'id_profile_leader');
    const seller = sellerId(slots);
    return `SELECT count(*)::bigint AS bought_lots
FROM carl_an.t_auct_total_an
WHERE status IN ('SUCCESS', 'BUYNOW')
  AND id_profile_leader = ${idProfile}
  AND ${column} >= ${from}
  AND ${column} < ${to}
  AND (${seller} IS NULL OR id_profile_seller = ${seller});`;
  },
};
