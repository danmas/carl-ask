# Allowlist v1 — снимок 2026-10-07

Каталог колонок снят с **wpl2** (`192.168.1.22`, `carlinkng`). w2 для этих витрин не оракул: объекты либо отсутствуют, либо другой формы.

Хеш: `md5` строки `column_name|data_type|ordinal_position` через запятую, порядок по `ordinal_position`. `data_type` из `information_schema` (`USER-DEFINED` для enum, не имя типа).

## Разрешено

| Отношение | На wpl2 | Колонок | Хеш | Зерно |
|-----------|---------|---------|-----|-------|
| `carl_an.t_auct_total_an` | table, est ~350k | 94 | `648f27a0f79ed0a3205b035213bc870a` | лот |
| `carl_an.t_auct_bids_an` | table, est ~812k | 8 | `cae6e54af58b89e2e82b79196b318dd8` | профиль на лоте |
| `carl_an.prof_total_an` | table, est ~41k | 28 | `6672d8d16a91094e27c5b1d03281dadf` | профиль, все |
| `carl_an.prof_sel` | table, est ~2.0k | 28 | `6672d8d16a91094e27c5b1d03281dadf` | профиль-продавец |
| `carl_an.prof_buy` | table, est ~35k | 30 | `0bd7dbeb3ed0c51b7929b79bbb5efc01` | профиль-покупатель |
| `carl_an.users` | table, est ~177k | 14 | `8db785f91b1d81380ee7a0682c62a2e4` | пользователь |
| `carl_an.v_inspect_report_an` | view, объявлена в `GROK_v_inspect_an.sql`, на wpl2 ещё не сверена | 16 | `6de9c30ff1b9f1007d0a5f1ca289f33e` | отчёт |
| `carl_an.v_lot_from_report_an` | view, объявлена в `GROK_v_inspect_an.sql`, на wpl2 ещё не сверена | 12 | `b296de5576881106150cf53758f6dd45` | лот из отчёта |

Это таблицы-снимки. `update_prof_total_an` пересобирает три профильные, `update_users_an` — пользователей. На чтении функций нет.

`prof_sel`: `is_seller OR (NOT is_buyer AND is_seller_wanted)`. `prof_buy`: `is_buyer OR (NOT is_seller AND is_buyer_wanted)`. По этим формулам профиль может попасть в обе таблицы. На снимке wpl2 пересечение `prof_buy` и `prof_sel` равно 0, и `is_seller AND is_buyer` в `prof_total_an` тоже 0. Соединять `prof_buy` с `prof_sel` всё равно нельзя. Все профили — `prof_total_an`.

Связи, единственные разрешённые соединения (ровно две таблицы):

| Левая | Правая | Ключ |
|-------|--------|------|
| `t_auct_total_an` | `t_auct_bids_an` | `id_auction = id_auction` |
| `t_auct_total_an` | `prof_total_an` / `prof_sel` / `prof_buy` | `id_profile_seller = id_profile` или `id_profile_leader = id_profile` |
| `t_auct_bids_an` | `prof_*` | `id_profile_bid = id_profile` |
| `t_auct_bids_an` | `users` | `id_user_bid = id_user` |
| `prof_*` | `users` | `id_user_owner = id_user` |
| `v_lot_from_report_an` | `users` | `id_user = id_user` или `id_user_inspector = id_user` |
| `v_lot_from_report_an` | `t_auct_total_an` | `id_auction = id_auction` |
| `v_inspect_report_an` | `users` | `id_user = id_user` |
| `v_inspect_report_an` | `t_auct_total_an` | `id_auction = id_auction` или `key = inspect_key` |
| `v_inspect_report_an` | `v_lot_from_report_an` | `key = inspect_key` или `id_auction = id_auction` |

На wpl2 в `t_auct_bids_an` 350042 различных `id_auction`, и все они есть в `t_auct_total_an`. Со стороны ставок это много строк на один лот. Фраза 8 это соединение не требует: продавец и лидер лежат в `t_auct_total_an`. Фраза 7 требует, если нужен фильтр продавца.

## Запрещено

| Отношение | Почему |
|-----------|--------|
| `carl_an.v_auct_total_an` | view зовёт `getauctobjattrib` и соседние функции на строку. На wpl2 это подтверждено |
| `carl_an.v_auct_bids_an` | view зовёт `getusersmartname` и `getprofsmartname2` |
| `carl_an.auct_total_an` | на wpl2 это явная проекция `t_auct_total_an` без функций (тот же хеш 94 колонок). На w2 это **другая таблица**: 77 колонок, хеш `379d0000b9442ea68cba7148be3b6556`, 15181 строк, `dt_change_status` до 2023-10-18. Одно имя — два объекта |
| `carl_an.auct_bids_an` | на wpl2 view из 7 колонок над `t_auct_bids_an` и **без** `last_bid_value`. Хеш `2c83fab3ea1f625fe238035261e9e621` |
| `carl_an.v_prof_total_an` | view зовёт `getprofsmartname2`, `hasrole`, `getprofparameterv` на строку. Снимок уже в `prof_*` |
| `amo_data`, `amo_json`, `tmp_*` | не v1 |

