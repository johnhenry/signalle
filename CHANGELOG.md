# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.0.

## 0.1.1 (2026-09-26)

### Fixed

- **Published package could not be imported at all (#6)**: `package.json`'s `exports` map pointed every entry (`.`, `./dom`, `./stream`, `./scope`, `./broadcast`) at `./src/*.mjs`, but the published tarball only ever contained `dist/`, `LICENSE`, and `README.md` — `src/` was never shipped. `dist/` is a real build output (`npm run build` runs `cp src/*.mjs dist/`), not vestigial, so every `import '@johnhenry/signalle'` (or any subpath) from a real install failed with `ERR_MODULE_NOT_FOUND`. Fixed `exports` to point at `./dist/*` (matching `main`/`types`, which already did). Verified empirically: `npm pack`, installed the tarball into a separate scratch project, and confirmed both the root entry and `/dom`/`/scope` subpaths import and work correctly (and confirmed the old `exports` reproducibly fails with `ERR_MODULE_NOT_FOUND` the same way under the same test).
- **`batch()` recomputed a shared dependent once per changed input instead of once per batch (#7)**: reported from a real physics-sim showcase (ORRERY) as a `computed` depending on several signals recomputing multiple times per `batch()`. Investigation confirmed the report's *symptom* but corrected its *diagnosis*: a computed depending directly on several raw signals all written in one `batch()` was already (accidentally) deduplicated by existing recompute-serialization + per-dependency version tracking. The real, reproducible root cause is one level deeper — when a computed's own dependencies are themselves *other* computeds that settle asynchronously at different times (an extremely common shape for any non-trivial derived-state chain, e.g. velocity → position → collision), the downstream computed recomputed once per upstream settle event, and could briefly show subscribers a wrong intermediate total (e.g. `17` before correctly landing on `25`) even though `batch()` had already flushed. Fixed by replacing the eager per-notification recompute cascade with `runPropagationWave()`: dependents are marked dirty (not recomputed) as changes are discovered, then drained in a single dependency-ordered pass so each affected computed recomputes exactly once, only after all of *its own* affected dependencies have settled, before any effects fire. Added regression tests for both the reported (already-passing) shape and the actual root-cause shape, the latter confirmed to fail against the pre-fix code (2 recomputes, and a wrong intermediate value observed by an effect) and pass after the fix.

## 0.1.0 (2026-09-21)

### Fixed

- **Diamond-dependency corruption**: `Computed`'s dirty-check tracked a single collapsed "high water mark" version (`Math.max` across all dependency versions) instead of one version per dependency. Since every signal's version counter starts at 0 and increments independently, two unrelated dependencies routinely land on the same version number, which could mask a genuine update to one dependency and leave a diamond-shaped computed permanently stuck at a wrong value.
- **Nested `batch()` broke atomicity**: batching state was a single shared boolean/queue, so a `batch()` call nested inside another flipped the shared flag off and drained the *entire* queue on exit — prematurely flushing the outer batch's still-pending updates instead of waiting for the outer batch to finish. Fixed with a nesting-depth counter so only the outermost `batch()` flushes.
- **Overlapping `Computed` recomputes could clobber a pending side effect**: the reentrancy guard referenced a field set once in the constructor and never updated on subsequent calls, so it didn't actually serialize overlapping `recompute()` calls triggered by near-simultaneous dependency changes — one pass's `[value, cleanup]` side effect could be silently clobbered by another.
- **`Computed#dispose()` didn't fully dispose**: it never called `super.dispose()`, so subscribers added via `subscribe()` were never released. Separately, `update()` bypassed the "cannot modify computed signal directly" guard entirely — including on an already-disposed computed, which could resurrect it and re-fire stale subscriber callbacks.
- **`BroadcastSignal` re-broadcast on every no-op set**: the equality check compared a freshly `structuredClone()`d copy of the new value against the current value, and clones of objects/arrays are never `===` equal to begin with — so re-assigning the exact same unchanged reference still bumped the version, re-broadcast to every other tab, and re-notified local subscribers.
- **`createEffect`'s auto-dependency-tracking was not scope-isolated**: it always used a single module-static tracker shared by the whole process, so two `SignalScope` instances (e.g. one per server request) could corrupt each other's dependency tracking. Refactored into a shared `createEffectWithTracker` factory; added `SignalScope#createEffect`, which uses the scope's own tracker state. `Signal#value` now only ever consults its own scope's tracker once scoped (no fallthrough to the global tracker).
- **`SignalScope#computed()` didn't thread the scope through**: it called `new Computed(deps, fn)` directly instead of passing `this`, so a scoped computed's `.value` reads never registered as a dependency of a scoped effect.
- `examples/worker.js` imported the nonexistent `broadcastSignal`; the real export is `createBroadcastSignal`.
- `src/types.d.ts` declared a `defaultOptions` export from `signalle/dom` that doesn't exist at runtime (defaults are internal); replaced with an internal `BindOptions` type.

### Added

- `signalle/broadcast` (`createBroadcastSignal`, `generateWorkerCode`) is now a documented, exported public subpath — previously implemented but not wired into `package.json` `exports`, not documented, and not tested.
- `src/stream.mjs` (`toReadableStream`, `toSSEResponse`) — restored; this canonical repo was missing the file entirely despite `package.json` already declaring a `./stream` export subpath for it.
- Full type declarations for `signalle/stream`, `signalle/scope`, and `signalle/broadcast` (previously only `signalle` and `signalle/dom` were documented).
- `jsdom` devDependency, so `tests/dom.test.mjs` can actually run (it was silently unable to load before).

### Security

- Known limitation, documented rather than fixed: `generateWorkerCode()` interpolates a caller-supplied code string into generated Worker source that's later run/`eval`'d. This is inherent to generating code from a string and is fine for the library's intended use (embedding your own trusted signal logic into a Worker without a bundler) — flagging here since it would not be safe to use with untrusted input.
