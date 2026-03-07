import { LinkedList } from './linked-list.mjs';
import { Signal, Computed, effect } from './signal.mjs';

/**
 * An isolated signal scope with its own batch queue and tracking state.
 * Use createScope() to get an independent reactivity context safe for
 * multi-tenant server use.
 */
export class SignalScope {
  /** @type {LinkedList<Signal<any>>} */
  batchQueue = new LinkedList();
  /** @type {boolean} */
  batching = false;
  /** @type {((signal: Signal<any>) => void) | null} */
  trackSignalAccess = null;
  /** @type {Set<Function>} */
  #cleanups = new Set();

  /**
   * Create a new signal bound to this scope.
   * @template T
   * @param {T} initialValue
   * @returns {Signal<T>}
   */
  signal(initialValue) {
    const sig = new Signal(initialValue, this);
    return sig;
  }

  /**
   * Create a computed signal bound to this scope.
   * @template T
   * @param {Signal<any> | Signal<any>[]} deps
   * @param {(...args: any[]) => Promise<T>} fn
   * @returns {Computed<T>}
   */
  computed(deps, fn) {
    return new Computed(deps, fn);
  }

  /**
   * Create an effect bound to this scope.
   * @template T
   * @param {Signal<T>} sig
   * @param {(value: T) => void} fn
   * @returns {() => void}
   */
  effect(sig, fn) {
    const unsub = effect(sig, fn);
    this.#cleanups.add(unsub);
    return () => {
      unsub();
      this.#cleanups.delete(unsub);
    };
  }

  /**
   * Batch signal updates within this scope.
   * @param {() => Promise<void>} fn
   * @returns {Promise<void>}
   */
  async batch(fn) {
    try {
      this.batching = true;
      await fn();
    } finally {
      this.batching = false;
      const signals = this.batchQueue.toArray();
      this.batchQueue.clear();
      await Promise.all(signals.map((s) => s._notify()));
    }
  }

  /**
   * Run a function without tracking dependencies in this scope.
   * @template R
   * @param {() => R} fn
   * @returns {R}
   */
  untrack(fn) {
    const prev = this.trackSignalAccess;
    this.trackSignalAccess = null;
    try {
      return fn();
    } finally {
      this.trackSignalAccess = prev;
    }
  }

  /**
   * Dispose of all effects created in this scope.
   */
  dispose() {
    for (const cleanup of this.#cleanups) {
      cleanup();
    }
    this.#cleanups.clear();
    this.batchQueue.clear();
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

/**
 * Create an isolated signal scope.
 * @returns {{ signal: Function, computed: Function, effect: Function, batch: Function, untrack: Function, dispose: Function }}
 */
export const createScope = () => {
  const scope = new SignalScope();
  return {
    signal: scope.signal.bind(scope),
    computed: scope.computed.bind(scope),
    effect: scope.effect.bind(scope),
    batch: scope.batch.bind(scope),
    untrack: scope.untrack.bind(scope),
    dispose: scope.dispose.bind(scope),
    [Symbol.dispose]: scope.dispose.bind(scope),
  };
};
