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
    // Track this signal access for automatic dependency tracking
    if (this.#scope?.trackSignalAccess) {
      this.#scope.trackSignalAccess(this);
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
    try {
      Signal.#batching = true;
      await fn();
    } finally {
      Signal.#batching = false;
      // Process all queued updates
      const signals = Signal.#batchQueue.toArray();
      Signal.#batchQueue.clear();
      await Promise.all(signals.map((signal) => signal._notify()));
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
  /** @type {number} */
  #lastVersion = -1;
  /** @type {boolean} */
  #initialized = false;

  /**
   * @param {Signal<any> | Signal<any>[]} deps
   * @param {(...args: any[]) => Promise<T>} computeFn
   */
  constructor(deps, computeFn) {
    super(undefined);
    this.#deps = Array.isArray(deps) ? deps : [deps];
    this.#compute = computeFn;

    // Set up dependencies
    for (const dep of this.#deps) {
      const unsubscribe = dep.addComputedDep(this);
      this.#depUnsubscribes.add(unsubscribe);
    }

    // Initial computation
    this.#computePromise = this.recompute();
  }

  /** 
   * Recompute the value if dependencies have changed
   * @returns {Promise<void>} 
   */
  async recompute() {
    // Wait for any pending computation to complete
    if (this.#computePromise) {
      await this.#computePromise;
    }

    // Check if any dependencies have changed by comparing versions
    let needsUpdate = false;
    for (const dep of this.#deps) {
      if (dep instanceof Signal && dep.version > this.#lastVersion) {
        needsUpdate = true;
        break;
      }
    }

    if (!needsUpdate && this.#lastVersion !== -1) {
      return;
    }

    // Update the last version we computed with
    this.#lastVersion = Math.max(...this.#deps.map(dep => dep instanceof Signal ? dep.version : 0));

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
 * Creates an effect that automatically tracks signal dependencies
 * @param {() => void} fn
 * @returns {() => void}
 */
export const createEffect = (fn) => {
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
    Signal.setTracker(trackSignal);

    try {
      // Run the effect, tracking will happen automatically
      fn();
    } finally {
      // Clean up tracking
      Signal.clearTracker();

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
