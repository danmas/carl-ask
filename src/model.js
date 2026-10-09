import { REFUSAL_CODES } from './refusals.js';

const SCORE_KEYS = ['score', 'complexity', 'clarity', 'rating'];

export function modelRequest(model, messages, reasoning) {
  const body = {
    model,
    temperature: 0,
    stream: false,
    response_format: { type: 'json_object' },
    messages,
  };
  if (reasoning !== true) body.reasoning_effort = 'none';
  return body;
}

async function complete(messages, reasoning = false) {
  const url = process.env.CARL_ASK_MODEL_URL;
  const key = process.env.CARL_ASK_MODEL_KEY;
  const model = process.env.CARL_ASK_MODEL_NAME || 'gpt-4.1';
  const timeoutMs = Number(process.env.CARL_ASK_MODEL_TIMEOUT_MS || 120000);
  if (!url || !key) {
    const error = new Error('Модель не настроена: CARL_ASK_MODEL_URL и CARL_ASK_MODEL_KEY');
    error.code = 'MODEL_UNSET';
    throw error;
  }
  const started = Date.now();
  const endpoint = url.replace(/\/$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify(modelRequest(model, messages, reasoning)),
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') {
      const error = new Error(`Модель не ответила за ${timeoutMs} мс`);
      error.code = 'MODEL_TIMEOUT';
      error.trace = { model, endpoint, ms: Date.now() - started, timeoutMs };
      throw error;
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Модель ответила ${response.status}: ${detail.slice(0, 500)}`);
    error.code = 'MODEL_HTTP';
    error.trace = { model, endpoint, ms: Date.now() - started, status: response.status, body: detail.slice(0, 2000) };
    throw error;
  }
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content || '';
  return {
    parsed: JSON.parse(text),
    trace: {
      model,
      endpoint,
      ms: Date.now() - started,
      status: response.status,
      usage: body.usage || null,
      reasoning_requested: reasoning === true,
      reasoning_effort: reasoning === true ? null : 'none',
      content: text,
      reasoning: body.choices?.[0]?.message?.reasoning || null,
    },
  };
}

function withTrace(value, trace) {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, '__trace', { value: trace, enumerable: false });
  }
  return value;
}

function cleanSlots(raw) {
  const slots = raw && typeof raw === 'object' ? { ...raw } : {};
  for (const key of SCORE_KEYS) delete slots[key];
  if (typeof slots.refusal === 'string') {
    slots.refusal = REFUSAL_CODES.has(slots.refusal) ? { code: slots.refusal } : null;
  } else if (slots.refusal && typeof slots.refusal === 'object') {
    const code = slots.refusal.code || null;
    slots.refusal = code && REFUSAL_CODES.has(code) ? { code } : null;
  }
  return slots;
}

export function createModelParser() {
  return {
    async slots({ prompt, reasoning }) {
      const call = await complete([
        { role: 'system', content: 'Ты разбираешь аналитический вопрос Carlink в JSON слотов.' },
        { role: 'user', content: prompt },
      ], reasoning);
      return withTrace(cleanSlots(call.parsed), call.trace);
    },
    async delta({ prompt, rejection, slots, reasoning }) {
      const call = await complete([
        { role: 'system', content: 'Верни только JSON дельты слотов. Незатронутые поля не включай. Шкалу не возвращай.' },
        { role: 'user', content: `${prompt}\n\nТекущие слоты:\n${JSON.stringify(slots)}\n\nОтказ человека:\n${rejection}` },
      ], reasoning);
      return withTrace(cleanSlots(call.parsed), call.trace);
    },
    async sql({ prompt, reasoning }) {
      const call = await complete([
        { role: 'system', content: 'Верни JSON с одним полем sql.' },
        { role: 'user', content: prompt },
      ], reasoning);
      const sql = typeof call.parsed.sql === 'string' ? call.parsed.sql : '';
      return withTrace({ sql }, call.trace);
    },
  };
}
