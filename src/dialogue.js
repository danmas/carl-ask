import { randomUUID } from 'node:crypto';
import { buildCard } from './card.js';
import { absorbedFilters, deletedLots, ignoredFilters, matchMetric, render } from './metrics.js';
import { plainText } from './plain.js';
import { createModelParser } from './model.js';
import { guardPhrase } from './guard.js';
import { allGaps, next, normalizeMart } from './policy.js';
import { buildParsePrompt, buildSqlPrompt } from './prompt.js';
import { validate } from './validator.js';
import { scrubError } from './query.js';

function blank() {
  return {
    metric: {},
    grain: null,
    mart: null,
    time: null,
    dimensions: [],
    filters: [],
    assumptions: [],
    missing: [],
    period_stated: false,
    refusal: null,
    params: {},
  };
}

export function mergeSlots(base, delta) {
  const out = structuredClone(base || blank());
  if (!delta || typeof delta !== 'object') return out;
  if (delta.grain !== undefined) out.grain = delta.grain;
  if (delta.mart !== undefined) out.mart = normalizeMart(delta.mart);
  if (delta.period_stated !== undefined) out.period_stated = Boolean(delta.period_stated);
  if (delta.time !== undefined) out.time = delta.time;
  if (delta.dimensions !== undefined) out.dimensions = delta.dimensions;
  if (delta.filters !== undefined) out.filters = delta.filters;
  if (delta.assumptions !== undefined) out.assumptions = delta.assumptions;
  if (delta.missing !== undefined) out.missing = delta.missing;
  if (delta.refusal !== undefined) out.refusal = delta.refusal;
  if (delta.params !== undefined) out.params = { ...(out.params || {}), ...delta.params };
  if (delta.metric !== undefined) out.metric = { ...(out.metric || {}), ...delta.metric };
  if (delta.metric && Object.prototype.hasOwnProperty.call(delta.metric, 'field') && delta.metric.field === null) {
    delete out.metric.field;
  }
  return out;
}

function upsertFilter(slots, column, value) {
  const filters = (slots.filters || []).filter((f) => f.column !== column);
  if (value !== null && value !== undefined && value !== '') filters.push({ column, op: '=', value });
  slots.filters = filters;
}

export function applyAnswers(slots, values) {
  const out = structuredClone(slots);
  for (const [key, value] of Object.entries(values || {})) {
    if (key === 'metric.agg') out.metric = { ...(out.metric || {}), agg: value };
    else if (key === 'metric.field') out.metric = { ...(out.metric || {}), field: value };
    else if (key === 'grain') out.grain = value;
    else if (key === 'mart') out.mart = normalizeMart(value);
    else if (key === 'exposure') {
      const from = value?.from;
      const to = value?.to;
      out.params = { ...(out.params || {}), exposure: true, exposure_from: from, exposure_to: to };
      out.metric = { ...(out.metric || {}), field: from && to ? `${to} - ${from}` : out.metric?.field };
      out.assumptions = (out.assumptions || []).filter((line) => !/^Длительность =/.test(line));
      if (from && to) out.assumptions.push(`Длительность = ${to} − ${from}.`);
    } else if (key === 'time') out.time = value;
    else if (key === 'id_profile') {
      const column = out.grain === 'bid_profile' || out.mart?.endsWith('t_auct_bids_an') ? 'id_profile_bid' : 'id_profile_leader';
      if (/^(все|всё|любой|любые|любое|any|all)$/i.test(String(value || '').trim()) || value === '' || value == null) {
        out.filters = (out.filters || []).filter((filter) => filter.column !== column && filter.column !== 'id_profile');
      } else upsertFilter(out, column, value);
    } else if (key === 'id_user') {
      const text = String(value ?? '').trim();
      const all = text === '' || /^(все|всё|все пользователи|по всем|по всем пользователям|любой|любые|any|all)$/i.test(text);
      out.filters = (out.filters || []).filter((filter) => filter.column !== 'id_user');
      out.params = { ...(out.params || {}) };
      if (all) {
        out.params.all_users = true;
      } else if (/^\d+$/.test(text)) {
        delete out.params.all_users;
        upsertFilter(out, 'id_user', text);
      } else {
        delete out.params.all_users;
      }
    } else if (key === 'id_profile_seller') {
      out.params = { ...(out.params || {}), id_profile_seller: value === '' ? null : value };
      if (value !== null && value !== undefined && value !== '') upsertFilter(out, 'id_profile_seller', value);
    } else if (key === 'thresholds' || key === 'params') {
      out.params = { ...(out.params || {}), ...value };
    }
  }
  out.missing = (out.missing || []).filter((name) => !Object.prototype.hasOwnProperty.call(values || {}, name));
  return out;
}

