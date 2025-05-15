import { signal, computed, effect, untrack } from "./signal.mjs";

/** @typedef {keyof HTMLElementEventMap} EventName */
/** @typedef {keyof HTMLElement} ElementProperty */

/** @type {{ property: ElementProperty, events: EventName[], render: (value: any) => string, twoWay: boolean }} */
const defaultOptions = {
  property: "textContent",
  events: [],
  render: (value) => value?.toString() ?? "",
  twoWay: false,
};

/**
 * Create a signal bound to a DOM element
 * @template T
 * @param {{ [key: string]: any }} element
 * @param {Partial<typeof defaultOptions>} options
 * @returns {import('./signal.mjs').Signal<T>}
 */
export const bind = (element, options = {}) => {
  const opts = { ...defaultOptions, ...options };
  /** @type {import('./signal.mjs').Signal<T>} */
  const boundSignal = signal(/** @type {T} */ (undefined));

  // Set up DOM -> Signal binding (two-way)
  if (opts.twoWay) {
    for (const event of opts.events) {
      element.addEventListener(event, async () => {
        const value = /** @type {T} */ (element[opts.property]);
        // Use untrack to avoid creating a circular dependency
        untrack(() => {
          boundSignal.value = value;
        });
        // Allow time for signal to propagate
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  // Set up Signal -> DOM binding (one-way)
  effect(boundSignal, async (value) => {
    const rendered = opts.render(value);
    element[opts.property] = rendered;
    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return boundSignal;
};

/**
 * Bind multiple signals to multiple elements
 * @param {{ [key: string]: { element: { [key: string]: any } } & Partial<typeof defaultOptions> }} bindings
 * @returns {{ [key: string]: import('./signal.mjs').Signal<any> }}
 */
export const bindAll = (bindings) => {
  return Object.fromEntries(
    Object.entries(bindings).map(([key, { element, ...options }]) => [
      key,
      bind(element, options),
    ])
  );
};

/**
 * Create a computed signal bound to a DOM element
 * @template T
 * @param {{ [key: string]: any }} element
 * @param {import('./signal.mjs').Signal<any> | import('./signal.mjs').Signal<any>[]} deps
 * @param {(...args: any[]) => Promise<T>} computeFn
 * @param {Partial<typeof defaultOptions>} options
 * @returns {import('./signal.mjs').Computed<T>}
 */
export const computedBind = (element, deps, computeFn, options = {}) => {
  const opts = { ...defaultOptions, ...options };
  const computedSignal = computed(deps, computeFn);

  effect(computedSignal, async (value) => {
    const rendered = opts.render(value);
    element[opts.property] = rendered;
    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return computedSignal;
};

/**
 * Bind a signal to an attribute
 * @template T
 * @param {{ setAttribute: (name: string, value: string) => void, removeAttribute: (name: string) => void, getAttribute: (name: string) => string | null }} element
 * @param {string} attribute
 * @param {import('./signal.mjs').Signal<T>} signal
 * @param {(value: T) => string} [render]
 * @returns {import('./signal.mjs').Signal<T>}
 */
export const bindAttribute = (
  element,
  attribute,
  signal,
  render = (value) => value?.toString() ?? ""
) => {
  /**
   * @param {T} value
   */
  const updateAttribute = async (value) => {
    if (value === false || value === null || value === undefined) {
      element.removeAttribute(attribute);
    } else {
      element.setAttribute(attribute, value === true ? "true" : render(value));
    }
    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  effect(signal, updateAttribute);
  void updateAttribute(signal.value);
  return signal;
};

/**
 * Bind a signal to a class name
 * @template T
 * @param {{ classList: { add: (name: string) => void, remove: (name: string) => void, has: (name: string) => boolean } }} element
 * @param {string} className
 * @param {import('./signal.mjs').Signal<T>} signal
 * @returns {import('./signal.mjs').Signal<T>}
 */
export const bindClass = (element, className, signal) => {
  /**
   * @param {T} value
   */
  const updateClass = async (value) => {
    if (value) {
      element.classList.add(className);
    } else {
      element.classList.remove(className);
    }
    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  effect(signal, updateClass);
  void updateClass(signal.value);
  return signal;
};

/**
 * Bind a signal to a style property
 * @template T
 * @param {{ style: { setProperty: (name: string, value: string) => void, removeProperty: (name: string) => void, getPropertyValue: (name: string) => string } }} element
 * @param {string} property
 * @param {import('./signal.mjs').Signal<T>} signal
 * @param {string} [unit='']
 * @returns {import('./signal.mjs').Signal<T>}
 */
export const bindStyle = (element, property, signal, unit = "") => {
  /**
   * @param {T} value
   */
  const updateStyle = async (value) => {
    if (value === null || value === undefined) {
      element.style.removeProperty(property);
    } else {
      element.style.setProperty(property, `${value}${unit}`);
    }
    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  effect(signal, updateStyle);
  void updateStyle(signal.value);
  return signal;
};

/**
 * Create a list binding that efficiently updates only changed items
 * @template T
 * @param {{ appendChild: (node: any) => void, removeChild: (node: any) => void, insertBefore: (node: any, ref: any) => void, children: any[] }} element
 * @param {import('./signal.mjs').Signal<Array<T & { id: string | number }>>} itemsSignal
 * @param {(item: T & { id: string | number }) => any} renderItem
 * @returns {import('./signal.mjs').Signal<Array<T & { id: string | number }>>}
 */
export const bindList = (element, itemsSignal, renderItem) => {
  const itemCache = new Map();

  /**
   * @param {Array<T & { id: string | number }>} items
   */
  const updateList = async (items = []) => {
    // Remove old items
    const currentIds = new Set(items.map((item) => item.id));
    for (const [id, node] of itemCache) {
      if (!currentIds.has(id)) {
        element.removeChild(node);
        itemCache.delete(id);
      }
    }

    // Add/update items
    items.forEach((item, index) => {
      const id = item.id;
      let node = itemCache.get(id);

      if (!node) {
        node = renderItem(item);
        itemCache.set(id, node);
      }

      // Ensure correct position
      if (index >= element.children.length) {
        element.appendChild(node);
      } else if (element.children[index] !== node) {
        element.insertBefore(node, element.children[index]);
      }
    });

    // Remove any extra children
    while (element.children.length > items.length) {
      element.removeChild(element.children[element.children.length - 1]);
    }

    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  effect(itemsSignal, updateList);
  void updateList(itemsSignal.value || []);
  return itemsSignal;
};
