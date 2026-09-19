declare module 'signalle' {
  /**
   * A signal that holds a value and notifies subscribers when it changes
   */
  export class Signal<T> {
    /**
     * Creates a new signal with the given initial value
     */
    constructor(initialValue: T);

    /**
     * Gets the current value of the signal
     * Reading this property will track this signal as a dependency in effects
     */
    get value(): T;

    /**
     * Sets a new value for the signal, notifying subscribers if the value changes
     */
    set value(newValue: T);

    /**
     * Gets the current value without tracking as a dependency
     */
    peek(): T;

    /**
     * Updates the value using a function
     * @param fn Function that receives the current value and returns a new value
     */
    update(fn: (oldValue: T) => T): void;

    /**
     * Subscribes to changes in the signal
     * @param fn Function to call when the signal changes
     * @returns A function to unsubscribe
     */
    subscribe(fn: (value: T) => void): () => void;
  }

  /**
   * A computed signal that derives its value from other signals
   */
  export class Computed<T> extends Signal<T | undefined> {
    /**
     * Creates a new computed signal
     * @param deps Single signal or array of signals this computed depends on
     * @param computeFn Function that computes the value based on dependency values
     */
    constructor(
      deps: Signal<any> | Signal<any>[],
      computeFn: (...args: any[]) => Promise<T>
    );

    /**
     * Gets the current computed value
     * Reading will track this computed as a dependency in effects
     */
    get value(): T | undefined;

    /**
     * Recomputes the value if dependencies have changed
     */
    recompute(): Promise<void>;

    /**
     * Disposes of this computed signal and removes all subscriptions
     */
    dispose(): void;
  }

  /**
   * Creates a new signal with the given initial value
   * @param initialValue The initial value for the signal
   * @returns A new signal instance
   */
  export function signal<T>(initialValue: T): Signal<T>;

  /**
   * Creates a computed signal derived from other signals
   * @param deps Single signal or array of signals this computed depends on
   * @param fn Function that computes the value based on dependency values
   * @returns A new computed signal
   */
  export function computed<T>(
    deps: Signal<any> | Signal<any>[],
    fn: (...args: any[]) => Promise<T>
  ): Computed<T>;

  /**
   * Creates an effect that runs when a signal's value changes
   * @param signal The signal to watch for changes
   * @param fn Function to run when the signal changes
   * @returns A function to cancel the effect
   */
  export function effect<T>(
    signal: Signal<T>,
    fn: (value: T) => void
  ): () => void;

  /**
   * Creates an effect that automatically tracks signal dependencies.
   *
   * NOT scope-isolated: this tracks dependencies through a single
   * module-static tracker shared by the whole process, so it will not
   * auto-track signals created via a `SignalScope` (`signalle/scope`), and
   * is unsafe to rely on for isolation across concurrent logical contexts
   * (e.g. concurrent server requests). Use `SignalScope#createEffect`
   * instead when working with a scope.
   * @param fn Function to run, any signals accessed inside will be tracked
   * @returns A function to cancel the effect
   */
  export function createEffect(fn: () => void): () => void;

  /**
   * Batches multiple signal updates to prevent intermediate re-renders
   * @param fn Function containing multiple signal updates
   */
  export function batch(fn: () => Promise<void>): Promise<void>;

  /**
   * Runs a function without tracking dependencies
   * @param fn Function to run without tracking signal dependencies
   * @returns The return value of the function
   */
  export function untrack<R>(fn: () => R): R;
}

declare module 'signalle/dom' {
  import { Signal, Computed } from 'signalle';

  /**
   * Shape of the options object accepted by `bind`, `bindAll`, and
   * `computedBind`. There is no runtime `defaultOptions` export from
   * `signalle/dom` — the defaults are internal to the module — so this is
   * expressed as a plain type rather than `typeof defaultOptions`.
   */
  type BindOptions = {
    property: keyof HTMLElement;
    events: (keyof HTMLElementEventMap)[];
    render: (value: any) => string;
    twoWay: boolean;
  };

  /**
   * Creates a signal bound to a DOM element
   * @param element DOM element to bind to
   * @param options Binding options
   * @returns A signal connected to the DOM element
   */
  export function bind<T>(
    element: { [key: string]: any },
    options?: Partial<BindOptions>
  ): Signal<T>;