## w2, чтобы не перепутать

| Отношение | Факт |
|-----------|------|
| `t_auct_total_an` | table, 17910 строк, `dt_change_status` до 2024-12-24, 77 колонок. Нет 18 колонок, которые на wpl2 есть (`resale_num`, `resale_num_total`, комиссия, `expert_cert`, …) |
| `auct_total_an` | table, не view. 15181 строк, данные до 2023-10-18 |
| `t_auct_bids_an`, `auct_bids_an`, `v_auct_bids_an`, `users` | отношений нет |
| `prof_buy`, `prof_sel`, `prof_total_an` | есть, но 27 колонок и общий хеш `861c6d0b661775fb7451936229be9f9d`. На wpl2 у `prof_buy` 30 колонок, у двух других 28 |

Статусы на w2 `t_auct_total_an` (не распределение wpl2): `FAILED`, `MODERATED`, `DRAFT`, `ACTIVE`, `SUCCESS`, `BUYNOW`, `FINISHED`, `CANCELED`.

## `t_auct_bids_an` (wpl2)

| # | Колонка | data_type |
|---|---------|-----------|
| 1 | `id_auction` | integer |
| 2 | `count` | bigint |
| 3 | `id_user_bid` | integer |
| 4 | `id_profile_bid` | integer |
| 5 | `user_bid` | text |
| 6 | `profile_bid` | text |
| 7 | `last_bid_set` | timestamp with time zone |
| 8 | `last_bid_value` | integer |

`user_bid` и `profile_bid` — имена. В промпт выборки не класть.

## `t_auct_total_an` (wpl2)

`dt_set_lead` — `timestamp without time zone`. Остальные даты снимка — `timestamp with time zone`. `period` — text. `status` — `en_auction_status`, `auction_type` — `en_auction_type`.

В промпт не класть значения `vin`, `reg_num`, `seller_name`, `leader_name`, `source_url`, `parameters`, `tariff_rules`.

| # | Колонка | data_type |
|---|---------|-----------|
| 1 | mark | character varying |
| 2 | model | character varying |
| 3 | modification | character varying |
| 4 | vin | character varying |
| 5 | reg_num | character varying |
| 6 | year | character varying |
| 7 | mileage | character varying |
| 8 | volume | character varying |
| 9 | engine | character varying |
| 10 | power_hp | character varying |
| 11 | drive_train | character varying |
| 12 | transmission | character varying |
| 13 | location | character varying |
| 14 | body_type | character varying |
| 15 | vat | character varying |
| 16 | total | character varying |
| 17 | object_type_name | character varying |
| 18 | object_type_top_name | text |
| 19 | auct_dealer_code | character varying |
| 20 | auct_dealer_name | character varying |
| 21 | leader_dealer_code | character varying |
| 22 | leader_dealer_name | character varying |
| 23 | pay_delay | integer |
| 24 | id_profile_seller | integer |
| 25 | summa_lead | integer |
| 26 | dt_set_lead | timestamp without time zone |
| 27 | id_profile_leader | integer |
| 28 | leader_name | text |
| 29 | inspect_key | bigint |
| 30 | leader_city | character varying |
| 31 | seller_id_company | integer |
| 32 | maxpost_avg_price | integer |
| 33 | bid_profiles | bigint |
| 34 | period | text |
| 35 | id_comp_buyers | character varying |
| 36 | id_commission | integer |
| 37 | commission_name | character varying |
| 38 | id_commission_details | integer |
| 39 | wcb | numeric |
| 40 | wcb_name | character varying |
| 41 | subcase | character varying |
| 42 | tariff_code | character varying |
| 43 | commission_dt_start | timestamp with time zone |
| 44 | commission_dt_end | timestamp with time zone |
| 45 | commission_min | double precision |
| 46 | commission_max | double precision |
| 47 | commission_cb_min | double precision |
| 48 | commission_cb_max | double precision |
| 49 | commission_percent | double precision |
| 50 | commission_fix | double precision |
| 51 | expert_cert | character varying |
| 52 | resale_num | integer |
| 53 | resale_num_total | bigint |
| 54 | id_auction | integer |
| 55 | id_user_profile | integer |
| 56 | id_object | integer |
| 57 | auction_type | USER-DEFINED |
| 58 | status | USER-DEFINED |
| 59 | dt_start | timestamp with time zone |
| 60 | dt_end | timestamp with time zone |
| 61 | buy_now | integer |
| 62 | min_price | integer |
| 63 | start_price | integer |
| 64 | step | integer |
| 65 | is_deleted | character |
| 66 | is_parsed | character varying |
| 67 | n_views | integer |
| 68 | source_url | character varying |
| 69 | seller_name | character varying |
| 70 | reserv_comp | integer |
| 71 | id_workflow | character varying |
| 72 | workflow_status | character varying |
| 73 | is_archive | boolean |
| 74 | approve_days | integer |
| 75 | parameters | jsonb |
| 76 | sort_priority | integer |
| 77 | bid_count | integer |
| 78 | reserv_indiv | integer |
| 79 | bid_locked_by | integer |
| 80 | locked_by | integer |
| 81 | dt_approve | timestamp with time zone |
| 82 | dt_change_status | timestamp with time zone |
| 83 | id_prof_dealer_code | integer |
| 84 | id_queue | integer |
| 85 | dt_create | timestamp with time zone |
| 86 | hidden | boolean |
| 87 | dt_active | timestamp with time zone |
| 88 | amo_status_lead | character varying |
| 89 | amo_status_sell | character varying |
| 90 | amo_status_lead_bro | character varying |
| 91 | applied_commission | integer |
| 92 | tariff_rules | jsonb |
| 93 | menu_parent_object_type | integer |
| 94 | who_can_buy | numeric |

