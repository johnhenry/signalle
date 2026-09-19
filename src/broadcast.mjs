// Base Signal class for broadcast communication
class BroadcastSignal {
  #value;
  #version = 0;
  #effects = new Set();
  #channel;

  /**
   * @param {any} initialValue - The initial value of the signal
   * @param {string} [channelName='default-signal'] - The name of the broadcast channel
   */
  constructor(initialValue, channelName = "default-signal") {
    this.#value = initialValue;
    this.#channel = new BroadcastChannel(channelName);

    this.#channel.onmessage = (event) => {
      const { value, version } = event.data;
      if (version > this.#version) {
        this.#version = version;
        this.#value = value;
        this.#notifyEffects();
      }
    };
  }

  get value() {
    return this.#value;
  }

  set value(newValue) {
    // Compare the RAW incoming value against the current value before
    // cloning. structuredClone() always returns a fresh reference for
    // objects/arrays, so comparing the *clone* (the old behavior) could
    // never short-circuit for a non-primitive value even when the exact
    // same reference was passed again unchanged — every "no-op" set of an
    // object/array value still bumped the version, re-broadcast to every
    // other tab, and re-notified local subscribers.
    if (Object.is(this.#value, newValue)) return;

    const clonedValue = structuredClone(newValue);

    this.#value = clonedValue;
    this.#version++;

    this.#channel.postMessage({
      value: this.#value,
      version: this.#version,
    });

    this.#notifyEffects();
  }

  /**
   * @param {(value: any) => void} fn - The effect function to subscribe
   * @returns {() => void} A function to unsubscribe the effect
   */
  subscribe(fn) {
    this.#effects.add(fn);
    fn(this.#value);
    return () => this.#effects.delete(fn);
  }

  #notifyEffects() {
    for (const effect of this.#effects) {
      effect(this.#value);
    }
  }

  dispose() {
    this.#channel.close();
    this.#effects.clear();
  }
}

/**
 * Creates a new broadcast signal that can communicate across different contexts
 * @param {any} initialValue - The initial value of the signal
 * @param {string} [channelName] - Optional channel name for the broadcast channel
 * @returns {BroadcastSignal} A new broadcast signal instance
 */
export function createBroadcastSignal(initialValue, channelName) {
  return new BroadcastSignal(initialValue, channelName);
}

/**
 * Generates worker code as a string that includes the BroadcastSignal implementation
 * @param {string} signalCode - The code that will use the BroadcastSignal
 * @returns {string} The complete worker code as a string
 */
export function generateWorkerCode(signalCode, name = "createBroadcastSignal") {
  return `
    ${BroadcastSignal.toString()}

    // Create the createBroadcastSignal function in the worker context
    const ${name} = ${createBroadcastSignal.toString()};

    // User provided signal code
    ${signalCode}
    `;
}
