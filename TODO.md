# TUI redesign: welcome, setup, persistent studio

This file is the only implementation plan. A smaller model should execute
it in order, one phase at a time, without inventing extra scope.

Do not start Phase 2 until Phase 1 is verified. Do not start a later phase
until the previous phase verify block passes.

---

## 0. What this work is

Rewrite the attached Ink TUI so a novice can:

1. See a welcome screen with a large ASCII logo.
2. Keep the current folder with Enter, or pick another folder.
3. Complete first-run setup only when `.binaflow/config.json` is missing.
4. Land in a persistent studio (lazygit-like): workflows + runs on the left,
   the current work on the right.
5. Launch, watch, finish, inspect, approve, and browse artifacts in that
   same right panel. No bounce to a separate home/history/completion maze.

Stay on Ink. Do not switch toolkits.

## 0.1 What this work is not

Do not implement any of these unless a later explicit product decision says so:

- OpenTUI, Bubble Tea, Go, Bun, or a Node version change
- A daemon, detach, reconnect, or remote TUI
- An in-TUI config file editor for invalid configs
- A theme engine, animation library, figlet, or extra UI package
- Generic approval / loop / DAG engine primitives
- Extracting `lifecycle.ts`, `execution.ts`, or `ApplicationService`
- Moving folder listing or splash logic into `src/core`
- Linux bundle build, package, install, or smoke test
- Anything listed in `WISHLIST.md`

## 0.2 Fixed product constraints

Read `AGENTS.md` before editing. These rules already exist and stay true:

- Modular TypeScript monolith on Node 22.
- One attached Ink TUI under `src/tui`.
- CLI and TUI are presentation adapters. They must not import SQLite,
  filesystem artifacts, Pi RPC, or `src/core/engine`.
- Prefer `pnpm`.
- Prefer the simplest correct change. Do not add an abstraction for one use.
- Prefer ASCII unless Unicode has a clear purpose.
- Tests must protect contracts, not coverage.
- Before calling the work done, run the Phase 6 verify block.

Current stack already in `package.json` (do not add packages):

- `ink` 7.1.1
- `react` 19.2.8
- `@inkjs/ui` 2.0.0 (`TextInput`, `Spinner`)

`NO_COLOR` must still disable SGR color and keep the alternate screen.

## 0.3 How to work

- Touch only files listed in the current phase.
- Match existing style. Do not reformat unrelated code.
- Do not add comments unless a type or function would be unclear without one.
- Do not guess UX. Copy, keys, and transitions in this file are the spec.
- If something is missing from this file, stop and ask. Do not invent a
  third navigation model.
- Keep performance boring: no recursive disk walks, no unbounded lists, no
  live activity in React state on every event.

---

## 1. Current code the implementer must understand

Entry:

- TTY + no args, or `binaflow tui` -> `runInkShell` in `src/tui/shell.tsx`.
- CLI `--cwd` is passed into `runInkShell({ cwd })` from `src/cli/index.ts`.
- Today the TUI never lets the user change folder. After this work, `--cwd`
  only preloads the welcome path. Welcome still always shows.

God-controller to replace:

- `src/tui/shell-controller.tsx` (~1308 lines, ~40 `useState`, one huge
  `useInput`). Screens are mostly dumb views.

Keep as-is unless a phase explicitly says otherwise:

- `src/tui/lifecycle.ts` — one attached execution owner. First cancel is
  graceful, second is force. Never close SQLite while a run or event write
  is active.
- `src/tui/execution.ts` — live activity bounds and flush:
  `MAX_DISPLAYED_ACTIVITY = 200`, `MAX_ACTIVITY_BYTES = 64_000`,
  `MAX_ACTIVITY_MESSAGE_BYTES = 4_000`, `LIVE_UI_FLUSH_MS = 50`.
- `src/tui/viewport.ts` — `moveSelection`, `scrollText`, `keepSelectionVisible`.
- `src/tui/text.ts` — `sanitizeInkText`. All user/persisted strings go through
  `SafeText`.
- `src/tui/launch.ts` — setup/launch validation helpers. Reuse them.
- `src/tui/bootstrap.tsx` — Ink render, resize, `NO_COLOR`, alternate screen.
- `src/application/service.ts` — the only application facade the TUI may use
  for runs, inspect, artifacts, approval, recovery.
