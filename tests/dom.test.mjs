import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { signal } from "../src/signal.mjs";
import {
  bind,
  bindAttribute,
  bindClass,
  bindStyle,
  bindList,
} from "../src/dom.mjs";

// Improved MockElement with proper DOM-like API
class MockElement {
  constructor() {
    this.textContent = "";
    this.value = "";
    this._attributes = new Map();
    this._classList = new Set();
    this._style = new Map();
    this._children = [];
    this._eventListeners = new Map();
  }

  setAttribute(name, value) {
    this._attributes.set(name, value);
  }

  getAttribute(name) {
    return this._attributes.get(name);
  }

  removeAttribute(name) {
    this._attributes.delete(name);
  }

  get attributes() {
    return this._attributes;
  }

  get classList() {
    return {
      add: (className) => this._classList.add(className),
      remove: (className) => this._classList.delete(className),
      toggle: (className, force) => {
        if (force === undefined) {
          force = !this._classList.has(className);
        }
        if (force) {
          this._classList.add(className);
        } else {
          this._classList.delete(className);
        }
        return force;
      },
      has: (className) => this._classList.has(className),
    };
  }

  get style() {
    return {
      setProperty: (prop, value) => this._style.set(prop, value),
      removeProperty: (prop) => this._style.delete(prop),
      getPropertyValue: (prop) => this._style.get(prop),
    };
  }

  get children() {
    return this._children;
  }

  appendChild(child) {
    this._children.push(child);
  }

  insertBefore(newChild, referenceChild) {
    const index = referenceChild
      ? this._children.indexOf(referenceChild)
      : this._children.length;
    this._children.splice(index, 0, newChild);
  }

  removeChild(child) {
    const index = this._children.indexOf(child);
    if (index !== -1) {
      this._children.splice(index, 1);
    }
  }

  addEventListener(event, handler) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event).add(handler);
  }

  removeEventListener(event, handler) {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      listeners.delete(handler);
    }
  }

  dispatchEvent(event, value) {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      listeners.forEach((handler) => handler({ target: this, value }));
    }
  }

  remove() {
    // Simulate node removal
  }
}

describe("DOM Bindings", async () => {
  let element;

  beforeEach(() => {
    element = new MockElement();
  });

  it("should bind signal to element content", async () => {
    const boundSignal = bind(element);
    boundSignal.value = "Hello";
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(element.textContent, "Hello");
  });

  it("should support two-way binding", async () => {
    const boundSignal = bind(element, {
      property: "value",
      events: ["input"],
      twoWay: true,
    });

    // DOM -> Signal
    element.value = "test";
    element.dispatchEvent("input");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(boundSignal.value, "test");

    // Signal -> DOM
    boundSignal.value = "updated";
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.value, "updated");
  });

  it("should bind attributes", async () => {
    const isDisabled = signal(false);
    bindAttribute(element, "disabled", isDisabled);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.attributes.has("disabled"), false);

    isDisabled.value = true;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.attributes.get("disabled"), "true");
  });

  it("should bind classes", async () => {
    const isActive = signal(false);
    bindClass(element, "active", isActive);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.classList.has("active"), false);

    isActive.value = true;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.classList.has("active"), true);
  });

  it("should bind styles", async () => {
    const width = signal(100);
    bindStyle(element, "width", width, "px");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(element.style.getPropertyValue("width"), "100px");
    width.value = 200;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(element.style.getPropertyValue("width"), "200px");
  });

  it("should handle list binding", async () => {
    const items = signal([
      { id: 1, text: "Item 1" },
      { id: 2, text: "Item 2" },
    ]);

    bindList(element, items, (item) => {
      const child = new MockElement();
      child.textContent = item.text;
      return child;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(element.children.length, 2);
    assert.equal(element.children[0].textContent, "Item 1");
    assert.equal(element.children[1].textContent, "Item 2");

    // Update list
    items.value = [
      { id: 2, text: "Item 2" },
      { id: 3, text: "Item 3" },
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(element.children.length, 2);
    assert.equal(element.children[0].textContent, "Item 2");
    assert.equal(element.children[1].textContent, "Item 3");
  });

  it("should support custom rendering", async () => {
    const count = bind(element, {
      render: (value) => `Count: ${value}`,
    });

    count.value = 42;
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(element.textContent, "Count: 42");
  });

  it("should handle null/undefined values", () => {
    const nullSignal = bind(element);
    nullSignal.value = null;
    assert.equal(element.textContent, "");

    const undefinedSignal = bind(element);
    undefinedSignal.value = undefined;
    assert.equal(element.textContent, "");
  });
});
