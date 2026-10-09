# Карточка: ставки

Отношение: `carl_an.t_auct_bids_an`. Не `v_auct_bids_an` (зовёт `getusersmartname` и `getprofsmartname2`). Не `auct_bids_an`: там 7 колонок и нет `last_bid_value`.

Каталог: `allowlist.md`, хеш `cae6e54af58b89e2e82b79196b318dd8`, 8 колонок.

## Зерно

Одна строка = один профиль на одном лоте, не одна ставка.

Колонки: `id_auction`, `count`, `id_user_bid`, `id_profile_bid`, `user_bid`, `profile_bid`, `last_bid_set`, `last_bid_value`.

Колонки `id_profile` нет. Профиль — `id_profile_bid`. Пользователь — `id_user_bid`. Слово «профиля» без уточнения значит `id_profile_bid`.

## Чем снимок не лента

`count` — число событий `AUTO_BID`, `MAKE_BID`, `BUYNOW` этого профиля на этом лоте. `SET_PROXY` сюда не входит. Времени каждого события нет.

`last_bid_value` — сумма последней ставки этого профиля, в том числе если он не победил. Для `BUYNOW` в сборке брался `buynow_price`. Это не ставка лидера лота и не `summa_lead` с карточки лотов.

`last_bid_set` — время этой последней ставки (`timestamptz`).

Отчёт «каждая ставка, автоставка, статус, дата» из этого снимка не строится. Код отказа `NO_BID_TAPE`. SQL к `auction_log` не писать. Это не замена фразой «количество ставок».

`user_bid` и `profile_bid` — имена. В промпт их значения не класть.

## Свежесть

Таблица пересобирается тем же `prepare_update_auct_total_an`, что и лоты. В `analytics_table_refresh_log` строки для `t_auct_bids_an` нет.

## Связи

- к лоту: `id_auction = t_auct_total_an.id_auction`. Нужно, чтобы отфильтровать продавца (`id_profile_seller`), тип или статус лота. Много строк ставок на один лот
- к профилю: `id_profile_bid = prof_*.id_profile`
- к пользователю: `id_user_bid = users.id_user`

В запросе не больше двух таблиц. Исключение — выгрузка покупателей со ставками и покупками по номерам продавцов: к этой ленте добавляются `prof_buy` и `t_auct_total_an`.

## Синонимы и допустимые допущения

| Слово | Допущение |
|-------|-----------|
| количество ставок профиля за период | `sum(count)` по `id_profile_bid`. Время периода — `last_bid_set`, не время каждой ставки и не `dt_start` лота. В карточке прямо сказать: без `SET_PROXY` |
| последняя ставка, на чём остановился | `last_bid_value` этой строки, включая не победивших |
| выигрышная ставка, ставка победителя по сумме | лот: `summa_lead` и `id_profile_leader` на `t_auct_total_an`. Не `max(last_bid_value)` |
| сколько ставок сделал победитель | `sum(count)` на этой таблице, где `id_profile_bid` равен `id_profile_leader` того же `id_auction` на `t_auct_total_an`. Это соединение двух таблиц, не `summa_lead` |

Какой профиль и какие границы периода — пустые слоты. Номер профиля из фразы не выдумывать.
