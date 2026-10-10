import { Signal } from './signal.mjs';

/**
 * Adapters between signals and async iterables (issue #18).
 *
 * Nothing in this module touches the DOM: it relies only on `Promise`,
 * `queueMicrotask`, `Symbol.asyncIterator` and (optionally) `AbortSignal`,
 * so it runs unchanged in a Worker, an iframe, Node, Deno or Bun.
 */

const DONE = Object.freeze({ value: undefined, done: true });

/**
 * Turn a signal into an async iterable of its values.
 *
 * Works with anything that has `subscribe(fn) => unsubscribe` -- a
 * `Signal`, a `Computed`, a scoped signal, or a `BroadcastSignal`.
 *
 * The subscription is taken immediately (when this function is called), not
 * on the first `next()`, so with `latest: false` no change made after the
 * call is lost. End the iteration (`break`, `return()`, or abort) to release
 * it; an iterator that is never iterated keeps its subscription until then.
 *
 * - `latest: true` (default): conflating. Holds at most one pending value. A
 *   reader that falls behind gets the newest value, never the intermediate
 *   ones. Delivery to a reader that is already waiting is deferred by one
 *   microtask, so a synchronous burst of writes (several `.value = ...` in a
 *   row, or a `batch()` flush) reaches it as a single, final value.
 * - `latest: false`: buffering. Every change is queued in order. The queue
 *   is unbounded unless `limit` is set; past `limit` the OLDEST queued value
 *   is dropped.
 * - Either way, a notification equal (`Object.is`) to the previous one is
 *   not yielded again (see the comment at the `subscribe()` call).
 *
 * Aborting `options.signal` ends the iteration the same way `return()` does:
 * pending and future `next()` calls resolve `{ done: true }` (they do not
 * reject).
 *
 * @template T
 * @param {{ subscribe(fn: (value: T) => void): () => void }} source
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Ends the iteration when aborted.
 * @param {boolean} [options.initial=true] - Yield the value current at call time first.
 * @param {boolean} [options.latest=true] - Conflate (true) or buffer every change (false).
 * @param {number} [options.limit] - With `latest: false`, the maximum number of buffered values.
 * @returns {AsyncIterableIterator<T>}
 */
