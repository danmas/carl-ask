import { relationName } from './catalog.js';
import { knownRefusal } from './refusals.js';
import { matchMetric } from './metrics.js';

const ASK_ORDER = ['metric.agg', 'grain', 'mart', 'metric.field', 'time', 'id_profile', 'id_profile_seller', 'id_user', 'thresholds'];

const TIME_OPTIONS = [
  { value: 'dt_end', label: 'окончание торгов' },
  { value: 'dt_change_status', label: 'последняя смена статуса' },
  { value: 'dt_start', label: 'старт торгов' },
  { value: 'dt_active', label: 'переход в активные' },
  { value: 'dt_approve', label: 'одобрение' },
  { value: 'dt_create', label: 'создание лота' },
];

const USER_TIME_OPTIONS = [
  { value: 'dt_last_login', label: 'последний вход' },
  { value: 'dt_created', label: 'регистрация пользователя' },
];

const REPORT_TIME_OPTIONS = [
  { value: 'dt_create', label: 'создание отчёта' },
  { value: 'dt_update', label: 'обновление отчёта' },
];

const LOT_FROM_REPORT_TIME_OPTIONS = [
  { value: 'dt_create', label: 'создание лота из отчёта' },
  { value: 'dt_report', label: 'создание отчёта' },
];

function timeOptions(slots) {
  const mart = String(slots.mart || '');
  if (mart.endsWith('users')) return USER_TIME_OPTIONS;
  if (mart.endsWith('v_inspect_report_an')) return REPORT_TIME_OPTIONS;
  if (mart.endsWith('v_lot_from_report_an')) return LOT_FROM_REPORT_TIME_OPTIONS;
  return TIME_OPTIONS;
}

export function timeRequired(slots) {
  const agg = slots.metric?.agg;
  if (!agg) return false;
  if (agg !== 'list') return true;
  return Boolean(slots.period_stated);
}

export function timeFilled(slots) {
  const time = slots.time;
  if (!time) return false;
  if (!time.column && !time.all_time) return false;
  if (time.all_time && time.column) return true;
  return Boolean(time.column && time.from && time.to);
}

function filterHas(slots, column) {
  return (slots.filters || []).some((f) => f.column === column && f.value !== undefined && f.value !== null && f.value !== '');
}

function gapFilled(slots, gap) {
  if (gap === 'metric.agg') return Boolean(slots.metric?.agg);
  if (gap === 'metric.field') return Boolean(slots.metric?.field);
  if (gap === 'grain') return Boolean(slots.grain);
  if (gap === 'mart') return Boolean(slots.mart);
  if (gap === 'time') return timeFilled(slots);
  if (gap === 'id_profile') {
    return filterHas(slots, 'id_profile_bid') || filterHas(slots, 'id_profile_leader') || filterHas(slots, 'id_profile');
  }
  if (gap === 'id_profile_seller') {
    return filterHas(slots, 'id_profile_seller') || Object.prototype.hasOwnProperty.call(slots.params || {}, 'id_profile_seller');
  }
  if (gap === 'id_user') {
    if (slots.params?.all_users) return true;
    return ['id_user', 'id_user_inspector'].some((column) => (slots.filters || []).some((f) => f.column === column && /^\d+$/.test(String(f.value ?? ''))));
  }
  if (gap === 'thresholds') {
    const p = slots.params || {};
    return [p.fl_min, p.fl_max, p.ip_min, p.ip_max].every((v) => v !== undefined && v !== null);
  }
  if (gap === 'exposure') return Boolean(slots.params?.exposure_from && slots.params?.exposure_to);
  return false;
}

export function requiredGaps(slots) {
  const gaps = [];
  if (!slots.metric?.agg) gaps.push('metric.agg');
  if (!slots.grain) gaps.push('grain');
  if (!slots.mart) gaps.push('mart');
  if (slots.metric?.agg && slots.metric.agg !== 'list' && !slots.metric.field) gaps.push('metric.field');
  if (timeRequired(slots) && !timeFilled(slots)) gaps.push('time');
  return gaps;
}

export function paramGaps(slots) {
  const id = matchMetric(slots);
  const gaps = [];
  if (id === 'profile_bid_count' || id === 'profile_purchase_count') {
    gaps.push('id_profile', 'id_profile_seller');
  }
  if (id === 'deposit_thresholds') gaps.push('thresholds');
  if (id === 'lots_from_reports_by_user') gaps.push('id_user');
  return gaps.filter((gap) => !gapFilled(slots, gap));
}

export function allGaps(slots) {
  let gaps = requiredGaps(slots);
  if (slots.params?.exposure) {
    gaps = gaps.filter((gap) => gap !== 'metric.field');
    if (!gapFilled(slots, 'exposure')) gaps.unshift('exposure');
  }
  for (const name of slots.missing || []) {
    if (name === 'id_profile' || name === 'id_profile_seller') continue;
    if (ASK_ORDER.includes(name) && !gaps.includes(name)) gaps.push(name);
  }
  for (const name of paramGaps(slots)) {
    if (!gaps.includes(name)) gaps.push(name);
  }
  return gaps.filter((gap) => !gapFilled(slots, gap));
}

