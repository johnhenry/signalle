import { LinkedList } from './linked-list.mjs';

/**
 * @template T
 */
export class Signal {
  /** @type {T} */
  #value;
  /** @type {number} */
  #version = 0;
  /** @type {LinkedList<(value: T) => void>} */
  #effects = new LinkedList();
  /** @type {LinkedList<Computed<any>>} */
  #computedDeps = new LinkedList();
  /** @type {LinkedList<Signal<any>>} */
  static #batchQueue = new LinkedList();
  /** @type {boolean} */
  static #batching = false;
  /**
   * Nesting depth of active `batch()` calls. Needed because `#batchQueue`
   * is a single shared queue: without tracking depth, an inner `batch()`
   * call's `finally` block would drain and flush the *entire* queue
   * (including updates queued by an outer, still-in-progress `batch()`)
   * as soon as the inner call finishes, instead of waiting for the
   * outermost `batch()` to complete. Only the outermost call may flip
   * `#batching` back off and flush the queue.
   * @type {number}
   */
  static #batchDepth = 0;
  /** @type {object | null} */
  #scope = null;

  /**
   * @param {T} initialValue
   * @param {object} [scope] - Optional SignalScope for isolated reactivity
   */
  constructor(initialValue, scope = null) {
    this.#value = initialValue;
    this.#scope = scope;
  }

  /** 
   * Get the current value of the signal
   * @returns {T} 
   */
  get value() {
    // Track this signal access for automatic dependency tracking.
    // Scoped signals ALWAYS consult their own scope's tracker — never the
    // global static one — even when the scope has no tracker currently
    // active (i.e. no `createEffect`/`SignalScope#createEffect` call is
    // in progress). Falling through to the global tracker here would let a
    // scoped signal's access "leak" into an unrelated, non-scoped effect's
    // dependency set (or vice versa), defeating the whole point of
    // SignalScope. See SignalScope#createEffect in scope.mjs for the
    // scope-isolated counterpart to the global createEffect below.
    if (this.#scope) {
      this.#scope.trackSignalAccess?.(this);
    } else {
      Signal.#trackSignalAccess?.(this);
    }
    return this.#value;
  }

