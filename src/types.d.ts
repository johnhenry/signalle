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
   * Creates an effect that automatically tracks signal dependencies
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
   * Default options for binding signals to DOM elements
   */
  export const defaultOptions: {
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
    options?: Partial<typeof defaultOptions>
  ): Signal<T>;

  /**
   * Binds multiple signals to multiple elements
   * @param bindings Object mapping names to element binding configurations
   * @returns Object with the same keys mapped to bound signals
   */
  export function bindAll(bindings: {
    [key: string]: { element: { [key: string]: any } } & Partial<typeof defaultOptions>;
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
    options?: Partial<typeof defaultOptions>
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
