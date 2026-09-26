import test from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untrack, createEffect } from '../src/signal.mjs';

test('signal creation and basic operations', async (t) => {
  const count = signal(0);
  assert.equal(count.value, 0, 'Initial value should be set correctly');
  
  count.value = 5;
  assert.equal(count.value, 5, 'Value should update when set');
  
  count.update(v => v + 1);
  assert.equal(count.value, 6, 'Update function should work correctly');
  
  // Test peek
  const originalValue = count.peek();
  assert.equal(originalValue, 6, 'peek() should return current value');
});

test('computed signals', async (t) => {
  const count = signal(1);
  const doubled = computed(count, async (v) => v * 2);
  
  // First computation might need time to complete
  while (doubled.value === undefined) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  assert.equal(doubled.value, 2, 'Computed should calculate correctly');
  
  count.value = 5;
  
  // Wait for computed to update
  while (doubled.value !== 10) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  assert.equal(doubled.value, 10, 'Computed should update when dependencies change');
  
  // Try setting computed directly (should throw)
  assert.throws(() => {
    doubled.value = 20;
  }, /Cannot modify computed signal directly/, 'Should not allow setting computed directly');
});

test('effect and subscriptions', async (t) => {
  const name = signal('John');
  const callCount = {value: 0};
  const values = [];
  
  const unsubscribe = effect(name, (value) => {
    callCount.value++;
    values.push(value);
  });
  
  // Initial effect call
  assert.equal(callCount.value, 1, 'Effect should be called immediately');
  assert.deepEqual(values, ['John'], 'Effect should receive initial value');
  
  // Update the signal
  name.value = 'Jane';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should be called when signal changes');
  assert.deepEqual(values, ['John', 'Jane'], 'Effect should receive updated value');
  
  // Multiple updates with same value
  name.value = 'Jane';
  name.value = 'Jane';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should not be called if value does not change');
  
  // Unsubscribe and verify no more calls
  unsubscribe();
  name.value = 'Bob';
  
  // Allow time for effects to process
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assert.equal(callCount.value, 2, 'Effect should not be called after unsubscribe');
  assert.deepEqual(values, ['John', 'Jane'], 'Values should not change after unsubscribe');
});

