import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { signal, computed, batch } from '../src/signal.mjs';
import { toAsyncIterable, fromAsyncIterable } from '../src/iterable.mjs';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a signal so the test can see how many subscriptions are live.
 * toAsyncIterable only needs `subscribe(fn) => unsubscribe`.
 */
const spy = (sig) => {
  const source = {
    active: 0,
    subscribe(fn) {
      source.active++;
      const unsub = sig.subscribe(fn);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        source.active--;
        unsub();
      };
    },
  };
  return source;
};

/** Pull `n` values from an iterator. */
const take = async (it, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await it.next();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
};

// --- toAsyncIterable: conflation vs buffering --------------------------------

test('toAsyncIterable (latest, default): yields the current value first', async () => {
  const s = signal(1);
  const it = toAsyncIterable(s);
  assert.deepEqual(await it.next(), { value: 1, done: false });
  await it.return();
});

test('toAsyncIterable (latest): a slow reader gets the newest value, not the intermediate ones', async () => {
  const s = signal(0);
  const it = toAsyncIterable(s);
  assert.equal((await it.next()).value, 0);

  // Nobody is reading while these land.
  s.value = 1;
  s.value = 2;
  s.value = 3;
  await tick();
  s.value = 4;

  assert.deepEqual(await it.next(), { value: 4, done: false });
  await it.return();
});

test('toAsyncIterable (latest): a synchronous burst reaches a waiting reader as one final value', async () => {
  const s = signal('a');
  const it = toAsyncIterable(s, { initial: false });
  const pending = it.next(); // waiting before any write

  s.value = 'b';
  s.value = 'c';
  s.value = 'd';

  assert.deepEqual(await pending, { value: 'd', done: false });
  await it.return();
});

test('toAsyncIterable (latest): a batch() flush arrives as one value', async () => {
  const s = signal(0);
  const it = toAsyncIterable(s, { initial: false });
  const pending = it.next();
  batch(() => {
    s.value = 1;
    s.value = 2;
  });
  assert.deepEqual(await pending, { value: 2, done: false });
  await it.return();
});

test('toAsyncIterable (latest): concurrent next() calls are served in order', async () => {
  const s = signal(0);
  const it = toAsyncIterable(s, { initial: false });
  const first = it.next();
  s.value = 1; // flush for `first` is scheduled, not yet delivered
  const second = it.next(); // must queue behind `first`, not steal its value
  await tick();
  s.value = 2;
  assert.deepEqual(await first, { value: 1, done: false });
  assert.deepEqual(await second, { value: 2, done: false });
  await it.return();
});

test('toAsyncIterable (initial: false): skips the current value', async () => {
  const s = signal('now');
  const it = toAsyncIterable(s, { initial: false });
  const pending = it.next();
  await tick();
  s.value = 'later';
  assert.deepEqual(await pending, { value: 'later', done: false });
  await it.return();
});

test('toAsyncIterable (latest: false): buffers every change in order', async () => {
  const s = signal(0);
  const it = toAsyncIterable(s, { latest: false });
  s.value = 1;
  s.value = 2;
  s.value = 3;
  assert.deepEqual(await take(it, 4), [0, 1, 2, 3]);

  // And a waiting reader gets each change, not a conflated one.
  const a = it.next();
  const b = it.next();
  s.value = 4;
  s.value = 5;
  assert.deepEqual([await a, await b].map((r) => r.value), [4, 5]);
  await it.return();
});

test('toAsyncIterable (latest: false, limit): drops the oldest buffered values past the limit', async () => {
  const s = signal(0);
  const it = toAsyncIterable(s, { latest: false, limit: 2 });
  s.value = 1;
  s.value = 2;
  s.value = 3;
  assert.deepEqual(await take(it, 2), [2, 3]);
  await it.return();
});

test('toAsyncIterable: rejects a bad limit and a non-subscribable source', () => {
  const s = signal(0);
  assert.throws(() => toAsyncIterable(s, { latest: false, limit: 0 }), RangeError);
  assert.throws(() => toAsyncIterable(s, { latest: false, limit: 1.5 }), RangeError);
  assert.throws(() => toAsyncIterable({}), TypeError);
});

// --- toAsyncIterable: cleanup ---------------------------------------------------

