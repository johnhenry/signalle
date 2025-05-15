/**
 * A lightweight linked list implementation for more efficient dependency tracking
 * @template T
 */
export class LinkedList {
  /** @type {LinkedListNode<T> | null} */
  #head = null;
  /** @type {LinkedListNode<T> | null} */
  #tail = null;
  /** @type {number} */
  #size = 0;

  /**
   * @param {T[]} [initialItems=[]]
   */
  constructor(initialItems = []) {
    for (const item of initialItems) {
      this.add(item);
    }
  }

  /**
   * Add an item to the list
   * @param {T} item
   * @returns {() => boolean} Function to remove the item
   */
  add(item) {
    const node = new LinkedListNode(item);
    
    if (!this.#head) {
      this.#head = node;
      this.#tail = node;
    } else if (this.#tail) {
      this.#tail.next = node;
      node.prev = this.#tail;
      this.#tail = node;
    }
    
    this.#size++;
    
    // Return a remove function for this specific node
    return () => this.remove(item);
  }

  /**
   * Remove an item from the list
   * @param {T} item
   * @returns {boolean} Whether the item was found and removed
   */
  remove(item) {
    let current = this.#head;
    
    while (current) {
      if (Object.is(current.value, item)) {
        // Reconnect the list without this node
        if (current.prev) {
          current.prev.next = current.next;
        } else {
          this.#head = current.next;
        }
        
        if (current.next) {
          current.next.prev = current.prev;
        } else {
          this.#tail = current.prev;
        }
        
        this.#size--;
        return true;
      }
      
      current = current.next;
    }
    
    return false;
  }

  /**
   * Check if the list contains an item
   * @param {T} item
   * @returns {boolean}
   */
  has(item) {
    let current = this.#head;
    
    while (current) {
      if (Object.is(current.value, item)) {
        return true;
      }
      current = current.next;
    }
    
    return false;
  }

  /**
   * Get the size of the list
   * @returns {number}
   */
  get size() {
    return this.#size;
  }

  /**
   * Convert the list to an array
   * @returns {T[]}
   */
  toArray() {
    const result = [];
    let current = this.#head;
    
    while (current) {
      result.push(current.value);
      current = current.next;
    }
    
    return result;
  }

  /**
   * Iterate over each item in the list
   * @param {(item: T, index: number) => void} callback
   */
  forEach(callback) {
    let current = this.#head;
    let index = 0;
    
    while (current) {
      callback(current.value, index);
      current = current.next;
      index++;
    }
  }

  /**
   * Create an iterator for the list
   * @returns {Iterator<T>}
   */
  [Symbol.iterator]() {
    let current = this.#head;
    
    return {
      next() {
        if (current) {
          const value = current.value;
          current = current.next;
          return { value, done: false };
        }
        
        return { value: undefined, done: true };
      }
    };
  }

  /**
   * Clear all items from the list
   */
  clear() {
    this.#head = null;
    this.#tail = null;
    this.#size = 0;
  }
}

/**
 * A node in the linked list
 * @template T
 */
class LinkedListNode {
  /** @type {T} */
  value;
  /** @type {LinkedListNode<T> | null} */
  next = null;
  /** @type {LinkedListNode<T> | null} */
  prev = null;

  /**
   * @param {T} value
   */
  constructor(value) {
    this.value = value;
  }
}
