# 🎭 Signalle

Beautiful, modern signals with optional DOM integration.

## Features

- 🚀 Modern JavaScript with ES modules
- 💡 Simple, intuitive API
- ⚡ Async by default with top-level await support
- 🎯 Computed signals with automatic dependency tracking
- 🔄 Efficient batch updates
- 🌳 Tree-shakeable DOM integration
- 🎨 Flexible rendering options
- 📦 Tiny footprint (~2KB minified and gzipped)

## Installation

```bash
npm install signalle
```

## Basic Usage

```javascript
import { signal, computed, effect } from "signalle";

// Create a simple signal
const count = signal(0);

// Create a computed signal
const doubled = computed(count, (value) => value * 2);

// Create an effect
effect(count, (value) => {
  console.log(`Count is now: ${value}`);
});

// Update the signal
count.value = 5; // Logs: "Count is now: 5"
console.log(doubled.value); // Output: 10

// Update with a function
count.update((n) => n + 1); // Logs: "Count is now: 6"
```

## DOM Integration

DOM integration is available as a separate module to keep the core library lean:

```javascript
import { signal } from "signalle";
import { bind, bindAttribute, bindClass, bindStyle } from "signalle/dom";

// Two-way binding with an input
const name = bind(nameInput, {
  property: "value",
  events: ["input"],
  twoWay: true,
});

// Bind to element content
const greeting = bind(greetingDiv, {
  render: (value) => `Hello, ${value}!`,
});

// Bind to attributes
const isActive = signal(false);
bindAttribute(button, "disabled", isActive);
bindClass(button, "active", isActive);

// Bind to styles
const width = signal(100);
bindStyle(element, "width", width, "px");

// Efficient list rendering
const items = signal([
  { id: 1, text: "Item 1" },
  { id: 2, text: "Item 2" },
]);

bindList(listElement, items, (item) => {
  const li = document.createElement("li");
  li.textContent = item.text;
  return li;
});
```

## Advanced Features

### Batch Updates

```javascript
import { Signal } from "signalle";

await Signal.batch(async () => {
  count.value = 1;
  count.value = 2;
  count.value = 3;
  // Only one update will be triggered
});
```

### Computed Signals with Cleanup

```javascript
const mousePosition = computed([], async () => {
  const pos = signal({ x: 0, y: 0 });

  const handler = (e) => {
    pos.value = { x: e.clientX, y: e.clientY };
  };

  window.addEventListener("mousemove", handler);

  // Return value and cleanup function
  return [pos, () => window.removeEventListener("mousemove", handler)];
});
```

### Multiple Bindings

```javascript
import { bindAll } from "signalle/dom";

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
});

console.log(signals.name.value); // Access bound signals
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
```

## License

MIT