  /** 
   * Set a new value for the signal
   * @param {T} newValue 
   */
  set value(newValue) {
    if (Object.is(this.#value, newValue)) return;

    this.#value = newValue;
    this.#version++;
    void this._notify();
  }

  /**
   * Read the signal value without creating a dependency
   * @returns {T}
   */
  peek() {
    return this.#value;
  }

  /**
   * Get the current version (incremented on each change)
   * @returns {number}
   */
  get version() {
    return this.#version;
  }

  /**
   * Update the signal value using a function
   * @param {(oldValue: T) => T} fn
   */
  update(fn) {
    const newValue = fn(this.#value);
    if (Object.is(this.#value, newValue)) return;

    this.#value = newValue;
    this.#version++;
    void this._notify();
  }

  /**
   * Subscribe to changes in the signal
   * @param {(value: T) => void} fn
   * @returns {() => void} Unsubscribe function
   */
  subscribe(fn) {
    const unsubscribe = this.#effects.add(fn);
    // Immediately call with current value
    fn(this.#value);

    // Return unsubscribe function
    return unsubscribe;
  }

  /**
   * Add an effect callback without calling it immediately.
   * Used by Computed to defer the initial callback until computation completes.
   * @param {(value: T) => void} fn
   * @returns {() => void} Unsubscribe function
   */
  _addEffect(fn) {
    return this.#effects.add(fn);
  }

  /**
   * Add a computed dependency to this signal
   * @param {Computed<any>} computed
   * @returns {() => boolean} Function to remove the dependency
   */
  addComputedDep(computed) {
    return this.#computedDeps.add(computed);
  }

  /**
   * Notify all subscribers of a change (also called from scope.batch)
   * @returns {Promise<void>}
   */
  async _notify() {
    if (this.#scope ? this.#scope.batching : Signal.#batching) {
      if (this.#scope) {
        this.#scope.batchQueue.add(this);
      } else {
        Signal.#batchQueue.add(this);
      }
      return;
    }

    // Update computed signals first
    const computedPromises = [];
    this.#computedDeps.forEach((computed) => {
      computedPromises.push(computed.recompute());
    });
    await Promise.all(computedPromises);

    // Then notify effect subscribers
    const effectPromises = [];
    this.#effects.forEach((effect) => {
      effectPromises.push(effect(this.#value));
    });
    await Promise.all(effectPromises);
  }

  /**
   * Dispose this signal: clear all effects and computed deps.
   */
  dispose() {
    this.#effects.clear();
    this.#computedDeps.clear();
  }

  [Symbol.dispose]() {
    this.dispose();
  }

  /**
   * Static variable to track the currently active effect
   * @type {((signal: Signal<any>) => void) | null}
   */
  static #trackSignalAccess = null;

  /**
   * Set up automatic dependency tracking for the current context
   * @param {(signal: Signal<any>) => void} trackFn
   */
  static setTracker(trackFn) {
    Signal.#trackSignalAccess = trackFn;
  }

  /**
   * Clear the current dependency tracker
   */
  static clearTracker() {
    Signal.#trackSignalAccess = null;
  }

  /**
   * Batch multiple signal updates to prevent intermediate re-renders
   * @param {() => Promise<void>} fn
   * @returns {Promise<void>}
   */
  static async batch(fn) {
    Signal.#batchDepth++;
    try {
      Signal.#batching = true;
      await fn();
    } finally {
      Signal.#batchDepth--;
      // Only the outermost batch() call flushes: a nested batch() call
      // finishing must NOT flip #batching off or drain #batchQueue, since
      // the still-in-progress outer batch (and the shared queue) owns
      // updates queued both before and after the nested call.
      if (Signal.#batchDepth === 0) {
        Signal.#batching = false;
        // Process all queued updates
        const signals = Signal.#batchQueue.toArray();
        Signal.#batchQueue.clear();
        await Promise.all(signals.map((signal) => signal._notify()));
      }
    }
  }

  /**
   * Run a function without tracking dependencies
   * @template R
   * @param {() => R} fn
   * @returns {R}
   */
  static untrack(fn) {
    const prevTracker = Signal.#trackSignalAccess;
    Signal.#trackSignalAccess = null;
    try {
      return fn();
    } finally {
      Signal.#trackSignalAccess = prevTracker;
    }
  }
}

/**
 * @template T
 * @extends {Signal<T | undefined>}
 */
export class Computed extends Signal {
  /** @type {Signal<any>[]} */
  #deps;
  /** @type {(...args: any[]) => Promise<T>} */
  #compute;
  /** @type {(() => Promise<void>) | null} */
  #cleanup = null;
  /** @type {Promise<void> | null} */
  #computePromise = null;
  /** @type {LinkedList<() => boolean>} */
  #depUnsubscribes = new LinkedList();
  /**
   * Last-seen version number for each dependency, indexed to match `#deps`.
   * Tracked per-dependency (NOT collapsed into a single scalar) because a
   * single `Math.max(...)` of all dep versions is unsound: two independent
   * dependencies' version counters can (and routinely do, since every
   * signal starts at version 0 and increments by 1 per change) land on the
   * same number. A shared scalar "high water mark" then can't tell "dep A
   * is still on the version I've already seen" apart from "dep A's newest
   * version happens to numerically equal what I recorded for dep B" — so a
   * genuine update to A gets silently swallowed whenever it happens to
   * coincide with (or trail behind, in version-number terms) an update
   * already recorded for B. See the diamond-dependency regression test.
   * @type {number[]}
   */
  #depVersions;
  /** @type {boolean} */
  #initialized = false;

  /**
   * @param {Signal<any> | Signal<any>[]} deps
   * @param {(...args: any[]) => Promise<T>} computeFn
   * @param {object} [scope] - Optional SignalScope for isolated reactivity (see SignalScope#computed)
   */
  constructor(deps, computeFn, scope = null) {
    super(undefined, scope);
    this.#deps = Array.isArray(deps) ? deps : [deps];
    this.#compute = computeFn;
    this.#depVersions = this.#deps.map(() => -1);

    // Set up dependencies
    for (const dep of this.#deps) {
      const unsubscribe = dep.addComputedDep(this);
      this.#depUnsubscribes.add(unsubscribe);
    }

    // Initial computation
    this.recompute();
  }

  /**
   * Recompute the value if dependencies have changed.
   *
   * This is a thin serializing wrapper around #recomputeOnce(): it waits
   * for any already-in-flight computation, then registers its OWN
   * computation as the new "in flight" one *before* doing any real work
   * (synchronously, so no other concurrent call can slip in between).
   * This matters because two dependencies can each notify a shared
   * `Computed` at nearly the same time (e.g. a diamond dependency graph,
   * or two deps settling their own async computations back to back).
   * Without this serialization, two overlapping `#recomputeOnce()` calls
   * could each read `#cleanup` before the other has written its own new
   * cleanup function, so the first call's cleanup reference gets silently
   * clobbered (never invoked) by the second — leaking whatever resource
   * it represented. Serializing means the second call's `#recomputeOnce()`
   * only starts after the first's cleanup handling has fully completed.
   * @returns {Promise<void>}
   */
  async recompute() {
    if (this.#computePromise) {
      await this.#computePromise;
    }
    const run = this.#recomputeOnce();
    this.#computePromise = run;
    try {
      await run;
    } finally {
      if (this.#computePromise === run) {
        this.#computePromise = null;
      }
    }
  }

  /**
   * Perform a single (non-serialized) recompute pass. Only ever called
   * from `recompute()`, which guarantees at most one of these runs at a
   * time for a given `Computed` instance.
   * @returns {Promise<void>}
   */
  async #recomputeOnce() {
    // Check if any dependencies have changed by comparing each dependency's
    // current version against the version we last computed *that specific
    // dependency* against (not a single collapsed max — see #depVersions).
    let needsUpdate = false;
    for (let i = 0; i < this.#deps.length; i++) {
      const dep = this.#deps[i];
      if (dep instanceof Signal && dep.version > this.#depVersions[i]) {
        needsUpdate = true;
        break;
      }
    }

    if (!needsUpdate && this.#initialized) {
      return;
    }

    // Record the version we're computing each dependency against.
    for (let i = 0; i < this.#deps.length; i++) {
      const dep = this.#deps[i];
      this.#depVersions[i] = dep instanceof Signal ? dep.version : 0;
    }

    // Clean up previous computation if needed
    if (this.#cleanup) {
      await this.#cleanup();
      this.#cleanup = null;
    }

    const depValues = this.#deps.map((dep) => dep.value);
    const result = await this.#compute(...depValues);

    // Handle both array returns [value, cleanup] and direct value returns
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      typeof result[1] === "function"
    ) {
      const [newValue, cleanup] = result;
      this.#cleanup = cleanup;
      super.value = newValue;
    } else {
      super.value = result;
    }
    this.#initialized = true;
  }

  /**
   * Subscribe to this computed signal.
   * Defers the initial callback until the first computation completes.
   * @param {(value: T) => void} fn
   * @returns {() => void} Unsubscribe function
   */
  subscribe(fn) {
    if (this.#initialized) {
      return super.subscribe(fn);
    }
    // Not yet initialized — add effect without immediate call.
    // The _notify triggered by the initial computation will call fn.
    return this._addEffect(fn);
  }

  /** @returns {T | undefined} */
  get value() {
    return super.value;
  }

  /** @param {T} newValue */
  set value(newValue) {
    throw new Error("Cannot modify computed signal directly");
  }

  /**
   * Computed signals are derived, read-only state: `update()` (inherited
   * from Signal) would otherwise bypass the `set value` guard above — it
   * writes `#value`/`#version` directly and never goes through
   * `recompute()` — silently corrupting the computed's dependency-tracking
   * state (and, if called after `dispose()`, resurrecting a supposedly
   * torn-down computed, re-notifying stale subscribers).
   * @param {(oldValue: T) => T} _fn
   */
  update(_fn) {
    throw new Error("Cannot modify computed signal directly");
  }

  /**
   * Clean up this computed signal and remove all subscriptions
   */
  dispose() {
    // Remove all dependency subscriptions
    this.#depUnsubscribes.forEach(unsubscribe => unsubscribe());

    // Run cleanup function if it exists
    if (this.#cleanup) {
      try {
        const result = this.#cleanup();
        if (result && typeof result.catch === "function") {
          result.catch(() => {}); // prevent unhandled rejection
        }
      } catch {
        // cleanup errors should not propagate
      }
      this.#cleanup = null;
    }

    // Clear this computed's own effects/computedDeps (Signal#dispose). Without
    // this, subscribers added via subscribe() before dispose() are never
    // released, and stay reachable/callable for the lifetime of the instance.
    super.dispose();
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

/**
 * Creates a new signal with the given initial value
 * @template T
 * @param {T} initialValue
 * @returns {Signal<T>}
 */
export const signal = (initialValue) => new Signal(initialValue);

/**
 * Creates a computed signal derived from other signals
 * @template T
 * @param {Signal<any> | Signal<any>[]} deps
 * @param {(...args: any[]) => Promise<T>} fn
 * @returns {Computed<T>}
 */
export const computed = (deps, fn) => new Computed(deps, fn);

/**
 * Creates an effect that runs when signal values change
 * @template T
 * @param {Signal<T>} signal
 * @param {(value: T) => void} fn
 * @returns {() => void}
 */
export const effect = (signal, fn) => signal.subscribe(fn);

/**
 * Internal factory that builds an auto-tracking `createEffect`-style
 * function against a pair of set/clear tracker callbacks. This lets the
 * same dependency-tracking logic be reused both by the global
 * `createEffect` below (backed by the module-static `Signal.setTracker`/
 * `Signal.clearTracker`) and by `SignalScope#createEffect` in scope.mjs
 * (backed by that scope's own, independent `trackSignalAccess` field), so
 * that two scopes' auto-tracking effects never share or clobber each
 * other's tracker state.
 * @param {(trackFn: (signal: Signal<any>) => void) => void} setTracker
 * @param {() => void} clearTracker
 * @returns {(fn: () => void) => () => void}
 */
export function createEffectWithTracker(setTracker, clearTracker) {
  return function (fn) {
    const trackedSignals = new Set();
    let allUnsubscribes = [];
    let isRunning = false;
    let pending = false;

    // Create a tracker function that will record signal access
    const trackSignal = (signal) => {
      trackedSignals.add(signal);
    };

    // Schedule a re-run via macrotask to coalesce multiple triggers
    // from the same dependency cascade (e.g. count → doubled both firing).
    // Uses setTimeout(0) so all microtask-based notification chains settle
    // before runEffect fires, ensuring the pending flag properly deduplicates.
    const scheduleEffect = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        runEffect();
      }, 0);
    };

    // The effect function that will run and track dependencies
    const runEffect = () => {
      // Re-entry guard
      if (isRunning) return;
      isRunning = true;

      // Unsubscribe from previous dependencies
      allUnsubscribes.forEach(unsub => unsub());
      allUnsubscribes = [];

      // Clear previous dependencies
      trackedSignals.clear();

      // Set up tracking
      setTracker(trackSignal);

      try {
        // Run the effect, tracking will happen automatically
        fn();
      } finally {
        // Clean up tracking
        clearTracker();

        // Subscribe to all accessed signals (without immediate callback).
        // Use scheduleEffect so multiple dep changes coalesce into one re-run.
        const unsubscribes = [];
        trackedSignals.forEach(signal => {
          const unsubscribe = signal._addEffect(() => {
            scheduleEffect();
          });
          unsubscribes.push(unsubscribe);
        });

        // Store unsubscribe functions
        allUnsubscribes = unsubscribes;
        isRunning = false;
      }
    };

    // Start with initial synchronous run
    runEffect();

    // Return function to clean up all subscriptions
    return () => {
      allUnsubscribes.forEach(unsubscribe => unsubscribe());
      allUnsubscribes = [];
      pending = false;
    };
  };
}

/**
 * Creates an effect that automatically tracks signal dependencies.
 *
 * IMPORTANT — scope isolation: this global `createEffect` always uses the
 * module-static tracker (`Signal.setTracker`/`Signal.clearTracker`), which
 * is shared process-wide. Per the fix to `Signal#value` above, it will
 * simply fail to auto-track any signal created via `SignalScope#signal`
 * (scoped signals only ever report access to *their own scope's* tracker).
 * If you're working with a `SignalScope` (from `signalle/scope`), use
 * `scope.createEffect(fn)` instead — it has fully independent tracker
 * state per scope, so concurrent logical contexts (e.g. concurrent server
 * requests each with their own scope) can safely run auto-tracking effects
 * without racing or corrupting each other's dependency tracking.
 * @param {() => void} fn
 * @returns {() => void}
 */
export const createEffect = createEffectWithTracker(Signal.setTracker, Signal.clearTracker);

/**
 * Batch multiple signal updates to prevent intermediate re-renders
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
export const batch = Signal.batch;

/**
 * Run a function without tracking dependencies
 * @template R
 * @param {() => R} fn
 * @returns {R}
 */
export const untrack = Signal.untrack;
