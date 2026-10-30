import { columnNames, relationName } from './catalog.js';

const SALE = /продаж|продан|купил|куплен|покупк/i;
const PROFILE_ROLES = /подписчик|всеми ролями|все роли|ролями в профил/i;
const SELLER_ACTIVITY = /ставк|покуп/i;
const ROLE_SKIP = 'Подписчик не используется. Роли профиля — покупатель и продавец.';
const SEGMENT = /сегмент/i;
const DEPOSIT = /депозит/i;
const EXPOSURE = /экспозиц/i;
const SALE_STATUS = new Set(['SUCCESS', 'BUYNOW']);
const DATE_COLS = new Set([
  'dt_end', 'dt_start', 'dt_active', 'dt_approve', 'dt_create', 'dt_change_status', 'dt_set_lead', 'dt_update', 'dt_report',
]);

const ALL_STATUSES = 'Экспозиция — все статусы лота. Фильтр продажи не ставился: во фразе нет продажи.';

export function mentionsSale(text) {
  return SALE.test(text || '');
}

function dateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function refusalCode(slots) {
  const raw = slots?.refusal;
  return typeof raw === 'string' ? raw : raw?.code;
}

function sellerIds(utterance) {
  const marked = String(utterance || '').match(/ID\s*(\d+)\s*и\s*(\d+)/i);
  if (!marked) return [];
  return [marked[1], marked[2]];
}

function applySellerActivity(utterance, out) {
  const ids = sellerIds(utterance);
  if (!ids.length || !/покупател/i.test(utterance || '')) return;
  out.metric = { ...(out.metric || {}), agg: 'list' };
  delete out.metric.field;
  out.grain = 'profile';
  out.mart = 'carl_an.prof_buy';
  out.period_stated = true;
  const time = out.time || {};
  out.time = { ...time, column: /зарегистрир/i.test(utterance) ? 'dt_create' : (time.column || 'dt_create') };
  out.params = { ...(out.params || {}), seller_ids: ids };
  out.filters = (out.filters || []).filter((filter) => filter.column !== 'id_profile_seller');
  out.filters.push({ column: 'id_profile_seller', op: 'in', value: ids });
  out.assumptions = (out.assumptions || []).filter((line) => !/ставк|покупк|продав|арвал|id_profile_seller/i.test(line));
  out.assumptions.push(`Ставки и покупки только по продавцам ${ids.join(' и ')}. В списке нет покупателей с нулём и там, и там. Ставки — сумма count, без SET_PROXY. Покупки — лоты SUCCESS и BUYNOW, покупатель лидер. Период на ставки и покупки не действует.`);
  out.missing = (out.missing || []).filter((name) => !['metric.agg', 'metric.field', 'grain', 'mart', 'time', 'time.column'].includes(name));
}

function admitsMissingColumn(line) {
  return /колонк/i.test(line) && /нет/i.test(line);
}

function applyMissingColumn(out) {
  const hit = (out.assumptions || []).find(admitsMissingColumn);
  if (!hit) return;
  out.assumptions = (out.assumptions || []).filter((line) => !admitsMissingColumn(line));
  out.refusal = { code: 'COLUMN_ABSENT', assumption: hit };
}

function applyProfileRoles(utterance, out) {
  if (refusalCode(out) === 'COLUMN_ABSENT') out.refusal = null;
  out.metric = { ...(out.metric || {}), agg: 'list' };
  delete out.metric.field;
  out.grain = 'user';
  out.mart = 'carl_an.users';
  out.period_stated = true;
  const years = Number((utterance.match(/(\d+)\s*(?:год|года|лет)/i) || [])[1]);
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const start = new Date(today);
  if (years > 0) start.setFullYear(start.getFullYear() - years);
  const time = out.time || {};
  out.time = {
    column: 'dt_last_login',
    from: time.from || (years > 0 ? dateOnly(start) : null),
    to: time.to || dateOnly(end),
  };
  out.params = { ...(out.params || {}), profile_roles: true };
  out.assumptions = (out.assumptions || []).filter((line) => !/подписчик/i.test(line));
  out.assumptions.push(ROLE_SKIP);
  out.missing = (out.missing || []).filter((name) => !['metric.agg', 'metric.field', 'grain', 'mart', 'time', 'id_profile'].includes(name));
}

function saleOnly(filter) {
  if (filter.column !== 'status') return false;
  const values = (Array.isArray(filter.value) ? filter.value : [filter.value]).map(String);
  return values.length > 0 && values.every((value) => SALE_STATUS.has(value));
}

export function guardPhrase(utterance, slots, { contextUtterance = '' } = {}) {
  const out = structuredClone(slots);
  const sale = mentionsSale(utterance) || mentionsSale(contextUtterance);
  if (!sale) {
    out.filters = (out.filters || []).filter((filter) => !saleOnly(filter));
    out.assumptions = (out.assumptions || []).filter((line) => !(/продаж/i.test(line) && /SUCCESS|BUYNOW/i.test(line)));
  }
  const params = out.params || {};
  const thresholds = ['fl_min', 'fl_max', 'ip_min', 'ip_max'].every((key) => params[key] !== undefined && params[key] !== null);
  if (DEPOSIT.test(utterance || '') || thresholds) {
    out.metric = { ...(out.metric || {}), agg: 'list', field: 'deposit_balance' };
    if (!out.grain) out.grain = 'profile';
    if (!out.period_stated) out.time = null;
    out.filters = (out.filters || []).filter((filter) => filter.column !== 'prof_categ_buy' && filter.column !== 'deposit_balance');
    out.missing = (out.missing || []).filter((name) => name !== 'metric.agg' && name !== 'metric.field' && name !== 'time' && name !== 'grain');
  }
  if (SEGMENT.test(utterance || '')) {
    out.metric = { ...(out.metric || {}), agg: 'list' };
    delete out.metric.field;
    out.missing = (out.missing || []).filter((name) => name !== 'id_profile' && name !== 'id_profile_seller' && name !== 'metric.field');
  }
  applyMissingColumn(out);
  if (PROFILE_ROLES.test(utterance || '')) applyProfileRoles(utterance, out);
  if (SELLER_ACTIVITY.test(utterance || '')) applySellerActivity(utterance, out);
  const mart = relationName(out.mart);
  if (out.time?.column && mart && columnNames(mart).size && !columnNames(mart).has(out.time.column)) {
    out.time = { ...out.time, column: null };
  }
  if (!EXPOSURE.test(utterance || '')) return out;
  out.params = { ...(out.params || {}), exposure: true };
  if (!out.params.exposure_from || !out.params.exposure_to) {
    if (out.metric && (DATE_COLS.has(out.metric.field) || typeof out.metric.field === 'string')) {
      delete out.metric.field;
    }
  }
  out.assumptions = (out.assumptions || []).filter((line) => !/экспозиц/i.test(line));
  if (!sale) out.assumptions.push(ALL_STATUSES);
  return out;
}
