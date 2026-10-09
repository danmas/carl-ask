# carl-ask

Локальный контур аналитических вопросов к снимкам `carl_an`. Вопрос разбирается в слоты, код задаёт до трёх вопросов за раунд и не больше двух раундов, человек подтверждает карточку, после этого появляется текст SQL. В PostgreSQL уходит только этот принятый оператор и только по явному выполнению.

Страница `http://127.0.0.1:8787` только вызывает API и рисует тот же JSON.

## API

| Метод | Путь | Тело |
|---|---|---|
| POST | `/api/dialogues` | `{ "utterance": "..." }` |
| GET | `/api/dialogues/:id` | снимок |
| POST | `/api/dialogues/:id/answers` | `{ "values": { "time": { "column", "from", "to" } } }` |
| POST | `/api/dialogues/:id/confirm` | пусто. Базу не открывает |
| POST | `/api/dialogues/:id/reject` | `{ "text": "..." }` |
| GET | `/api/connections` | список без паролей |
| POST | `/api/dialogues/:id/execute` | `{ "connection": "wpl2" }` только в фазе `sql_ready` |

Слушает только `127.0.0.1`. Диалог живёт в памяти процесса.

## Коннекции и выполнение

Свой `config.json` (в git не входит, образец — `config.example.json`). Форма записи и пароль — как у carl-panel: `DATABASE_URL_<ИМЯ>`, иначе `"${VAR}"`, иначе `passwordEnv`, иначе `PG_PASSWORD_<ИМЯ>`. Для wpl2 в панели пароль лежит в `PG_PASSWORD_WPL-2`.

`optional: true` не открывает пул на старте. Коннекция с `requireWriteConfirm` видна в списке и не выполняется. `allowReadOnlyOverride` не действует.

Каждый прогон — транзакция `READ ONLY`, `statement_timeout` из `query.statementTimeoutMs` (15 с), не больше `query.maxRows` строк (500). Клиент эти пределы не поднимает. Если у записи `readOnly: true`, пул ещё стартует с `default_transaction_read_only=on`.

Ответ: `fields` в порядке драйвера, `rows` — массивы той же длины. Пустой результат всё равно отдаёт колонки. Ошибка запроса остаётся на снимке, фаза не сбрасывается.

В `logs/journal.json` пишутся имя коннекции, время, число строк, `truncated` и код ошибки. Строки результата и пароль туда не попадают. Панель по HTTP не вызывается.

## Модель

Разбор слотов и свободный SQL (если шаблон не подошёл) ходят в OpenAI-совместимый `POST /chat/completions`.

Значения лежат в `.env` (в git не входит):

- `CARL_ASK_MODEL_URL` — `https://api.selectel.ru/aig/v1`
- `CARL_ASK_MODEL_KEY`
- `CARL_ASK_MODEL_NAME` — `deepseek/deepseek-v4-flash-0731`
- `CARL_ASK_MODEL_TIMEOUT_MS` — таймаут вызова, по умолчанию 120000. Иначе 504

В тело запроса уходит `reasoning_effort: none`. Без этого deepseek-v4-flash на полном промпте карточек уходит в reasoning и не отвечает минутами. С флагом тот же промпт вернулся за ~5 с, `reasoning_tokens` = 0.

Без этих переменных `POST /api/dialogues` отвечает 503. Политика, карточка и семь шаблонов модели не требуют.

Few-shot пустой: все десять фраз только в прогоне, в промпт они не входят.

## Запуск

```bash
npm test
npm start
```

Сверка хешей колонок с живым wpl2 (не часть `npm test`):

```bash
set PGHOST=192.168.1.22
set PGPORT=5432
set PGUSER=carl
set PGDATABASE=carlinkng
set PGPASSWORD=...
npm run drift
```

Каталог колонок в `data/columns.json` снят с wpl2 2026-10-07. Числа эталона к этому снимку привязаны в OpenSpec и здесь не проверяются.

Каждый шаг диалога дописывается в `logs/journal.json`: вопрос, промпт, сырой ответ модели, ответы человека, карточка, SQL, ошибки контролёра. Ключ из `.env` в файл не пишется.
