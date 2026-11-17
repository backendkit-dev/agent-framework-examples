# release-captain

**Is this monorepo ready to release?** A release captain for npm workspaces monorepos, built as a durable flow with `@backendkit-labs/agent-core`. It is the checklist a person does by hand before publishing (and that this repository's own releases kept needing), run as a flow whose **shape is the shape of the monorepo**:

- builds **in dependency order**, as many at once as you allow;
- checks that **every range a package asks of another workspace package includes the version the workspace has** (in `0.x`, `^0.42.0` does not cover `0.43.0`, and CI then fails at install);
- sees **what changed since each package's last release tag**, committed or not, and flags a package that changed but is still at the same version;
- asks the **registry** whether each version is already published;
- does what `npm publish` does short of uploading (`prepublishOnly`, then `npm pack --dry-run`) and refuses a package that would publish a secret (`.env`, keys) or whose `main` is not in the tarball;
- plans the publication **in dependency order**, has the plan **verified on its own** from the graph, and — only if it is sound and **a person approves** — hands over the checklist (`npm publish` per package, in order, and the tags).

**It publishes nothing.** It builds, reads and plans.

```
inspect ─┐
tags ────┤                                  ┌─ pack-core ┐
registry-core … ──────────────────────────┐ │            │
build-core ─> build-util ─> build-web ─> build-cli        ├─> plan ─> verify ─> report
   └──────────> build-docs (private)        └─ pack-… ───┘            │            (when ok; a person approves)
build-solo ─────────────────────────────────────────────────────────  blocked ──> report skipped
```

## Run it

```bash
npm install
npm run smoke                                   # 19 checks, ~3 min: a small monorepo on disk, real git, real processes

# on a real monorepo (the framework itself, below)
npm run release -- ../../agent-framework --jobs 3 --extra packages/templates/base
#   if the plan is sound it ends "awaiting_approval" with a run id; read the plan, then:
npm run release -- ../../agent-framework --run <id> --approve
```

| Flag | |
|---|---|
| `--jobs N` | Builds at the same time (default 3). Other steps have their own caps: registry 6, pack 4, tests 2. |
| `--tests` | Also run every package's tests after its build (the slowest part, off by default). |
| `--extra a,b` | Folders of manifests **outside** the workspace (templates) that ask for workspace packages and must match it too. |
| `--run <id>` | Resume that run. What finished is **not done again**: after fixing one package, only it and what depends on it build again. |
| `--approve` | Approve the report of `--run <id>` (as the current user) and finish it. |
| `--state <dir>` | Where runs are kept (default: the temp folder, one per repo). Ctrl-C stops what is running and the run can be resumed. |

A resume **trusts the earlier results**: if you changed a package that had already built, or committed after the `tags` step, start a new run.

## What it shows of the library

| In the flow | Library piece |
|---|---|
| The definition is **built from the package graph**: a build `after` the builds it needs, the checks that need no build start at once | `FlowDefinition`, `validateFlow` |
| Real subprocesses (`npm`, `git`) as steps; **cancel and deadline kill the whole process tree** | `StepExecutor`, the step `signal`, `timeoutMs` |
| At most N builds at once, other caps for other kinds of step | `KeyedConcurrencyLimiter` keyed by agent |
| A failed build **skips what depends on it** and lets the rest finish; the error carries the compiler's output | default `onStepFailure`, the step `error` |
| A run that lasts minutes **survives the process** and resumes where it stopped | `NdjsonRunJournal`, `runId` |
| The report runs only if the plan is sound, and a person reads it first | `when: { matches: '^VERIFY: ok' }`, `gate.approval: human`, `FileApprovalStore`, `createApprovalHandler` |
| The one that checks is not the one that planned | the verifier derives the order and dependencies again from the graph |

`NdjsonRunJournal` is in [SPEC-0024](../../agent-framework/docs/specs/SPEC-0024-journal-de-corridas-ndjson.md) (framework PR #216); until it is published this example uses the framework **from source** (`tsconfig` paths to `../../agent-framework/packages`).

## The checks (`npm run smoke`)

Plain functions: the order and a named cycle; the `0.x` range rule; manifests outside the workspace; what changed since a tag (newest by version, tests/locks/build output ignored); an unsound plan caught on its own; the context blocks of a step; the shape of the flow.
With a small monorepo on disk (`fixture.ts`: real git, tags, builds that are real processes with a controlled duration, logging to `builds.log`): the builds respect the order and the cap, a failure skips what depends on it, **resuming builds only what was left**, what is already published is not published again, a range or a version problem blocks the plan and the report is skipped by its condition (nobody is asked), a **deadline** and a **cancel** kill the processes, and **real `npm pack`** refuses a package that would publish a `.env`.

## On the real monorepo

Run against this repository (17 packages, real `npm` builds, real registry, `--jobs 3`, templates included with `--extra`): **150 s, 52 steps, none failed**, the repository left clean, and the verdict

```
VERIFY: blocked 1 problems
  - @backendkit-labs/agent-core: changed since agent-core@0.44.0 (6 files) and still 0.44.0
```

which is right: the checked-out branch had `NdjsonRunJournal` (6 files of `core`) not yet released. The report was skipped by its condition and nobody was asked. Getting there took four runs, and each stop was informative:

1. **A false alarm of the tool: `web-ui` "main is not in the package".** Its `npm run build` is the Vite *app* build; the library is built by `build:lib`, which `prepublishOnly` runs. `npm pack` does not run `prepublishOnly`, `npm publish` does, so the check now does what publishing does: run `prepublishOnly` if the package has one, then `npm pack --dry-run` (which runs `prepack`). (`npm publish --dry-run` cannot be used: it refuses any version that is already on the registry.)
2. **`create-bk-agent` "did not answer JSON".** Its `prepack` builds and copies templates and prints to the same stdout as `--json`; the JSON is now read from the last line that opens it.
3. **A bug of the tool: `.env.example` flagged as a secret.** The pattern was not anchored at the end, so `.env.example` matched as `.env`. A test now covers it, with the near misses (`src/.envelope.ts`, `my.key.ts`).
4. **A design point: a changed `README.md` blocked the release.** Only documentation changed in `web-ui` since its tag. That is reported (`docs-changed`: npm keeps showing the old README) but blocks nothing; a README next to code still needs the bump.

Honest costs: `prepublishOnly` rebuilds what `build` already built (that is what publishing does), which doubled the time (87 s → 150 s), and `npm pack` of `create-bk-agent` runs its `prepack`, which rewrites its ignored `templates/` copy.

## What it found while being built

- Killing the builds of a cancelled run with `spawnSync('taskkill')` held the whole process (a second per build). Now it is asynchronous. A cancelled run still took 6 s because the `tags` step ran its `git diff`s one after another and did not look at the signal between them: they are parallel now and the step stops.
- `npm` takes ~3 s to start on Windows, so the fixture runs a fast `node build.cjs` instead of `npm run build` (the commands are replaceable: `commands`), and one check runs the real `npm pack`.
- A resumed run reuses the earlier `tags` result. That is the point of resuming, and also the trap: see above.

## Limits

- It checks and plans; it does not publish, tag or push. Publishing is irreversible and stays with a person.
- The `0.x` caret rule and the checks of tarballs are about npm. A monorepo that is not npm workspaces (pnpm/yarn `workspace:` protocols are read, but their workspaces files are not) is out of scope.
- The registry check is `npm view`: it needs the network, and a failure other than "not found" fails the step instead of guessing.
- Paths with spaces are refused as command arguments (they are validated, not quoted).

## Files

`workspace.ts` (packages, graph, order, ranges, tags, plan) · `release-flow.ts` (the flow from the graph) · `release-executor.ts` (the steps) · `proc.ts` (cancellable commands) · `release-run.ts` (run and CLI) · `fixture.ts`, `release-smoke.ts` (the checks).
