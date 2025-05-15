import { Signal } from "./signal.mjs";

/**
 * @template T
 * @extends {Signal<T>}
 */
export class BroadcastSignal extends Signal {
  /** @type {BroadcastChannel} */
  #channel;
  /** @type {string} */
  #id;
  /** @type {boolean} */
  #initialized = false;

  /**
   * @param {T} initialValue
   * @param {string} channelName
   */
  constructor(initialValue, channelName) {
    super(initialValue);
    this.#id = Math.random().toString(36).slice(2);
    this.#channel = new BroadcastChannel(channelName);
    this.#setupChannel();
  }

  #setupChannel() {
    if (this.#initialized) return;
    this.#initialized = true;

    this.#channel.addEventListener("message", (event) => {
      const { id, value } = event.data;
      if (id !== this.#id) {
        super.value = value;
      }
    });

    // Broadcast initial value
    this.#channel.postMessage({ id: this.#id, value: this.value });
  }

  /** @param {T} newValue */
  set value(newValue) {
    super.value = newValue;
    this.#channel.postMessage({ id: this.#id, value: newValue });
  }

  close() {
    this.#channel.close();
  }
}

/**
 * Create a broadcast signal that syncs across contexts
 * @template T
 * @param {T} initialValue
 * @param {string} channelName
 * @returns {BroadcastSignal<T>}
 */
export const broadcastSignal = (initialValue, channelName) =>
  new BroadcastSignal(initialValue, channelName);

/**
 * Generate worker initialization code
 * @param {string} signallePath - Path to the signalle library
 * @returns {string}
 */
export function generateWorkerCode(signallePath = "/src/broadcast.mjs") {
  return `
    import { broadcastSignal } from '${signallePath}';
    
    // Setup shared signals
    const signals = {};
    
    // Handle signal creation messages
    self.addEventListener('message', (event) => {
      const { type, channelName, initialValue } = event.data;
      
      if (type === 'createSignal') {
        signals[channelName] = broadcastSignal(initialValue, channelName);
        signals[channelName].subscribe((value) => {
          self.postMessage({ type: 'update', channelName, value });
        });
      }
    });
  `;
}

/**
 * Create a worker with broadcast signal support
 * @param {string} workerUrl
 * @returns {Worker}
 */
export function createSignalWorker(workerUrl) {
  const worker = new Worker(workerUrl, { type: "module" });

  return {
    worker,
    /**
     * @template T
     * @param {string} channelName
     * @param {T} initialValue
     */
    createSignal(channelName, initialValue) {
      worker.postMessage({
        type: "createSignal",
        channelName,
        initialValue,
      });
      return broadcastSignal(initialValue, channelName);
    },
  };
}
