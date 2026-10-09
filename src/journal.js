import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function redact(event) {
  const key = process.env.CARL_ASK_MODEL_KEY;
  const json = JSON.stringify(event);
  if (!key) return JSON.parse(json);
  return JSON.parse(json.split(key).join('[redacted]'));
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