function assumptionPatch(slots, gaps) {
  const id = matchMetric(slots);
  const patch = {};
  const assumptions = [...(slots.assumptions || [])];
  if (gaps.includes('time') && id === 'buyer_purchases_and_commission') {
    patch.time = {
      ...(slots.time || {}),
      column: slots.time?.column || 'dt_end',
      all_time: true,
      from: slots.time?.from || '2022-01-01',
      to: slots.time?.to || '2023-01-01',
    };
    assumptions.push('Поле времени года — dt_end. Допущение только этой метрики.');
  }
  if (gaps.includes('mart') && (id === 'deposit_thresholds' || slots.metric?.field === 'deposit_balance')) {
    patch.mart = 'carl_an.prof_total_an';
    assumptions.push('Витрина prof_total_an: во фразе нет слова «покупатели».');
  }
  for (const gap of gaps) {
    if (gap === 'time' && !patch.time) {
      assumptions.push('Поле времени не выбрано. Умолчания нет, SQL без него не строится.');
    }
    if (gap === 'exposure') {
      assumptions.push('Границы экспозиции не выбраны. Умолчания нет, SQL без них не строится.');
    }
  }
  return { assumptions, patch };
}

function questionFor(slot, slots) {
  if (slot === 'metric.agg') {
    return {
      text: 'Что нужно получить?',
      control: {
        type: 'select',
        options: [
          { value: 'count', label: 'число' },
          { value: 'sum', label: 'сумма' },
          { value: 'avg', label: 'среднее' },
          { value: 'min', label: 'минимум' },
          { value: 'max', label: 'максимум' },
          { value: 'list', label: 'список строк' },
        ],
      },
    };
  }
  if (slot === 'grain') {
    return {
      text: 'Одна строка ответа — это что?',
      control: {
        type: 'select',
        options: [
          { value: 'auction', label: 'лот' },
          { value: 'bid_profile', label: 'ставки одного профиля на лоте' },
          { value: 'profile', label: 'профиль' },
          { value: 'user', label: 'пользователь' },
        ],
      },
    };
  }
  if (slot === 'mart') {
    return {
      text: 'Откуда читать данные?',
      control: {
        type: 'select',
        options: [
          { value: 't_auct_total_an', label: 'лоты' },
          { value: 't_auct_bids_an', label: 'ставки' },
          { value: 'prof_total_an', label: 'все профили' },
          { value: 'prof_sel', label: 'продавцы' },
          { value: 'prof_buy', label: 'покупатели' },
          { value: 'users', label: 'пользователи' },
          { value: 'v_lot_from_report_an', label: 'лоты из отчётов' },
          { value: 'v_inspect_report_an', label: 'отчёты инспекции' },
        ],
      },
    };
  }
  if (slot === 'exposure') {
    return {
      text: 'Экспозиция — разность двух дат лота, не продажа. От какой даты и до какой?',
      control: { type: 'span', options: TIME_OPTIONS },
    };
  }
  if (slot === 'metric.field') {
    if (slots.metric?.agg === 'count') {
      const subject = slots.grain === 'profile' ? 'профилей'
        : slots.grain === 'user' ? 'пользователей'
          : slots.grain === 'bid_profile' ? 'ставок'
            : 'лотов';
      return {
        text: `Считать количество ${subject}?`,
        control: { type: 'select', options: [{ value: '*', label: `да, количество ${subject}` }] },
      };
    }
    return { text: 'По какому полю считать сумму или среднее?', control: { type: 'text' } };
  }
  if (slot === 'time') {
    const from = slots.time?.from;
    const to = slots.time?.to;
    if (from && to) {
      return {
        text: `Период уже стоит с ${from} включительно по ${to} не включая. По какой дате лота его отрезать?`,
        control: { type: 'select', options: timeOptions(slots) },
        preset: { from, to, all_time: false },
      };
    }
    return {
      text: 'За какой период и по какой дате лота? Дата «с» входит, дата «по» — нет.',
      control: { type: 'period', options: timeOptions(slots) },
    };
  }
  if (slot === 'id_profile') {
    const bids = slots.grain === 'bid_profile';
    return {
      text: bids ? 'Номер профиля, который делал ставки.' : 'Номер профиля, который забрал лот.',
      control: { type: 'text' },
    };
  }
  if (slot === 'id_profile_seller') {
    return { text: 'Номер профиля продавца. Пусто — продавец любой.', control: { type: 'text' } };
  }
  if (slot === 'id_user') {
    return { text: 'Номер пользователя, который создал лот из отчёта. «все» — по всем пользователям. Автор отчёта — другой человек.', control: { type: 'text' } };
  }
  if (slot === 'thresholds') {
    return {
      text: 'Пороги депозита, границы не входят. Сначала физлицо (больше и меньше), потом ИП.',
      control: { type: 'thresholds' },
    };
  }
  return { text: slot, control: { type: 'text' } };
}

export function questionsFor(gaps, slots = {}) {
  return gaps.slice(0, 3).map((slot) => ({ slot, ...questionFor(slot, slots) }));
}

export function next(slots, roundsAsked) {
  const refusal = knownRefusal(slots);
  if (refusal) {
    return { phase: 'failed', refusal, questions: [], missing: allGaps(slots), assumptions: slots.assumptions || [], patch: {} };
  }
  const missing = allGaps(slots);
  if (missing.length === 0) {
    return { phase: 'awaiting_confirm', questions: [], missing, assumptions: slots.assumptions || [], patch: {} };
  }
  if (roundsAsked >= 2) {
    const { assumptions, patch } = assumptionPatch(slots, missing);
    return { phase: 'awaiting_confirm', questions: [], missing, assumptions, patch };
  }
  const questions = questionsFor(missing, slots);
  return { phase: 'clarifying', questions, missing, assumptions: slots.assumptions || [], patch: {} };
}

export function normalizeMart(value) {
  const name = relationName(value);
  if (!name) return value;
  return `carl_an.${name}`;
}