test('toAsyncIterable: break in for-await unsubscribes', async () => {
  const s = signal(0);
  const source = spy(s);
  const seen = [];
  const writer = (async () => {
    for (let i = 1; i <= 5; i++) {
      await tick();
      s.value = i;
    }
  })();

  for await (const v of toAsyncIterable(source)) {
    assert.equal(source.active, 1);
    seen.push(v);
    if (v >= 2) break;
  }
  assert.equal(source.active, 0, 'break must release the subscription');
  assert.deepEqual(seen, [0, 1, 2]);
  await writer;
});

test('toAsyncIterable: return() unsubscribes and ends pending and later next() calls', async () => {
  const s = signal(0);
  const source = spy(s);
  const it = toAsyncIterable(source, { initial: false });
  const pending = it.next();
  assert.equal(source.active, 1);

  assert.deepEqual(await it.return('bye'), { value: 'bye', done: true });
  assert.equal(source.active, 0);
  assert.deepEqual(await pending, { value: undefined, done: true });
  s.value = 1;
  assert.deepEqual(await it.next(), { value: undefined, done: true });
});

test('toAsyncIterable: abort unsubscribes and ends iteration without throwing', async () => {
  const s = signal(0);
  const source = spy(s);
  const ac = new AbortController();
  const seen = [];
  const loop = (async () => {
    for await (const v of toAsyncIterable(source, { signal: ac.signal })) seen.push(v);
  })();
  await tick();
  s.value = 1;
  await tick();
  ac.abort();
  await loop; // resolves, does not reject
  assert.equal(source.active, 0);
  assert.deepEqual(seen, [0, 1]);
});

test('toAsyncIterable: an already-aborted signal never subscribes', async () => {
  const source = spy(signal(0));
  const it = toAsyncIterable(source, { signal: AbortSignal.abort() });
  assert.equal(source.active, 0);
  assert.deepEqual(await it.next(), { value: undefined, done: true });
});

// --- toAsyncIterable: computed timing ----------------------------------------

test('toAsyncIterable: an async computed yields settled values, never the pre-settle undefined', async () => {
  const n = signal(1);
  const doubled = computed(n, async (v) => v * 2);
  const it = toAsyncIterable(doubled); // first run has not settled yet
  assert.deepEqual(await it.next(), { value: 2, done: false });
  n.value = 5;
  assert.deepEqual(await it.next(), { value: 10, done: false });
  await it.return();
});

test('toAsyncIterable: a synchronous computed yields its value immediately', async () => {
  const n = signal(2);
  const sq = computed(n, (v) => v * v);
  const it = toAsyncIterable(sq);
  assert.deepEqual(await it.next(), { value: 4, done: false });
  await it.return();
});

// --- fromAsyncIterable -------------------------------------------------------

test('fromAsyncIterable: the signal takes each yielded value, and done resolves at the end', async () => {
  async function* source() {
    yield 1;
    yield 2;
    yield 3;
  }
  const { signal: s, done } = fromAsyncIterable(source(), 0);
  assert.equal(s.value, 0, 'starts at the initial value');
  const seen = [];
  s.subscribe((v) => seen.push(v));
  await done;
  assert.deepEqual(seen, [0, 1, 2, 3]);
  assert.equal(s.value, 3, 'keeps the last value after the source ends');
});

test('fromAsyncIterable: dispose() calls the source\'s return() and stops writes', async () => {
  let finallyRan = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  async function* source() {
    try {
      yield 1;
      await gate; // suspended in an await, not at a yield
      yield 2;
    } finally {
      finallyRan = true;
    }
  }
  const { signal: s, dispose, done } = fromAsyncIterable(source(), 0);
  while (s.value !== 1) await tick();

  dispose();
  await done; // settles promptly even though the generator is mid-await
  assert.equal(s.value, 1);

  release();
  await tick();
  assert.equal(finallyRan, true, 'return() ran the generator\'s finally');
  assert.equal(s.value, 1, 'no write after dispose');
});

test('fromAsyncIterable: return() is called once, and not after the source finished', async () => {
  let returns = 0;
  let i = 0;
  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise((resolve) => setTimeout(() => resolve({ value: ++i, done: false }), 5)),
        return: async () => { returns++; return { value: undefined, done: true }; },
      };
    },
  };
  const h = fromAsyncIterable(iterable, 0);
  await tick(12);
  h.dispose();
  h.dispose();
  h[Symbol.dispose]();
  await h.done;
  assert.equal(returns, 1);

  async function* finite() { yield 'x'; }
  const g = finite();
  const original = g.return.bind(g);
  let finiteReturns = 0;
  g.return = (v) => { finiteReturns++; return original(v); };
  const h2 = fromAsyncIterable(g, '');
  await h2.done;
  h2.dispose();
  assert.equal(finiteReturns, 0, 'nothing to close once the source is done');
});

