# 🎭 Signalle

Beautiful, modern signals with optional DOM integration.

## What are Signals?

Signals are reactive containers for values that can notify subscribers when they change. Think of them as smart variables that know when they've been modified and can trigger updates automatically. Unlike traditional variables, signals provide a way to track changes and automatically update dependent parts of your application.

## Features

- 🚀 Modern JavaScript with ES modules
- 💡 Simple, intuitive API
- ⚡ Async by default with top-level await support
- 🎯 Computed signals with automatic dependency tracking
- 🔄 Efficient batch updates
- 🌳 Tree-shakeable DOM integration
- 🎨 Flexible rendering options
- 🌐 Cross-context communication support
- 📦 Tiny footprint (~2KB minified and gzipped)

## Installation

```bash
npm install signalle
```

## Core Concepts

### Signal vs signal

The library provides two ways to work with signals:

- `signal` lowercase: A factory function that creates new Signal instances. This is the recommended way to create signals in your application. It provides a simpler, more ergonomic API for working with signals.

- `Signal` (Uppercase): The class that implements the signal behavior. Use this when you need to extend or create custom signal types. It provides the core functionality for value containment, subscription management, and update notifications.

```javascript
import { signal, Signal } from "signalle";

// Using the signal factory function (recommended)
const count = signal(0);

// Using the Signal class directly (not recommended for general use)
const countSignal = new Signal(0);
```

### Core Functions

#### signal(initialValue)

Creates a new signal with an initial value. The signal provides reactive state management with automatic updates.

```javascript
const count = signal(0);
console.log(count.value); // Get the current value: 0
count.value = 5; // Update the value
count.update((n) => n + 1); // Update using a function
```

#### computed(dependencies, computeFn)

Creates a computed signal that automatically updates when its dependencies change. The compute function can be asynchronous and optionally return a cleanup function.

```javascript
// Simple computed
const count = signal(0);
const doubled = computed(count, async (value) => value * 2);

// Computed with multiple dependencies
const firstName = signal("John");
const lastName = signal("Doe");
const fullName = computed(
  [firstName, lastName],
  async (first, last) => `${first} ${last}`
);

// Computed with cleanup
const mousePos = computed([], async () => {
  const pos = signal({ x: 0, y: 0 });

  const handler = (e) => {
    pos.value = { x: e.clientX, y: e.clientY };
  };

  window.addEventListener("mousemove", handler);

  // Return value and cleanup function
  return [pos, () => window.removeEventListener("mousemove", handler)];
});
```

#### effect(signal, fn)

Creates an effect that runs whenever the signal's value changes. Effects are useful for performing side effects in response to state changes.

```javascript
const count = signal(0);

effect(count, (value) => {
  console.log(`Count changed to: ${value}`);
});

count.value = 5; // Logs: "Count changed to: 5"
```

### Batch Updates

Batch updates allow you to make multiple signal updates that will only trigger a single notification to subscribers. This is useful for optimizing performance when making multiple related updates.

```javascript
import { Signal } from "signalle";

const count = signal(0);
const doubled = computed(count, async (value) => value * 2);

effect(doubled, (value) => {
  console.log(`Doubled value: ${value}`);
});

// Without batching - triggers multiple updates
count.value = 1; // Logs: "Doubled value: 2"
count.value = 2; // Logs: "Doubled value: 4"
count.value = 3; // Logs: "Doubled value: 6"

// With batching - triggers only one update
await Signal.batch(async () => {
  count.value = 1;
  count.value = 2;
  count.value = 3;
}); // Logs: "Doubled value: 6" (only once)
```

### Cross-Context Communication

Signals can work seamlessly across different JavaScript contexts (Web Workers, iframes) using structuredClone for value transfer and BroadcastChannel for communication.

