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

test('toSSEResponse stream emits SSE-formatted data as Uint8Array chunks', async () => {
  const sig = signal('initial');
  const response = toSSEResponse(sig);

  const reader = response.body.getReader();

  const { value } = await reader.read();

  // Regression guard (#9): a Response body stream must yield bytes, not
  // strings. The stream used to enqueue raw strings directly, which
  // silently "worked" when read via reader.read() (this test used to
  // accept either a string or a Uint8Array here) but broke the moment a
  // real consumer called res.text() or otherwise treated the body as a
  // proper byte stream. See the "res.text()" test below for that case.
  assert.ok(value instanceof Uint8Array, 'Chunk should be a Uint8Array, not a raw string');

  const text = new TextDecoder().decode(value);
  assert.ok(text.includes('data: "initial"'), 'Should contain SSE data line');
  assert.ok(text.endsWith('\n\n'), 'Should end with double newline');

  reader.cancel();
});

test('toSSEResponse passes event option through', async () => {
  const sig = signal('test');
  const response = toSSEResponse(sig, { event: 'update' });

  const reader = response.body.getReader();

  const { value } = await reader.read();
  assert.ok(value instanceof Uint8Array, 'Chunk should be a Uint8Array, not a raw string');
  const text = new TextDecoder().decode(value);

  assert.ok(text.includes('event: update'), 'Should contain event name');
  assert.ok(text.includes('data: "test"'), 'Should contain data');

  reader.cancel();
});

test('toSSEResponse: res.text() does not throw "non-Uint8Array chunk" (#9)', async () => {
  // Regression test for the exact failure reported in #9: a consumer
  // calling res.text() on the Response returned by toSSEResponse() got
  // `TypeError: Received non-Uint8Array chunk` instead of the SSE text,
  // because the underlying stream enqueued raw strings instead of bytes.
  //
  // An SSE stream is intentionally long-lived (it mirrors a real
  // server-sent-events connection and never closes on its own), so
  // response.text() -- which per spec buffers the *entire* body until the
  // stream ends -- never actually resolves here. That's expected and
  // correct for a live stream; it's not what's under test. What's under
  // test is the pre-fix behavior where text() rejected almost immediately,
  // as soon as the first chunk was read, with the non-Uint8Array
  // TypeError -- rather than hanging (or eventually resolving) like a
  // stream of well-formed byte chunks should. Race a short timeout
  // against it: with the fix, nothing should reject in that window.
  const sig = signal('hello');
  const response = toSSEResponse(sig);

  let rejection = null;
  const textPromise = response.text().catch((err) => {
    rejection = err;
  });

  await Promise.race([
    textPromise,
    new Promise((resolve) => setTimeout(resolve, 50)),
  ]);

  assert.equal(rejection, null, 'res.text() should not reject with a non-Uint8Array chunk error');
});

test('toReadableStream: chunks are Uint8Array, and decode to the same SSE text as before', async () => {
  const sig = signal({ n: 1 });
  const stream = toReadableStream(sig);
  const reader = stream.getReader();

  const { value, done } = await reader.read();

  assert.equal(done, false);
  assert.ok(value instanceof Uint8Array, 'toReadableStream() chunks should be Uint8Array');
  assert.equal(new TextDecoder().decode(value), 'data: {"n":1}\n\n');

  reader.cancel();
});
