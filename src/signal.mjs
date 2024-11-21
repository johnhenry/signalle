/**
 * @template T
 */
export class Signal {
  /** @type {T} */
  #value;
  /** @type {number} */
  #version = 0;
  /** @type {Set<(value: T) => void>} */
  #effects = new Set();
  /** @type {Set<Computed<any>>} */
  #computedDeps = new Set();
  /** @type {Set<Signal<any>>} */
  static #batchQueue = new Set();
  /** @type {boolean} */
  static #batching = false;

  /**
   * @param {T} initialValue
   */
  constructor(initialValue) {
    this.#value = initialValue;
  }

  /** @returns {T} */
  get value() {
    return this.#value;
  }

  /** @param {T} newValue */
  set value(newValue) {
    if (Object.is(this.#value, newValue)) return;

    this.#value = newValue;
    this.#version++;
    void this.#notify();
  }

  /**
   * @param {(oldValue: T) => T} fn
   */
  update(fn) {
    const newValue = fn(this.#value);
    if (Object.is(this.#value, newValue)) return;

    this.#value = newValue;
    this.#version++;
    void this.#notify();
  }

  /**
   * @param {(value: T) => void} fn
   * @returns {() => void}
   */
  subscribe(fn) {
    this.#effects.add(fn);
    // Immediately call with current value
    fn(this.#value);

    // Return unsubscribe function
    return () => this.#effects.delete(fn);
  }

  /**
   * @param {Computed<any>} computed
   */
  addComputedDep(computed) {
    this.#computedDeps.add(computed);
  }

  /** @returns {Promise<void>} */
  async #notify() {
    if (Signal.#batching) {
      Signal.#batchQueue.add(this);
      return;
    }

    // Update computed signals first
    const computedPromises = Array.from(this.#computedDeps).map((computed) =>
      computed.recompute()
    );
    await Promise.all(computedPromises);

    // Then notify effect subscribers
    const effectPromises = Array.from(this.#effects).map((effect) =>
      effect(this.#value)
    );
    await Promise.all(effectPromises);
  }

  /**
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
      const signals = Array.from(Signal.#batchQueue);
      Signal.#batchQueue.clear();
      await Promise.all(signals.map((signal) => signal.#notify()));
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
      dep.addComputedDep(this);
    }

    // Initial computation
    this.#computePromise = this.recompute();
  }

  /** @returns {Promise<void>} */
  async recompute() {
    // Wait for any pending computation to complete
    if (this.#computePromise) {
      await this.#computePromise;
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
  }

  /** @returns {T | undefined} */
  get value() {
    return super.value;
  }

  /** @param {T} newValue */
  set value(newValue) {
    throw new Error("Cannot modify computed signal directly");
  }
}

/**
 * @template T
 * @param {T} initialValue
 * @returns {Signal<T>}
 */
export const signal = (initialValue) => new Signal(initialValue);

/**
 * @template T
 * @param {Signal<any> | Signal<any>[]} deps
 * @param {(...args: any[]) => Promise<T>} fn
 * @returns {Computed<T>}
 */
export const computed = (deps, fn) => new Computed(deps, fn);

/**
 * @template T
 * @param {Signal<T>} signal
 * @param {(value: T) => void} fn
 * @returns {() => void}
 */
export const effect = (signal, fn) => signal.subscribe(fn);
