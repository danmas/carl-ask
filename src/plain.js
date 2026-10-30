import { timeRequired } from './policy.js';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const DATE_LABEL = {
  dt_end: 'окончание торгов',
  dt_change_status: 'последняя смена статуса',
  dt_start: 'старт торгов',
  dt_active: 'переход в активные',
  dt_approve: 'одобрение',
  dt_create: 'создание лота',
  dt_set_lead: 'время лидирующей ставки',
  last_bid_set: 'последняя ставка этого профиля на лоте',
  dt_last_login: 'последний вход',
  dt_created: 'регистрация пользователя',
};

const STATUS_LABEL = {
  SUCCESS: 'торги состоялись',
  BUYNOW: 'купили сразу',
  ACTIVE: 'сейчас в торгах',
  FAILED: 'торги не состоялись',
  DRAFT: 'черновик',
  MODERATED: 'на модерации',
  FINISHED: 'торги закончились, продажей это не считается',
  CANCELED: 'отменён',
};

function ruDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value);
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function dateName(column, mart) {
  if (column === 'dt_create' && /prof_|users/.test(mart || '')) return 'регистрация';
  return DATE_LABEL[column] || null;
}

function valuesOf(filter) {
  return (Array.isArray(filter.value) ? filter.value : [filter.value]).map(String);
}

function findFilter(filters, column) {
  return filters.find((filter) => filter.column === column);
}

function sameStatus(values, expected) {
  return values.slice().sort().join(',') === expected.slice().sort().join(',');
}

function periodSentence(time, mart, slots) {
  if (!time && !timeRequired(slots || {})) return '';
  if (!time) return 'Период не задан.';
  const name = dateName(time.column, mart);
  const by = name ? ` Дата, по которой отрезается период: ${name}.` : '';
  if (time.all_time && time.from && time.to) {
    return `За всё время и отдельно за окно с ${ruDate(time.from)} включительно по ${ruDate(time.to)}, эту дату не включая.${by}`;
  }
  if (time.from && time.to) {
    return `Период с ${ruDate(time.from)} включительно по ${ruDate(time.to)}, эту дату не включая.${by}`;
  }
  if (time.all_time) return `За всё время.${by}`;
  return `Период задан не до конца.${by}`;
}

function statusSentence(filters, mart) {
  if (!/t_auct_total_an/.test(mart || '')) return '';
  const found = findFilter(filters, 'status');
  if (!found) return 'Статус лота любой: и проданные, и несостоявшиеся, и черновики.';
  const values = valuesOf(found);
  if (sameStatus(values, ['SUCCESS', 'BUYNOW'])) {
    return 'Только проданные: торги состоялись или купили сразу. Просто оконченные торги продажей не считаются.';
  }
  if (sameStatus(values, ['ACTIVE'])) return 'Только лоты, которые сейчас в торгах.';
  const names = values.map((value) => STATUS_LABEL[value] || value);
  return `Статус лота: ${names.join(', ')}.`;
}

function whoSentence(slots) {
  const filters = slots.filters || [];
  const lines = [];
  const type = findFilter(filters, 'object_type_top_name');
  if (type) lines.push(`Категория: ${type.value}.`);
  const leader = findFilter(filters, 'id_profile_leader');
  if (leader) lines.push(`Покупатель, который забрал лот, номер ${leader.value}.`);
  const bidder = findFilter(filters, 'id_profile_bid');
  if (bidder) lines.push(`Профиль, который делал ставки, номер ${bidder.value}.`);
  const maker = findFilter(filters, 'id_user');
  if (maker && /v_lot_from_report_an|v_inspect_report_an/.test(slots.mart || '')) {
    lines.push(`Пользователь номер ${maker.value}.`);
  }
  const inspector = findFilter(filters, 'id_user_inspector');
  if (inspector) lines.push(`Автор отчёта, номер ${inspector.value}.`);
  const seller = findFilter(filters, 'id_profile_seller');
  if (seller) lines.push(`Продавец номер ${seller.value}.`);
  else if (Object.prototype.hasOwnProperty.call(slots.params || {}, 'id_profile_seller') && (slots.params.id_profile_seller === null || slots.params.id_profile_seller === '')) {
    lines.push('Продавец любой.');
  }
  return lines.join(' ');
}

function deletedSentence(deleted, mart) {
  if (deleted === 'включены') return /t_auct_/.test(mart || '') ? 'Удалённые лоты входят в подсчёт.' : 'Удалённые записи входят.';
  if (deleted === 'исключены') return /t_auct_/.test(mart || '') ? 'Удалённые лоты не входят.' : 'Удалённые записи не входят.';
  if (/t_auct_total_an/.test(mart || '')) return 'Удалённые лоты отдельно не отсекались.';
  return '';
}