## `users` (wpl2)

Снимок `carl_data.users` плюс `target_url`. На w2 таблицы нет. `phone`, `email`, `name`, `first_name`, `middle_name`, `last_name` в выборки для промпта не попадают. `dt_created` и `dt_last_login` — `timestamp without time zone`.

| # | Колонка | data_type |
|---|---------|-----------|
| 1 | id_user | integer |
| 2 | name | character varying |
| 3 | phone | character varying |
| 4 | email | character varying |
| 5 | first_name | character varying |
| 6 | middle_name | character varying |
| 7 | last_name | character varying |
| 8 | status | USER-DEFINED |
| 9 | target_url | character varying |
| 10 | dt_created | timestamp without time zone |
| 11 | dt_last_login | timestamp without time zone |
| 12 | is_deleted | character varying |
| 13 | is_blocked | character varying |
| 14 | reg_domain | character varying |

## `prof_total_an` и `prof_sel` (wpl2)

Один и тот же набор колонок. `prof_sel` — срез продавцов. `is_seller` / `is_buyer` — это `hasRole` для `seller` / `buyer`. `subscriber` и массив `carl_data.profile.roles` сюда не копируются. Брокера в `carl_prof.en_role` нет. Имя `getprofsmartname2` — это колонка снимка, не вызов функции при чтении. Колонка `?column?` — второй `hasrole(..., 'seller')` без алиаса. На wpl2 по всем 40657 строкам `prof_total_an` она совпадает с `is_seller`. В SQL её не использовать, `SELECT *` по этим снимкам не писать. `users` содержит `phone` и `email`: выборки этой таблицы в промпт не класть.

`trade_name` и `getprofsmartname2` в выборки для промпта не попадают.

| # | Колонка | data_type |
|---|---------|-----------|
| 1 | id_profile | integer |
| 2 | getprofsmartname2 | text |
| 3 | is_seller | boolean |
| 4 | is_seller_wanted | boolean |
| 5 | is_buyer | boolean |
| 6 | is_buyer_wanted | boolean |
| 7 | ?column? | boolean |
| 8 | is_company | boolean |
| 9 | is_indiv | boolean |
| 10 | dkptype_fl | character varying |
| 11 | dkptype | character varying |
| 12 | is_deleted | boolean |
| 13 | status | USER-DEFINED |
| 14 | reserv_comp | integer |
| 15 | reserv_indiv | integer |
| 16 | balance_reserv | integer |
| 17 | balance_summ | integer |
| 18 | prof_categ_buy | character varying |
| 19 | prof_categ_sel | character varying |
| 20 | who_can_buy | numeric |
| 21 | who_can_buy_str | character varying |
| 22 | dt_create | timestamp with time zone |
| 23 | dt_signe | timestamp with time zone |
| 24 | region | character varying |
| 25 | log_domain | character varying |
| 26 | trade_name | character varying |
| 27 | is_vip | character varying |
| 28 | id_user_owner | integer |

## `prof_buy` (wpl2)

Те же 28 колонок и ещё две, снятые при пересборке через `getProfParameterV`:

| # | Колонка | data_type |
|---|---------|-----------|
| 29 | ext_buyer_num | character varying |
| 30 | employer | character varying |
