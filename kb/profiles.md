# Карточка: профили

Три среза одной сборки. Не `v_prof_total_an`: view на строку зовёт `getprofsmartname2`, `hasrole`, `getprofparameterv`.

| Отношение | Кто попадает | Колонок | Хеш |
|-----------|----------------|---------|-----|
| `carl_an.prof_total_an` | все профили | 28 | `6672d8d16a91094e27c5b1d03281dadf` |
| `carl_an.prof_sel` | `is_seller OR (NOT is_buyer AND is_seller_wanted)` | 28 | тот же |
| `carl_an.prof_buy` | `is_buyer OR (NOT is_seller AND is_buyer_wanted)` | 30 | `0bd7dbeb3ed0c51b7929b79bbb5efc01` |

У `prof_buy` сверху две колонки, снятые при сборке: `ext_buyer_num`, `employer`.

Зерно каждой таблицы: одна строка = один `id_profile`.

## Свежесть

`analytics_table_refresh_log.job_name = 'update_prof_total_an'`. Три `target_table`: `prof_total_an`, `prof_sel`, `prof_buy`. Свежесть среза — `max(finished_at)` его строки. Дату из этой карточки не зашивать: на 2026-10-07 в журнале wpl2 последний прогон был 2026-09-24.

Функция пересоздаёт таблицы (`DROP` + `CREATE TABLE AS`). Читать можно, функций на чтении нет.

## Время

`dt_create` — регистрация профиля (`timestamptz`). «Зарегистрирован с сентября 2022 по январь 2023 включительно» = `dt_create >= 2022-09-01` и `dt_create < 2023-02-01`.

`dt_signe` — подписание, не регистрация и не последний визит.

## Статусы

На `prof_total_an` wpl2: `ok`, `draft`, `signed`. Это не статусы лота.

`is_deleted` — boolean. Живые: `is_deleted = false`. Не писать `= 'N'`.

## Роли и типы лиц

В оперативной базе роли торгового профиля — enum `carl_prof.en_role`, колонка `carl_data.profile.roles` (`en_role[]`). В одном профиле несколько сразу. Значения ровно три: `subscriber` (подписчик), `buyer` (покупатель), `seller` (продавец). Брокера в enum нет. `setRoles` для подписчика ничего не требует; покупателю нужен `id_prof_categ_buy`, продавцу — `id_prof_categ_sel`.

Снимок массив не копирует. `v_prof_total_an` зовёт `hasRole` / `haswantedrole` и кладёт флаги:

| Роль | На снимке | wanted |
|------|-----------|--------|
| `seller` | `is_seller` = `hasRole(..., 'seller') = 'Y'` | `is_seller_wanted` |
| `buyer` | `is_buyer` = `hasRole(..., 'buyer') = 'Y'` | `is_buyer_wanted` |
| `subscriber` | колонки нет | нет |

Вопрос про покупателя, продавца или «все роли профиля» закрывается флагами `is_buyer` и `is_seller`. Подписчик в работе не используется: из-за него отказ не ставить и колонку не заводить. Массив `roles` не читать. SQL к `carl_data.profile` не писать.

Флаги типа лица: `is_company`, `is_indiv`.

`is_company` и `is_indiv` на `prof_buy` не бывают истинны вместе.

Юрлицо / физлицо в срезе покупателей: `is_company` / `is_indiv`.

ИП в оперативной базе — `company.ownership_type = 'ИП'`. Этой колонки нет. Допущение, его показывать: `prof_categ_buy = 'Individual Entrepreneur'`. Это не доказанное равенство с `ownership_type`.

ФЛ как категория: `prof_categ_buy = 'Private customer'`. Не путать с одним только `is_indiv`.

На wpl2 2026-10-07:

| Срез | Individual Entrepreneur | Private customer |
|------|-------------------------|------------------|
| `prof_buy` | 1629 | 30327 |
| `prof_total_an` | 1990 | 33510 |

Фраза про ФЛ и ИП без слова «покупатели» идёт в `prof_total_an`. Слово «покупатели» переключает на `prof_buy`.

## Депозит

Допущение для слова «депозит»: `balance_reserv + balance_summ`. Не `reserv_comp` и не `reserv_indiv`.

Пороги ФЛ 40 000 и ИП 80 000 — два условия в одном `SELECT`, не два диалога. Границы строгие: больше 0 и меньше порога.

## Регион

`region` — текст региона профиля, не регион лота.

Дословные значения для трёх округов: `Тюменская область`, `Ханты-Мансийский автономный округ`, `Ямало-Ненецкий автономный округ`.

Если фраза не говорит, чей регион, слот пустой. Регион лота с этой карточки не брать.

## Имена и мусорная колонка

Отображаемое имя лежит в колонке `getprofsmartname2`. Это поле снимка, не вызов функции. `trade_name` — торговое имя. Оба в промпт не класть.

Колонка `?column?` — второй `hasrole(..., 'seller')` без алиаса. На всех 40657 строках `prof_total_an` она равна `is_seller`. В SQL её не использовать. `SELECT *` по этим таблицам не писать.

## Связи и запрет

К лоту: `id_profile` = `t_auct_total_an.id_profile_seller` или `id_profile_leader`. К ставке: `id_profile` = `t_auct_bids_an.id_profile_bid`. К пользователю: `id_user_owner = users.id_user`.

Выгрузка покупателей со ставками и покупками по номерам продавцов читает три таблицы: `prof_buy`, `t_auct_bids_an`, `t_auct_total_an`. Другие тройки нельзя.

`prof_buy` не соединять с `prof_sel`. По формулам один профиль может попасть в оба среза. На текущем снимке пересечение 0 и `is_seller AND is_buyer` в `prof_total_an` тоже 0. Запрет всё равно действует. Все профили без разреза ролей — `prof_total_an`.

Складывать `count(*)` двух срезов нельзя.