- `src/application/config-operations.ts` — `diagnoseConfigurationFile`,
  `discoverSetupModels`, `generateConfiguration`,
  `writeConfigurationAtomically` (atomic, never overwrite).

Architecture test that must stay green:

- `test/architecture-boundaries.test.ts`
- TUI must not import `storage/sqlite-*`, `artifacts/file-*`,
  `drivers/pi-rpc`, `core/engine`, or `storage/run-store`.

Known bugs this rewrite must close (not optional):

1. First-run auto-open setup does not call `discoverSetupModels()`. Only
   Home -> New workflow -> `startSetup()` does. Auto-open must discover.
2. `q` in setup/launch currently aborts to home. Setup `q` must cancel with
   nothing written and return to welcome. Setup review must offer Go back
   to the previous field.
3. Home recent runs are display-only. Studio runs must be selectable.
4. Completion currently sends failed/interrupted to the history list and
   success/cancel to home. Result must stay on the same run in the right
   panel.
5. Waiting + approval hijacks and Leave goes to history. Waiting stays
   selected and inspectable. Approval is a right-panel mode, not a hijack.
6. Diagnosis footer advertises `r` but `r` only works on home/history.
   Studio `r` / `d` refresh must actually refresh.
7. `approvalPreviewOffset` is never updated. If previews overflow, `j`/`k`
   in the approval preview pane must scroll them.
8. OS SIGINT handler calls `exit()` even on graceful cancel. Keyboard
   Ctrl-C does not. Unify: first cancel on a live run is graceful and does
   not unmount. Second cancel force-signals through lifecycle.
9. Invalid config cannot be edited in the TUI. Keep that limit. Show a
   one-sentence diagnosis plus "edit `.binaflow/config.json` in your editor".

Leftover UI to delete when nothing imports it:

- `SetupChoiceScreen` and `SetupInputScreen` in `src/tui/screens/setup.tsx`
- `HOME_ACTIONS` in `src/tui/screens.ts` once home is gone

---

## 2. Where new behavior lives

| Behavior | Lives in | Why |
|---|---|---|
| Screen / overlay / focus transitions | `src/tui/model.ts` + `src/tui/reduce.ts` | Pure, testable |
| Key -> event mapping | `shell-controller.tsx` `useInput` only | No logic in the hook |
| Diagnose, write config, discover models | existing `config-operations.ts` | Do not duplicate |
| listRuns, inspect, run, resume, approval, artifacts | existing `ApplicationService` | Do not duplicate |
| Folder listing (`readdir` dirs only) | TUI effects, not core | One consumer |
| Active cwd change | TUI state + lifecycle context replace | Close old context only when idle |
| ASCII logo | `src/tui/brand.ts` | Static, no dependency |
| Colors / borders / chrome | `src/tui/layout.tsx` | Presentation only |

Nothing new belongs in `src/core`.

Changing folder is forbidden while a live run is attached. When idle, changing
folder must close the previous owned application context through
`lifecycle.replaceOwnedContext` / `shutdown` of the owned context, then
diagnose the new cwd. Never close SQLite during an active operation.

`--cwd` and `binaflow tui --cwd <path>` only set the initial welcome path.
They do not skip welcome.

---

## 3. Target files

Create:

- `src/tui/model.ts`
- `src/tui/reduce.ts`
- `src/tui/brand.ts`
- `src/tui/layout.tsx`
- `src/tui/screens/welcome.tsx`
- `src/tui/screens/folder-picker.tsx`
- `test/tui-reduce.test.ts`

Rewrite:

- `src/tui/shell-controller.tsx` into a thin dispatch + effects + layout host
- `src/tui/components.tsx` so bordered panels replace flat `ScreenFrame`
- Right-panel screens so they render inside the studio split, not as a
  full-screen `ScreenFrame` stack
- `test/tui-ink-shell.test.ts` and `test/tui-ink-phase6.test.ts` onto the
  new copy and flow
- README TUI paragraphs in Phase 6 only

Optional small helper, only if `shell-controller.tsx` would otherwise keep
I/O inline:

- `src/tui/effects.ts` — diagnose, list directory, write config, load runs,
  inspect, start run. Not a framework. Just async functions the controller
  calls after `reduce`.

Delete when unused:

- leftover setup screens
- `HOME_ACTIONS`
- home-only copy such as `Attached Ink shell` once no test needs it

Do not create:

- a generic router
- a plugin system
- a theme file with more than the semantic colors listed in Phase 3
- per-screen god reducers