  /**
   * Binds multiple signals to multiple elements
   * @param bindings Object mapping names to element binding configurations
   * @returns Object with the same keys mapped to bound signals
   */
  export function bindAll(bindings: {
    [key: string]: { element: { [key: string]: any } } & Partial<BindOptions>;
  }): { [key: string]: Signal<any> };

  /**
   * Creates a computed signal bound to a DOM element
   * @param element DOM element to bind to
   * @param deps Signal dependencies for the computed
   * @param computeFn Function to compute the value
   * @param options Binding options
   * @returns A computed signal connected to the DOM element
   */
  export function computedBind<T>(
    element: { [key: string]: any },
    deps: Signal<any> | Signal<any>[],
    computeFn: (...args: any[]) => Promise<T>,
    options?: Partial<BindOptions>
  ): Computed<T>;

  /**
   * Binds a signal to an element attribute
   * @param element DOM element with attributes
   * @param attribute Attribute name to bind to
   * @param signal Signal to bind
   * @param render Optional function to render the value as a string
   * @returns The bound signal
   */
  export function bindAttribute<T>(
    element: {
      setAttribute: (name: string, value: string) => void;
      removeAttribute: (name: string) => void;
      getAttribute: (name: string) => string | null;
    },
    attribute: string,
    signal: Signal<T>,
    render?: (value: T) => string
  ): Signal<T>;

  /**
   * Binds a signal to a class name
   * @param element DOM element with classList
   * @param className Class name to toggle
   * @param signal Signal that determines if the class is present
   * @returns The bound signal
   */
  export function bindClass<T>(
    element: {
      classList: {
        add: (name: string) => void;
        remove: (name: string) => void;
        has: (name: string) => boolean;
      };
    },
    className: string,
    signal: Signal<T>
  ): Signal<T>;

  /**
   * Binds a signal to a style property
   * @param element DOM element with style
   * @param property CSS property name
   * @param signal Signal with the style value
   * @param unit Optional CSS unit to append
   * @returns The bound signal
   */
  export function bindStyle<T>(
    element: {
      style: {
        setProperty: (name: string, value: string) => void;
        removeProperty: (name: string) => void;
        getPropertyValue: (name: string) => string;
      };
    },
    property: string,
    signal: Signal<T>,
    unit?: string
  ): Signal<T>;

  /**
   * Creates a list binding that efficiently updates only changed items
   * @param element Container element for the list
   * @param itemsSignal Signal containing array of items with ids
   * @param renderItem Function to render each item into a DOM node
   * @returns The bound signal
   */
  export function bindList<T>(
    element: {
      appendChild: (node: any) => void;
      removeChild: (node: any) => void;
      insertBefore: (node: any, ref: any) => void;
      children: any[];
    },
    itemsSignal: Signal<Array<T & { id: string | number }>>,
    renderItem: (item: T & { id: string | number }) => any
  ): Signal<Array<T & { id: string | number }>>;
}

declare module 'signalle/stream' {
  import { Signal } from 'signalle';

  /**
   * Options shared by `toReadableStream` and `toSSEResponse`.
   */
  interface ToStreamOptions<T> {
    /** Transform value before sending (default: JSON.stringify) */
    transform?: (value: T) => string;
    /** SSE event name (omit for the default, unnamed event) */
    event?: string;
    /** Whether to send the signal's current value immediately (default: true) */
    sendInitial?: boolean;
  }

  /**
   * Convert a signal into a ReadableStream that emits SSE-formatted strings
   * every time the signal's value changes.
   * @param sig The signal to observe
   * @param options Stream formatting options
   * @returns A ReadableStream of SSE-formatted string chunks
   */
  export function toReadableStream<T>(
    sig: Signal<T>,
    options?: ToStreamOptions<T>
  ): ReadableStream<string>;

  /**
   * Convert a signal into a ready-to-send Server-Sent Events Response.
   * @param sig The signal to observe
   * @param options Stream formatting options, plus CORS configuration
   * @returns A Response with `Content-Type: text/event-stream` and related headers
   */
  export function toSSEResponse<T>(
    sig: Signal<T>,
    options?: ToStreamOptions<T> & {
      /** Set the `Access-Control-Allow-Origin` header. `true` for "*", or a specific origin string. */
      cors?: boolean | string;
    }
  ): Response;
}