test('fromAsyncIterable: abort calls return(); an already-aborted signal never opens the source', async () => {
  let finallyRan = false;
  async function* forever() {
    try {
      for (let i = 0; ; i++) {
        yield i;
        await tick(2);
      }
    } finally {
      finallyRan = true;
    }
  }
  const ac = new AbortController();
  const { signal: s, done } = fromAsyncIterable(forever(), -1, { signal: ac.signal });
  while (s.value < 2) await tick(2);
  ac.abort();
  await done;
  const last = s.value;
  await tick(20);
  assert.equal(finallyRan, true);
  assert.equal(s.value, last, 'no write after abort');

  let opened = false;
  const lazy = { [Symbol.asyncIterator]() { opened = true; return forever(); } };
  const h = fromAsyncIterable(lazy, 'init', { signal: AbortSignal.abort() });
  await h.done;
  assert.equal(opened, false);
  assert.equal(h.signal.value, 'init');
});

test('fromAsyncIterable: done rejects with the source error; the signal keeps its last value', async () => {
  const boom = new Error('boom');
  async function* failing() {
    yield 'ok';
    throw boom;
  }
  const { signal: s, done } = fromAsyncIterable(failing(), '');
  await assert.rejects(done, boom);
  assert.equal(s.value, 'ok');
});

test('fromAsyncIterable: an ignored failure is not an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    async function* failing() { throw new Error('ignored'); }
    fromAsyncIterable(failing(), 0); // `done` deliberately not observed
    await tick(20);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test('fromAsyncIterable: rejects a non-async-iterable', () => {
  assert.throws(() => fromAsyncIterable([1, 2], 0), TypeError);
  assert.throws(() => fromAsyncIterable(null, 0), TypeError);
});

// --- Together, and off the main thread ---------------------------------------

test('round trip: fromAsyncIterable(toAsyncIterable(s)) mirrors s', async () => {
  const s = signal(0);
  const source = spy(s);
  const mirror = fromAsyncIterable(toAsyncIterable(source, { latest: false }), null);
  await tick();
  assert.equal(mirror.signal.value, 0);
  s.value = 1;
  await tick();
  assert.equal(mirror.signal.value, 1);
  mirror.dispose(); // return() on the toAsyncIterable iterator -> unsubscribes
  await mirror.done;
  assert.equal(source.active, 0);
});

test('no DOM: the adapters run inside a worker thread', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const url = new URL('../src/iterable.mjs', import.meta.url).href;
  const signalUrl = new URL('../src/signal.mjs', import.meta.url).href;
  const code = `
    import { parentPort } from 'node:worker_threads';
    const { toAsyncIterable, fromAsyncIterable } = await import(${JSON.stringify(url)});
    const { signal } = await import(${JSON.stringify(signalUrl)});
    const s = signal(1);
    const out = [];
    const it = toAsyncIterable(s, { latest: false });
    s.value = 2;
    for await (const v of it) { out.push(v); if (v === 2) break; }
    async function* gen() { yield 'a'; yield 'b'; }
    const h = fromAsyncIterable(gen(), '');
    await h.done;
    out.push(h.signal.value, typeof document);
    parentPort.postMessage(out);
  `;
  const worker = new Worker(code, { eval: true, type: 'module' });
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  await worker.terminate();
  assert.deepEqual(result, [1, 2, 'b', 'undefined']);
});

test('toAsyncIterable: a signal with computed dependents does not yield its final value once per write', async () => {
  // A write to a signal that has computed dependents notifies its own
  // subscribers only after the propagation wave settles, with the value
  // current at that point -- so three synchronous writes arrive as three
  // notifications of the last value. The iterator must not yield it 3 times.
  const s = signal(0);
  computed(s, (v) => v * 2);
  const buffered = toAsyncIterable(s, { latest: false });
  const conflated = toAsyncIterable(s);
  assert.equal((await conflated.next()).value, 0);
  s.value = 1;
  s.value = 2;
  s.value = 3;
  await tick(10);
  s.value = 4;
  await tick(10);
  assert.deepEqual(await take(buffered, 3), [0, 3, 4]);
  assert.deepEqual(await conflated.next(), { value: 4, done: false });
  await buffered.return();
  await conflated.return();
});