`src/tui/shell.tsx` stays the public entry. It can keep rendering
`InkShellController`. Do not add a second TUI entrypoint.

---

## 4. Model

Keep the model small and explicit. Suggested shape; names may be adjusted
if a field is clearly unused, but do not add modes that this file does not
name.

```ts
type FocusPane = 'workflows' | 'runs' | 'detail';

type Overlay =
  | 'none'
  | 'welcome'
  | 'about'
  | 'folder-picker'
  | 'folder-confirm'
  | 'setup'
  | 'help'
  | 'recovery-confirm'
  | 'rejection-feedback';

type DetailMode =
  | 'empty'
  | 'diagnosis'
  | 'launch'
  | 'live'
  | 'approval'
  | 'result'
  | 'inspect'
  | 'artifacts';

interface TuiState {
  cwd: string;
  configPath: string;
  focus: FocusPane;
  overlay: Overlay;
  detail: DetailMode;
  setupStep: 1 | 2 | 3 | 4;
  setupField: number;
  folderPickerPath: string;
  error?: string;
  status?: string;
  // selection indexes, offsets, draft input, and loaded view-models
  // live/activity stay in refs, not in this object
}
```

Rules:

- `reduce(state, event): TuiState` is a pure function. No I/O, no React,
  no timers, no `process`.
- Effects run in the controller after reduce, or in response to effect
  tags if that stays simpler than a second return value. Prefer:

  ```ts
  const next = reduce(state, event);
  setState(next);
  void runEffects(previous, next, event);
  ```

  Do not build a generic effect runtime.

- Live activity, snapshot inspection, and the 50ms publisher stay in the
  existing refs from `execution.ts`. Putting every agent event through
  `reduce` will make the TUI jank.

- `useInput` only maps keys to events. Example: `q` on live ->
  `{ type: 'cancel-requested' }`. The hook must not call application
  methods directly except through the existing effect helpers.

Initial state:

- `overlay: 'welcome'`
- `cwd` = `options.cwd ?? process.cwd()`
- `folderPickerPath` = that same cwd
- `detail: 'empty'`
- `focus: 'workflows'`

---

## 5. Screen spec

Human footers. Prefer `Enter = continue` over jargon. Every footer must
list only keys that actually work on that surface.

### 5.1 Welcome (always, fullscreen overlay)

Large static ASCII logo from `src/tui/brand.ts`. No figlet. No animation.

Show:

- tagline: `Local workflows for coding agents.`
- current folder path
- one status sentence:
  - config exists and diagnoses ready: `This folder already has Binaflow.`
  - config missing: `New folder. Nothing has been written yet.`
  - cannot read/open: `This folder cannot be used yet.` plus the error
- actions:
  1. `Use this folder` (default)
  2. `Choose a different folder`
  3. `What is Binaflow?`
  4. `Quit`

Keys:

- `Enter` = selected action
- `j` / `k` or arrows = move
- `q` / `Esc` = quit (welcome is the entry; q leaves the app)

`What is Binaflow?` opens overlay `about`: 8-10 short lines taken from
`src/tui/screens/documentation.tsx` (attached process, no credentials,
planner read-only, builder write is visible, research approval is
experimental, no daemon). `q` returns to welcome.

### 5.2 Folder picker (overlay)

Directories only. Start at current cwd / `--cwd`.

List rows:

- `..` when not at filesystem root
- child directories
- if the current path is a WSL/Linux root listing, also show `/mnt/c` and
  `/mnt/d` when those directories exist. Do not invent other disks.
- badge `has Binaflow` when `.binaflow/config.json` exists in that directory
- permission errors appear as a row, they do not crash the TUI

Type-to-filter filters the already-loaded directory listing. Never walk
the tree.

Keys:

- `Enter` = open the selected directory (do not select it as workspace)
- `Space` = use the selected directory (or the current directory if `..`
  is not the intent). Also offer an explicit list item
  `Use this folder` at the top after `..`.
- `h` = parent
- `/` = filesystem root
- type characters = filter
- `Backspace` = delete filter character
- `q` = back to welcome (or back to studio if opened with `w`)

After Space / Use this folder, show overlay `folder-confirm`:

- full absolute path
- `Agents may read files in this folder.`
- `The builder can write only if you allow that later.`
- actions: `Use this folder` / `Back`

On confirm:

- set `cwd`
- close previous owned application context if idle
- diagnose the new cwd
- if config is missing, open setup
- else open studio

Cannot open the picker while `detail === 'live'`.

From studio, `w` opens the picker only when idle.

### 5.3 Setup (overlay, only if config does not exist)

Four steps. Novice copy. Nothing is written until the last step confirms.

Auto-open and the New workflow path both must call `discoverSetupModels()`.

`q` on any step: cancel, write nothing, return to welcome.

Steps:

1. Environment / Pi. Show whether Pi looks launchable. Continue / Retry /
   Cancel.
2. Planner. Explain it is read-only and does not change files. Provider
   then model from discovered lists, or free text if the list is empty.
   Example placeholder if empty: `openai` / `gpt-4.1`.
3. Builder. Same provider/model, then a huge yes/no for write+shell.
   `No` is first and recommended for a first look.
4. Human summary, not raw JSON:
   - planner provider/model, read-only
   - builder provider/model, read-only or WRITE+SHELL
   - config path that will be created
   - `Nothing has been written yet.`
   - actions: `Save` / `Show full config` / `Go back` / `Cancel`

Reuse `generateConfiguration` + `writeConfigurationAtomically`. Never
overwrite. After save, close setup and open studio with Status on the
right (`detail: 'diagnosis'`).

Keep using `SETUP_FIELDS` and `validateSetupValue` from `launch.ts`.

### 5.4 Studio (replaces home, history, diagnosis, workflows)

Chrome:

```
[ Ready | Needs attention ]  ~/short/path  [active run id or idle]
+------------------+--------------------------------------+
| Workflows        | right panel                          |
| plan-build       | empty / launch / live / result /     |
| research-...     | inspect / approval / artifacts       |
|------------------|                                      |
| Runs             |                                      |
| ...              |                                      |
+------------------+--------------------------------------+
n new run   w folder   d status   ? help   Tab switch   q quit
```

Left top: workflows from `discoverWorkflows()`, stable workflows first
(`orderedWorkflows`).

Left bottom: runs from `application.listRuns`. Selectable. Bound the page
(existing history used `limit: 50`; keep a page size, do not load all
runs). Show workflow, human status, short objective.

Right panel modes:

- `empty`: one friendly sentence. If ready: `Press n to start a run.`
  If not ready: one cause + one fix.
- `diagnosis`: current doctor output, scrollable
- `launch`: objective field, then same-panel confirm
- `live`: checklist + activity
- `result`: finished run card in place
- `inspect`: selected historical run
- `approval`: waiting research decision
- `artifacts`: bounded preview

Header colors when `colors` is true:

- Ready = green
- Needs attention = yellow
- live / active folder hint = cyan
- failed / interrupted = red
- hints, paths, footers = dim

Focus:

- `Tab` or `h`/`l` moves `workflows` <-> `runs` <-> `detail`
- `j`/`k` move inside the focused pane
- focused pane uses a visible border color (cyan). Unfocused is default

Footer shows at most 5 real actions for the current surface. During live,
replace folder/new-run with cancel help.

`?` opens help overlay with the full keymap. `q` closes help.

`n` starts a new run if config is valid. If config is missing, open setup.
If config is invalid, stay in studio and show the edit-file sentence.

### 5.5 New run (right panel `launch`)

From `n` or Enter on a workflow.

Not a multi-screen wizard. Stack fields in the same panel. Today that is
usually `objective`.

Then same-panel confirm:

- planner: read-only
- builder: WRITE+SHELL warning when write-capable
- actions: `Start` / `Edit` / `Cancel`

Profile drift stays on confirm with an error. Reuse `profileReview` /
`sameProfileReview`.

Cancel returns to `empty` or the previously selected run. It does not go
to a home screen.

### 5.6 Live (right panel `live`)

Split stays. Left marks the running item.

- first `q` / `Esc` / `Ctrl-C` = graceful cancel
- second = force through lifecycle
- `d` toggles activity detail
- `j`/`k` scroll activity
- no leave-to-history while running
- `w` and `n` are disabled

Spinner from `@inkjs/ui` on the running step. If `NO_COLOR`, do not rely
on color; spinner may render as `@inkjs/ui` default or a plain
`Loading...` / `[>]` row. Prefer the existing `Spinner` when colors are
on, and a static `[>] running` row when `NO_COLOR` is set.

### 5.7 Result (right panel `result`)

Same run, same panel. No `Return home`. No `Review in history`.