test('batching updates', async (t) => {
  const firstName = signal('John');
  const lastName = signal('Doe');
  const fullName = computed([firstName, lastName], async (first, last) => `${first} ${last}`);
  
  const updates = [];
  effect(fullName, (value) => {
    updates.push(value);
  });
  
  // Allow initial computation to complete
  while (updates.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Reset updates array
  updates.length = 0;
  
  await batch(async () => {
    firstName.value = 'Jane';
    lastName.value = 'Smith';
  });
  
  // Allow batch to complete
  await new Promise(resolve => setTimeout(resolve, 20));
  
  assert.equal(updates.length, 1, 'Batch should result in a single update');
  assert.equal(updates[0], 'Jane Smith', 'Batch should apply all updates correctly');
});

test('untrack function', async (t) => {
  const count = signal(0);
  let regularAccess = 0;
  let untrackedAccess = 0;
  
  createEffect(() => {
    // This will create a dependency
    regularAccess = count.value;
    
    // This should not create a dependency
    untrackedAccess = untrack(() => count.value);
  });
  
  // Initial run sets both values to 0
  assert.equal(regularAccess, 0);
  assert.equal(untrackedAccess, 0);
  
  // Update the signal
  count.value = 5;
  
  // Allow effect to run
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Regular access should be updated, but untracked should not have caused a rerun
  assert.equal(regularAccess, 5, 'Regular access should track and update');
  assert.equal(untrackedAccess, 5, 'Untracked access should still get latest value');
});

test('auto-dependency tracking with createEffect', async (t) => {
  const count = signal(0);
  const doubled = computed(count, async (v) => v * 2);
  const results = [];
  
  // Wait for initial computation to complete
  while (doubled.value === undefined) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  const cleanup = createEffect(() => {
    results.push({
      count: count.value,
      doubled: doubled.value
    });
  });
  
  // Allow initial effect to run
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Update one of the signals
  count.value = 5;
  
  // Allow effect to run
  await new Promise(resolve => setTimeout(resolve, 20));
  
  // We should have two results: initial and after update
  assert.equal(results.length, 2, 'Effect should run twice');
  assert.deepEqual(results[0], { count: 0, doubled: 0 }, 'Initial values should be tracked');
  assert.deepEqual(results[1], { count: 5, doubled: 10 }, 'Updates should be tracked');
  
  // Clean up
  cleanup();
  
  // Update again
  count.value = 10;
  
  // Allow time
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Should still have only two results
  assert.equal(results.length, 2, 'Effect should not run after cleanup');
});

test('diamond dependency: a computed depending on two computeds sharing a common signal converges to the correct value', async (t) => {
  // Regression test for a real bug: Computed used to track dependency
  // freshness with a single scalar `#lastVersion = Math.max(...)` across
  // ALL of its dependencies. Since every signal's version counter starts
  // at 0 and increments by 1 per change, two independent dependencies'
  // versions routinely collide on the same number — and a single collapsed
  // "high water mark" can't tell "dependency A is still stale" apart from
  // "dependency B's newest version happens to equal what I recorded". That
  // silently swallowed genuine updates. Staggering b's and c's resolution
  // times (b resolves slower than c) reproduces the exact interleaving
  // that used to corrupt `a`'s final value.
  const d = signal(1);
  const b = computed(d, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return v * 2;
  });
  const c = computed(d, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return v * 3;
  });
  const a = computed([b, c], async (bv, cv) => bv + cv);

  // Wait for the diamond to fully settle after construction.
  while (a.value !== 5) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(a.value, 5, 'Initial diamond should settle at 1*2 + 1*3');

  d.value = 5;

  // Give both legs of the diamond time to settle before sampling for
  // stability below. This must exceed `b`'s 30ms delay: since the
  // propagation-wave fix for issue #7, `a` only recomputes once *both* `b`
  // and `c` have settled (previously `a` recomputed eagerly the moment
  // `c` alone settled at ~5ms, producing a wrong intermediate total before
  // catching up once `b` settled too -- so sampling "has `a.value` changed
  // in the last 20ms" as early as t=0 used to reliably observe that
  // intermediate change). Now that `a` jumps straight from the stale value
  // to the correct one in a single step at ~30ms, sampling has to start
  // after that step, or it can mistake the still-stale value for a
  // already-converged one.
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Poll until things stop changing, then assert the *correct* converged
  // value — the bug produced a permanently wrong value (8 instead of 25 in
  // one reproduction) because a later dependency update got masked.
  let value;
  do {
    value = a.value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (a.value !== value);

  assert.equal(a.value, 25, 'Diamond must converge to 5*2 + 5*3, not a stale/masked intermediate value');
});

