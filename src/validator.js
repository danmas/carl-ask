import { FORBIDDEN, JOIN_PAIRS, JOIN_TRIPLES, RELATIONS, columnNames } from './catalog.js';

const FUNCS = new Set(['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'date_trunc', 'date_part']);

const KEYWORDS = new Set(`select from where and or not join on as in is null true false group by order having
limit offset with distinct filter case when then else end asc desc inner left right full outer using between
like ilike exists all any union except intersect bigint integer boolean text numeric int8 int4 timestamptz
timestamp date interval over partition rows range unbounded preceding following current row only lateral`.split(/\s+/));

function strip(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, " '' ");
}

function relationsIn(bare) {
  const found = [];
  const re = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?/gi;
  let match;
  while ((match = re.exec(bare))) {
    found.push({ schema: match[2] ? match[1] : null, name: match[2] || match[1] });
  }
  return found;
}

function aliases(bare) {
  const map = new Map();
  const re = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)(?:\s+as)?\s+([a-z_][a-z0-9_]*)/gi;
  let match;
  while ((match = re.exec(bare))) {
    const alias = match[3].toLowerCase();
    if (!KEYWORDS.has(alias)) map.set(alias, match[2]);
  }
  return map;
}

function outputNames(bare) {
  const names = new Set();
  const re = /\bas\s+([a-z_][a-z0-9_]*)/gi;
  let match;
  while ((match = re.exec(bare))) names.add(match[1].toLowerCase());
  return names;
}

function hasEq(bare, left, right) {
  const a = left.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const b = right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`\\b${a}\\b\\s*=\\s*(?:[a-z_][a-z0-9_]*\\s*\\.\\s*)?${b}\\b`, 'i');
  const re2 = new RegExp(`\\b${b}\\b\\s*=\\s*(?:[a-z_][a-z0-9_]*\\s*\\.\\s*)?${a}\\b`, 'i');
  return re1.test(bare) || re2.test(bare);
}

export function validate(sql) {
  const errors = [];
  if (!sql || typeof sql !== 'string') {
    return { ok: false, errors: ['пустой SQL'] };
  }
  if (sql.includes('?column?')) errors.push('колонка ?column? запрещена');
  const bare = strip(sql).replace(/::[a-z_][a-z0-9_]*/gi, ' ');
  const body = bare.trim().replace(/;\s*$/, '');
  if (body.includes(';')) errors.push('второй оператор');
  if (!/^(with|select)\b/i.test(body)) errors.push('нужен один SELECT или WITH ... SELECT');
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|copy|call|do)\b/i.test(body)) {
    errors.push('не SELECT');
  }
  if (/\bselect\s+(distinct\s+)?\*/i.test(body)) errors.push('SELECT * запрещён');

  const funcs = body.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi);
  for (const found of funcs) {
    const name = found[1].toLowerCase();
    if (KEYWORDS.has(name)) continue;
    if (!FUNCS.has(name)) errors.push(`функция ${name} не из белого списка`);
  }

  const rels = relationsIn(body);
  if (rels.length === 0) errors.push('нет отношения');
  const names = [];
  for (const rel of rels) {
    if (!rel.schema || rel.schema.toLowerCase() !== 'carl_an') errors.push(`схема не carl_an: ${rel.schema || rel.name}`);
    const table = rel.name.toLowerCase();
    names.push(table);
    if (FORBIDDEN.includes(table) || table.startsWith('tmp_')) errors.push(`отношение ${table} запрещено`);
    else if (!RELATIONS.includes(table)) errors.push(`отношение ${table} вне allowlist`);
  }
  if (names.includes('prof_buy') && names.includes('prof_sel')) errors.push('prof_buy и prof_sel не соединяются');
  const distinct = [...new Set(names)];
  if (distinct.length > 3) errors.push('больше трёх отношений');
  else if (distinct.length === 3 && errors.length === 0) {
    const triple = JOIN_TRIPLES.find((item) => item.tables.length === distinct.length && item.tables.every((name) => distinct.includes(name)));
    if (!triple) errors.push('тройка отношений не из allowlist');
    else if (!triple.keys.every(([left, right]) => hasEq(body, left, right))) errors.push('ключ соединения не из allowlist');
  } else if (distinct.length === 2 && errors.length === 0) {
    const pair = JOIN_PAIRS.find((item) => distinct.includes(item.a) && distinct.includes(item.b));
    if (!pair) errors.push('пара отношений не из allowlist');
    else if (!pair.keys.some(([left, right]) => hasEq(body, left, right))) errors.push('ключ соединения не из allowlist');
  }

  const aliasMap = aliases(body);
  const outputs = outputNames(body);
  const qualified = /\b([a-z_][a-z0-9_]*)\s*\.\s*([a-z_][a-z0-9_]*)/gi;
  let match;
  const used = new Set();
  while ((match = qualified.exec(body))) {
    const left = match[1].toLowerCase();
    const right = match[2].toLowerCase();
    if (left === 'carl_an') continue;
    const table = aliasMap.get(left);
    if (!table) continue;
    used.add(`${left}.${right}`);
    if (!columnNames(table).has(right)) errors.push(`колонки ${right} нет в ${table}`);
  }

  const known = new Set(KEYWORDS);
  known.add('carl_an');
  for (const table of names) {
    known.add(table);
    for (const name of columnNames(table)) known.add(name.toLowerCase());
  }
  for (const alias of aliasMap.keys()) known.add(alias);
  for (const name of outputs) known.add(name);
  for (const func of FUNCS) known.add(func);

  const idents = body.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi);
  for (const found of idents) {
    const name = found[1].toLowerCase();
    if (!known.has(name)) errors.push(`имя ${name} вне каталога`);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
