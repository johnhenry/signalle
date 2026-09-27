import test from 'node:test';
import assert from 'node:assert/strict';

// Node.js has provided a native, spec-compliant `BroadcastChannel` global
// since v18 (this package's minimum supported version), so on Node it can
// be exercised directly. In case it's ever unavailable (e.g. a stripped-down
// or very old runtime), fall back to a minimal in-process mock so the test
// file still runs rather than crashing at import time, mirroring the
// jsdom-availability guard used in tests/dom.test.mjs.
const hasNativeBroadcastChannel = typeof BroadcastChannel === 'function';

if (!hasNativeBroadcastChannel) {
  // Minimal mock: routes messages between all channels sharing a name,
  // within this process, closely matching the subset of the BroadcastChannel
  // API that src/broadcast.mjs relies on (constructor, onmessage, postMessage, close).
  const channelsByName = new Map();

  globalThis.BroadcastChannel = class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      if (!channelsByName.has(name)) {
        channelsByName.set(name, new Set());
      }
      channelsByName.get(name).add(this);
    }

    postMessage(data) {
      const peers = channelsByName.get(this.name) ?? new Set();
      for (const peer of peers) {
        if (peer === this) continue; // BroadcastChannel never echoes to self
        peer.onmessage?.({ data });
      }
    }

    close() {
      channelsByName.get(this.name)?.delete(this);
    }
  };
}

const { createBroadcastSignal, generateWorkerCode } = await import('../src/broadcast.mjs');

test('createBroadcastSignal: construction and initial value', () => {
  const sig = createBroadcastSignal('initial', 'test-construction');
  assert.equal(sig.value, 'initial', 'Should start with the given initial value');
  sig.dispose();
});

test('createBroadcastSignal: setting a value updates it locally and notifies subscribers', () => {
  const sig = createBroadcastSignal(0, 'test-local-update');
  const seen = [];

  sig.subscribe((value) => {
    seen.push(value);
  });

  sig.value = 1;
  sig.value = 2;

  assert.deepEqual(seen, [0, 1, 2], 'Subscriber should be called immediately, then on each change');
  assert.equal(sig.value, 2, 'value getter should reflect the latest set value');

  sig.dispose();
});

test('createBroadcastSignal: setting the same value again is a no-op', () => {
  // Note: Object.is is checked against the raw incoming value *before*
  // structuredClone() runs (see the "same object reference" test below for
  // the object/array case). For primitives this is straightforward since
  // there's no reference identity to worry about.
  const sig = createBroadcastSignal(1, 'test-no-op');
  const seen = [];
  sig.subscribe((value) => seen.push(value));

  sig.value = 1; // Object.is-equal primitive value

  // Only the initial subscribe call should have fired.
  assert.equal(seen.length, 1, 'Setting an Object.is-equal primitive value should not notify again');

  sig.dispose();
});

test('createBroadcastSignal: setting the same object reference again is a no-op', () => {
  // Regression test for a real bug: the equality check compared
  // `structuredClone(newValue)` against the current value, but
  // structuredClone() always returns a fresh reference for objects/arrays —
  // so even re-assigning the *exact same, unchanged* object reference could
  // never short-circuit. Every such "no-op" set still bumped the version,
  // re-broadcast to other tabs, and re-notified local subscribers. The fix
  // compares the raw incoming value (before cloning) against the current
  // value.
  const sig = createBroadcastSignal({ a: 1 }, 'test-object-no-op');
  const seen = [];
  sig.subscribe((value) => seen.push(value));

  const sameRef = sig.value;
  sig.value = sameRef; // Object.is-equal reference, unchanged

  assert.equal(seen.length, 1, 'Re-setting the same object reference unchanged should not notify again');

  sig.dispose();
});

test('createBroadcastSignal: unsubscribe stops future notifications', () => {
  const sig = createBroadcastSignal(0, 'test-unsubscribe');
  const seen = [];

  const unsubscribe = sig.subscribe((value) => seen.push(value));
  sig.value = 1;
  unsubscribe();
  sig.value = 2;

  assert.deepEqual(seen, [0, 1], 'No notifications should arrive after unsubscribe');

  sig.dispose();
});

test('createBroadcastSignal: two signals on the same channel name stay in sync', async () => {
  const a = createBroadcastSignal('start', 'test-sync-channel');
  const b = createBroadcastSignal('start', 'test-sync-channel');

  const bValues = [];
  b.subscribe((value) => bValues.push(value));

  a.value = 'updated-from-a';

  // BroadcastChannel delivery is asynchronous even within a single process.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(b.value, 'updated-from-a', 'Peer signal should receive the broadcast update');
  assert.deepEqual(bValues, ['start', 'updated-from-a']);

  a.dispose();
  b.dispose();
});