function answerLabel(question, value) {
  if (value && typeof value === 'object' && value.from && value.to && !value.column) {
    const options = question.control?.options || [];
    const label = (token) => options.find((item) => item.value === token)?.label || token;
    return `${label(value.from)} → ${label(value.to)}`;
  }
  if (value && typeof value === 'object' && value.column) {
    const option = (question.control?.options || []).find((item) => item.value === value.column);
    const name = option ? option.label : value.column;
    const bounds = value.from && value.to ? `, ${value.from} … ${value.to}` : '';
    return `${name}${bounds}`;
  }
  const option = (question.control?.options || []).find((item) => item.value === value);
  if (option) return option.label;
  if (value === null || value === undefined || value === '') return 'пусто';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function remember(dialogue, values) {
  dialogue.turns.push({
    round: dialogue.round,
    questions: (dialogue.questions || []).map((question) => ({
      slot: question.slot,
      text: question.text,
      answer: values?.[question.slot],
      answer_label: answerLabel(question, values?.[question.slot]),
    })),
  });
}

const CARRY_KEYS = ['seller_ids', 'profile_roles', 'exposure', 'exposure_from', 'exposure_to', 'fl_min', 'fl_max', 'ip_min', 'ip_max'];
const FILTER_LABEL = {
  id_user: 'Пользователь',
  id_user_inspector: 'Автор отчёта',
  id_profile_leader: 'Покупатель',
  id_profile_bid: 'Профиль со ставками',
  id_profile_seller: 'Продавцы',
  status: 'Статус',
};

function same(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function listOf(value) {
  return (Array.isArray(value) ? value : [value]).map(String).join(', ');
}

function contextOf(parent) {
  const s = parent.slots || {};
  const exec = parent.execution || {};
  const single = (exec.fields || []).length === 1 && (exec.rows || []).length === 1;
  return {
    parent_id: parent.id,
    utterance: parent.utterance,
    slots: structuredClone({
      metric: s.metric || {},
      grain: s.grain ?? null,
      mart: s.mart ?? null,
      time: s.time ?? null,
      dimensions: s.dimensions || [],
      filters: s.filters || [],
      period_stated: Boolean(s.period_stated),
      params: s.params || {},
    }),
    reading: plainText(parent.slots, { metricId: matchMetric(parent.slots), brief: true }).split('\n')[0] || '',
    result: {
      connection: exec.connection || null,
      rowCount: exec.rowCount ?? 0,
      value: single && Array.isArray(exec.rows[0]) ? exec.rows[0][0] ?? null : null,
    },
  };
}

function carryParams(context, slots) {
  const base = context.slots;
  if (base.mart !== slots.mart || base.metric?.agg !== slots.metric?.agg) return slots;
  const out = structuredClone(slots);
  out.params = { ...(out.params || {}) };
  for (const key of CARRY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(base.params || {}, key) && out.params[key] === undefined) {
      out.params[key] = structuredClone(base.params[key]);
    }
  }
  const seller = (base.filters || []).find((filter) => filter.column === 'id_profile_seller');
  if (out.params.seller_ids && seller && !(out.filters || []).some((filter) => filter.column === 'id_profile_seller')) {
    out.filters = [...(out.filters || []), structuredClone(seller)];
  }
  return out;
}

function inheritedLines(context, slots) {
  if (!context) return [];
  const base = context.slots;
  const lines = [];
  const time = slots.time;
  if (time && base.time && ['column', 'from', 'to', 'all_time'].every((key) => same(time[key], base.time[key]))) {
    const span = time.from && time.to ? `${time.from} … ${time.to} (конец не включая)` : 'за всё время';
    lines.push(`Период: ${span}${time.column ? `, дата ${time.column}` : ''}.`);
  }
  const shown = new Set();
  for (const filter of slots.filters || []) {
    if (!(base.filters || []).some((old) => same(old, filter))) continue;
    shown.add(filter.column);
    lines.push(`${FILTER_LABEL[filter.column] || filter.column}: ${listOf(filter.value)}.`);
  }
  const p = slots.params || {};
  const bp = base.params || {};
  const kept = (key) => p[key] !== undefined && same(p[key], bp[key]);
  if (kept('seller_ids') && !shown.has('id_profile_seller')) lines.push(`Продавцы: ${listOf(p.seller_ids)}.`);
  if (kept('profile_roles')) lines.push('Роли профиля: покупатель и продавец.');
  if (kept('exposure_from') && kept('exposure_to')) lines.push(`Экспозиция: от ${p.exposure_from} до ${p.exposure_to}.`);
  if (['fl_min', 'fl_max', 'ip_min', 'ip_max'].every(kept)) {
    lines.push(`Пороги депозита: физлица ${p.fl_min}–${p.fl_max}, ИП ${p.ip_min}–${p.ip_max}.`);
  }
  return lines;
}

function cardOf(dialogue, assumptions) {
  const card = buildCard(dialogue.slots, assumptions);
  if (dialogue.inherited?.length) card.inherited = dialogue.inherited;
  const id = matchMetric(dialogue.slots);
  const ignored = id ? ignoredFilters(id, dialogue.slots) : [];
  const absorbed = id ? absorbedFilters(id, dialogue.slots) : [];
  if (ignored.length) {
    card.notes = [...(card.notes || []), `Шаблон не учитывает фильтр ${ignored.join(', ')}. SQL напишет модель, контролёр проверит.`];
  }
  if (absorbed.length) {
    card.notes = [...(card.notes || []), `Фильтр ${absorbed.join(', ')} шаблон не применяет отдельно. Про удалённые и состав витрины сказано в тексте карточки.`];
  }
  return card;
}

function templateBypass(dialogue) {
  const id = matchMetric(dialogue.slots);
  return id ? ignoredFilters(id, dialogue.slots) : [];
}

function snapshot(dialogue) {
  return {
    id: dialogue.id,
    parent_id: dialogue.context?.parent_id || null,
    context: dialogue.context
      ? { parent_id: dialogue.context.parent_id, utterance: dialogue.context.utterance, reading: dialogue.context.reading, result: dialogue.context.result }
      : null,
    inherited: dialogue.inherited || [],
    utterance: dialogue.utterance,
    phase: dialogue.phase,
    round: dialogue.round,
    turns: dialogue.turns,
    slots: dialogue.slots,
    missing: dialogue.missing,
    assumptions: dialogue.assumptions,
    questions: dialogue.questions,
    card: dialogue.card,
    reading: plainText(dialogue.slots, {
      metricId: matchMetric(dialogue.slots),
      deleted: matchMetric(dialogue.slots) ? deletedLots(matchMetric(dialogue.slots), dialogue.slots) : null,
      assumptions: dialogue.assumptions || [],
      brief: true,
    }),
    sql: dialogue.sql,
    execution: dialogue.execution || null,
    validator_errors: dialogue.validator_errors,
    refusal: dialogue.refusal,
    block: dialogue.block,
    log: dialogue.log,
    reasoning: dialogue.reasoning === true,
    model: dialogue.model || { reasoning: false, effort: 'none', ms: null, reasoning_tokens: null, reasoned: false },
  };
}

function move(dialogue, phase) {
  if (dialogue.phase === phase) return;
  dialogue.log.push({ from: dialogue.phase, to: phase, at: new Date().toISOString() });
  dialogue.phase = phase;
}

function applyDecision(dialogue, decision) {
  if (decision.patch) dialogue.slots = mergeSlots(dialogue.slots, decision.patch);
  dialogue.missing = allGaps(dialogue.slots);
  dialogue.assumptions = decision.assumptions;
  dialogue.questions = decision.questions;
  dialogue.slots.assumptions = decision.assumptions;
  if (decision.phase === 'failed') {
    dialogue.refusal = decision.refusal;
    dialogue.sql = null;
    dialogue.execution = null;
    dialogue.card = cardOf(dialogue, decision.assumptions);
    move(dialogue, 'failed');
    return;
  }
  if (decision.phase === 'clarifying') {
    dialogue.round = dialogue.roundsAsked + 1;
    dialogue.roundsAsked = dialogue.round;
    dialogue.card = null;
    dialogue.sql = null;
    dialogue.execution = null;
    move(dialogue, 'clarifying');
    return;
  }
  dialogue.card = cardOf(dialogue, decision.assumptions);
  dialogue.sql = null;
  dialogue.execution = null;
  move(dialogue, 'awaiting_confirm');
}

function journalView(dialogue) {
  const view = snapshot(dialogue);
  if (view.context) view.context = { ...view.context, result: { ...view.context.result, value: undefined } };
  if (!view.execution) return view;
  const exec = view.execution;
  view.execution = {
    connection: exec.connection || null,
    elapsedMs: exec.elapsedMs ?? null,
    rowCount: exec.rowCount ?? 0,
    truncated: exec.truncated === true,
    error: exec.error?.code || (typeof exec.error === 'string' ? exec.error : null),
    error_message: exec.error?.message || null,
    error_detail: exec.error?.detail || null,
    error_hint: exec.error?.hint || null,
  };
  return view;
}

function traceOf(value) {
  return value && typeof value === 'object' ? value.__trace || null : null;
}

function rejectExecuteBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Тело выполнения принимает только connection');
    error.code = 'BODY';
    throw error;
  }
  if ('sql' in body || 'confirmWrite' in body || 'overrideReadOnly' in body) {
    const error = new Error('Тело выполнения принимает только connection');
    error.code = 'BODY';
    throw error;
  }
}

