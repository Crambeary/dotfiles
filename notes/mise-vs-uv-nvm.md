# mise vs. uv (Python) + nvm (Node)

Research date: 2026-08-21. Current setup: uv for all Python work (venvs, package
installs, `uv tool` for CLIs), nvm occasionally for Node.

## Summary / Recommendation

- **mise does not replace uv for Python.** By default mise installs Python
  itself (precompiled `python-build-standalone` binaries, or `python-build`
  compilation as fallback) — it does not shell out to uv to fetch
  interpreters. It *does* integrate with uv for two narrower jobs: (1)
  creating/activating the venv for a uv-managed project (`python.uv_venv_auto`,
  gated on a `uv.lock` file existing), and (2) installing Python CLI tools via
  `uvx` instead of `pipx` when uv is present (`pipx.uvx`, default `true`)
  ([mise Python docs](https://mise.jdx.dev/lang/python.html), [pipx backend
  docs](https://mise.jdx.dev/dev-tools/backends/pipx.html)).
- **mise's Node management is functionally nvm-shaped but architecturally
  different** — PATH rewriting via a Rust binary (`mise activate`) or opt-in
  shims, versus nvm's shell-function PATH rewriting. Mise explicitly bills
  itself as "a drop-in replacement for nvm" and reads `.nvmrc`/`.node-version`
  natively ([mise Node docs](https://mise.jdx.dev/lang/node.html)).
- **Real conflict exists and is documented**: uv's default
  `python-preference = "managed"` lets uv download and use its *own* Python
  build independently of whatever mise put on PATH, producing two separate
  CPython installs and interpreter-identity confusion. The fix is a config
  change on uv's side (`python-preference = "only-system"`, or pointing
  `UV_PYTHON` at mise's exact interpreter path), not something mise
  auto-resolves ([mise/uv Python interpreter conflict — Shiinayane blog](https://www.shiinayane.com/en/posts/python/), [mise Python docs on `UV_PYTHON`](https://mise.jdx.dev/lang/python.html)).
- **Given the user's setup (uv already does everything for Python, nvm
  occasionally for Node), adopting mise's own Python/Node backends would be
  redundant and adds a second, layered PATH/venv-selection mechanism to
  reason about.** The value mise adds is orthogonal: a single cross-language
  task runner + env-var/`.env` layer + version pinning file (`mise.toml`) for
  *other* tools (linters, CLIs, non-Python/Node runtimes), while explicitly
  delegating Python package/venv work to uv and (optionally) Node to
  nvm/fnm — a pattern documented in mise's own cookbook and echoed by the
  mise author on Hacker News ("mise is designed to be an overlay on top of
  existing systems") ([mise Python Cookbook](https://mise.jdx.dev/mise-cookbook/python.html), [HN — mise author comment](https://news.ycombinator.com/item?id=48493719)).
- No credible independent benchmarks compare mise's Node/Python activation
  against uv or nvm specifically; the only first-party numbers found are
  mise-vs-asdf (see §4), which aren't a like-for-like comparison to uv or
  nvm.

---

## 1. How mise handles Python version/tool management

mise's Python core plugin has two installation paths:

- **Default**: downloads precompiled binaries from the `python-build-standalone`
  project (indra/astral-adjacent project, not uv itself) — faster, no system
  build deps needed.
- **Fallback**: compiles via `python-build` (the engine behind pyenv) when a
  precompiled build isn't available; can be forced with `MISE_PYTHON_COMPILE=1`.

So **interpreter acquisition is independent of uv** — mise does not shell out
to `uv python install` to get Python itself
([mise Python docs](https://mise.jdx.dev/lang/python.html)).

Where uv *is* used by mise:

- **Venv creation/activation**: `_.python.venv` is mise's own venv
  mechanism (creates/activates via stdlib `python -m venv` for
  non-uv projects). For uv-managed projects, `python.uv_venv_auto` (values
  `"source"` or `"create|source"`; the historical `true` value is deprecated,
  planned removal mise 2026.7) makes mise source (or create-then-source) the
  venv uv manages. This is **gated on the presence of a `uv.lock` file** —
  mise walks up the directory tree looking for one; without it, the setting
  is a no-op ([mise Python docs](https://mise.jdx.dev/lang/python.html),
  maintainer clarification in [jdx/mise discussion #8376](https://github.com/jdx/mise/discussions/8376)).
  It also respects uv's `UV_PROJECT_ENVIRONMENT` for a non-default venv path.
- **CLI tool installs**: mise's `pipx:` backend defaults to using `uvx`
  instead of `pipx` when uv is installed and on PATH (`pipx.uvx` setting,
  default `true`, env var `MISE_PIPX_UVX`) — this only affects the *speed and
  mechanism* of installing Python CLI tools, not interpreter management
  ([pipx backend docs](https://mise.jdx.dev/dev-tools/backends/pipx.html)).
- **Version sync helper**: `mise sync python --uv` aligns mise's and uv's
  recorded Python versions in a given project
  ([mise Python Cookbook](https://mise.jdx.dev/mise-cookbook/python.html)).

**Bottom line**: mise is not "uv under the hood" for Python — it's its own
version manager (python-build-standalone) that offers opt-in glue to
delegate venv creation and CLI-tool installs to uv when uv is present.

## 2. How mise handles Node version management, vs. nvm

**mise**: Node is a mise *core plugin* (built into the mise binary, source at
`src/plugins/core/node.rs` in [jdx/mise](https://github.com/jdx/mise)) — no
separate plugin install needed. mise explicitly says it "makes it a drop-in
replacement for nvm" and reads the same pin files nvm/other tools use:
`.tool-versions` (asdf format), `.nvmrc`, `.node-version`, plus `package.json`'s
`devEngines` field. Global default is set with `mise use -g node@<version>`;
per-project via `mise.toml` (or the above files) with auto-switching on `cd`
([mise Node docs](https://mise.jdx.dev/lang/node.html)).

Activation model — two mutually exclusive modes, and this is the real
functional axis of comparison with nvm:

- **`mise activate` (PATH mode, recommended for interactive shells)**: a
  hook run on each prompt display rewrites `$PATH` to point at the active
  tool versions. No shims, no per-command interception.
- **Shims mode**: small executables placed in `~/.local/share/mise/shims`
  (added to PATH once) that intercept a command name, resolve the right
  mise-managed version, and exec it. Recommended mainly as a fallback / for
  non-interactive contexts, since shims don't fire `cd`/`enter`/`leave`
  hooks and can — per mise's own docs — "silently run a completely
  different, unrelated binary instead of failing loudly" if a shim shadows
  a system binary like Debian's `python3`
  ([mise shims docs](https://mise.jdx.dev/dev-tools/shims.html)).

**nvm**: a **shell function**, not a binary — sourced into `.bashrc`/`.zshrc`/
`.profile` at shell start. `nvm use <version>` mutates `$PATH` (and also
`MANPATH`/`NODE_PATH`) for the *current shell only* — nvm's README describes
it as "designed to be installed per-user, and invoked per-shell," so each
terminal/tab can independently run a different Node version. `.nvmrc`
auto-switching on `cd` is opt-in via a shell snippet nvm's README supplies
for bash/zsh/fish, not built in ([nvm README](https://github.com/nvm-sh/nvm#readme)).

**Comparison**: functionally similar end state (right `node`/`npm` on PATH
per project), but mise's PATH-mode is a compiled binary doing the rewrite
(cheap, see §4) vs. nvm's pure-shell-function approach (slower, notably on
`nvm use`/shell init — see §4). mise's directory-based auto-switch is
built-in; nvm's requires manually wiring a shell hook.

## 3. Conflict mode: can mise and uv fight over which Python/venv is active?

Yes — documented, with a known cause and fix, not a hypothetical:

- uv's default `python-preference` setting is `"managed"`: uv prefers a
  uv-managed Python, falls back to a system interpreter, and — critically —
  will **download and install its own Python build** under
  `~/.local/share/uv/python/` whenever no available interpreter satisfies a
  project's `requires-python`, *independent of what mise has on PATH*. This
  produces two separate CPython installs (one mise-managed, one
  uv-managed) and situations where `python` and `uv run python` resolve to
  different versions ([Shiinayane — "Making mise and uv Agree on
  Python"](https://www.shiinayane.com/en/posts/python/)).
- **Fix used in the wild**: set `python-preference = "only-system"` in
  `~/.config/uv/uv.toml` (or project `pyproject.toml`/`uv.toml`) so uv never
  downloads its own interpreter and instead uses whatever's on PATH (i.e.
  mise's). For stricter pinning to mise's *exact* interpreter path (not just
  "some Python of the right version on PATH"), mise's own docs recommend
  setting `UV_PYTHON` to the interpreter's literal path via a templated env
  var: `UV_PYTHON = { value = "{{ tools.python.path }}", tools = true }` in
  `mise.toml` ([mise Python docs](https://mise.jdx.dev/lang/python.html)).
- Separately, mise's `pipx:`/`uvx:` backend has a reported edge case where
  Python CLI tools installed via `uvx` end up pinned to a uv-managed Python
  even when an older mise-managed version is what's on PATH, i.e. the two
  tools' idea of "the current Python" can diverge per-invocation
  ([jdx/mise discussions, general uv+pipx threads](https://github.com/jdx/mise/discussions/4377)).
- General category of conflict, per mise's own shims documentation: **PATH
  ordering / shadowing** — if both mise shims and another version manager
  (nvm, pyenv, etc.) are on PATH, whichever comes first wins, and a
  mise shim can silently intercept a call meant for a system or
  differently-managed binary rather than erroring
  ([mise shims docs](https://mise.jdx.dev/dev-tools/shims.html)).

**Practical implication for this user's setup**: since uv already owns Python
entirely, introducing mise's Python backend alongside it is exactly the
configuration that produces this conflict, unless mise's Python backend is
either left unused for Python (no `python` entry in `mise.toml`) or uv is
explicitly told to stop self-managing interpreters.

## 4. Performance / DX comparisons

Only credible first-party numbers found are **mise vs. asdf**, not
mise vs. uv or mise vs. nvm directly:

- mise's own docs: asdf shims add **~120ms per runtime call** (asdf is
  implemented as bash shell scripts throughout — shims, plugins, everything).
  mise's PATH-mode `hook-env` costs **~5–10ms on prompt display** ("~4ms if
  no changes, ~14ms on a full reload," per the maintainer's own
  measurement), with a documented benchmark chart ("asdf vs mise exec
  performance comparison") backing the summary claim: "asdf adds ~120ms
  when calling a runtime, mise adds ~5ms when the prompt loads." For the
  newer Go-rewritten asdf (0.16+), mise's docs concede "the difference is
  much closer" ([mise — Comparison to asdf](https://mise.jdx.dev/dev-tools/comparison-to-asdf.html)).
- Tool installs: mise's docs claim up to **7x faster** installs than asdf in
  real-world scenarios (same page).
- **No mise-vs-uv or mise-vs-nvm first-party or independently-reproduced
  benchmark was found.** uv's own well-documented advantage is Python
  package install speed (a different axis — package resolution/install, not
  version-manager PATH overhead) and is not in scope for comparison against
  mise's PATH/shim mechanism. nvm's README does not publish activation
  timing numbers; it only offers a `--no-use` flag "to postpone using nvm
  until you manually use it," which is itself evidence the nvm maintainers
  are aware shell-init cost is a concern, without quantifying it
  ([nvm README](https://github.com/nvm-sh/nvm#readme)).
- **Stated explicitly per the task's instruction**: beyond the mise-vs-asdf
  numbers above, no credible benchmark comparing mise's activation overhead
  against uv or nvm specifically was found in primary sources during this
  research pass — treat any such claim (e.g. "mise is Xms faster than nvm")
  seen elsewhere as unverified unless it cites a reproducible measurement.

## 5. Community opinions / tradeoffs

- **Hacker News** (mise author's own comment, on a thread about switching a
  full dev environment to mise): "mise is not intended to be a full
  bootstrapping solution... mise is designed to be an overlay on top of
  existing systems" — i.e. the mise maintainer's own framing supports using
  mise alongside, not instead of, ecosystem-native tools
  ([HN thread](https://news.ycombinator.com/item?id=48493719)).
- Same HN thread, another commenter: keeps "a global node & python along
  with uv@latest which pretty much covers every tool I might want to
  install" — using mise for version pinning while still using uv natively
  for Python package/tool work.
- Another HN comment (different thread) reports preferring **uv for Python
  and bun for TypeScript directly**, skipping mise's language backends
  entirely, partly because "mise doesn't support dependencies" (i.e. no
  lockfile/dependency-resolution story of its own — that's left to
  language-native tools like uv/pnpm) ([HN — mise+uv backend
  thread](https://news.ycombinator.com/item?id=44897277)).
- **GitHub discussions on jdx/mise** repeatedly surface the same friction:
  users asking "how do I make mise and uv work together" and the answers
  converging on either (a) `mise exec -- uv sync` / `mise activate` putting
  uv on PATH and running uv normally, or (b) `python.uv_venv_auto` for
  automatic venv sourcing — never a recommendation to let mise manage the
  interpreter *and* uv manage it redundantly
  ([jdx/mise discussion #5304](https://github.com/jdx/mise/discussions/5304),
  [discussion #4377](https://github.com/jdx/mise/discussions/4377)).
- A **documentation-quality complaint** thread (`#8376`) shows even mise's
  own docs have been internally inconsistent about which uv-related setting
  is deprecated (`python.venv_auto_create` vs. `python.uv_venv_auto`'s
  legacy `true` value) — worth being cautious and re-checking current docs
  before relying on any specific setting name
  ([jdx/mise discussion #8376](https://github.com/jdx/mise/discussions/8376)).

## 6. Concrete recommendation pattern documented by the community/mise itself

The pattern that recurs across mise's own docs and community discussion is:

> **Use mise for what uv/nvm don't do** — cross-language version pinning
> for *other* tools, task running (`mise run`), and project-scoped
> environment variables (`[env]` in `mise.toml`, direnv-like activate/leave
> on `cd`) — **and explicitly delegate Python package/venv work to uv, Node
> to nvm/fnm**, rather than letting mise's own Python/Node backends manage
> the interpreters uv/nvm already own.

Evidence this is a recognized, documented pattern (not just this report's
inference):

- mise's **own Python Cookbook** frames the supported setup as "mise pins
  the language runtime; uv drives the Python project and its dependencies
  inside that environment" — i.e. mise for pinning/activation glue, uv for
  everything package/venv-related — via `python.uv_venv_auto`
  ([mise Python Cookbook](https://mise.jdx.dev/mise-cookbook/python.html)).
- The BetterStack comparison article (a secondary source, included here
  only for its explicit statement of the hybrid pattern, cross-checked
  against the primary mise docs above) states: "you don't have to pick just
  one. You can let mise manage versions across languages and use uv for
  Python's package and environment management" ([BetterStack — mise vs
  uv](https://betterstack.com/community/guides/scaling-python/mise-vs-uv/)).
- mise author on HN, again: mise as "an overlay on top of existing
  systems," not a replacement for them
  ([HN](https://news.ycombinator.com/item?id=48493719)).
- For Node specifically, no first-party mise doc explicitly says "delegate
  to nvm" (mise instead positions its own Node backend as an nvm
  replacement); the delegate-to-nvm pattern shows up only as a community
  choice (HN comment above: keeping a "global node" via mise while using
  uv/nvm-equivalents for anything more granular) rather than a documented
  mise recommendation. If the goal is minimizing surface area beyond what
  uv+nvm already cover, the practical corollary is: **don't add `node` or
  `python` entries to `mise.toml` at all** — use mise only for its task
  runner / env-var layer / other-language tool pins, leaving Node version
  switching to nvm and Python entirely to uv, which avoids the PATH/venv
  double-management conflict described in §3 altogether.

---

### Sources consulted (primary unless noted)

- [mise — Python](https://mise.jdx.dev/lang/python.html)
- [mise — Node.js](https://mise.jdx.dev/lang/node.html)
- [mise — Shims](https://mise.jdx.dev/dev-tools/shims.html)
- [mise — pipx backend](https://mise.jdx.dev/dev-tools/backends/pipx.html)
- [mise — Python Cookbook](https://mise.jdx.dev/mise-cookbook/python.html)
- [mise — Comparison to asdf](https://mise.jdx.dev/dev-tools/comparison-to-asdf.html)
- [jdx/mise discussion #8376 — doc contradiction on `python.uv_venv_auto`](https://github.com/jdx/mise/discussions/8376)
- [jdx/mise discussion #5304 — using mise with uv](https://github.com/jdx/mise/discussions/5304)
- [jdx/mise discussion #4377 — uv + mise and the pipx backend](https://github.com/jdx/mise/discussions/4377)
- [nvm-sh/nvm README](https://github.com/nvm-sh/nvm#readme)
- [Hacker News — mise author on overlay design philosophy](https://news.ycombinator.com/item?id=48493719)
- [Hacker News — mise + uv backend comment thread](https://news.ycombinator.com/item?id=44897277)
- [Shiinayane — "Making mise and uv Agree on Python" (first-party dotfiles author blog, not mise/uv official)](https://www.shiinayane.com/en/posts/python/)
- [BetterStack — Mise vs uv (secondary, used only for one explicitly-flagged claim cross-checked against primary docs)](https://betterstack.com/community/guides/scaling-python/mise-vs-uv/)
