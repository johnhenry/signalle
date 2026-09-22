# signalle examples

Most of signalle's surface area is DOM/browser-facing (bindings, cross-tab
broadcast, Service-Worker-adjacent Worker code), so most examples here are
browser demos rather than headless Node scripts — they are served and opened
in a browser, not run with `node`. `dom-example.mjs` and `todo-app.mjs` are
Node modules that build and inject their own HTML rather than standalone
pages; open `index.html` for the full list with descriptions.

These are **not** currently numbered `NN-<what-it-proves>` or wired into a
`npm run examples` smoke-test script — unlike a self-verifying Node example,
a browser demo has no headless "exits 0 on success" story without adding a
browser-automation dependency this repo doesn't otherwise have. The unit
suite (`tests/*.test.mjs`) is what actually gets regression coverage; these
examples are for humans exploring the API interactively.

| Example | Demonstrates |
| --- | --- |
| [`index.html`](./index.html) | Landing page linking every other example in this directory. |
| [`todo-app.mjs`](./todo-app.mjs) | A `signal`/`computed`/`createEffect`/`batch` todo list: filtering derives from two signals (`todos`, `filter`) via `computed`, and adding/toggling/removing todos goes through `batch()` so multiple state changes produce one re-render. |
| [`todo.html`](./todo.html) | The same todo app, wired directly into a static HTML page instead of injected by `todo-app.mjs` — for comparing the two integration styles side by side. |
| [`dom-example.mjs`](./dom-example.mjs) | `signalle/dom`'s `bind`/`bindAttribute`/`bindClass`-style two-way DOM bindings, injected into a generated page. Serve it and open in a browser. |
| [`mouse-tracker.html`](./mouse-tracker.html) | `computed()` deriving a value with no static dependencies (an empty deps array) from live mouse-position state, re-rendered on every move — the "fine-grained, only what changed" reactivity claim under real, high-frequency input. |
| [`worker.js`](./worker.js) | `createBroadcastSignal()` running inside a Web Worker, subscribing to a channel shared with the main thread. Meant to be loaded as a `Worker` by another example (see `cross-context.html`), not run directly. |
| [`cross-context.html`](./cross-context.html) | `createBroadcastSignal()` plus `generateWorkerCode()` keeping a signal's value in sync between the main window and a Worker it spawns — the `signalle/broadcast` cross-context story end to end. **Read [Security model](../README.md#security-model) before adapting this pattern**: `generateWorkerCode()` performs zero sandboxing, and this example only works because the code it generates is this repo's own, not user-supplied. |
| [`iframe-parent.html`](./iframe-parent.html) / [`iframe-child.html`](./iframe-child.html) | A signal kept in sync between a parent window and a same-origin `<iframe>` via `BroadcastChannel`, as opposed to `cross-context.html`'s window/Worker pairing — open `iframe-parent.html`, which loads the child in an embedded frame. |

## Running

These are static files — serve the directory with any static file server
and open the `.html` pages in a browser, e.g.:

```sh
npx serve examples
# or: python3 -m http.server --directory examples
```

`dom-example.mjs` and `todo-app.mjs` are ES modules meant to be imported
from a page (or bundled), not run under plain `node` — they build a full
HTML document string for injection rather than executing headlessly.
