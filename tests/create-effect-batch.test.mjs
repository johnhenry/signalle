import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, createEffect, batch } from '../src/index.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { await tick(); await tick(); };

test('createEffect re-runs when a tracked signal is written inside batch()', async () => {
  const a = signal(1);
  let runs = 0;
  createEffect(() => { runs += 1; a.value; });
  await tick();
  assert.equal(runs, 1);
  batch(() => { a.value = 2; });
  await tick();
  assert.equal(runs, 2, 'the effect must run again after the batch');
});

test('the same write outside batch() does re-run it (control)', async () => {
  const a = signal(1);
  let runs = 0;
  createEffect(() => { runs += 1; a.value; });
  await tick();
  a.value = 2;
  await tick();
  assert.equal(runs, 2);
});

test('awaited async batch() re-runs createEffect', async () => {
  const a = signal(1);
  const seen = [];
  createEffect(() => { seen.push(a.value); });
  await batch(async () => { a.value = 2; });
  await settle();
  assert.deepEqual(seen, [1, 2]);
});

test('nested batches re-run the effect once, with the final value', async () => {
  const a = signal(1);
  const seen = [];
  createEffect(() => { seen.push(a.value); });
  await batch(async () => {
    a.value = 2;
    await batch(async () => { a.value = 3; });
    a.value = 4;
  });
  await settle();
  assert.deepEqual(seen, [1, 4]);
});

test('several signals written in one batch run each dependent effect exactly once', async () => {
  const a = signal(1);
  const b = signal(10);
  const c = signal(100);
  let both = 0, onlyC = 0;
  createEffect(() => { both += 1; a.value; b.value; });
  createEffect(() => { onlyC += 1; c.value; });
  await settle();
  await batch(async () => { a.value = 2; b.value = 20; c.value = 200; });
  await settle();
  assert.equal(both, 2);
  assert.equal(onlyC, 2);
});

test('an effect writing another signal inside a batch propagates', async () => {
  const a = signal(1);
  const b = signal(0);
  const seen = [];
  createEffect(() => { b.value = a.value * 2; });
  createEffect(() => { seen.push(b.value); });
  await settle();
  await batch(async () => { a.value = 5; });
  await settle();
  assert.equal(b.peek(), 10);
  assert.equal(seen.at(-1), 10);
});

test('computed values read inside the batch are not stale in the effect', async () => {
  const a = signal(1);
  const d = computed(a, async (v) => v * 2);
  await d.ready;
  const seen = [];
  createEffect(() => { seen.push([a.value, d.value]); });
  await batch(async () => { a.value = 3; });
  await settle();
  assert.deepEqual(seen.at(-1), [3, 6]);
});

test('batching still coalesces: one run per batch, not per write', async () => {
  const a = signal(0);
  let runs = 0;
  createEffect(() => { runs += 1; a.value; });
  await settle();
  await batch(async () => { for (let i = 1; i <= 5; i++) a.value = i; });
  await settle();
  assert.equal(runs, 2);
  assert.equal(a.peek(), 5);
});

test('SignalScope: createEffect re-runs after a synchronous batch()', async () => {
  const { createScope } = await import('../src/scope.mjs');
  const scope = createScope();
  const a = scope.signal(1);
  let runs = 0;
  scope.createEffect(() => { runs += 1; a.value; });
  await tick();
  scope.batch(() => { a.value = 2; });
  await tick();
  assert.equal(runs, 2);
});

test('a throwing batch() fn still flushes writes and rejects', async () => {
  const a = signal(1);
  let runs = 0;
  createEffect(() => { runs += 1; a.value; });
  await settle();
  await assert.rejects(batch(() => { a.value = 2; throw new Error('boom'); }), /boom/);
  await settle();
  assert.equal(runs, 2);
});
