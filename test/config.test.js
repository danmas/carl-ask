import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionInfo, poolOptions, publicConnection, resolveConnections } from '../src/config.js';
import { createConnectionSet } from '../src/connections.js';

test('placeholder, passwordEnv and PG_PASSWORD_ resolve in that order', () => {
  const map = resolveConnections({
    connections: {
      wpl2: { host: '192.168.1.22', port: 5432, database: 'carlinkng', user: 'carl', password: '${PG_PASSWORD_WPL-2}' },
      custom: { password: 'literal', passwordEnv: 'CUSTOM_SECRET' },
      w2: { host: '192.168.1.12', port: 5432, database: 'carlinkng', user: 'carl' },
      plain: { password: 'kept' },
    },
  }, {
    'PG_PASSWORD_WPL-2': 'from-placeholder',
    CUSTOM_SECRET: 'from-env-name',
    PG_PASSWORD_W2: 'from-convention',
  });
  assert.equal(map.get('wpl2').password, 'from-placeholder');
  assert.equal(map.get('custom').password, 'from-env-name');
  assert.equal(map.get('w2').password, 'from-convention');
  assert.equal(map.get('plain').password, 'kept');
});

test('DATABASE_URL replaces host and the public list has no secret', () => {
  const map = resolveConnections({
    connections: {
      wpl2: {
        host: 'json-host',
        port: 1,
        database: 'json-db',
        user: 'json-user',
        password: '${PG_PASSWORD_WPL-2}',
      },
    },
  }, {
    DATABASE_URL_WPL2: 'postgresql://real:s3cret@db.example:5432/carlinkng',
    'PG_PASSWORD_WPL-2': 'from-placeholder',
  });
  const cfg = map.get('wpl2');
  assert.equal(cfg.connectionString, 'postgresql://real:s3cret@db.example:5432/carlinkng');
  assert.equal(cfg.host, undefined);
  assert.equal(connectionInfo(cfg), 'db.example:5432/carlinkng');
  const listed = publicConnection('wpl2', cfg);
  assert.equal(listed.host, 'db.example');
  assert.equal(listed.user, 'real');
  assert.equal(JSON.stringify(listed).includes('s3cret'), false);
});

test('read-only pool option is fixed and override is ignored', () => {
  const options = poolOptions({
    host: '127.0.0.1',
    port: 5432,
    database: 'carlinkng',
    user: 'carl',
    password: 'secret',
    readOnly: true,
    allowReadOnlyOverride: true,
  });
  assert.equal(options.options, '-c default_transaction_read_only=on');
  assert.equal(Object.hasOwn(options, 'allowReadOnlyOverride'), false);
});

test('optional connection is not opened until it is executed', async () => {
  const seen = [];
  const set = createConnectionSet({
    connections: {
      w2: { host: 'w2-host', port: 5432, database: 'carlinkng', user: 'carl', password: 'a' },
      supabase: { host: 'cloud', port: 5432, database: 'postgres', user: 'carl', password: 'b', optional: true },
    },
  }, {}, {
    async connect(cfg) {
      seen.push(cfg.host);
      return {
        async connect() {
          return {
            async query(arg) {
              if (typeof arg === 'object') return { fields: [{ name: 'ok', dataTypeID: 23 }], rows: [[1]] };
              return { rows: [], fields: [] };
            },
            release() {},
          };
        },
      };
    },
  });
  assert.deepEqual(set.poolNames(), []);
  await set.run('w2', 'SELECT 1');
  assert.deepEqual(seen, ['w2-host']);
  assert.deepEqual(set.poolNames(), ['w2']);
});
