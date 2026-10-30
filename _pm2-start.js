/**
 * Лончер для PM2.
 *
 * src/server.js открывает порт только когда он главный модуль
 * (`import.meta.url === pathToFileURL(process.argv[1]).href`). Под PM2 в fork-режиме
 * argv[1] — это ProcessContainerFork.js, поэтому main-гард не срабатывает и процесс
 * висит без слушателя. Здесь вызываем listen() явно.
 *
 * `npm start` по-прежнему запускает src/server.js напрямую — этот файл только для PM2.
 */
import { listen } from './src/server.js';

listen(Number(process.env.PORT || 8799));
