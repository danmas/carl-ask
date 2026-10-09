export const REFUSAL_TEXT = {
  MART_MISSING_TYPE_PARENT:
    'В снимке лотов нет родителя типа: строительная (150) и сельхоз (122) лежат под спецтехникой, а на `t_auct_total_an` есть только лист `object_type_name`. Легковые отличить можно. Запрос к оперативным `auction` / `auction_log` не строю.',
  COLUMN_ABSENT:
    'В снимке профилей нет массива `roles` (`carl_data.profile.roles`, enum `subscriber` / `buyer` / `seller`). Покупатель и продавец уже флаги `is_buyer` и `is_seller`. Подписчика на снимке нет. Брокера в enum нет. Последний вход есть: `carl_an.users.dt_last_login`, подставлять `dt_created` нельзя. SQL к `carl_data.profile` не строю.',
  NO_BID_TAPE:
    'В allowlist нет ленты ставок. `t_auct_bids_an` — одна строка на профиль и лот (`count`, `last_bid_value`, `last_bid_set`), это не отчёт по каждой ставке. SQL к `auction_log` не строю.',
};

export const REFUSAL_CODES = new Set(Object.keys(REFUSAL_TEXT));

export function knownRefusal(slots) {
  const raw = slots?.refusal;
  const code = typeof raw === 'string' ? raw : raw?.code;
  if (!code || !REFUSAL_CODES.has(code)) return null;
  return { code, text: REFUSAL_TEXT[code] };
}
