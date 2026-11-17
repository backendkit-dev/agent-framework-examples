# What this bench found in the framework

Written while building and running the bot against the **unpublished** F1 and F2 of the learning module (SPEC-0019). Ordered by how much each one matters. Each says how it was seen, so it can be reproduced.

**Status (2026-11-16):** the two bugs (1, 2) and points 3 and 4 were **fixed in the framework** (#193), and then everything the bench had to write by hand was added to it (see "What the bench asked for" at the end). Point 5 (simulated time) is solved too. `npm run smoke` asserts all of it, and found two new things (A and B at the end).

## Bugs

### 1. A lesson that works removes itself (F1, the rate) — FIXED
`npm run smoke`, section "A refusal that repeats".
The bot asks for 40% of the equity, the risk gate refuses (`RISK_MAX_POSITION`), and after three refusals the lesson with the author's hint reaches the prompt. The bot obeys, and its correct `place_order` calls pile up. They dilute the failure rate below the threshold, **the pattern leaves and takes its lesson with it**, the bot repeats the mistake, and the lesson comes back. Seen: 27 refusals over 19 trades, and the lesson absent from 257 prompts between its first and last appearance.
**Fixed:** the rate now decides when a pattern *enters*; once in, it stays while its failures stay in the window, and it has to pass the rate again to come back. In the same scenario the refusals stop at 8 or fewer and the lesson is in every prompt from its first appearance. **Original diagnosis:** the rate should decide when a pattern *enters*, not when it *leaves* (hysteresis). A lesson should end by time (nothing in the window) or by an explicit resolve, which is SPEC-0019 F3, not by dilution. Probably worth bringing the hysteresis forward into the same release as F1, because F1 is what introduces the oscillation.

### 2. Malformed tool arguments are counted as a success — FIXED
`npm run smoke`, "FINDING probe: a call with arguments that fail validation".
`defineTool` returns `"Error: Invalid arguments ..."` as the *result*, so the audit event says `outcome: 'ok'`. A model that keeps sending invalid arguments leaves no experience and adds to the denominator of the rate. It never learns from the mistake it makes most often.
**Fixed:** `defineTool` throws a `ToolArgumentError` (code `INVALID_ARGUMENTS`); the model sees the same text, the audit event is an error with that code, and the engine has a hint for it that the tool's `errorHints` can replace. It also exposed two tests of the framework that passed by accident: one called `read_file` with `path` instead of `file_path` and asserted success, and a `run_command` timeout test used 200 ms, below the 1000 ms minimum.

## Design points

### 3. The rate is per `subject`; the context has to live in the subject — DOCUMENTED
Breakouts lose in a flat trend (75%) and win in an uptrend (57%). The rate is "failures of the pattern / calls of the *subject*", so with the subject `breakout` the threshold judged both trends together. The bench had to encode the context in the subject (`breakout/trend_flat`) to get a per-context rate. That works and reads well in the prompt, but nothing says so, and `LearnedPattern` has no way to carry features of the situation. The `fingerprint` does not help: the rate ignores it.
**Done:** the docs of `rate`, of `Experience.subject` and the README say it, with this example.

### 4. A lesson names the last symbol, not the pattern — FIXED
The line is built from the `situation` of the **latest** experience: `false_breakout keeps happening. BBB-SIM breakout entry (trend_flat): ...` when the pattern spans three symbols. A real model read it as being about BBB-SIM. The `detail` is what carries the advice.
**Fixed:** with a `detail` the line is `kind keeps happening: detail`; the situation is only used when there is no detail.

### 5. Nothing helps with simulated time — FIXED
Backtests and simulations are a natural use of an agent bench. The windows use the real clock and the audit events carry it, so dating an experience with the simulated day takes it out of every window. The bench keeps `at` real and puts the simulated day in `meta`. `createLearning({ now })` exists, but the sink cannot use it for events.
**Fixed:** `createLearning({ now, stamp: 'clock' })` makes the sink, `record` and the counters use the clock of the simulation. The bench runs one bar per simulated day and sets the window to 120 bars. That immediately showed finding A below.

## Small things

- **File-backed stores accumulate between runs in the same directory.** Running the bench twice on the same `dir` mixed two runs' experiences, which cost a debugging detour. A `learning.reset()` or a note would help.
- **`agentId` of a recorded experience has to equal the profile id, or the lesson never arrives** (silent). The hook only sees the profile of the turn. A warning in `record` when no engine has that agent would save time.
- **The vertical rule is the author's to enforce.** The `EntryGuard` is read from `learning.rules` inside the risk gate and filtered with a type guard (`isEntryGuard`); `learning.policy` only understands tool rules. A typed helper to read the rules of one shape would remove the boilerplate.
- **`place_order` is `readOnly: false` and, with no `approver` or `policy`, it runs without asking** (the legacy path). That is by design and nothing hung, but for a bot that moves money a first-time user will be surprised.
- **A real model writes its own memory about the lessons** (`memory_remember`). The lesson, the episodic memory and the procedural pattern then say similar things, and the effect of each cannot be told apart. Expected, since `ProceduralMemory` is deprecated, but worth knowing when comparing.

## What worked (so the list is not only complaints)

- The loop closed with a **real LLM**. With DeepSeek, 30 sessions: it read the lesson, declined three flat-trend breakouts ("honored the 0.5% filter"), waited until SMA20 was 0.53% above SMA50 and then entered. No order was refused and no money was lost. Anecdotal, one seed.
- The approved rule protects a bot that **ignores** the lessons: no breakout in the blocked trend after the approval, and the learning saw the gate's refusals as experiences.
- Tenants, windows, the cost cap, `errorHints` and the unit format (`### breakout/trend_flat`, `### place_order`) did what they should, and the unit export/import round-tripped.

## What the bench asked for, and the framework now has

Everything the bench had to write by hand and that belongs to any agent. Each one is now used by the bench, and the hand-made version is gone.

| Written by hand in the bench | In the framework |
|---|---|
| Five stores wired one by one (the third copy of the same wiring, after coding and enterprise) | `createLearning({ dir })` |
| `RiskError` with a `code` | `ToolError(code, message)` |
| The risk gate owned a rule store and filtered it with `isEntryGuard` | the tool reads `learnedRules(ctx, guard)`: a read-only view of the tenant's rules (never the `Learning` object, which could approve) |
| A session report rebuilt from transport events | `engine.run()` returns `RunResult` (text, tool calls with their error code, errors, aborted, budget) |
| A provider wrapper to capture the system prompt | `emitSystemPrompt` (off by default) and `RunResult.systemPrompts` |
| A silent transport | the one of `agent-testkit` (it already existed) |
| `subject: 'breakout/trend_flat'` to judge a context on its own | `Experience.context`: same subject, judged apart |
| Simulated day in `meta` | `stamp: 'clock'` |
| A flag set in `onBudgetExceeded` to stop the loop | `engine.budgetExceeded` |
| `classify` + `recordTrade` boilerplate over `record` | `learning.trackOutcome({ ok, subject, context, ... })` (a success with no subject is refused) |

## New findings, with the framework as it is now

### A. A lesson that works is removed by time, and the mistake comes back
`npm run smoke`, "FINDING probe", twice. With the simulated clock the window is in bars. The oversized bot obeys the lesson and stops failing; its failures age out of the window; the lesson expires; the bot repeats the mistake (19 refusals over 245 sessions, the lesson missing from 170 prompts between its first and last appearance). The same happens to the false-breakout lesson: the approved rule keeps the bot safe, but the lesson is gone after ~120 bars without failures.
"No failures in the window" cannot tell "solved" from "solved *because of this lesson*". It is the other half of finding 1: that one was dilution by correct calls (fixed), this one is time.
**Proposal for SPEC-0019 F3 (it changes decision D5):** a lesson stays while its subject is still being called (the success counters already know that) and ends when the subject goes quiet or a person resolves it. It needs the pattern to be remembered beyond its experiences (the qualified record could carry what the line needs).

### B. Entering is path-dependent (a consequence of the hysteresis)
The live run ended with `breakout@trend_up x3` learned although breakouts in an uptrend mostly win here: the pattern passed the rate early, on a handful of calls, and the hysteresis keeps it while its failures stay in the window. That is the price of not losing a working lesson. A person approving a rule sees the evidence in the proposal (`3 x false_breakout`), not the share at the moment, so it would help to show the share (failures / calls) in it.

### C. Little things
- Budget: with `abortOnBudget`, DeepSeek's thinking plus a `memory_remember` call per session used the cap of 0.25 USD in about 22 sessions. Nothing wrong with the framework: the run stopped by itself, and `engine.budgetExceeded` said why.


## Resolved (2026-11-16): the lesson that removed itself

SPEC-0022 F1-F4 (framework, unpublished): a learned lesson stays while its subject is still being called and a person can resolve it. With it, the two FINDING probes of smoke.ts stopped printing and became assertions: the lesson is in every prompt after its first appearance, in both scenarios.
Measured with the simulated model (a script that reads its prompt, not a real LLM): 3 refusals of RISK_MAX_POSITION before the lesson first reached the prompt and 0 in the 230 sessions after it (against 19 in 245 sessions before SPEC-0022). 5 refusals of RISK_MAX_OPEN happened too: the lesson is not about them.

## The research desk (orchestration, SPEC-0023, core 0.43.0)

Written against the published flow engine. `npm run desk:smoke` asserts 11 things (9 held on the first run): parallel steps, order between them, the cap per agent, a failed analyst, approval and resume, a crash, a plan by a model. A live run with DeepSeek (6 flows, 51 model calls, 0.018 USD) completed every flow, had the three analysts overlapping (step time 78 s, wall 25 s, x3.2) and entered one trade after the model judged a breakout BULLISH in a volatile regime. These are the things that were awkward:

### 6. A claim is never renewed (core, `runFlow`) — FIXED (unpublished)
`claimTtlMs` (default 10 minutes) is the lifetime of the claim from the moment it is taken: nothing renews it while the run goes on. A run longer than the TTL can be taken over by another process **while the first is still running**, and a step with an external effect would run twice. The crash check relies on a short TTL to make the takeover quick, which shows the other side of it: the claim cannot tell "dead" from "slow". **Fixed:** `runFlow` renews the claim every `claimRenewMs` (default a third of the TTL) while the run goes on, so it expires only when the process stops; a renewal that finds the claim taken stops the run and throws `FlowClaimError` without writing over the new owner. `claimRenewMs: 0` turns it off (the crash check uses it to simulate a process that died). The desk checks a decision slower than the TTL that nobody takes over.

### 7. A flow cannot skip a step: "SKIP" still goes through the gate — FIXED (unpublished)
The decider answers `SKIP` most of the time, but `execute` is a step with `gate.approval: human`, so a person is asked to approve "do nothing". The desk works around it with an `approve` callback that auto-approves a decision without ENTER, and an executor that does nothing. A step with a condition (`when: {{steps.decision}} contains ENTER`) would make the flow say what it means and spare the approval.

**Fixed:** `when: { step, contains | equals | matches, not? }` on a step. A step whose condition does not hold (or cannot be evaluated because the step it looks at produced nothing) is `skipped` before anything else: not run, no approval asked, the steps that wait for it skipped too, and the flow does not fail. The desk now has `when: { step: decision, contains: "DECISION: ENTER" }` on `execute` and a check that a SKIP asks nobody.

### 8. `FileRunJournal` costs about 4 ms per event on Windows — MEASURED, left as is
`npm run desk` journals about 20 events per flow: 78 ms per flow with the file journal against 7 ms in memory (x11), constant as the directory grows (195 flows: 78 ms; 15 flows: 76 ms), so it is the cost of the hard-link write, not of listing. Fine for steps that take seconds (an LLM), visible for steps that take milliseconds. `desk-journal-bench.ts` measures it.

### 9. The result carries no cost — FIXED (unpublished)
`StepOutput.costUsd` is optional and `FlowResult` does not total it, so the cost of a flow is whatever the executor kept (the bench wraps the provider and sums the tokens). **Fixed:** `FlowResult.costUsd` is the sum of the steps' `costUsd` (absent when none reported).

### Not tried
`desk:live` with `REDIS_URL` (the BullMQ `QueueStepExecutor` and the `RedisRunJournal` Lua scripts) type-checks but **was not run: there is no Redis on this machine**. It is the first thing to try when there is one.