test('batch(): a computed depending on several signals written in one batch() recomputes exactly once', async (t) => {
  // Regression test for https://github.com/johnhenry/signalle/issues/7:
  // "batch() still notifies dependants once per changed signal, causing
  // extra recomputes". Reported from a real physics-sim showcase (ORRERY):
  // writing several signals feeding one computed inside a single batch()
  // per animation frame made that computed recompute multiple times a
  // frame instead of once.
  const y = signal(0);
  const vy = signal(1);
  const dt = signal(0.016);

  let recomputeCount = 0;
  const y1 = computed([y, vy, dt], (yv, vyv, dtv) => {
    recomputeCount++;
    return yv + vyv * dtv;
  });

  // Let the initial computation settle before measuring.
  while (y1.value === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  recomputeCount = 0;

  await batch(async () => {
    y.value = 5;
    vy.value = 2;
    dt.value = 0.017;
  });

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(
    recomputeCount,
    1,
    'A computed depending on 3 signals all written in one batch() must recompute exactly once, not once per changed input'
  );
  assert.equal(y1.value, 5 + 2 * 0.017, 'The single recompute must reflect all three writes');
});

test('propagation wave: a computed whose dependencies are themselves still-settling computeds recomputes exactly once', async (t) => {
  // Deeper root cause behind issue #7, confirmed by direct investigation
  // (not just trusting the issue's own diagnosis): the reported symptom —
  // "y1 = computed(...) feeds bounce = computed(...); ... makes y1
  // recompute ~2x and bounce ~3x per frame" — does NOT reproduce for a
  // single computed depending directly on several raw signals changed in
  // one batch() (see the test above; that case was already deduplicated
  // by the existing per-dependency version tracking + recompute
  // serialization). It DOES reproduce, exactly as described, once the
  // dependency graph has more than one level: two signals written in the
  // same batch(), each feeding its OWN computed, both of those feeding a
  // shared downstream computed. Because the two upstream computeds settle
  // asynchronously at different times (very plausible for any non-trivial
  // physics/animation compute chain — exactly ORRERY's shape), the
  // downstream computed used to recompute once per upstream settle event,
  // AND observe a transient wrong intermediate total in between (see the
  // `seenValues` assertion below), even though `batch()` itself was
  // already flushed by the time either upstream computed settled.
  const d1 = signal(1);
  const d2 = signal(1);

  const b = computed(d1, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    return v * 2;
  });
  const c = computed(d2, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return v * 3;
  });

  let recomputeCount = 0;
  const a = computed([b, c], (bv, cv) => {
    recomputeCount++;
    return bv + cv;
  });

  const seenValues = [];
  effect(a, (v) => { seenValues.push(v); });

  while (a.value !== 5) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  recomputeCount = 0;
  seenValues.length = 0;

  await batch(async () => {
    d1.value = 5;
    d2.value = 5;
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(a.value, 25, 'Final value must be correct: 5*2 + 5*3');
  assert.equal(
    recomputeCount,
    1,
    'A computed depending on two other computeds that settle at different times must recompute exactly once for this wave, not once per upstream settle event'
  );
  assert.deepEqual(
    seenValues,
    [25],
    'The effect must only ever observe the final, fully-settled value — never a transient wrong intermediate total (e.g. 17, computed from the fast leg alone before the slow leg settled)'
  );
});

test('Computed: overlapping recomputes do not clobber a pending [value, cleanup] side effect', async (t) => {
  // Regression test for a real bug: Computed#recompute()'s reentrancy guard
  // (`if (this.#computePromise) await this.#computePromise`) only ever
  // pointed at the constructor's *original* initial-computation promise —
  // it was never updated on subsequent calls, so it didn't actually
  // serialize later overlapping recompute() calls (e.g. two dependencies
  // notifying at nearly the same time). Two overlapping #recomputeOnce()
  // passes could each read `#cleanup` before the other had written its own
  // new cleanup, silently clobbering (and thus leaking — never invoking) the
  // first pass's cleanup function.
  const d = signal(1);
  const b = computed(d, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return v * 2;
  });
  const c = computed(d, async (v) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return v * 3;
  });

  // Track how many compute passes have started their side effect but not
  // yet had it cleaned up. This must never exceed 1: whenever a NEW compute
  // pass starts, the PREVIOUS pass's cleanup must run first (or on its
  // heels) — never be skipped/overwritten. Track a running max rather than
  // per-window deltas, since a pass started before a given "settle" point
  // can legitimately have its cleanup invoked after it (that's not a leak).
  let outstanding = 0;
  let maxOutstanding = 0;
  const a = computed([b, c], async (bv, cv) => {
    outstanding++;
    maxOutstanding = Math.max(maxOutstanding, outstanding);
    const cleanup = () => { outstanding--; };
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [bv + cv, cleanup];
  });

  while (a.value !== 5) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  d.value = 5;

  let value;
  do {
    value = a.value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (a.value !== value);

  assert.equal(a.value, 25, 'Should converge to the correct final value');
  assert.equal(
    outstanding,
    1,
    'Exactly one cleanup should be outstanding (the current pass) once settled'
  );
  assert.equal(
    maxOutstanding,
    1,
    'No more than one pass\'s side effect should ever be open at once — a second overlapping compute must not start until the first\'s cleanup has run, or a cleanup gets silently clobbered (leaked) instead of invoked'
  );
});