test('createBroadcastSignal: signals on different channel names do not interfere', async () => {
  const a = createBroadcastSignal('a-value', 'test-channel-a');
  const b = createBroadcastSignal('b-value', 'test-channel-b');

  a.value = 'a-changed';

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(b.value, 'b-value', 'Signal on a different channel name should be unaffected');

  a.dispose();
  b.dispose();
});

test('createBroadcastSignal: a late-joining signal syncs to the current value instead of starting stale', async () => {
  // Regression test for a real bug (#9): each instance used to track its
  // own version counter starting at 0, with no way for a newly-created
  // instance to learn what version/value peers that were already
  // broadcasting had reached. A tab opened after others had already
  // written several times would start from its own local initial value
  // and never catch up -- and its own subsequent writes, still counted
  // from its own low version number, would be ignored by the already-
  // ahead peers, so the two views diverged permanently.
  const a = createBroadcastSignal(0, 'test-late-join');
  a.value = 1;
  a.value = 2;
  a.value = 3;

  // C joins the channel well after A has already written three times,
  // with a totally different initial value of its own.
  const c = createBroadcastSignal(-1, 'test-late-join');
  const seen = [];
  c.subscribe((value) => seen.push(value));

  // BroadcastChannel delivery (and the sync-request/state round trip) is
  // asynchronous even within a single process.
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(
    c.value,
    3,
    'Late-joining signal should adopt the current value from the already-broadcasting peer instead of staying at its own stale initial value'
  );

  // The late joiner's own next write must also be accepted by the
  // pre-existing peer -- this was the second half of the bug: a
  // newcomer's version counter used to restart at 0/1, which a peer
  // already at version 3 would simply ignore as "not newer."
  c.value = 99;
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(
    a.value,
    99,
    "Late joiner's write should be accepted by the pre-existing peer once it has caught up"
  );

  a.dispose();
  c.dispose();
});

test('createBroadcastSignal: three instances all converge regardless of join order', async () => {
  const a = createBroadcastSignal('a-initial', 'test-three-way-join');
  a.value = 'first';
  a.value = 'second';

  const b = createBroadcastSignal('b-initial', 'test-three-way-join');
  await new Promise((resolve) => setTimeout(resolve, 30));

  const c = createBroadcastSignal('c-initial', 'test-three-way-join');
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(a.value, 'second');
  assert.equal(b.value, 'second', 'B should have caught up to the value A had already reached before B joined');
  assert.equal(c.value, 'second', 'C should have caught up even though it joined after both A and B');

  a.dispose();
  b.dispose();
  c.dispose();
});

test('createBroadcastSignal: dispose() clears effects and closes the channel', () => {
  const sig = createBroadcastSignal(0, 'test-dispose');
  const seen = [];
  sig.subscribe((value) => seen.push(value));

  sig.dispose();

  // After dispose, mutating the underlying value directly isn't possible via
  // the public API, but we can at least assert dispose doesn't throw and
  // that it's safe to call more than once.
  assert.doesNotThrow(() => sig.dispose(), 'dispose() should be idempotent-safe');
});

test('generateWorkerCode: produces a string containing the signal setup code', () => {
  const code = generateWorkerCode('const s = createBroadcastSignal(0, "worker-chan");');

  assert.equal(typeof code, 'string');
  assert.ok(code.includes('createBroadcastSignal'), 'Should wire up createBroadcastSignal in worker scope');
  assert.ok(
    code.includes('const s = createBroadcastSignal(0, "worker-chan");'),
    'Should embed the user-provided signal code verbatim'
  );
});

test('generateWorkerCode: is evaluable and produces a working BroadcastSignal', async () => {
  const code = generateWorkerCode(
    'globalThis.__testResult = createBroadcastSignal(0, "test-generated-worker-code");'
  );

  // eslint-disable-next-line no-eval
  (0, eval)(code);

  assert.ok(globalThis.__testResult, 'Evaluated worker code should construct a signal');
  assert.equal(globalThis.__testResult.value, 0);

  globalThis.__testResult.dispose();
  delete globalThis.__testResult;
});

test('generateWorkerCode: respects a custom factory function name', () => {
  const code = generateWorkerCode('/* noop */', 'myCustomFactory');
  assert.ok(code.includes('const myCustomFactory ='), 'Should use the custom name for the factory binding');
});