Show status, duration, tokens, cost, checklist, artifacts.

- Enter on an artifact opens `artifacts`
- failed: clear error + `Resume` if eligible + `Mark interrupted` if stuck
- waiting: switch `detail` to `approval` without losing the selected run

### 5.8 Approval (right panel `approval`)

Experimental and workflow-specific. Do not invent a generic engine gate.

- Approve -> continue live
- Reject -> overlay `rejection-feedback`, then continue live
- Leave waiting keeps the run selected and inspectable

Scroll previews when they overflow.

### 5.9 Overlays only

Use a fullscreen overlay only when the split would lie:

- welcome / about / folder picker / folder confirm
- setup
- help
- type `YES` to mark interrupted
- reject feedback
- terminal smaller than the split

Do not turn every screen into an overlay. If you do, the persistent
layout is dead.

### 5.10 Size

- Comfortable split: 80x24. Target this layout.
- Absolute minimum remains 56x12. Below that, show quit-only fallback
  (`MinimumSizeFallback`). Do not try to split.
- Between 56x12 and 80x24, keep the split but shrink lists. Do not add a
  third layout system.

---

## 6. Color and motion

No new library.

Use Ink `Text` `color` / `bold` / `dimColor` and existing
`runStatusColor` in `src/presentation/format.ts`.

Semantic palette only:

- green: Ready, completed
- yellow: Needs attention, waiting, pending
- red: failed, errors
- cyan: titles, focused border, live/active folder
- gray / dim: cancelled, interrupted, hints, paths
- `NO_COLOR`: no SGR. Borders and layout stay.

Spinners only for real waits:

- diagnosing
- listing a folder
- discovering models
- the currently running live step

Do not animate the logo. Do not blink the whole layout.

---

## 7. Implementation phases

### Phase 1 — model + reduce + transition tests

Files: `src/tui/model.ts`, `src/tui/reduce.ts`, `test/tui-reduce.test.ts`.

No Ink rendering required in this phase.

Cover these transitions in `test/tui-reduce.test.ts` as a table. Each
test name should say the user-visible behavior.

Required cases:

1. Initial overlay is welcome. `--cwd` is just `state.cwd`.
2. Welcome `Use this folder` with missing config -> setup overlay, and
   the effect tag / follow-up state makes it obvious models must be
   discovered (document that the controller must call
   `discoverSetupModels()`; the reducer cannot do I/O).
3. Welcome `Use this folder` with existing valid config -> studio,
   overlay none, detail empty or diagnosis.
4. Setup `q` -> welcome, no "saved" flag, setup values cleared.
5. Setup review `Go back` -> previous setup field/step, not welcome.
6. Live `cancel-requested` sets cancellationRequested / does not clear
   live / does not change overlay to none-and-home.
7. Opening a waiting run sets `detail: 'approval'` and keeps the run
   selected. A leave-waiting event sets `detail: 'inspect'`, not a
   history screen.
8. `open-folder-picker` while live is ignored.
9. `open-folder-picker` while idle opens the picker.
10. Invalid config does not enter launch.

Do not render Ink in this file. Do not mock SQLite.

Verify:

```bash
pnpm exec vitest run test/tui-reduce.test.ts
pnpm run typecheck
```

### Phase 2 — persistent studio shell

Rewrite `shell-controller.tsx` to:

- own one `TuiState`
- map keys to events
- run existing application/config effects
- render `layout.tsx` instead of a screen switchboard

Replace home/history/workflows/diagnosis as separate routes with the
studio split. Old screen components may be reused as right-panel bodies
if that is smaller than rewriting them.

Must work:

- welcome still appears first (can be a simple placeholder logo until
  Phase 4, but the overlay must exist)
- after accepting a folder with config, studio is visible
- `n`, `w`, `d`, `?`, `Tab`, `q` exist and do what section 5 says
- runs are selectable and open inspect/result in the right panel
- live stays in the right panel
- leftover `SetupChoiceScreen` / `SetupInputScreen` deleted if unused

Verify:

```bash
pnpm run typecheck
pnpm exec vitest run test/tui-reduce.test.ts
```

Add at most one Ink shell smoke in this phase if needed: welcome ->
Enter -> studio shows `Press n to start a run` or Needs attention. Prefer
updating an existing shell test instead of adding a new file.

### Phase 3 — look