```javascript
// In main thread
const sharedSignal = signal(0, "counter");
effect(sharedSignal, (value) => {
  console.log("Main thread:", value);
});

// In Web Worker or iframe
const workerSignal = signal(0, "counter");
effect(workerSignal, (value) => {
  console.log("Worker:", value);
});

// Updates sync automatically between contexts
sharedSignal.value = 42; // Both contexts log the new value
```

Key features of cross-context signals:

- Automatic value synchronization using structuredClone
- Support for complex objects and nested data structures
- Race condition handling with version tracking
- Bi-directional updates between contexts
- Clean resource disposal

## DOM Integration

The DOM integration module provides powerful tools for binding signals to DOM elements. All DOM bindings are automatically reactive and update when their associated signals change.

### Basic Binding

#### bind(element, options)

Creates a two-way binding between a signal and a DOM element.

```javascript
import { bind } from "signalle/dom";

// Simple text binding
const nameSignal = bind(nameDiv, {
  property: "textContent",
  render: (value) => `Hello, ${value}!`,
});

// Two-way input binding
const inputSignal = bind(inputElement, {
  property: "value",
  events: ["input"],
  twoWay: true,
});
```

#### bindAttribute(element, attribute, signal, render?)

Binds a signal to an element's attribute.

```javascript
const isDisabled = signal(false);
bindAttribute(button, "disabled", isDisabled);

// With custom rendering
const opacity = signal(0.5);
bindAttribute(
  div,
  "data-opacity",
  opacity,
  (value) => (value * 100).toFixed(0) + "%"
);
```

#### bindClass(element, className, signal)

Binds a signal to a CSS class, toggling it based on the signal's value.

```javascript
const isActive = signal(false);
bindClass(element, "active", isActive);

// The class 'active' will be added when isActive is true
isActive.value = true;
```

#### bindStyle(element, property, signal, unit?)

Binds a signal to a CSS style property.

```javascript
const width = signal(100);
bindStyle(element, "width", width, "px");

const color = signal("red");
bindStyle(element, "background-color", color);
```

#### bindList(element, itemsSignal, renderItem)

Creates an efficient list binding that only updates changed items.

```javascript
const items = signal([
  { id: 1, text: "Item 1" },
  { id: 2, text: "Item 2" },
]);

bindList(listElement, items, (item) => {
  const li = document.createElement("li");
  li.textContent = item.text;
  return li;
});

// Efficiently updates only changed items
items.value = [
  { id: 1, text: "Item 1" },
  { id: 2, text: "Updated Item 2" },
  { id: 3, text: "Item 3" },
];
```

### Multiple Bindings

#### bindAll(bindings)

Binds multiple signals to multiple elements in one operation.

```javascript
const signals = bindAll({
  name: {
    element: nameInput,
    property: "value",
    events: ["input"],
    twoWay: true,
  },
  age: {
    element: ageInput,
    property: "value",
    events: ["input"],
    twoWay: true,
    render: (value) => value.toString(),
  },
  greeting: {
    element: greetingDiv,
    render: (value) => `Hello, ${value}!`,
  },
});

console.log(signals.name.value); // Access bound signals
```

## Examples

The library includes several examples demonstrating different features:

1. **Todo App** (todo.html)

   - Basic signal usage with DOM integration
   - Event handling and state management

2. **Cross-Context with Web Workers** (cross-context.html)

   - Signals working across Web Worker boundaries
   - structuredClone integration
   - Worker-to-main thread communication

3. **Cross-Context with iframes** (iframe-parent.html)
   - Parent-child iframe communication
   - Shared state management
   - Complex object synchronization

View the examples by running:

```bash
npx live-server examples/
```

## TypeScript Support

Full TypeScript support is included out of the box:

```typescript
import { signal, computed, type Signal } from "signalle";

interface User {
  name: string;
  age: number;
}

const user: Signal<User> = signal({
  name: "John",
  age: 30,
});

const greeting = computed(user, async (u) => `Hello, ${u.name}!`);
```

## License

MIT
