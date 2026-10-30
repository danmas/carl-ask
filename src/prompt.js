import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CARDS = ['lots.md', 'bids.md', 'profiles.md', 'users.md', 'inspect.md']
  .map((name) => readFileSync(join(root, 'kb', name), 'utf8'))
  .join('\n\n');

export const FEW_SHOT = [];

const RULES = `Разрешены только carl_an.t_auct_total_an, carl_an.t_auct_bids_an, carl_an.prof_total_an, carl_an.prof_sel, carl_an.prof_buy, carl_an.users, carl_an.v_inspect_report_an, carl_an.v_lot_from_report_an.
Одно отношение или ровно одна пара: лот со ставкой по id_auction; лот с профилем по id_profile_seller или id_profile_leader; ставка с профилем по id_profile_bid; ставка с users по id_user_bid; профиль с users по id_user_owner; лот из отчёта с users по id_user или id_user_inspector; лот из отчёта с t_auct_total_an по id_auction; отчёт с users по id_user; отчёт с лотом по id_auction или key = inspect_key; отчёт с лотом из отчёта по key = inspect_key или id_auction.
Одна тройка разрешена: prof_buy, t_auct_bids_an и t_auct_total_an, когда у покупателей просят число ставок и покупок по номерам продавцов. Другие тройки нельзя. Номера продавцов бери из фразы, годы периода продавцами не считай.
prof_buy с prof_sel не соединять. Не читать v_auct_total_an, v_auct_bids_an, v_prof_total_an, auct_total_an, auct_bids_an, amo_data, amo_json, tmp_*. Вьюха v_ допустима, если она в каталоге колонок. Колонку ?column? не выбирать. SELECT * не писать.`;

const SLOT_SCHEMA = `Верни только JSON объекта слотов. Шкалу понятности и числа 1-7 не возвращай. Текст отказа не пиши: поле refusal — только code или null.
Коды refusal, и только они: MART_MISSING_TYPE_PARENT (родитель типа стройка/сельхоз), NO_BID_TAPE (строка = одно событие ставки), COLUMN_ABSENT (колонки нет, и это не роль профиля). Иной код не ставь. Подписчик не используется: из-за него отказ не ставь. Все роли профиля — is_buyer и is_seller. Массив profile.roles не нужен. dt_last_login на carl_an.users есть: последний вход, не отказ.
Схема:
{"metric":{"agg":"count|sum|avg|min|max|list","field":null},"grain":"auction|bid_profile|profile|user","mart":"carl_an.<отношение>","time":null,"dimensions":[],"filters":[{"column":"","op":"=","value":""}],"assumptions":[],"missing":[],"period_stated":false,"refusal":null,"params":{}}
list — выгрузка. При list поле metric.field пустое, кроме депозита: field = deposit_balance.
period_stated = true, если во фразе есть период. Тогда time обязателен и до ответа человека column пустой: dt_end сам не подставляй.
missing — только пустые или неоднозначные слоты из списка metric.agg, grain, mart, metric.field, time, id_profile, id_profile_seller, id_user, thresholds.
Лот из отчёта за период данным пользователем: mart v_lot_from_report_an, agg count, grain auction, фильтр id_user (пользователь лота) или id_user_inspector (автор отчёта), время dt_create. Номер пользователя из фразы не выдумывай: слот id_user в missing.
Номер профиля из фразы не выдумывай: слот id_profile в missing.
Продажа — status SUCCESS и BUYNOW, не FINISHED. Этот фильтр ставь только если во фразе есть продажа, продано, продали, купили, куплено или покупка. Экспозиция — длительность лота, не продажа: status не добавляй, одну дату в metric.field не пиши, разность дат не выдумывай.
Активные — status ACTIVE и is_deleted N. Только если во фразе есть «активные» или «текущие».
Депозит без слова «покупатели» — mart prof_total_an. Пороги в params: fl_min, fl_max, ip_min, ip_max.
Покупки и комиссия за всё время и за год: grain profile, agg list, dimensions включают id_profile_leader и applied_commission, time.all_time true, границы года в time.from и time.to, column пустой пока человек не назвал поле.`;

export function cardsText() {
  return CARDS;
}

export function buildParsePrompt(utterance) {
  const examples = FEW_SHOT.map((item, index) => `Пример ${index + 1}: ${item}`).join('\n');
  const today = new Date().toISOString().slice(0, 10);
  const clock = `Сегодня ${today}. Месяц без года считай в этом году.`;
  return [CARDS, RULES, SLOT_SCHEMA, clock, examples, `Фраза:\n${utterance}`].filter(Boolean).join('\n\n');
}

export function buildSqlPrompt(card, errors) {
  const retry = errors?.length ? `Прошлый SQL отклонён:\n${errors.join('\n')}\nИсправь.` : '';
  const from = card?.params?.exposure_from;
  const to = card?.params?.exposure_to;
  const span = from && to
    ? `Экспозиция: avg(${to} - ${from}). Одну дату не усредняй. status в WHERE пиши только если он есть в filters карточки.`
    : '';
  return [CARDS, RULES, 'Верни JSON {"sql":"..."} — один SELECT по подтверждённой карточке. Пояснений нет.', span, JSON.stringify(card), retry]
    .filter(Boolean)
    .join('\n\n');
}