export function toAsyncIterable(source, options = {}) {
  const {
    signal: abortSignal,
    initial = true,
    latest = true,
    limit = Infinity,
  } = options;

  if (!source || typeof source.subscribe !== 'function') {
    throw new TypeError('toAsyncIterable: source must have a subscribe(fn) method');
  }
  if (limit !== Infinity && !(Number.isInteger(limit) && limit >= 1)) {
    throw new RangeError('toAsyncIterable: limit must be a positive integer');
  }

  let closed = false;
  let unsubscribe = null;
  /** Readers waiting on `next()`, oldest first. */
  const waiters = [];
  /** Buffered values (`latest: false`). */
  const buffer = [];
  /** Conflated pending value (`latest: true`). */
  let hasPending = false;
  let pending;
  let flushScheduled = false;

  const flush = () => {
    flushScheduled = false;
    if (closed || !hasPending || waiters.length === 0) return;
    const value = pending;
    hasPending = false;
    pending = undefined;
    waiters.shift()({ value, done: false });
  };

  const push = (value) => {
    if (closed) return;
    if (latest) {
      hasPending = true;
      pending = value;
      if (waiters.length > 0 && !flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
      return;
    }
    if (waiters.length > 0) {
      waiters.shift()({ value, done: false });
      return;
    }
    buffer.push(value);
    if (buffer.length > limit) buffer.shift();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (abortSignal) abortSignal.removeEventListener('abort', close);
    const unsub = unsubscribe;
    unsubscribe = null;
    if (unsub) unsub();
    buffer.length = 0;
    hasPending = false;
    pending = undefined;
    for (const resolve of waiters.splice(0)) resolve(DONE);
  };

  const iterator = {
    next() {
      // Only hand out a held value when nobody is queued ahead of this call
      // (a conflated value can be held while a flush for an earlier waiter
      // is still scheduled).
      if (waiters.length === 0 && (latest ? hasPending : buffer.length > 0)) {
        let value;
        if (latest) {
          value = pending;
          hasPending = false;
          pending = undefined;
        } else {
          value = buffer.shift();
        }
        return Promise.resolve({ value, done: false });
      }
      if (closed) return Promise.resolve(DONE);
      return new Promise((resolve) => waiters.push(resolve));
    },
    return(value) {
      close();
      return Promise.resolve({ value, done: true });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  if (abortSignal?.aborted) {
    closed = true;
    return iterator;
  }

  // `subscribe()` may call back synchronously with the current value (a
  // plain Signal, a settled Computed, a BroadcastSignal) or not at all (a
  // Computed whose first async run hasn't settled yet -- its first settled
  // value then arrives as an ordinary change). Only a synchronous call made
  // during `subscribe()` itself counts as the "initial" value.
  //
  // A notification equal (`Object.is`) to the previous one is dropped.
  // signalle only notifies on an actual change, but it reports the value
  // current when the notification fires, and a signal with computed
  // dependents fires after its propagation wave settles -- so a synchronous
  // burst of writes to it is reported once per write, each time with the
  // final value. Collapsing those repeats keeps `latest: false` from
  // yielding the same value several times in a row.
  let subscribing = true;
  let hasLast = false;
  let last;
  unsubscribe = source.subscribe((value) => {
    if (hasLast && Object.is(value, last)) return;
    hasLast = true;
    last = value;
    if (subscribing && !initial) return;
    push(value);
  });
  subscribing = false;

  if (abortSignal) abortSignal.addEventListener('abort', close, { once: true });

  return iterator;
}

/**
 * Drive a signal from an async iterable: the signal takes each yielded
 * value (`signal.value = v`, so subscribers are notified synchronously and
 * an `Object.is`-equal value is a no-op, exactly like any other write).
 *
 * Returns `{ signal, dispose, done }`:
 * - `signal`: a plain `Signal`, starting at `initial`. It is never disposed
 *   by this adapter; it keeps its last value after iteration ends.
 * - `dispose()`: stops writing to the signal and calls the iterator's
 *   `return()` (once). Idempotent; a no-op after the source has finished.
 *   Aborting `options.signal` does the same.
 * - `done`: settles when iteration ends. Resolves when the source completes
 *   or on `dispose()`/abort (without waiting for `return()` to finish, which
 *   an async generator suspended in an `await` can't do until that `await`
 *   settles); rejects with the error if the source's `next()` throws. It is
 *   pre-marked as handled, so an ignored failure does not surface as an
 *   unhandled rejection -- await or `.catch()` it to observe errors.
 *
 * If `options.signal` is already aborted, the iterable is never opened and
 * `done` resolves immediately.
 *
 * @template T
 * @param {AsyncIterable<T>} iterable
 * @param {T} initial
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {{ signal: Signal<T>, dispose: () => void, done: Promise<void>, [Symbol.dispose]: () => void }}
 */
export function fromAsyncIterable(iterable, initial, options = {}) {
  const { signal: abortSignal } = options;

  if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('fromAsyncIterable: argument must be an async iterable');
  }

  const sig = new Signal(initial);
  let stopped = false;
  let finished = false;
  let iterator = null;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => {});

  const dispose = () => {
    if (stopped) return;
    stopped = true;
    if (abortSignal) abortSignal.removeEventListener('abort', dispose);
    if (!finished && iterator && typeof iterator.return === 'function') {
      try {
        const result = iterator.return();
        if (result && typeof result.then === 'function') {
          result.then(undefined, () => {});
        }
      } catch {
        // A throwing return() has nowhere useful to report to once the
        // consumer has asked to stop.
      }
    }
    finished = true;
    resolveDone();
  };

  const handle = {
    signal: sig,
    dispose,
    done,
    [Symbol.dispose]: dispose,
  };

  if (abortSignal?.aborted) {
    stopped = true;
    finished = true;
    resolveDone();
    return handle;
  }

  iterator = iterable[Symbol.asyncIterator]();
  if (abortSignal) abortSignal.addEventListener('abort', dispose, { once: true });

  (async () => {
    try {
      while (!stopped) {
        const result = await iterator.next();
        if (stopped) return;
        if (result.done) break;
        sig.value = result.value;
      }
      finished = true;
      if (abortSignal) abortSignal.removeEventListener('abort', dispose);
      stopped = true;
      resolveDone();
    } catch (err) {
      if (stopped) return;
      finished = true;
      stopped = true;
      if (abortSignal) abortSignal.removeEventListener('abort', dispose);
      rejectDone(err);
    }
  })();

  return handle;
}
