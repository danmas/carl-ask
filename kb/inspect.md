# Карточка: отчёты и лоты из отчётов

Две вьюхи. На чтении функций нет. Это не ночной снимок: строки на момент запроса.

## `carl_an.v_lot_from_report_an`

Зерно: один лот, который создали из отчёта. Связь — `inspect_report.id_auction`, её пишет `createCarInspectAuction`.

Сюда не входят перевыставления и лоты, к которым отчёт привязали позже (`setLotInspectReport`): у них `inspect_key` лежит в `auction.parameters`, а `id_auction` отчёта не меняется.

| Колонка | Смысл |
|---------|--------|
| `id_user` | пользователь лота (`user_profile` аукциона). Это «кто сделал лот из отчёта» |
| `id_user_inspector` | автор отчёта. Другой человек |
| `dt_create` | когда создан лот. Период фразы «за период» режется по ней |
| `dt_report` | когда создан отчёт |
| `id_auction` | лот |
| `inspect_key` | `inspect_report.key` |
| `is_deleted` | удаление лота. В подсчёт удалённые входят, пока фильтр не попросили |
| `report_is_deleted` | удаление отчёта |

Вопрос «сколько лотов сделано из отчётов за период данным пользователем»: `count`, зерно лот, эта вьюха, фильтр `id_user`, время `dt_create`. Номер пользователя из фразы не выдумывать.

Соединения: с `users` по `id_user` или `id_user_inspector`; с `t_auct_total_an` по `id_auction`.

## `carl_an.v_inspect_report_an`

Зерно: один отчёт, включая те, из которых лот не делали.

`id_user` здесь автор отчёта. `id_auction` пустой, если лот из отчёта не создавали. `dt_create` — создание отчёта.

В выборку не класть `report`, `api_key`, `api_key_organ`, VIN.

Соединения: с `users` по `id_user`; с `t_auct_total_an` по `id_auction` или `key = inspect_key`; с `v_lot_from_report_an` по `key = inspect_key` или `id_auction`.
