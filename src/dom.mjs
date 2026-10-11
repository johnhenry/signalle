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
 * Longest increasing subsequence of `seq` (entries of -1 are skipped), as a
 * Set of the indexes into `seq` that belong to it. Used by `bindList` to keep
 * the largest run of already-ordered nodes in place and move only the rest.
 * @param {number[]} seq
 * @returns {Set<number>}
 */
const longestIncreasing = (seq) => {
  /** @type {number[]} */
  const tails = [];
  /** @type {number[]} */
  const prev = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i];
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k];
  }
  return keep;
};

/**
 * Create a keyed list binding that efficiently updates only changed items.
 *
 * `bindList(element, itemsSignal, renderItem)` is the original form: items
 * are keyed by `item.id`, and a node is rendered once per key. The third
 * argument may instead be an options object, or a fourth options argument
 * may follow `renderItem`:
 *
 * - `render(item, index)`: returns a node, or `{ node, update }` where
 *   `update` patches that node later (it takes precedence over `options.update`).
 * - `update(node, item, index, previousItem)`: called for an existing key whose
 *   item changed (`!equals(previousItem, item)`). Without any update function,
 *   an existing node is never re-rendered (the original behaviour).
 * - `key`: a property name or `(item, index) => key`; defaults to `item.id`.
 * - `equals(previousItem, item)`: defaults to `Object.is`.
 *
 * Only nodes that `bindList` created are moved or removed. Other children of
 * `element` are left alone, and the list's nodes stay together as one block
 * (appended after the existing children on the first render).
 * @template T
 * @param {any} element
 * @param {import('./signal.mjs').Signal<T[]>} itemsSignal
 * @param {((item: T, index: number) => any) | Record<string, any>} renderOrOptions
 * @param {Record<string, any>} [maybeOptions]
 * @returns {import('./signal.mjs').Signal<T[]>}
 */
export const bindList = (element, itemsSignal, renderOrOptions, maybeOptions) => {
  const opts =
    typeof renderOrOptions === "function"
      ? { ...(maybeOptions || {}), render: renderOrOptions }
      : { ...(renderOrOptions || {}) };
  if (typeof opts.render !== "function") {
    throw new TypeError("bindList: a render function is required");
  }
  const keyOf =
    typeof opts.key === "function"
      ? opts.key
      : opts.key !== undefined && opts.key !== null
        ? (/** @type {any} */ item) => item?.[opts.key]
        : (/** @type {any} */ item) => item?.id;
  const equals = typeof opts.equals === "function" ? opts.equals : Object.is;

  /** @type {Map<any, { node: any, item: any, update: Function | undefined }>} */
  let entries = new Map();
  /** @type {any[]} nodes in list order */
  let order = [];
  // The node right after the list's block when the list was last empty, so
  // an emptied list grows back in the same place among other children.
  /** @type {any} */
  let emptyRef = null;
  let warnedDuplicate = false;

  /**
   * @param {T[]} items
   */
  const updateList = async (items = []) => {
    if (!Array.isArray(items)) items = [];

    // Where the block ends: the sibling after our last node (a foreign
    // child or null), measured before anything moves.
    let ref = null;
    if (order.length) {
      const last = order[order.length - 1];
      ref = last.parentNode === element ? last.nextSibling : null;
      // Skip over our own nodes that may follow if the block was disturbed.
      const own = new Set(order);
      while (ref && own.has(ref)) ref = ref.nextSibling;
    } else if (emptyRef && emptyRef.parentNode === element) {
      ref = emptyRef;
    }

    /** @type {Map<any, { node: any, item: any, update: Function | undefined }>} */
    const nextEntries = new Map();
    /** @type {any[]} */
    const nextOrder = [];
    items.forEach((item, index) => {
      const key = keyOf(item, index);
      if (nextEntries.has(key)) {
        if (!warnedDuplicate) {
          warnedDuplicate = true;
          console.warn(`bindList: duplicate key ${String(key)}; later items with the same key are skipped`);
        }
        return;
      }
      let entry = entries.get(key);
      if (!entry) {
        const rendered = opts.render(item, index);
        entry =
          rendered && typeof rendered === "object" && !("nodeType" in rendered) && "node" in rendered
            ? { node: rendered.node, item, update: rendered.update }
            : { node: rendered, item, update: undefined };
      } else if (!equals(entry.item, item)) {
        const update = entry.update || opts.update;
        const previous = entry.item;
        entry = { ...entry, item };
        if (typeof update === "function") update(entry.node, item, index, previous);
      }
      nextEntries.set(key, entry);
      nextOrder.push(entry.node);
    });

    // Remove nodes whose key is gone (only our own nodes).
    const kept = new Set(nextOrder);
    for (const node of order) {
      if (!kept.has(node) && node.parentNode === element) {
        element.removeChild(node);
      }
    }

    // Keep the longest run of nodes that are already in order; move the rest.
    const oldIndex = new Map(order.map((node, i) => [node, i]));
    const seq = nextOrder.map((node) =>
      node.parentNode === element && oldIndex.has(node) ? /** @type {number} */ (oldIndex.get(node)) : -1
    );
    const stable = longestIncreasing(seq);
    let cursor = ref;
    for (let i = nextOrder.length - 1; i >= 0; i--) {
      const node = nextOrder[i];
      if (!stable.has(i)) element.insertBefore(node, cursor);
      cursor = node;
    }

    if (!nextOrder.length) emptyRef = ref;
    entries = nextEntries;
    order = nextOrder;

    // Allow time for DOM to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  effect(itemsSignal, updateList);
  void updateList(itemsSignal.value || []);
  return itemsSignal;
};
