import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function redact(event) {
  const key = process.env.CARL_ASK_MODEL_KEY;
  const json = JSON.stringify(event);
  if (!key) return JSON.parse(json);
  return JSON.parse(json.split(key).join('[redacted]'));
}

export function readJournal(dir) {
  const file = join(dir, 'journal.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function eventDetail(row) {
  if (row.event === 'execute') {
    const problem = row.error_message || (row.error ? String(row.error) : '');
    const rows = row.rowCount == null ? '' : `${row.rowCount} строк`;
    return [row.connection, problem || rows].filter(Boolean).join(': ');
  }
  if (row.event === 'confirm_blocked' || row.event === 'model_error' || row.event === 'http_error') return row.message || '';
  if (row.event === 'reject') return row.rejection || '';
  if (row.event === 'confirm' && row.validator && row.validator.ok === false) return (row.validator.errors || []).join('; ');
  return '';
}

function executionOf(snapshot) {
  const exec = snapshot?.execution;
  if (!exec || typeof exec !== 'object') return null;
  const code = typeof exec.error === 'string' ? exec.error : exec.error?.code || null;
  return {
    connection: exec.connection || null,
    rowCount: exec.rowCount ?? null,
    elapsedMs: exec.elapsedMs ?? null,
    truncated: exec.truncated === true,
    error: code,
    error_message: exec.error_message || exec.error?.message || null,
  };
}

export function presentJournal(rows) {
  const groups = new Map();
  const ensure = (id) => {
    if (!groups.has(id)) {
      groups.set(id, { id, at: null, utterance: null, events: [], snapshot: null });
    }
    return groups.get(id);
  };
  for (const row of rows || []) {
    let id = row.dialogue_id || null;
    if (!id && row.event === 'http_error') {
      const found = String(row.path || '').match(/\/api\/dialogues\/([^/]+)/);
      if (found) id = decodeURIComponent(found[1]);
    }
    if (!id) id = `event:${row.at}:${groups.size}`;
    const item = ensure(id);
    item.at = row.at || item.at;
    if (row.utterance && !item.utterance) item.utterance = row.utterance;
    if (row.snapshot) item.snapshot = row.snapshot;
    item.events.push({ at: row.at || null, event: row.event, detail: eventDetail(row) });
  }
  const dialogues = [...groups.values()].map((item) => {
    const snapshot = item.snapshot || {};
    const refusal = snapshot.refusal && typeof snapshot.refusal === 'object' ? snapshot.refusal : null;
    return {
      id: item.id,
      at: item.at,
      utterance: snapshot.utterance || item.utterance || '',
      phase: snapshot.phase || (String(item.id).startsWith('event:') ? 'failed' : null),
      parent_id: snapshot.parent_id || null,
      context: snapshot.context ? { utterance: snapshot.context.utterance || '', reading: snapshot.context.reading || '' } : null,
      turns: snapshot.turns || [],
      questions: snapshot.questions || [],
      reading: snapshot.reading || '',
      plain: snapshot.card?.plain || '',
      assumptions: snapshot.assumptions || [],
      inherited: snapshot.inherited || [],
      refusal: refusal ? { code: refusal.code || null, text: refusal.text || '' } : null,
      block: snapshot.block || null,
      sql: snapshot.sql || null,
      validator_errors: snapshot.validator_errors || [],
      execution: executionOf(snapshot),
      events: item.events,
    };
  });
  dialogues.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return dialogues;
}

export function fileJournal(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'journal.json');
  return (event) => {
    let rows = [];
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) rows = parsed;
      } catch {
        rows = [];
      }
    }
    rows.push(redact({ at: new Date().toISOString(), ...event }));
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows, null, 2));
    copyFileSync(tmp, file);
    unlinkSync(tmp);
  };
}