Files: `src/tui/layout.tsx`, `src/tui/components.tsx`, `src/tui/brand.ts`.

- `AppFrame` / `Panel` / `StatusBar` using Ink `Box` `borderStyle="single"`
- focused panel border cyan when colors are on
- header Ready / Needs attention colors
- footer dim
- static ASCII logo in `brand.ts` (large, readable, no dependency)
- Spinner only on real waits
- `SafeText` remains the only path for untrusted strings

Do not add CSS-like theme tokens beyond a tiny `tone()` helper if it
removes duplication.

Verify:

```bash
pnpm run typecheck
pnpm exec vitest run test/tui-ink-foundation.test.ts
```

Foundation tests must still prove `NO_COLOR` disables color and the
alternate screen is used.

### Phase 4 — welcome + folder picker + setup copy

Files: `src/tui/screens/welcome.tsx`, `src/tui/screens/folder-picker.tsx`,
setup screen rewrite, controller effects for `readdir`.

Picker rules from section 5.2 are mandatory:

- directories only
- one `readdir` per opened path
- filter is local to the loaded listing
- `/mnt/c` and `/mnt/d` only if they exist
- permission errors are rows
- confirm shows the absolute path
- after confirm, diagnose that cwd
- picker blocked during live

Setup must call `discoverSetupModels()` on auto-open.

Setup review is a human summary, not only raw JSON. `Show full config`
can toggle the JSON preview.

Verify:

```bash
pnpm run typecheck
pnpm exec vitest run test/tui-ink-phase6.test.ts test/tui-reduce.test.ts
```

Phase 6 tests will likely fail until Phase 5 rewrites them. If they still
use old copy, rewrite those tests in this phase only as far as needed for
setup write / no-overwrite contracts. Do not leave the suite red.

### Phase 5 — rewrite shell tests off old copy

Old tests assert strings such as:

- `> New workflow`
- `> Read documentation`
- `> Refresh diagnosis`
- `> Diagnosis`
- `> Run history`
- `> Exit`
- `Run status`
- `Return home`
- `Review in history`

Those screens are gone. Rewrite `test/tui-ink-shell.test.ts` and
`test/tui-ink-phase6.test.ts` to the new copy.

Keep these contracts (behavior, not wording):

- navigate and quit without leaking color when `NO_COLOR` is set
- alternate screen is restored (`\u001b[?1049l`)
- diagnosis refreshes coalesce; a result after unmount is ignored
- first-run setup writes only after final confirmation
- setup never overwrites a config created before confirmation
- launch still re-checks profiles before start
- live cancel is first graceful, then force
- artifact previews stay bounded (4,000 bytes JSON / 8,000 chars display;
  application already owns the byte cap)

Do not add permutation tests for every key. Do not test border characters.

Keep unchanged:

- `test/tui-ink-execution.test.ts`
- `test/tui-ink-viewport.test.ts`
- `test/tui-ink-text.test.ts`
- `test/tui-ink-foundation.test.ts`
- `test/architecture-boundaries.test.ts`

Verify:

```bash
pnpm exec vitest run test/tui-ink-shell.test.ts test/tui-ink-phase6.test.ts test/tui-reduce.test.ts
```

### Phase 6 — docs + full verify

Update README TUI paragraphs (`README.md` around the "Run A Workflow"
and "Preview Limitations" TUI bullets) so they describe:

- welcome always shows
- Enter uses the current folder
- folder can be changed when idle
- studio split, not a home menu
- first/second cancel still attached
- no daemon

Update in-app about/help text if it still says "return home" or
"Attached Ink shell".

Then run all of:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Do not run `build:bundle` or e2e unless the owner asks.

---

## 8. Tests policy

Minimum useful tests only.

Add one new file: `test/tui-reduce.test.ts`.

Rewrite two Ink files that are coupled to old copy.

Do not add:

- snapshot tests of ASCII art
- tests for every color
- tests that only prove a getter exists
- a second reducer test file
- coverage targets

If a shell test becomes huge, prefer fewer end-to-end paths:

1. welcome -> use folder -> studio
2. first-run setup write + no overwrite
3. launch confirm -> live cancel
4. waiting run stays inspectable

---

## 9. Performance rules

