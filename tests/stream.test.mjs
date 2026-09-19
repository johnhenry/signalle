import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, effect } from '../src/signal.mjs';
import { toReadableStream, toSSEResponse } from '../src/stream.mjs';

test('toSSEResponse returns Response with correct SSE headers', () => {
  const sig = signal('hello');
  const response = toSSEResponse(sig);

  assert.ok(response instanceof Response, 'Should return a Response');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.equal(response.headers.get('connection'), 'keep-alive');
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'No CORS header by default');
});

test('toSSEResponse sets CORS header when cors: true', () => {
  const sig = signal(0);
  const response = toSSEResponse(sig, { cors: true });

  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('toSSEResponse sets CORS header to specific origin', () => {
  const sig = signal(0);
  const response = toSSEResponse(sig, { cors: 'https://example.com' });

  assert.equal(response.headers.get('access-control-allow-origin'), 'https://example.com');
});

test('toSSEResponse stream emits SSE-formatted data', async () => {
  const sig = signal('initial');
  const response = toSSEResponse(sig);

  const reader = response.body.getReader();

  // Read the initial value — stream enqueues strings directly
  const { value } = await reader.read();
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value);

  assert.ok(text.includes('data: "initial"'), 'Should contain SSE data line');
  assert.ok(text.endsWith('\n\n'), 'Should end with double newline');

  reader.cancel();
});

test('toSSEResponse passes event option through', async () => {
  const sig = signal('test');
  const response = toSSEResponse(sig, { event: 'update' });

  const reader = response.body.getReader();

  const { value } = await reader.read();
  const text = typeof value === 'string' ? value : new TextDecoder().decode(value);

  assert.ok(text.includes('event: update'), 'Should contain event name');
  assert.ok(text.includes('data: "test"'), 'Should contain data');

  reader.cancel();
});
