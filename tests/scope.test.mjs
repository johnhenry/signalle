import test from 'node:test';
import assert from 'node:assert/strict';
import { createScope } from '../src/scope.mjs';

test('scope.signal: values are isolated per scope', () => {
  const scopeA = createScope();
  const scopeB = createScope();

  const a = scopeA.signal(1);
  const b = scopeB.signal(1);

  a.value = 2;

  assert.equal(a.value, 2);
  assert.equal(b.value, 1, 'Updating one scope\'s signal must not affect another scope\'s signal');

  scopeA.dispose();
  scopeB.dispose();
});

test('scope.computed: threads the scope through to the underlying Computed (item 6)', async () => {
  const scope = createScope();
  const count = scope.signal(1);
  const doubled = scope.computed(count, async (v) => v * 2);

  while (doubled.value === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(doubled.value, 2);

  // Reading `doubled.value` inside a scope.createEffect should register it
  // as a tracked dependency of *this scope's* tracker — which only works if
  // scope.computed() actually forwarded `this` (the scope) into the
  // Computed constructor, exactly like scope.signal() does for plain
  // signals. If scope.computed() silently dropped the scope (the bug being
  // fixed here), `doubled` would only ever report to the global tracker,
  // and this auto-tracking effect would never re-run.
  const seen = [];
  scope.createEffect(() => {
    seen.push(doubled.value);
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen, [2], 'Initial run should track doubled');

  count.value = 5;

  // Wait for the computed to recompute and the scoped effect to re-run.
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(seen, [2, 10], 'Scoped computed dependency changes should re-run the scoped effect');

  scope.dispose();
});

test('SignalScope#createEffect: auto-tracks only this scope\'s signals (basic case)', async () => {
  const scope = createScope();
  const count = scope.signal(0);
  const results = [];

  const cleanup = scope.createEffect(() => {
    results.push(count.value);
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(results, [0]);

  count.value = 1;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(results, [0, 1]);

  cleanup();
  count.value = 2;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(results, [0, 1], 'No further runs after cleanup');

  scope.dispose();
});

test('SignalScope#createEffect: tracker state stays isolated across two scopes even when interleaved (item 5 regression)', async () => {
  // This is the concrete regression test for the historical bug: Signal's
  // auto-dependency tracker used to be a single module-static field shared
  // by every scope, so one scope's createEffect could clobber another's
  // in-flight tracking. Here scope B's createEffect is created *while*
  // scope A's effect callback is still mid-execution (a nested/interleaved
  // call, simulating two logical contexts whose synchronous phases
  // interleave within a single event-loop tick). With shared tracker state,
  // scope B's `clearTracker()` (which used to mean "clear the one global
  // tracker") would wipe out scope A's still-active tracker, so `aSecond`
  // — read *after* the nested call — would never be recorded as a
  // dependency of scope A's effect.
  const scopeA = createScope();
  const scopeB = createScope();

  const aFirst = scopeA.signal('a-first');
  const aSecond = scopeA.signal('a-second');
  const bSig = scopeB.signal('b');

  const aRuns = [];
  const bRuns = [];
  let bEffectCreated = false;

  scopeA.createEffect(() => {
    const first = aFirst.value;

    // Nested/interleaved: scope B's own createEffect runs to completion
    // (including its own setTracker/clearTracker cycle) *inside* scope A's
    // still-in-progress tracking window. Only do this on the first run —
    // it's the interleaving itself that's under test, not repeated
    // creation of scope B effects on every scope A re-run.
    if (!bEffectCreated) {
      bEffectCreated = true;
      scopeB.createEffect(() => {
        bRuns.push(bSig.value);
      });
    }

    const second = aSecond.value;
    aRuns.push(`${first}:${second}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(aRuns, ['a-first:a-second']);
  assert.deepEqual(bRuns, ['b']);

  // If aSecond wasn't tracked (the bug), this update would never re-run
  // scope A's effect.
  aSecond.value = 'a-second-updated';
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(
    aRuns,
    ['a-first:a-second', 'a-first:a-second-updated'],
    'aSecond must be tracked as a dependency of scope A\'s effect despite the nested scope B effect running in between'
  );

  // And scope B's own tracking must likewise be unaffected by scope A.
  bSig.value = 'b-updated';
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(bRuns, ['b', 'b-updated']);

  scopeA.dispose();
  scopeB.dispose();
});

test('global createEffect does not auto-track scope-bound signals (documents the isolation boundary)', async () => {
  const { createEffect } = await import('../src/signal.mjs');
  const scope = createScope();
  const scopedSignal = scope.signal(0);

  const runs = [];
  createEffect(() => {
    runs.push(scopedSignal.value);
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runs.length, 1, 'Initial synchronous run always happens');

  scopedSignal.value = 1;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(
    runs.length,
    1,
    'The global createEffect must NOT auto-track a scope-bound signal — use scope.createEffect for that'
  );

  scope.dispose();
});