declare module 'signalle/scope' {
  import { Signal, Computed } from 'signalle';

  /**
   * An isolated signal scope with its own batch queue and dependency
   * tracking state. Use `createScope()` to get an independent reactivity
   * context that's safe for multi-tenant/concurrent server use.
   *
   * IMPORTANT: only `signal()`, `computed()`, `effect()`, `createEffect()`,
   * `batch()`, and `untrack()` on this class are scope-isolated. The
   * module-level `createEffect` exported from `signalle` (not this class's
   * `createEffect` method) is NOT scope-aware — see its documentation.
   */
  export class SignalScope {
    /**
     * Create a new signal bound to this scope.
     */
    signal<T>(initialValue: T): Signal<T>;

    /**
     * Create a computed signal bound to this scope.
     */
    computed<T>(
      deps: Signal<any> | Signal<any>[],
      fn: (...args: any[]) => Promise<T>
    ): Computed<T>;

    /**
     * Create an effect bound to this scope, cleaned up automatically by `dispose()`.
     */
    effect<T>(sig: Signal<T>, fn: (value: T) => void): () => void;

    /**
     * Create an auto-tracking effect bound to this scope — the
     * scope-isolated counterpart to the module-level `createEffect`. Safe
     * to use concurrently across independent scopes (e.g. one per
     * server request), unlike the module-level `createEffect`.
     */
    createEffect(fn: () => void): () => void;

    /**
     * Batch signal updates within this scope.
     */
    batch(fn: () => Promise<void>): Promise<void>;

    /**
     * Run a function without tracking dependencies in this scope.
     */
    untrack<R>(fn: () => R): R;

    /**
     * Dispose of all effects created in this scope.
     */
    dispose(): void;

    [Symbol.dispose](): void;
  }

  /**
   * The object returned by `createScope()`: bound, scope-isolated
   * counterparts to the top-level `signalle` API.
   */
  interface ScopeHandle {
    signal: SignalScope['signal'];
    computed: SignalScope['computed'];
    effect: SignalScope['effect'];
    createEffect: SignalScope['createEffect'];
    batch: SignalScope['batch'];
    untrack: SignalScope['untrack'];
    dispose: () => void;
    [Symbol.dispose](): void;
  }

  /**
   * Create an isolated signal scope.
   * @returns Scope-bound signal/computed/effect/createEffect/batch/untrack/dispose functions
   */
  export function createScope(): ScopeHandle;
}

declare module 'signalle/broadcast' {
  /**
   * A signal that synchronizes its value across browser tabs, iframes, or
   * workers via `BroadcastChannel`.
   */
  export class BroadcastSignal<T> {
    constructor(initialValue: T, channelName?: string);

    /** Gets the current value of the signal. */
    get value(): T;

    /**
     * Sets a new value, `structuredClone`-ing it and broadcasting the
     * change to every other `BroadcastSignal` on the same channel name.
     */
    set value(newValue: T);

    /**
     * Subscribes to changes in the signal (including changes broadcast in
     * from other contexts). Called immediately with the current value.
     * @returns A function to unsubscribe
     */
    subscribe(fn: (value: T) => void): () => void;

    /**
     * Closes the underlying BroadcastChannel and clears all subscriptions.
     */
    dispose(): void;
  }

  /**
   * Creates a new broadcast signal that stays in sync with other same-named
   * broadcast signals across tabs, iframes, or workers.
   * @param initialValue The initial value of the signal
   * @param channelName Optional BroadcastChannel name (default: `'default-signal'`)
   * @returns A new broadcast signal instance
   */
  export function createBroadcastSignal<T>(
    initialValue: T,
    channelName?: string
  ): BroadcastSignal<T>;

  /**
   * Generates worker code (as a string) that includes the `BroadcastSignal`
   * implementation plus a `createBroadcastSignal`-equivalent factory, so it
   * can be embedded into a Worker/`Blob` URL without a bundler.
   * @param signalCode Code that uses the generated factory function
   * @param name Name to bind the factory function to in the generated code (default: `'createBroadcastSignal'`)
   * @returns The complete worker code as a string
   */
  export function generateWorkerCode(signalCode: string, name?: string): string;
}
