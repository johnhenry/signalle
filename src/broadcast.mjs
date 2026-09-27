// Base Signal class for broadcast communication
//
// Message protocol (all messages share one shape on the one BroadcastChannel
// -- no separate handshake side-channel):
//
//   { kind: 'state', id, value, version }
//     Self-describing state. Sent whenever a value changes (a normal
//     update), AND reused verbatim to answer a 'sync-request' -- a
//     receiver can't tell the difference and doesn't need to: it just
//     adopts whichever state has the higher (version, id).
//
//   { kind: 'sync-request', id }
//     Sent once, from the constructor, before an instance considers
//     itself caught up. Any peer that already has real state
//     (#version > 0) answers with its own 'state' message. This is how a
//     late-joining tab catches up to tabs that were already broadcasting
//     -- BroadcastChannel never redelivers messages posted before a
//     listener existed, so without this a newcomer would otherwise be
//     stuck at its own local initial value forever.
class BroadcastSignal {
  #value;
  #version = 0;
  #effects = new Set();
  #channel;
  // Unique per instance, used only as a deterministic tiebreak when two
  // peers independently produce the same version number (e.g. both wrote
  // once, concurrently, before hearing from each other). Not meaningful
  // on its own -- just needs to be comparable and unique enough that
  // "adopt the higher (version, id)" is total and join-order-independent.
  #id = crypto.randomUUID();

  /**
   * @param {any} initialValue - The initial value of the signal
   * @param {string} [channelName='default-signal'] - The name of the broadcast channel
   */
  constructor(initialValue, channelName = "default-signal") {
    this.#value = initialValue;
    this.#channel = new BroadcastChannel(channelName);

    this.#channel.onmessage = (event) => {
      const msg = event.data;

      if (msg.kind === "sync-request") {
        // Only answer if we actually have broadcast-worthy state; a fresh
        // peer that never wrote anything has nothing to offer and would
        // just echo back the asker's own initial value at version 0.
        if (this.#version > 0) {
          this.#channel.postMessage({
            kind: "state",
            id: this.#id,
            value: this.#value,
            version: this.#version,
          });
        }
        return;
      }

      this.#adopt(msg);
    };

    // Ask any already-broadcasting peer to (re-)announce its current
    // state. If we're the first/only instance, nobody answers and we
    // simply keep our own initialValue -- which is correct, there's
    // nothing to converge to yet.
    this.#channel.postMessage({ kind: "sync-request", id: this.#id });
  }

  /**
   * Adopt incoming state if it's newer than what we have. "Newer" is
   * (version, id) compared lexicographically so that join order never
   * matters: a newcomer that just caught up via a 'sync-request' reply
   * inherits the peer's version, so its *next* local write increments
   * past it and is correctly accepted everywhere -- unlike a scheme
   * where every instance's version starts independently at 0.
   *
   * A 'state' message can legitimately arrive more than once for the
   * same version -- e.g. a peer's reply to our 'sync-request' can cross
   * in flight with (and duplicate) the ordinary update we're already
   * receiving directly. Only notify subscribers if the value is actually
   * changing; otherwise this is a harmless re-delivery of state we
   * already have, not a new update.
   * @param {{id: string, value: any, version: number}} msg
   */
  #adopt({ id, value, version }) {
    const isNewer =
      version > this.#version ||
      (version === this.#version && id > this.#id);
    if (!isNewer) return;

    this.#version = version;
    if (Object.is(this.#value, value)) return;
    this.#value = value;
    this.#notifyEffects();
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
      kind: "state",
      id: this.#id,
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