export function createStore(parser = createModelParser(), journal = () => {}) {
  const dialogues = new Map();

  function emit(event, dialogue, extra = {}) {
    journal({
      event,
      dialogue_id: dialogue?.id || null,
      utterance: dialogue?.utterance || extra.utterance || null,
      ...extra,
      snapshot: dialogue ? journalView(dialogue) : null,
    });
  }

  function resume(dialogue) {
    applyDecision(dialogue, next(dialogue.slots, dialogue.roundsAsked));
    return snapshot(dialogue);
  }

  function noteModel(dialogue, trace) {
    const usage = trace?.usage || {};
    const details = usage.completion_tokens_details || usage.output_tokens_details || {};
    dialogue.model = {
      reasoning: dialogue.reasoning === true,
      effort: dialogue.reasoning ? null : 'none',
      ms: trace?.ms ?? null,
      reasoning_tokens: usage.reasoning_tokens ?? details.reasoning_tokens ?? null,
      reasoned: Boolean(trace?.reasoning),
    };
  }

  return {
    async open(utterance, options = {}) {
      let context = null;
      if (options.parentId) {
        const parent = dialogues.get(options.parentId);
        if (!parent) {
          const error = new Error('Опора потеряна: прошлого вопроса нет в памяти сервера. Задай вопрос с чистого листа.');
          error.code = 'PARENT';
          throw error;
        }
        if (parent.phase !== 'sql_ready' || !parent.execution || parent.execution.error) {
          const error = new Error('Опорой может быть только вопрос, выполненный без ошибки.');
          error.code = 'PARENT_STATE';
          throw error;
        }
        context = contextOf(parent);
      }
      const reasoning = context ? dialogues.get(context.parent_id).reasoning === true : options.reasoning === true;
      const prompt = buildParsePrompt(utterance, context);
      let parsed;
      try {
        parsed = await parser.slots({ utterance, prompt, reasoning });
      } catch (error) {
        emit('model_error', null, { utterance, kind: 'slots', message: error.message, model: error.trace || null, reasoning, parent_id: context?.parent_id || null });
        throw error;
      }
      const merged = mergeSlots(blank(), parsed);
      const slots = guardPhrase(utterance, context ? carryParams(context, merged) : merged, { contextUtterance: context?.utterance });
      const dialogue = {
        id: randomUUID(),
        phase: 'draft',
        round: 0,
        roundsAsked: 0,
        slots,
        missing: [],
        assumptions: [],
        questions: [],
        turns: [],
        card: null,
        sql: null,
        execution: null,
        validator_errors: [],
        refusal: null,
        block: null,
        log: [],
        utterance,
        reasoning,
        model: null,
        context,
        inherited: inheritedLines(context, slots),
      };
      noteModel(dialogue, traceOf(parsed));
      dialogues.set(dialogue.id, dialogue);
      resume(dialogue);
      emit('open', dialogue, { model: traceOf(parsed), prompt, parent_id: context?.parent_id || null });
      return snapshot(dialogue);
    },
    get(id) {
      const dialogue = dialogues.get(id);
      return dialogue ? snapshot(dialogue) : null;
    },
    answer(id, values) {
      const dialogue = dialogues.get(id);
      if (!dialogue) return null;
      if (dialogue.phase !== 'clarifying') {
        const error = new Error('Ответы принимаются только в фазе clarifying');
        error.code = 'PHASE';
        throw error;
      }
      dialogue.block = null;
      remember(dialogue, values);
      dialogue.slots = applyAnswers(dialogue.slots, values);
      resume(dialogue);
      const typedUser = values?.id_user;
      if (typeof typedUser === 'string' && typedUser.trim() && !/^\d+$/.test(typedUser.trim()) && !dialogue.slots.params?.all_users) {
        dialogue.block = `«${typedUser.trim()}» — не номер пользователя. Нужен номер или «все».`;
      }
      emit('answer', dialogue, { values });
      return snapshot(dialogue);
    },
    async reject(id, text) {
      const dialogue = dialogues.get(id);
      if (!dialogue) return null;
      if (dialogue.phase !== 'awaiting_confirm') {
        const error = new Error('Отказ принимается только в фазе awaiting_confirm');
        error.code = 'PHASE';
        throw error;
      }
      const prompt = buildParsePrompt(dialogue.utterance, dialogue.context);
      let delta;
      try {
        delta = await parser.delta({
          utterance: dialogue.utterance,
          rejection: text,
          slots: dialogue.slots,
          prompt,
          reasoning: dialogue.reasoning === true,
        });
      } catch (error) {
        emit('model_error', dialogue, { kind: 'delta', rejection: text, message: error.message, model: error.trace || null });
        throw error;
      }
      noteModel(dialogue, traceOf(delta));
      dialogue.slots = guardPhrase(dialogue.utterance, mergeSlots(dialogue.slots, delta), { contextUtterance: dialogue.context?.utterance });
      dialogue.inherited = inheritedLines(dialogue.context, dialogue.slots);
      dialogue.roundsAsked = 0;
      dialogue.round = 0;
      dialogue.block = null;
      dialogue.sql = null;
      dialogue.execution = null;
      resume(dialogue);
      emit('reject', dialogue, { rejection: text, model: traceOf(delta), prompt });
      return snapshot(dialogue);
    },
    async confirm(id) {
      const dialogue = dialogues.get(id);
      if (!dialogue) return null;
      if (dialogue.phase !== 'awaiting_confirm') {
        const error = new Error('Подтверждение принимается только в фазе awaiting_confirm');
        error.code = 'PHASE';
        throw error;
      }
      dialogue.block = null;
      const span = dialogue.slots.params || {};
      if (span.exposure && (!span.exposure_from || !span.exposure_to)) {
        dialogue.block = 'Границы экспозиции не выбраны. Умолчания нет.';
        emit('confirm_blocked', dialogue, { message: dialogue.block });
        return snapshot(dialogue);
      }
      let rendered = null;
      try {
        rendered = templateBypass(dialogue).length ? null : render(dialogue.slots);
      } catch (error) {
        dialogue.block = error.message;
        emit('confirm_blocked', dialogue, { message: error.message });
        return snapshot(dialogue);
      }
      if (rendered) {
        const checked = validate(rendered.sql);
        dialogue.card = cardOf(dialogue, dialogue.assumptions);
        dialogue.card.metric_id = rendered.metric_id;
        if (!checked.ok) {
          dialogue.sql = null;
          dialogue.execution = null;
          dialogue.validator_errors = checked.errors;
          dialogue.refusal = null;
          move(dialogue, 'failed');
          emit('confirm', dialogue, { metric_id: rendered.metric_id, validator: checked });
          return snapshot(dialogue);
        }
        dialogue.sql = rendered.sql;
        dialogue.execution = null;
        dialogue.validator_errors = [];
        move(dialogue, 'sql_ready');
        emit('confirm', dialogue, { metric_id: rendered.metric_id, validator: checked });
        return snapshot(dialogue);
      }
      let errors = [];
      const modelCalls = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prompt = buildSqlPrompt(dialogue.card, errors);
        let produced;
        try {
          produced = await parser.sql({ prompt, card: dialogue.card, errors, reasoning: dialogue.reasoning === true });
        } catch (error) {
          emit('model_error', dialogue, { kind: 'sql', attempt, message: error.message, model: error.trace || null });
          throw error;
        }
        const sql = typeof produced === 'string' ? produced : produced.sql;
        noteModel(dialogue, traceOf(produced));
        modelCalls.push({ attempt, prompt, model: traceOf(produced), sql });
        const checked = validate(sql);
        if (checked.ok) {
          dialogue.sql = sql;
          dialogue.execution = null;
          dialogue.validator_errors = [];
          dialogue.refusal = null;
          move(dialogue, 'sql_ready');
          emit('confirm', dialogue, { model_calls: modelCalls, validator: checked });
          return snapshot(dialogue);
        }
        errors = checked.errors;
      }
      dialogue.sql = null;
      dialogue.execution = null;
      dialogue.validator_errors = errors;
      dialogue.refusal = null;
      move(dialogue, 'failed');
      emit('confirm', dialogue, { model_calls: modelCalls, validator: { ok: false, errors } });
      return snapshot(dialogue);
    },
    async execute(id, body, connections) {
      rejectExecuteBody(body);
      const dialogue = dialogues.get(id);
      if (!dialogue) return null;
      if (dialogue.phase !== 'sql_ready' || !dialogue.sql) {
        const error = new Error('Выполнение принимается только в фазе sql_ready');
        error.code = 'PHASE';
        throw error;
      }
      const name = typeof body.connection === 'string' ? body.connection : '';
      if (!connections?.executable?.(name)) {
        const error = new Error(name ? `Коннекция «${name}» не исполняема` : 'Нужно имя коннекции');
        error.code = 'CONNECTION';
        throw error;
      }
      try {
        const result = await connections.run(name, dialogue.sql);
        dialogue.execution = {
          connection: name,
          connectionInfo: result.connectionInfo || connections.info?.(name) || null,
          fields: result.fields || [],
          rows: result.rows || [],
          rowCount: result.rowCount ?? 0,
          truncated: result.truncated === true,
          elapsedMs: result.elapsedMs ?? null,
          error: null,
        };
        emit('execute', dialogue, {
          connection: name,
          elapsedMs: dialogue.execution.elapsedMs,
          rowCount: dialogue.execution.rowCount,
          truncated: dialogue.execution.truncated,
          error: null,
        });
      } catch (error) {
        if (error.code === 'CONNECTION' || error.code === 'PHASE' || error.code === 'BODY') throw error;
        dialogue.execution = {
          connection: name,
          connectionInfo: connections.info?.(name) || null,
          fields: [],
          rows: [],
          rowCount: 0,
          truncated: false,
          elapsedMs: error.elapsedMs ?? null,
          error: scrubError(error, connections.secrets?.(name) || []),
        };
        emit('execute', dialogue, {
          connection: name,
          elapsedMs: dialogue.execution.elapsedMs,
          rowCount: 0,
          truncated: false,
          error: dialogue.execution.error.code,
          error_message: dialogue.execution.error.message,
          error_detail: dialogue.execution.error.detail,
          error_hint: dialogue.execution.error.hint,
        });
      }
      return snapshot(dialogue);
    },
  };
}
