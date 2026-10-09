import { connectionInfo, poolOptions, publicConnection, queryLimits, resolveConnections } from './config.js';
import { runReadOnly } from './query.js';

async function defaultConnect(cfg) {
  const pg = await import('pg');
  const lib = pg.Pool ? pg : pg.default;
  const options = poolOptions(cfg);
  if (cfg.usePool === false) {
    const client = new lib.Client(options);
    await client.connect();
    return {
      async connect() { return client; },
      async end() { await client.end(); },
    };
  }
  const pool = new lib.Pool(options);
  pool.on('error', () => {});
  return pool;
}

export function createConnectionSet(raw = {}, env = process.env, deps = {}) {
  const configs = resolveConnections(raw, env);
  const limits = queryLimits(raw);
  const pools = new Map();
  const connect = deps.connect || defaultConnect;

  return {
    limits,
    poolNames() {
      return [...pools.keys()];
    },
    list() {
      return {
        connections: [...configs.entries()].map(([name, cfg]) => publicConnection(name, cfg)),
        query: limits,
      };
    },
    executable(name) {
      const cfg = configs.get(name);
      return Boolean(cfg) && !cfg.requireWriteConfirm;
    },
    secrets(name) {
      const cfg = configs.get(name);
      if (!cfg) return [];
      return [cfg.password, cfg.connectionString].filter((item) => typeof item === 'string' && item.length > 0);
    },
    info(name) {
      const cfg = configs.get(name);
      return cfg ? connectionInfo(cfg) : null;
    },
    async run(name, sql) {
      const cfg = configs.get(name);
      if (!cfg || cfg.requireWriteConfirm) {
        const error = new Error(`Коннекция «${name}» не исполняема`);
        error.code = 'CONNECTION';
        throw error;
      }
      if (!pools.has(name)) pools.set(name, await connect(cfg));
      const pool = pools.get(name);
      const client = await pool.connect();
      const started = performance.now();
      try {
        const result = await runReadOnly(client, sql, limits);
        return {
          ...result,
          elapsedMs: Math.round(performance.now() - started),
          connection: name,
          connectionInfo: connectionInfo(cfg),
          error: null,
        };
      } catch (error) {
        error.elapsedMs = Math.round(performance.now() - started);
        throw error;
      } finally {
        if (typeof client.release === 'function') client.release();
      }
    },
  };
}
