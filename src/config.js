export function queryLimits(raw = {}) {
  const query = raw.query || {};
  return {
    statementTimeoutMs: timeoutMs(query.statementTimeoutMs),
    maxRows: rowCap(query.maxRows),
  };
}

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

export function resolveConnections(raw = {}, env = process.env) {
  const map = new Map();
  for (const [name, cfg] of Object.entries(raw.connections || {})) {
    map.set(name, resolveOne(name, cfg || {}, env));
  }
  return map;
}

function resolveOne(name, cfg, env) {
  const meta = {
    optional: !!cfg.optional,
    readOnly: !!cfg.readOnly,
    allowReadOnlyOverride: !!cfg.allowReadOnlyOverride,
    requireWriteConfirm: !!cfg.requireWriteConfirm,
    tunnelPort: cfg.tunnelPort || null,
    usePool: cfg.usePool ?? true,
    maxPoolSize: cfg.maxPoolSize || 10,
    idleTimeoutMillis: cfg.idleTimeoutMillis,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis,
  };
  const url = env[`DATABASE_URL_${name.toUpperCase()}`];
  if (url) return { ...meta, connectionString: url };
  return {
    ...meta,
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: resolvePassword(name, cfg, env),
  };
}

function resolvePassword(name, cfg, env) {
  const raw = cfg.password;
  if (typeof raw === 'string') {
    const match = raw.match(/^\$\{(.+)\}$/);
    if (match && env[match[1].trim()] !== undefined) return env[match[1].trim()];
  }
  const envKey = cfg.passwordEnv || `PG_PASSWORD_${name.toUpperCase()}`;
  if (env[envKey] !== undefined) return env[envKey];
  return raw;
}

export function connectionInfo(cfg = {}) {
  if (cfg.connectionString) {
    try {
      const url = new URL(cfg.connectionString);
      const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
      return `${url.hostname}:${url.port || '5432'}/${database}`;
    } catch {
      return '?:?/?';
    }
  }
  return `${cfg.host || '?'}:${cfg.port || '?'}/${cfg.database || '?'}`;
}

export function publicConnection(name, cfg) {
  let host = cfg.host ?? null;
  let port = cfg.port ?? null;
  let database = cfg.database ?? null;
  let user = cfg.user ?? null;
  if (cfg.connectionString) {
    try {
      const url = new URL(cfg.connectionString);
      host = url.hostname;
      port = Number(url.port || 5432);
      database = decodeURIComponent(url.pathname.replace(/^\//, ''));
      user = decodeURIComponent(url.username || '') || null;
    } catch {
      host = null;
      port = null;
      database = null;
      user = null;
    }
  }
  return {
    name,
    host,
    port,
    database,
    user,
    optional: !!cfg.optional,
    readOnly: !!cfg.readOnly,
    requireWriteConfirm: !!cfg.requireWriteConfirm,
    executable: !cfg.requireWriteConfirm,
  };
}

export function poolOptions(cfg) {
  const options = {
    max: cfg.maxPoolSize || 10,
    idleTimeoutMillis: cfg.idleTimeoutMillis ?? 10000,
    connectionTimeoutMillis: cfg.connectionTimeoutMillis ?? 10000,
  };
  if (cfg.connectionString) options.connectionString = cfg.connectionString;
  else {
    options.host = cfg.host;
    options.port = cfg.port;
    options.database = cfg.database;
    options.user = cfg.user;
    options.password = cfg.password;
  }
  if (cfg.readOnly) options.options = '-c default_transaction_read_only=on';
  return options;
}
