import './env.js';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConnectionSet } from './connections.js';
import { createStore } from './dialogue.js';
import { fileJournal, presentJournal, readJournal } from './journal.js';
import { createModelParser } from './model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = join(root, 'public', 'index.html');
const corpusFile = join(root, 'data', 'corpus.json');
const verifiedFile = join(root, 'data', 'corpus-verified.json');
const logsDir = join(root, 'logs');
const journal = fileJournal(logsDir);
const configFile = join(root, 'config.json');

function loadConnections() {
  if (!existsSync(configFile)) return createConnectionSet();
  return createConnectionSet(JSON.parse(readFileSync(configFile, 'utf8')));
}

function readVerified() {
  if (!existsSync(verifiedFile)) return {};
  const parsed = JSON.parse(readFileSync(verifiedFile, 'utf8'));
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('тело слишком большое'), { code: 'BODY' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON не разобран'), { code: 'JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createApp(store = createStore(createModelParser(), journal), deps = {}) {
  const connections = deps.connections || loadConnections();
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dev' || url.pathname === '/user')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        createReadStream(page).pipe(res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/connections') {
        send(res, 200, connections.list());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/journal') {
        send(res, 200, { dialogues: presentJournal(readJournal(logsDir)) });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/corpus') {
        const items = JSON.parse(readFileSync(corpusFile, 'utf8'));
        send(res, 200, { items, verified: readVerified() });
        return;
      }
      const verifiedMatch = url.pathname.match(/^\/api\/corpus\/(\d+)\/verified$/);
      if (verifiedMatch && req.method === 'POST') {
        const body = await readBody(req);
        const map = readVerified();
        map[verifiedMatch[1]] = body.verified === true;
        writeFileSync(verifiedFile, `${JSON.stringify(map, null, 2)}\n`);
        send(res, 200, { id: Number(verifiedMatch[1]), verified: map[verifiedMatch[1]] });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/dialogues') {
        const body = await readBody(req);
        if (!body.utterance || typeof body.utterance !== 'string') {
          send(res, 400, { error: 'нужна строка utterance' });
          return;
        }
        const parentId = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null;
        send(res, 201, await store.open(body.utterance, { reasoning: body.reasoning === true, parentId }));
        return;
      }
      const match = url.pathname.match(/^\/api\/dialogues\/([^/]+)(?:\/(answers|confirm|reject|execute))?$/);
      if (!match) {
        send(res, 404, { error: 'нет такого метода' });
        return;
      }
      const id = decodeURIComponent(match[1]);
      const action = match[2] || '';
      if (req.method === 'GET' && !action) {
        const found = store.get(id);
        send(res, found ? 200 : 404, found || { error: 'диалог не найден' });
        return;
      }
      if (req.method === 'POST' && action === 'answers') {
        const body = await readBody(req);
        send(res, 200, store.answer(id, body.values || body));
        return;
      }
      if (req.method === 'POST' && action === 'confirm') {
        send(res, 200, await store.confirm(id));
        return;
      }
      if (req.method === 'POST' && action === 'execute') {
        const body = await readBody(req);
        const executed = await store.execute(id, body, connections);
        send(res, executed ? 200 : 404, executed || { error: 'диалог не найден' });
        return;
      }
      if (req.method === 'POST' && action === 'reject') {
        const body = await readBody(req);
        if (!body.text) {
          send(res, 400, { error: 'нужен текст отказа' });
          return;
        }
        send(res, 200, await store.reject(id, body.text));
        return;
      }
      send(res, 404, { error: 'нет такого метода' });
    } catch (error) {
      journal({ event: 'http_error', path: url.pathname, message: error.message, code: error.code || null });
      const status = error.code === 'MODEL_UNSET' ? 503 : error.code === 'MODEL_TIMEOUT' ? 504 : error.code === 'PHASE' || error.code === 'PARENT_STATE' ? 409 : error.code === 'PARENT' ? 404 : 400;
      send(res, status, { error: error.message });
    }
  });
}

export function listen(port = Number(process.env.PORT || 8799)) {
  const server = createApp();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`порт ${port} занят. Останови предыдущий carl-ask и запусти снова.`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`carl-ask http://127.0.0.1:${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  listen(Number(process.env.PORT || 8799));
}