test('batch: nested batch() calls do not prematurely flush the outer batch', async (t) => {
  // Regression test for a real bug: batch()'s shared static queue was
  // flushed by whichever batch() call's `finally` ran first — including an
  // INNER batch() nested inside an outer one. That meant an inner batch()
  // finishing would flip the shared `#batching` flag off and drain
  // `#batchQueue` early, breaking the outer batch's atomicity: updates made
  // after the inner batch (but still inside the outer batch) would fire
  // immediately/unbatched instead of being deferred to the outer batch's
  // own flush.
  const s1 = signal('a');
  const s2 = signal('b');
  const s3 = signal('c');

  const events = [];
  effect(s1, (v) => events.push(`s1:${v}`));
  effect(s2, (v) => events.push(`s2:${v}`));
  effect(s3, (v) => events.push(`s3:${v}`));
  events.length = 0; // drop the immediate initial-subscribe calls

  await batch(async () => {
    s1.value = 'a2';
    await batch(async () => {
      s2.value = 'b2';
    });
    // At this point the shared batch queue must still hold s1's queued
    // update, and #batching must still be true — the inner batch() must
    // not have flushed it. Assert this indirectly: neither s1's nor s3's
    // effect may have fired yet.
    s3.value = 'c2';
    assert.deepEqual(events, [], 'No effects should fire until the OUTER batch completes');
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(
    events,
    ['s1:a2', 's2:b2', 's3:c2'],
    'All three updates should flush together once the outer batch completes'
  );
});

test('Computed: dispose() clears subscribers, and update() cannot bypass the read-only guard', async (t) => {
  // Regression test for two related real bugs:
  //  1. Computed#dispose() never called super.dispose(), so subscribers
  //     added via subscribe() were never released — they stayed callable
  //     for the lifetime of the (supposedly torn-down) instance.
  //  2. Computed inherited Signal#update() unmodified, so it could bypass
  //     the "Cannot modify computed signal directly" guard that the `value`
  //     setter enforces — including on an already-disposed computed.
  const s = signal(1);
  const c = computed(s, async (v) => v * 2);

  while (c.value === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  let calls = 0;
  c.subscribe(() => calls++);
  assert.equal(calls, 1, 'subscribe() calls back immediately once initialized');

  c.dispose();

  assert.throws(
    () => c.update((v) => (v ?? 0) + 100),
    /Cannot modify computed signal directly/,
    'update() must be blocked exactly like the value setter'
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1, 'A disposed computed must not re-notify subscribers it was supposed to have released');
});

test('linked list implementation', async (t) => {
  // Import the LinkedList directly to test it
  const { LinkedList } = await import('../src/linked-list.mjs');
  
  const list = new LinkedList();
  
  // Test adding items
  const removeA = list.add('A');
  list.add('B');
  list.add('C');
  
  assert.equal(list.size, 3, 'Size should be correct');
  assert.deepEqual(list.toArray(), ['A', 'B', 'C'], 'Items should be in correct order');
  
  // Test removing an item
  removeA();
  assert.equal(list.size, 2, 'Size should decrease after removal');
  assert.deepEqual(list.toArray(), ['B', 'C'], 'Items should be updated after removal');
  
  // Test contains
  assert.equal(list.has('B'), true, 'Should find existing item');
  assert.equal(list.has('A'), false, 'Should not find removed item');
  
  // Test forEach
  const values = [];
  list.forEach((value) => {
    values.push(value);
  });
  assert.deepEqual(values, ['B', 'C'], 'forEach should iterate over all items');
  
  // Test iteration
  const iteratedValues = [...list];
  assert.deepEqual(iteratedValues, ['B', 'C'], 'Iterator should work correctly');
  
  // Test clear
  list.clear();
  assert.equal(list.size, 0, 'Size should be zero after clearing');
  assert.deepEqual(list.toArray(), [], 'List should be empty after clearing');
});
