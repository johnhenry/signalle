# Signalle

A beautiful, modern JavaScript signals library with optional DOM integration. Signalle provides fine-grained reactivity with a simple, intuitive API inspired by the best features of existing signal implementations.

## Features

- 🚀 **High Performance**: Efficient linked list-based dependency tracking
- 🔄 **Fine-grained Reactivity**: Only update what changed, not entire components
- 🧩 **Framework Agnostic**: Works anywhere JavaScript runs
- 🔌 **Optional DOM Integration**: Direct DOM bindings when you need them
- 📦 **Small Size**: Tiny footprint for your applications
- 🔍 **TypeScript Support**: Full type definitions included

## Installation

```bash
npm install signalle
```

## Quick Start

```javascript
import { signal, computed, effect } from 'signalle';

// Create a signal with an initial value
const count = signal(0);

// Create a computed signal that depends on other signals
const doubled = computed(count, async (value) => value * 2);

// React to signal changes
effect(doubled, (value) => {
  console.log(`Doubled value: ${value}`);
});

// Update the signal
count.value = 5; // Logs: "Doubled value: 10"
```

## Core API

### signal(initialValue)

Creates a new signal with the given initial value.

```javascript
const name = signal('John');
console.log(name.value); // "John"
name.value = 'Jane';
console.log(name.value); // "Jane"
```

### computed(deps, computeFn)

Creates a computed signal that derives its value from other signals.

```javascript
const firstName = signal('John');
const lastName = signal('Doe');

const fullName = computed([firstName, lastName], async (first, last) => {
  return `${first} ${last}`;
});

console.log(fullName.value); // "John Doe"
firstName.value = 'Jane';
console.log(fullName.value); // "Jane Doe"
```

### effect(signal, fn)

Creates an effect that runs when a signal's value changes.

```javascript
const user = signal({ name: 'John', age: 30 });

const unsubscribe = effect(user, (value) => {
  console.log(`User updated: ${value.name}, ${value.age}`);
});

user.update(u => ({ ...u, age: 31 })); // Logs: "User updated: John, 31"

// Later, to clean up:
unsubscribe();
```

### createEffect(fn)

Creates an effect that automatically tracks signal dependencies.

```javascript
const count = signal(0);
const doubled = computed(count, async (value) => value * 2);

const cleanup = createEffect(() => {
  console.log(`Count: ${count.value}, Doubled: ${doubled.value}`);
});

count.value = 5; // Logs: "Count: 5, Doubled: 10"

// Later, to clean up:
cleanup();
```

### batch(fn)

Batches multiple signal updates to prevent intermediate re-renders.

```javascript
const firstName = signal('John');
const lastName = signal('Doe');
const age = signal(30);

// Without batching, this would trigger 3 separate updates
await batch(async () => {
  firstName.value = 'Jane';
  lastName.value = 'Smith';
  age.value = 28;
});
// Only one update happens after all changes are applied
```

### untrack(fn)

Runs a function without tracking dependencies.

```javascript
const count = signal(0);

createEffect(() => {
  // This will NOT create a dependency on count
  const value = untrack(() => count.value);
  console.log(`The count is ${value} (but won't update)`);
  
  // This WILL create a dependency
  console.log(`The count is ${count.value} (and will update)`);
});
```

## DOM Integration

Signalle includes optional DOM bindings to easily connect signals to the DOM.

```javascript
import { signal } from 'signalle';
import { bind, bindAttribute, bindClass } from 'signalle/dom';

// Create a two-way binding with an input element
const nameInput = document.querySelector('#name-input');
const nameSignal = bind(nameInput, {
  property: 'value',
  events: ['input'],
  twoWay: true
});

// Bind a signal to an attribute
const imageElement = document.querySelector('#profile-image');
const imageSrc = signal('default.jpg');
bindAttribute(imageElement, 'src', imageSrc);

// Bind a signal to a class
const themeToggle = signal(false);
bindClass(document.body, 'dark-theme', themeToggle);
```

### Available DOM Bindings

- `bind(element, options)`: Basic element binding
- `bindAll(bindings)`: Bind multiple elements at once
- `computedBind(element, deps, computeFn, options)`: Bind a computed value
- `bindAttribute(element, attribute, signal, render)`: Bind to an attribute
- `bindClass(element, className, signal)`: Toggle a class
- `bindStyle(element, property, signal, unit)`: Bind to a style property
- `bindList(element, itemsSignal, renderItem)`: Efficient list rendering

## Architecture

Signalle is built with performance and simplicity in mind. Key architectural decisions include:

- **Linked Lists for Dependencies**: More efficient than Set-based approaches
- **Automatic Dependency Tracking**: Optional auto-tracking for effects
- **Batching Support**: Prevent glitches with proper update batching
- **Lazy Evaluation**: Only recompute values when needed
- **Clean API Design**: Intuitive interfaces inspired by the best implementations

## License

MIT
