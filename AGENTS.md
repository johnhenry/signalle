# Agent playbook

`signalle` -- a fine-grained JavaScript signals library with optional DOM
integration, SSE streaming, scoped isolation, and cross-tab/worker
broadcast. Single package, Node >= 26, `node --test` (`npm test`), builds to
`dist/` via a plain file copy (`npm run build` copies `src/*.mjs` and
`src/types.d.ts`, no transpile/bundle step). Published on npm as unscoped
`signalle`, not yet moved into the `@johnhenry` scope.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm test` -- `node --test tests/*.test.mjs`. `tests/dom.test.mjs` needs
   the `jsdom` devDependency to load at all -- if it's ever removed or not
   installed, that suite silently can't run rather than failing loudly;
   confirm it actually ran, not just that the command exited 0.
2. `npm run build && npm pack --dry-run` -- read the file list. `files` is
   `["dist", "LICENSE", "README.md"]`; the build script copies every
   `src/*.mjs` file into `dist/` by glob, so a new file added under `src/`
   ships automatically -- and so does anything left in `src/` that was never
   meant to ship (check the glob result, not just that the build succeeded).
3. A genuinely fresh clone:
   `git clone . /tmp/signalle-verifyN && cd $_ && npm ci && npm run build && npm test`.
   This is the only way to catch "works on my checked-out tree" bugs --
   this repo has direct history of it: `signalle/stream` was declared in
   `package.json` `exports` with no `src/stream.mjs` behind it, and
   `signalle/dom`'s `defaultOptions` type export didn't exist at runtime
   either (both fixed in `0.1.0`, see `CHANGELOG.md`).
4. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run build`, then
`npm test`; match it locally.

## Repo-specific gotchas

- **Never use the top-level `createEffect` inside a `SignalScope`.** Its
  auto-dependency-tracking uses a single module-static tracker shared by
  the whole process, so it will not auto-track signals created via
  `scope.signal()`/`scope.computed()` -- reading a scoped signal inside a
  plain top-level `createEffect(...)` simply doesn't register a dependency,
  and using it as an isolation boundary between concurrent logical contexts
  (e.g. two server requests) corrupts state across them. Always use
  `scope.createEffect(fn)` inside a scope; it has its own independent
  tracker. Fixed in `0.1.0` (see `CHANGELOG.md` and the README's
  `## Scoped Signals` warning) -- don't reintroduce a shared tracker when
  touching `createEffectWithTracker`.
- **`Computed`'s dirty-check must track one version per dependency, not a
  single collapsed "high water mark."** Every signal's version counter
  starts at 0 and increments independently, so two unrelated dependencies
  routinely land on the same version number -- a `Math.max`-style collapsed
  check can mask a genuine update to one dependency in a diamond-shaped
  dependency graph. Fixed in `0.1.0`; any change to `Computed`'s dirty-check
  needs a per-dependency version map, not a single scalar.
- **`batch()` nesting needs a depth counter, not a shared boolean/queue.** A
  `batch()` call nested inside another used to flip the shared flag off and
  drain the *entire* queue on exit, prematurely flushing the outer batch's
  still-pending updates. Fixed in `0.1.0` with a nesting-depth counter --
  only the outermost `batch()` may flush.
- **`BroadcastSignal`'s equality check must compare against the value
  before `structuredClone()`, not after.** Comparing two independently
  cloned copies of an object/array is never `===` equal, so re-assigning
  the exact same unchanged reference used to still bump the version and
  re-broadcast to every other tab. Fixed in `0.1.0`.
- **`Computed#dispose()` must call `super.dispose()`.** It previously
  didn't, so subscribers added via `subscribe()` were never released; a
  disposed computed could also be resurrected via `update()`, which bypassed
  the "cannot modify computed signal directly" guard entirely. Fixed in
  `0.1.0` -- any new bypass of the base `dispose()`/mutation guards
  reintroduces this.

## Definition of done

A change is done when all of the following hold, not just when tests pass:
- A regression test exists for any bug fixed -- every gotcha above now has
  one; a fix without a test that would have caught it can come back
  unnoticed.
- Anything the feature does **not** do is stated in the README (the
  `## Security model` section for `generateWorkerCode()`, or the relevant
  API section otherwise), not only in an issue comment.
- `CHANGELOG.md` has an entry citing the commit/PR.
- New public exports are added to both `package.json` `exports` **and**
  `src/types.d.ts` in the same change -- the `signalle/stream` gap (declared
  in `exports`, missing from `src/`, undocumented in types) shipped because
  those three didn't move together.

## Non-goals

Sandboxing or validating `signalCode` passed to `generateWorkerCode()` is
explicitly out of scope for this package -- see the README's
`## Security model`. Pair it with a real sandbox (`@johnhenry/andbox`) if
you need that.

## Releases

Bump `version` in `package.json` in a PR, add the `CHANGELOG.md` entry, merge,
then `gh release create v<version>` -- the release event triggers
`.github/workflows/publish.yml`, which is idempotent (skips if the version is
already on npm).
