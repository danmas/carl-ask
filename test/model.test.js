import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRequest } from '../src/model.js';

test('reasoning off sends reasoning_effort none', () => {
  const body = modelRequest('demo', [], false);
  assert.equal(body.reasoning_effort, 'none');
});

test('reasoning on does not send reasoning_effort', () => {
  const body = modelRequest('demo', [], true);
  assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
});
