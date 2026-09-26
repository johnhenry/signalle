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
    if (this._setValue(newValue)) {
      void this._notify();
    }
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
    if (this._setValue(newValue)) {
      void this._notify();
    }
  }

  /**
   * Write `newValue` into this signal's storage (bumping `#version`) WITHOUT
   * triggering propagation (`_notify()`). Used both by the public
   * `value`/`update()` mutators above (which immediately follow up with
   * `_notify()`) and by `Computed#recompute()` (which intentionally defers
   * notification to its caller -- see `runPropagationWave` below -- so that
   * a single coordinated pass can propagate to dependents exactly once
   * instead of each dependency change triggering its own independent
   * cascade).
   * @param {T} newValue
   * @returns {boolean} Whether the value actually changed.
   */
  _setValue(newValue) {
    if (Object.is(this.#value, newValue)) return false;
    this.#value = newValue;
    this.#version++;
    return true;
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
   * Invoke `cb` once for each Computed that directly depends on this node.
   * Used by `runPropagationWave` to discover which Computeds a changed
   * node needs to (transitively) dirty -- kept as a narrow accessor rather
   * than exposing `#computedDeps` itself, matching the existing `_addEffect`
   * / `addComputedDep` convention of underscore-prefixed internal hooks.
   * @param {(computed: Computed<any>) => void} cb
   */
  _forEachComputedDep(cb) {
    this.#computedDeps.forEach(cb);
  }

  /**
   * Run every effect subscriber of this node with its current value, in
   * parallel, resolving once they've all settled.
   * @returns {Promise<void>}
   */
  _fireEffects() {
    const effectPromises = [];
    this.#effects.forEach((effectFn) => {
      effectPromises.push(effectFn(this.#value));
    });
    return Promise.all(effectPromises);
  }

  /**
   * Notify dependents of a change (also called from scope.batch's flush).
   *
   * When called while an outer `batch()` is active, this just enqueues
   * `this` for that batch's eventual flush (unchanged from before). When
   * called outside of an explicit batch, it used to eagerly recompute this
   * node's *direct* computed dependents right here, one `_notify()` call at
   * a time. That was the root cause of
   * https://github.com/johnhenry/signalle/issues/7: a Computed with more
   * than one changed dependency (whether those are raw Signals written in
   * the same batch(), or other Computeds that each independently finish
   * settling at different times) got `recompute()` invoked once per
   * dependency that changed, instead of once for the whole wave -- and,
   * worse, because each of those eager recomputes ran with whatever subset
   * of dependencies had settled *so far*, a downstream Computed's effects
   * could observe a transient, wrong intermediate total (see the
   * "propagation wave" regression test) even though the *final* value
   * converged correctly.
   *
   * Now, a non-batched change instead starts (or joins) a single
   * `runPropagationWave`, which marks dependents dirty without eagerly
   * recomputing them, then drains that dirty set in dependency order so
   * each affected Computed recomputes exactly once, with all of its own
   * affected dependencies already settled -- see `runPropagationWave` below
   * for the full algorithm.
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

    await runPropagationWave([this]);
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
        // Process all queued updates as a single coordinated propagation
        // wave (see `runPropagationWave`) rather than firing each queued
        // signal's `_notify()` independently -- the latter is what let a
        // computed depending on more than one signal written in this batch
        // recompute once per changed input instead of once total.
        const signals = Signal.#batchQueue.toArray();
        Signal.#batchQueue.clear();
        await runPropagationWave(signals);
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

    // Initial computation. `recompute()` itself no longer self-notifies
    // (see below) -- it just settles `#value`/`#version` and reports
    // whether the value changed, leaving propagation to whichever caller
    // is coordinating a wave. There are no dependents yet at construction
    // time (nothing has had the chance to depend on `this`), so once the
    // initial compute settles, fire this computed's own effect subscribers
    // (added via `subscribe()` before it finished) directly.
    this.recompute().then((changed) => {
      if (changed) void this._notify();
    });
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
   *
   * Deliberately does NOT call `_notify()` itself (unlike a plain
   * `Signal`'s `value` setter) -- see `runPropagationWave` for why:
   * recomputing is driven by a coordinated propagation wave that needs to
   * know, for *every* dirty Computed, whether it actually changed before
   * deciding what to mark dirty next and what to fire effects for. Letting
   * this self-notify would reintroduce the eager, once-per-dependency
   * cascade that issue #7 was filed about.
   * @returns {Promise<boolean>} Whether the value actually changed.
   */
  async recompute() {
    if (this.#computePromise) {
      await this.#computePromise;
    }
    const run = this.#recomputeOnce();
    this.#computePromise = run;
    try {
      return await run;
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
   * @returns {Promise<boolean>} Whether the value actually changed.
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
      return false;
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
    let changed;
    if (
      Array.isArray(result) &&
      result.length === 2 &&
      typeof result[1] === "function"
    ) {
      const [newValue, cleanup] = result;
      this.#cleanup = cleanup;
      changed = this._setValue(newValue);
    } else {
      changed = this._setValue(result);
    }
    this.#initialized = true;
    return changed;
  }

  /**
   * This computed's own dependencies (a mix of plain Signals and/or other
   * Computeds). Used by `runPropagationWave` to decide whether this
   * Computed is safe to recompute yet -- it must wait until none of its
   * OWN dependencies that are themselves dirty in the current wave remain
   * unsettled, so it always reads fresh, final values rather than a
   * transient partial update.
   * @returns {Signal<any>[]}
   */
  _getDependencies() {
    return this.#deps;
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
 * Run one coordinated propagation wave triggered by `rootNodes` -- Signals
 * and/or Computeds whose value has just changed (either because an
 * explicit `batch()` just flushed, or because a single non-batched write
 * changed a Signal outside of any batch). Shared by both `Signal.batch()`
 * and `SignalScope#batch()`'s flush, and by `Signal#_notify()` /
 * `SignalScope`'s non-batched path, since the propagation algorithm itself
 * doesn't depend on scoping -- only *when* a wave starts is scope/batching
 * specific, not *how* it drains.
 *
 * This is the fix for
 * https://github.com/johnhenry/signalle/issues/7 ("batch() still notifies
 * dependants once per changed signal, causing extra recomputes"): rather
 * than eagerly calling `computed.recompute()` as soon as any one of its
 * dependencies reports a change (which made a Computed depending on
 * several changed inputs recompute once per input, and could even let
 * effects observe a transient, wrong intermediate total when a Computed's
 * dependencies are themselves other Computeds settling at different
 * times -- see the "propagation wave" regression test), this:
 *
 *   1. Marks every DIRECT computed dependent of a changed node "dirty"
 *      without recomputing it yet.
 *   2. Repeatedly recomputes the wave-front of dirty Computeds whose own
 *      dependencies are NOT themselves still dirty (i.e. already settled
 *      for this wave), in parallel, since such a wave-front is mutually
 *      independent. This is a standard worklist/topological drain: it
 *      guarantees a Computed only ever recomputes after everything it
 *      depends on (that's part of this same wave) has already settled, so
 *      it always reads final values, and it guarantees each dirty Computed
 *      recomputes AT MOST ONCE for the whole wave.
 *   3. Once nothing is left dirty, fires every changed node's effect
 *      subscribers exactly once, in parallel -- after the whole graph has
 *      settled, never mid-wave.
 * Exported (not just module-internal) so `SignalScope#batch()` in
 * scope.mjs can drive its own flush through the exact same algorithm
 * instead of duplicating it.
 * @param {(Signal<any>|Computed<any>)[]} rootNodes
 * @returns {Promise<void>}
 */
export async function runPropagationWave(rootNodes) {
  /** @type {Set<Computed<any>>} */
  const dirty = new Set();
  /** @type {Set<Signal<any>|Computed<any>>} */
  const changed = new Set(rootNodes);

  const markDependentsDirty = (node) => {
    node._forEachComputedDep((dependent) => dirty.add(dependent));
  };
  for (const node of rootNodes) markDependentsDirty(node);

  while (dirty.size > 0) {
    // The wave-front: every currently-dirty Computed none of whose own
    // dependencies are themselves still dirty this wave.
    const ready = [];
    for (const computed of dirty) {
      const stillWaitingOn = computed
        ._getDependencies()
        .some((dep) => dirty.has(dep));
      if (!stillWaitingOn) ready.push(computed);
    }
    if (ready.length === 0) {
      // Only reachable with a cyclic dependency graph (not supported);
      // bail rather than looping forever.
      break;
    }
    for (const computed of ready) dirty.delete(computed);

    await Promise.all(
      ready.map(async (computed) => {
        const didChange = await computed.recompute();
        if (didChange) {
          changed.add(computed);
          markDependentsDirty(computed);
        }
      })
    );
  }

  await Promise.all(Array.from(changed, (node) => node._fireEffects()));
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
