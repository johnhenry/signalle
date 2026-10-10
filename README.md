# Signalle

[![npm version](https://img.shields.io/npm/v/signalle.svg)](https://www.npmjs.com/package/signalle)
[![CI](https://github.com/johnhenry/signalle/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/signalle/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/signalle.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/signalle](https://opensource.johnhenry.me/signalle/)

A beautiful, modern JavaScript signals library with optional DOM integration. Signalle provides fine-grained reactivity with a simple, intuitive API inspired by the best features of existing signal implementations.

> **Note:** Published on npm as unscoped `signalle` (not yet moved into the `@johnhenry` scope).

## Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core API](#core-api)
- [DOM Integration](#dom-integration)
- [Server-Side Streaming](#server-side-streaming)
- [Scoped Signals](#scoped-signals)
- [Broadcast Signals](#broadcast-signals)
- [Async Iterables](#async-iterables)
- [Exports](#exports)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Family](#family)
- [License](#license)

## Features

- 🚀 **High Performance**: Efficient linked list-based dependency tracking
- 🔄 **Fine-grained Reactivity**: Only update what changed, not entire components
- 🧩 **Framework Agnostic**: Works anywhere JavaScript runs
- 🔌 **Optional DOM Integration**: Direct DOM bindings when you need them
- 📦 **Small Size**: Tiny footprint for your applications
- 🔍 **TypeScript Support**: Full type definitions included

## Installation

```bash
npm install @johnhenry/signalle
```

> **Provenance:** first published under this name — `signalle` had never
> been published to npm under any name before `0.1.0`.

## Quick Start

```javascript
import { signal, computed, effect } from '@johnhenry/signalle';

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

Creates a computed signal that derives its value from other signals. `computeFn` may be synchronous or `async`:

- **Synchronous `computeFn`** (returns a plain value): the first run happens inside `computed()`, so `.value` is correct immediately.
- **Async `computeFn`** (returns a promise): `.value` is `undefined` until the first run settles, and later updates are applied asynchronously, one or more ticks after the dependency changes. Reading `.value` right after a write returns the previous result, not the new one.

`computed.ready` is a promise that resolves once the first run has settled (immediately for a synchronous `computeFn`), and `effect(computed, fn)` / `createEffect()` run `fn` whenever a settled value arrives.

```javascript
const firstName = signal('John');
const lastName = signal('Doe');

// Synchronous: usable right away
const initials = computed([firstName, lastName], (first, last) => first[0] + last[0]);
console.log(initials.value); // "JD"

// Async: undefined until the first run settles
const fullName = computed([firstName, lastName], async (first, last) => `${first} ${last}`);
console.log(fullName.value); // undefined
await fullName.ready;
console.log(fullName.value); // "John Doe"

firstName.value = 'Jane';
console.log(fullName.value); // "John Doe" (the async update has not been applied yet)
effect(fullName, (name) => console.log(name)); // logs "Jane Doe" once it settles
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
import { signal } from '@johnhenry/signalle';
import { bind, bindAttribute, bindClass } from '@johnhenry/signalle/dom';

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

## Server-Side Streaming

```js
import { signal } from '@johnhenry/signalle';
import { toSSEResponse } from '@johnhenry/signalle/stream';

const feed = signal({ count: 0 });

// Returns a Response with Content-Type: text/event-stream
// that automatically pushes updates when the signal changes
const response = toSSEResponse(feed, {
  event: 'update',  // SSE event name (optional)
  cors: true         // Set CORS headers (optional, default false)
});
```

### `toSSEResponse(signal, options?)`

Creates a Server-Sent Events Response from a signal. The stream pushes a new SSE message whenever the signal's value changes.

**Options:**

- `transform` (function) — Transform the value before sending (default: `JSON.stringify`)
- `event` (string) — SSE event name
- `sendInitial` (boolean) — Whether to send the signal's current value immediately (default: `true`)
- `cors` (boolean or string origin) — Set CORS headers

### `toReadableStream(signal, options?)`

The lower-level primitive behind `toSSEResponse`: converts a signal into a `ReadableStream<Uint8Array>` of UTF-8-encoded, SSE-formatted chunks, for cases where you need the stream itself rather than a full `Response`. Chunks are bytes, not strings — a `Response`/`ReadableStream` body must yield `Uint8Array`s, so a consumer can safely call `res.text()`, `res.arrayBuffer()`, or iterate `response.body.getReader()` directly.

## Scoped Signals

```js
import { createScope } from '@johnhenry/signalle/scope';

const scope = createScope();

const count = scope.signal(0);
const doubled = scope.computed(count, async (v) => v * 2);

const cleanup = scope.createEffect(() => {
  console.log(`Count: ${count.value}, Doubled: ${doubled.value}`);
});

count.value = 5; // Logs: "Count: 5, Doubled: 10"

scope.dispose(); // Cleans up all effects created in this scope
```

### `createScope()`

Creates an isolated signal context, safe for multi-tenant / concurrent server use (e.g. one scope per request). Returns:

- `scope.signal(initialValue)` — scope-isolated `signal()`
- `scope.computed(deps, fn)` — scope-isolated `computed()`
- `scope.effect(signal, fn)` — scope-isolated `effect()`
- `scope.createEffect(fn)` — scope-isolated `createEffect()` (see warning below)
- `scope.batch(fn)` — scope-isolated `batch()`
- `scope.untrack(fn)` — scope-isolated `untrack()`
- `scope.dispose()` — cleans up every effect created in this scope

### ⚠️ Auto-tracking isolation: use `scope.createEffect`, not the top-level `createEffect`

Signals, computeds, `effect()`, `batch()`, and `untrack()` created through a scope are fully isolated from every other scope — they hold their own independent state.

The **top-level `createEffect`** imported from `signalle` is different: its automatic dependency tracking is implemented with a single tracker shared by the whole process (a module-static field). Because of that, **it will not auto-track signals created via `scope.signal()`/`scope.computed()`** — reading a scoped signal inside a plain, top-level `createEffect(...)` simply won't register a dependency. This is intentional (it's what prevents scopes from leaking into each other), but it means the top-level `createEffect` must never be used as your auto-tracking mechanism for scoped signals, and is unsafe as an isolation boundary between concurrent logical contexts (e.g. two concurrent server requests) in general.

Use **`scope.createEffect(fn)`** instead whenever you need auto-tracking inside a scope. It has its own independent tracker state per scope, so multiple scopes' `createEffect` calls — even interleaved within the same event-loop tick — never corrupt each other's dependency tracking.

## Broadcast Signals

Signals that stay in sync across browser tabs, iframes, or workers via `BroadcastChannel`.

```js
import { createBroadcastSignal } from '@johnhenry/signalle/broadcast';

// Every `createBroadcastSignal(initial, channelName)` call that shares the
// same channel name — in any tab, iframe, or worker — stays in sync.
const sharedCount = createBroadcastSignal(0, 'shared-count');

sharedCount.subscribe((value) => {
  console.log('Count is now:', value);
});

// Setting the value here also updates every other tab/worker listening on
// the 'shared-count' channel.
sharedCount.value = 1;

// Clean up: closes the underlying BroadcastChannel
sharedCount.dispose();
```

### `createBroadcastSignal(initialValue, channelName?)`

Creates a signal backed by a `BroadcastChannel`. Values are `structuredClone`d before being compared/stored/broadcast, so they must be structured-clone-safe (plain objects, arrays, primitives, etc. — no functions or DOM nodes).

- `initialValue` — the signal's starting value (local to this instance until it either receives a broadcast or confirms it's the first one on the channel)
- `channelName` (optional) — the `BroadcastChannel` name to synchronize on; defaults to `'default-signal'`

Returns an object with `value` (get/set), `subscribe(fn)`, and `dispose()`.

**Joining an already-active channel:** every new instance asks any already-broadcasting peer for its current state as soon as it's constructed (a lightweight request/response exchange over the same `BroadcastChannel`, not a separate connection). If a peer answers, the newcomer adopts that peer's current value and version before it's ever written to — so a tab opened after others have already been writing converges to the current value shortly after construction, rather than starting from its own stale `initialValue` and never catching up. If no peer answers (it's the first/only instance on the channel), it simply keeps `initialValue`. This sync happens asynchronously, on the same message channel as ordinary updates — expect a short delay (one round trip) after construction before a late joiner's `.value` reflects the current state.

### `generateWorkerCode(signalCode, name?)`

Generates a self-contained string of worker code that embeds the `BroadcastSignal` implementation plus a `createBroadcastSignal`-equivalent factory (bound to `name`, default `'createBroadcastSignal'`), so it can be dropped into a `Worker`/`Blob` URL without a bundler:

```js
import { generateWorkerCode } from '@johnhenry/signalle/broadcast';

const workerCode = generateWorkerCode(`
  const sharedCount = createBroadcastSignal(0, 'shared-count');
  sharedCount.subscribe((value) => postMessage(value));
`);

const blob = new Blob([workerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(blob));
```

## Async Iterables

Adapters between signals and async iterables, from `@johnhenry/signalle/iterable`. They use only `Promise`, `queueMicrotask`, `Symbol.asyncIterator` and `AbortSignal` (no DOM), so they run the same in a Worker, an iframe and Node.

```js
import { signal } from '@johnhenry/signalle';
import { toAsyncIterable, fromAsyncIterable } from '@johnhenry/signalle/iterable';

const count = signal(0);

// Signal -> async iterable
const ac = new AbortController();
for await (const value of toAsyncIterable(count, { signal: ac.signal })) {
  render(value);            // `break`, `return()` or ac.abort() unsubscribes
}

// Async iterable -> signal
const { signal: latestPrice, dispose, done } = fromAsyncIterable(priceFeed(), null);
latestPrice.subscribe((price) => console.log(price));
done.catch((err) => console.error('feed failed', err));
// later: dispose() -> calls priceFeed's return()
```

### `toAsyncIterable(signal, { signal, initial = true, latest = true, limit }?)`

Returns an async iterator (also an async iterable) of the signal's values. `signal` can be any object with `subscribe(fn) => unsubscribe`: a `Signal`, a `Computed`, a scoped signal, or a `BroadcastSignal`.

- **`latest: true` (default): conflating.** At most one value is held. A reader that falls behind gets the newest value, never the intermediate ones.
- **`latest: false`: buffering.** Every change is queued and yielded in order. The queue is unbounded unless `limit` (a positive integer) is set; past `limit` the **oldest** queued value is dropped. `limit` is ignored with `latest: true`.
- **Repeats**: in either mode, a notification equal (`Object.is`) to the previous one is not yielded again; see [Timing](#timing) for why that matters.
- **`initial`**: yield the value current at call time first. With `initial: false`, only changes after the call are yielded.
- **Cleanup**: `break` (or anything else that calls `return()`) and aborting `signal` unsubscribe. An abort *completes* the iteration (`{ done: true }`); it does not reject. An already-aborted `signal` never subscribes.

**Not done:** the subscription is taken when `toAsyncIterable()` is called, not on the first `next()`, so a buffered iterator doesn't miss changes made before the loop starts. An iterator you never iterate keeps its subscription until you call `return()` or abort. It is a single iterator, not a broadcast: two loops over the same result share (split) its values; call `toAsyncIterable()` once per reader. Disposing the source signal does not end the iteration (signals have no completion event); end it yourself.

### `fromAsyncIterable(iterable, initial, { signal }?)`

Returns `{ signal, dispose, done }` (also `[Symbol.dispose]`, so it works with `using`). `signal` is a new plain `Signal` that starts at `initial` and takes each value the iterable yields.

- **`dispose()`** stops writing to the signal and calls the iterator's `return()` once, which runs an async generator's `finally`. It is idempotent, and a no-op once the source has finished. Aborting `signal` does the same; if `signal` is already aborted, the iterable is never opened.
- **`done`** settles when iteration ends. It resolves when the source completes or on `dispose()`/abort, and rejects with the error if the source throws. It doesn't wait for `return()` to finish: an async generator suspended in an `await` (rather than at a `yield`) can't run its `finally` until that `await` settles. Any rejection from `return()` itself is swallowed.
- **Errors** are reported only through `done`. `done` is pre-marked as handled, so a failure you ignore does not crash Node with an unhandled rejection. Await it or `.catch()` it if you need to know. On an error the signal keeps its last value.

**Not done:** the returned signal is never disposed by the adapter (it keeps its last value after the source ends), and it is not scoped. Sync iterables (arrays, plain generators) are rejected with a `TypeError`; wrap one in an `async function*` if you need it.

### Timing

signalle's notification timing has two cases (see [`computed`](#computeddeps-computefn) and the 0.1.4 entry in `CHANGELOG.md`):

- A write to a plain signal that **no `computed()` depends on** notifies its subscribers **synchronously**, inside the `.value = ...` write. Inside `batch()`, that notification waits for the outermost batch to flush.
- A write to a signal that **has computed dependents** runs a propagation wave: the computeds recompute first (asynchronously, even when `computeFn` is synchronous), then every changed node's subscribers fire, including the written signal's own. Subscribers receive the value current *when they fire*, so a synchronous burst of writes to such a signal is reported once per write, each time with the final value. An async `computeFn` settles one or more ticks after the write.

How the adapters fit in:

- **`fromAsyncIterable`** writes each yielded value with `signal.value = v`, in the microtask where the source's `next()` resolved. That is an ordinary write: the returned signal's subscribers run synchronously during it unless computeds depend on the signal, in which case they run after those computeds settle. An `Object.is`-equal value is a no-op, so consecutive duplicates don't notify.
- **`toAsyncIterable`** receives notifications at whatever time signalle delivers them, but `next()` always resolves asynchronously, since it returns a promise. With `latest: true`, delivery to a reader that is already waiting is deferred by one microtask, so a synchronous burst of writes, such as several assignments in a row or a `batch()` flush, reaches it as **one final value**.
- With **`latest: false`**, every notification is kept, but a notification equal (`Object.is`) to the previous one is not yielded again. That collapses the repeated final values described above. It also means the intermediate values of a synchronous burst to a signal *with computed dependents* are not observable: signalle never reports them, so the iterator yields only the final one. A signal with no computed dependents reports, and the iterator yields, every intermediate value.
- For a **`computed` source**, values arrive when the computation settles, never before. With `initial: true` on an async computed that hasn't settled yet, the first value yielded is its first *settled* value, not the pre-settle `undefined`. A computed that recomputes to the same value doesn't notify, so it doesn't yield.

## Exports

| Export | Description |
|--------|-------------|
| `signalle` | Core: `signal`, `computed`, `effect`, `createEffect`, `batch`, `untrack` |
| `signalle/dom` | DOM bindings: `bind`, `bindAll`, `computedBind`, `bindAttribute`, `bindClass`, `bindStyle`, `bindList` |
| `signalle/stream` | Server: `toReadableStream`, `toSSEResponse` |
| `signalle/scope` | Isolation: `createScope` (`SignalScope`) |
| `signalle/broadcast` | Cross-tab/worker sync: `createBroadcastSignal`, `generateWorkerCode` |
| `signalle/iterable` | Async iterables: `toAsyncIterable`, `fromAsyncIterable` |

## Architecture

Signalle is built with performance and simplicity in mind. Key architectural decisions include:

- **Linked Lists for Dependencies**: More efficient than Set-based approaches
- **Automatic Dependency Tracking**: Optional auto-tracking for effects
- **Batching Support**: Prevent glitches with proper update batching
- **Lazy Evaluation**: Only recompute values when needed
- **Clean API Design**: Intuitive interfaces inspired by the best implementations

## Security model

`generateWorkerCode(signalCode, name?)` (in `signalle/broadcast`) is the one
part of signalle that is eval-adjacent. Read this before passing it
anything you didn't write yourself.

**What signalle guarantees:**

- **Every other export is plain data-flow code with no code generation or
  dynamic evaluation.** `signal()`, `computed()`, `effect()`,
  `createEffect()`, `batch()`, `untrack()`, the DOM bindings, the SSE stream
  helpers, the async-iterable adapters, and `createScope()` never construct or execute a string as code.
  The security surface described below is scoped to `generateWorkerCode()`
  alone.
- **The generated Worker gets you what any Worker gets you: no DOM access.**
  Workers are inherently isolated from the document — this is a platform
  property, not something `generateWorkerCode()` adds.
- **`scope.createEffect()` keeps one scope's auto-tracking from corrupting
  another's.** Each `SignalScope` has its own tracker state, so multiple
  scopes' effects — even interleaved within the same event-loop tick — never
  clobber each other's dependency tracking (see the warning above; the
  top-level `createEffect` does not have this guarantee and must not be
  used as an isolation boundary between scopes).

**What is still yours:**

- **`generateWorkerCode()` does not parse, sandbox, or validate `signalCode`
  in any way.** It is plain string interpolation into a JS source string:

  ```js
  export function generateWorkerCode(signalCode, name = "createBroadcastSignal") {
    return `
      ${BroadcastSignal.toString()}
      const ${name} = ${createBroadcastSignal.toString()};
      ${signalCode}
      `;
  }
  ```

  Whatever `signalCode` contains becomes the literal body of the generated
  script, which the README's own usage example then runs by wrapping it in
  a `Blob` and handing it to `new Worker(URL.createObjectURL(blob))`. There
  is no intermediate evaluation step and no capability restriction — this
  is equivalent to `eval()`, just with an extra Worker/Blob indirection on
  top. Once that Worker is running, nothing here restricts what the
  generated code can call: `fetch`, `WebSocket`, `importScripts`,
  `indexedDB`, nested `Worker`s, and `postMessage` back to the page that
  created it are all directly reachable from inside `signalCode`, because
  `generateWorkerCode()` performs zero capability gating — it only
  concatenates strings.
- **Never pass untrusted or user-supplied input into `generateWorkerCode()`,**
  whether as the whole `signalCode` argument or interpolated into it (e.g.
  building the string from a URL parameter, a database value, or anything
  else an attacker could influence). Doing so is arbitrary code execution in
  that Worker's context, with network and storage access, and a live
  channel back to the page via `postMessage`.
- **`name` is interpolated the same way** (`const ${name} = ...`) — treat it
  as a fixed identifier you choose in code, not as a value derived from
  external input.
- **`generateWorkerCode()` is meant for splicing together developer-authored
  strings/templates** at build- or call-time (the documented use case:
  shipping a bundler-free worker script), not for running code whose
  content you don't already control. If you need to run code you don't
  fully trust, this function is the wrong tool — reach for a real
  sandboxing layer instead (see [Family](#family)).

## Family

signalle doesn't consume or produce artifacts for any other `@johnhenry/*`
package — it's a standalone reactive-signals library. The one
cross-reference that exists in this README is a pointer, not a dependency:

- **[`@johnhenry/andbox`](https://github.com/johnhenry/andbox)** — referenced
  from [Security model](#security-model) above as the tool to reach for if
  you need to run code you don't trust. `generateWorkerCode()` here performs
  zero sandboxing of its own; andbox documents its own, narrower set of
  guarantees and gaps for that job.

## License

MIT
