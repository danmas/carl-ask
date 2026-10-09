function timeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return 15000;
  return Math.floor(n);
}

function rowCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 500;
  return Math.floor(n);
}

function statementForCursor(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '');
}

export function scrubText(value, secrets = []) {
  if (value == null) return value;
  let text = String(value);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) text = text.split(secret).join('[redacted]');
  }
  return text;
}

export function scrubError(error, secrets = []) {
  return {
    message: scrubText(error?.message || 'ошибка запроса', secrets),
    code: error?.code || null,
    detail: error?.detail ? scrubText(error.detail, secrets) : null,
    hint: error?.hint ? scrubText(error.hint, secrets) : null,
    position: error?.position ?? null,
  };
}

export async function runReadOnly(client, sql, limits = {}) {
  const statementTimeoutMs = timeoutMs(limits.statementTimeoutMs);
  const maxRows = rowCap(limits.maxRows);
  let opened = false;
  try {
    await client.query('BEGIN READ ONLY');
    opened = true;
    await client.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(statementTimeoutMs)]);
    await client.query(`DECLARE carl_ask_cursor NO SCROLL CURSOR FOR ${statementForCursor(sql)}`);
    const fetched = await client.query({
      text: `FETCH ${maxRows + 1} FROM carl_ask_cursor`,
      rowMode: 'array',
    });
    const fields = (fetched.fields || []).map((field) => ({
      name: field.name,
      dataTypeID: field.dataTypeID ?? null,
    }));
    const source = fetched.rows || [];
    const truncated = source.length > maxRows;
    const rows = source.slice(0, maxRows).map((row) => fields.map((_, index) => {
      if (Array.isArray(row)) return index < row.length ? row[index] : null;
      return null;
    }));
    await client.query('COMMIT');
    opened = false;
    return { fields, rows, rowCount: rows.length, truncated };
  } catch (error) {
    if (opened) {
      try { await client.query('ROLLBACK'); } catch { /* соединение уже умерло */ }
    }
    throw error;
  }
}