- One `readdir` per folder open. Never recursive.
- Filter in memory on the current listing.
- `listRuns` stays paginated (`limit: 50` is fine).
- Home's old `limit: 3` goes away because runs are a real list.
- Live events: keep `createLiveUiPublisher` / `LIVE_UI_FLUSH_MS = 50`.
- Do not store the activity array in `TuiState`.
- Ignore stale async results after unmount or after cwd changes
  (generation counter or `active` ref, as the current controller already
  does for diagnosis).
- Sanitize on ingest (`execution.ts` already does this for activity).
- Do not re-render the logo from a changing string on every frame.

---

## 10. TUI input hygiene

- While a text field is focused (objective, setup free text, reject
  feedback, YES confirm, folder filter), do not treat `j`/`k`/`q` as
  global commands except:

  - `Esc` cancels / leaves the field according to that overlay
  - setup / picker `q` still cancels when not using a multi-line editor
    (there is no multi-line editor)

- Use `@inkjs/ui` `TextInput` where the current setup/launch already does.
- Footers must not advertise dead keys.
- Unify SIGINT with keyboard cancel. The current bug is in
  `shell-controller.tsx` around the `registerSignalHandler` effect
  (it calls `exit()` on the first graceful cancel). Fix it in Phase 2.

---

## 11. Copy bank

Use these strings unless a small grammar fix is clearly better. Do not
reintroduce `Attached Ink shell`.

Welcome actions:

- `Use this folder`
- `Choose a different folder`
- `What is Binaflow?`
- `Quit`

Welcome statuses:

- `This folder already has Binaflow.`
- `New folder. Nothing has been written yet.`
- `This folder cannot be used yet.`

Folder confirm:

- `Agents may read files in this folder.`
- `The builder can write only if you allow that later.`

Studio empty ready:

- `Press n to start a run.`

Studio footer:

- `n new run   w folder   d status   ? help   Tab switch   q quit`

Live footer:

- `q cancel   Ctrl-C cancel   d activity   j/k scroll`

Setup review:

- `Nothing has been written yet.`
- `Save`
- `Show full config`
- `Go back`
- `Cancel`

Invalid config:

- `The config file is invalid. Edit .binaflow/config.json in your editor, then press d to refresh.`

Help overlay title:

- `Keyboard`

About / help must still say:

- attached to this process
- no detach / daemon
- first cancel graceful, second forced
- planner is read-only
- builder write is reviewed
- research approval is experimental
- credentials stay outside Binaflow
- `NO_COLOR` removes color only

---

## 12. Keymap

Global, when no text field owns input and no blocking overlay is open:

| Key | Action |
|---|---|
| `n` | new run |
| `w` | folder picker if idle |
| `d` | diagnosis in the right panel and refresh |
| `r` | same as `d` (keep `r` working; do not advertise both if footer is full) |
| `?` | help |
| `Tab` / `h` / `l` | change focused pane |
| `j` / `k` / arrows | move or scroll in focused pane |
| `Enter` | activate selection |
| `q` / `Esc` | quit if studio idle; cancel if live; close overlay otherwise |
| `Ctrl-C` | same as live cancel, or quit 130 if idle |

Welcome:

| Key | Action |
|---|---|
| `Enter` | selected action |
| `j` / `k` | move |
| `q` | quit |

Picker:

| Key | Action |
|---|---|
| `Enter` | open directory |
| `Space` | use selected / current folder |
| `h` | parent |
| `/` | root |
| `q` | back |

---

## 13. Definition of done

A novice path works without hidden screens:

1. Logo
2. Enter uses this folder
3. Setup appears only if needed, discovers models, writes once
4. Studio says `Press n to start a run.` or one attention sentence
5. Objective + permission confirm
6. Live checklist in the right panel
7. Result and artifacts stay on that run

Plus:

- architecture boundary test green
- no new packages
- no core changes
- `pnpm run format:check`, `lint`, `typecheck`, `test`, `build` green
- this `TODO.md` can be checked off phase by phase

When a phase is finished, mark its checkboxes in this file. Do not delete
the spec.

---

## 14. Phase checklist

- [x] Phase 1: `model.ts`, `reduce.ts`, `test/tui-reduce.test.ts`
- [ ] Phase 2: studio shell, SIGINT unified, leftover setup screens gone
- [ ] Phase 3: borders, colors, logo, spinners, `NO_COLOR`
- [ ] Phase 4: welcome, picker, setup copy + model discovery on auto-open
- [ ] Phase 5: shell/phase6 tests rewritten to new copy, contracts kept
- [ ] Phase 6: README + about/help copy, full verify commands green