function whatSentence(slots, metricId) {
  const params = slots.params || {};
  if (params.exposure && params.exposure_from && params.exposure_to) {
    const from = dateName(params.exposure_from, slots.mart);
    const to = dateName(params.exposure_to, slots.mart);
    return `Средняя длительность экспозиции: от «${from || 'выбранной даты'}» до «${to || 'выбранной даты'}».`;
  }
  if (metricId === 'sales_count_by_period') return 'Сколько лотов продано.';
  if (metricId === 'active_lots') return 'Список лотов, которые сейчас в торгах. В списке есть VIN.';
  if (metricId === 'deposit_thresholds') {
    const p = params;
    return `Список профилей по депозиту. Депозит — зарезервированная сумма плюс свободный остаток. Физлица строго больше ${p.fl_min} и меньше ${p.fl_max}. ИП строго больше ${p.ip_min} и меньше ${p.ip_max}. Телефона, почты и имени нет. Удалённые профили не входят.`;
  }
  if (metricId === 'profile_bid_count') return 'Сколько событий ставок сделал профиль. Прокси-ставки, которые только удерживают цену, в это число не входят.';
  if (metricId === 'profile_purchase_count') return 'Сколько лотов забрал профиль.';
  if (metricId === 'buyer_purchases_and_commission') return 'По каждому покупателю: сколько лотов он забрал и какую комиссию заплатил, за всё время и за выбранный год.';
  if (metricId === 'buyer_registration_period') return 'Список покупателей по дате регистрации. Телефона, почты и имени нет. Удалённые профили входят.';
  if (metricId === 'buyer_seller_activity') {
    const ids = (params.seller_ids || []).join(' и ');
    return `Список покупателей по дате регистрации, у которых есть ставки или покупки у продавцов ${ids}. Остальные не входят. Ставки без прокси. Период не режет ставки и покупки. В списке есть имя. Телефона и почты нет. Удалённые профили входят. Удалённые лоты в числе покупок входят.`;
  }
  if (metricId === 'users_with_profile_roles') return 'Список пользователей и всех их профилей. Роль профиля — покупатель или продавец. Подписчик не используется.';
  if (metricId === 'lots_from_reports_by_user') return 'Сколько лотов создано из отчётов инспекции. Перевыставление и поздняя привязка отчёта к уже существующему лоту сюда не входят.';
  const agg = slots.metric?.agg;
  const grain = slots.grain === 'profile' ? 'профилей' : slots.grain === 'user' ? 'пользователей' : slots.grain === 'bid_profile' ? 'ставок профиля на лоте' : 'лотов';
  if (agg === 'count') return `Количество ${grain}.`;
  if (agg === 'list') return `Список ${grain}.`;
  if (agg === 'avg') return `Среднее по ${grain}.`;
  if (agg === 'sum') return `Сумма по ${grain}.`;
  return '';
}

function aside(assumptions) {
  const lines = [];
  const text = (assumptions || []).join('\n');
  if (/Поле времени года/.test(text)) lines.push('Дата года выбрана как окончание торгов. Это допущение только этого отчёта.');
  if (/нет слова «покупатели»/.test(text)) lines.push('Берутся все профили, не только покупатели: во фразе не было слова «покупатели».');
  if (/Поле времени не выбрано/.test(text)) lines.push('По какой дате резать период — не выбрано. Пока так, запрос не строится.');
  if (/Границы экспозиции не выбраны/.test(text)) lines.push('От какой даты до какой считать экспозицию — не выбрано. Подставлять даты самим нельзя.');
  return lines.join(' ');
}

function freshness(mart) {
  if (/t_auct_/.test(mart || '')) return 'Цифры на момент ночной пересборки лотов, около 03:00, не на текущую секунду.';
  if (/prof_/.test(mart || '')) return 'Профили — снимок. Насколько он свежий, видно по журналу обновления на момент вопроса.';
  if (/users/.test(mart || '')) return 'Пользователи — снимок. Насколько он свежий, видно по журналу обновления на момент вопроса.';
  if (/v_inspect_report_an|v_lot_from_report_an/.test(mart || '')) return 'Цифры на момент запроса: это вьюха, не ночной снимок.';
  return '';
}

export function plainText(slots, { metricId = null, deleted = null, assumptions = [], brief = false } = {}) {
  const mart = slots.mart || '';
  const lines = [
    whatSentence(slots, metricId),
    /t_auct_total_an/.test(mart) ? 'Каждая строка — один лот. Повторный раунд перевыставления считается отдельно, это не одна машина.' : '',
    /v_lot_from_report_an/.test(mart) ? 'Одна строка — один лот, созданный из отчёта. Повторный раунд перевыставления не считается.' : '',
    /v_inspect_report_an/.test(mart) ? 'Одна строка — один отчёт инспекции.' : '',
    whoSentence(slots),
    statusSentence(slots.filters || [], mart),
    periodSentence(slots.time, mart, slots),
    deletedSentence(deleted, mart),
    aside(assumptions),
    brief ? '' : freshness(mart),
  ];
  return lines.filter(Boolean).join('\n');
}
