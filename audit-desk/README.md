# audit-desk

An **exhaustive audit of expense records** as a durable flow, built to test the flow engine of `@backendkit-labs/agent-core` and its Redis side (`@backendkit-labs/agent-flow-queue`) **against a real Redis in a container**, with real processes and a hard kill.

The records are synthetic and deterministic from a seed, with anomalies **planted** (so the audit can be scored: nothing missed, nothing invented) and decoys (monthly subscriptions that look like duplicates and are not). No real data, no network, no model.

```
shard-000 ┐
shard-001 ├─ scanner x N (in parallel, on workers) ─> merge ─> verify ─> report
   ...    ┘     every record, one shard each          cross-shard  re-reads the   only if something was
                                                      duplicates   raw records    confirmed; a person
                                                      and splits   (not the       approves it
                                                                   scanner)
```

| Step | Agent | What it does |
|---|---|---|
| `shard-NNN` | scanner | Reads every record of its shard: outliers, missing approval, self approval. Hands on a compact index. |
| `merge` | consolidator | What only shows **across** shards: duplicates and purchases split to dodge the approval limit. |
| `verify` | verifier | Does not trust the scanner: re-reads the records. Clears the subscriptions (monthly recurrence) the scanner flagged. |
| `report` | writer | `when: matches '^VERIFY: [1-9]\d* CONFIRMED'` and `gate.approval: human`. A clean book produces no report and asks nobody. |

The scanning is deterministic computation, not a model: an exhaustive audit reads every record, and that is not what a language model is for. A model would come in where judgment and prose are needed (the verifier's doubtful cases, the report). The flow does not care which one an agent is: it is a `StepExecutor`.

## Run it

```bash
npm install
npm run smoke          # 8 checks, offline: correctness, why the consolidation is needed, failed shard, approval and resume, scale
npm run audit          # one audit in this process: precision, recall and the report
npm run audit -- 7 20000 250   # seed, records, shard size

# the Redis side, against a real Redis (a throwaway container, 127.0.0.1:6390):
npm run redis:up       # docker compose up -d --wait
npm run redis:check    # 11 checks, ~45 s, real processes
npm run redis:down

# the journal of one host, no Redis (SPEC-0024): kill the orchestrator with SIGKILL, another process takes the run over at once
npm run ndjson:check   # 5 checks, ~25 s, real processes
```

`REDIS_URL` overrides the address. The checks use their own key prefix and remove it at the end.

## What `redis:check` proves

| Check | Why it matters |
|---|---|
| 40 callers `begin` the same run at once: exactly one wins | The Lua `BEGIN` is atomic. |
| 300 events appended at once: none lost | The Lua `APPEND` under contention. |
| 30 owners `claim` at once: exactly one gets it | The Lua `CLAIM`: mutual exclusion. |
| Renewal replaces the claim; a stale release frees nothing | The token protects a renewed claim. |
| The claim expires on its own (`PX`) and can be taken over | Expiry is Redis's, not ours. |
| Same idempotency key sent twice: the worker runs it once | `jobId` = `runId:stepId:attempt`. |
| The whole audit through the queue, 2 worker processes | 100% precision and recall, every step once, in parallel. |
| **While an orchestrator lives, another cannot take the run** | The claim is renewed past its TTL (3 s): the run lasts ~9 s. |
| **Hard kill** of the orchestrator; the claim lapses by itself | No goodbye, no release: the TTL frees it ~3 s later. |
| Another process finishes the audit; no finding is lost | Resume from the Redis journal. |
| The shards that were done before the kill did not run again | At-least-once, not at-every-time: only work in flight is repeated. |

## `ndjson:check`: the file journal, with a hard kill and no Redis

`NdjsonRunJournal` (one `<runId>.ndjson` per run, a chain of MACs, `fsync`, one writer, a lock with the pid of its holder) with real processes: an orchestrator is **killed with SIGKILL** in the middle of the audit. The claim is free **10-18 ms** after the kill (with Redis the TTL of 3 s had to lapse), another process finishes the audit without losing a finding and without running again what was done (only what was in flight), and a live holder is respected however slow it is. A write cut in the middle is simulated (a kill rarely lands inside a write).

## What it found in the framework

Both were bugs, found only by running against a real Redis or with a wide fan-out. Both are fixed (PRs on the framework):

1. **`QueueStepExecutor` lost the end of a fast step** ([#213](https://github.com/BackendKit-labs/backendkit-agent-framework/pull/213)). BullMQ announces the end of a job through an event stream read with `XREAD ... $`, and an announcement made before a *new* `QueueEvents` has started reading is never delivered. A step that finishes in milliseconds on the first use of a queue (here the `report`, after the kill) waited until `timeoutMs` and failed although the worker had completed it. It failed **2 runs out of 3**; the mock tests could not show it. The executor now also looks at the job itself (`pollMs`).
2. **`FileRunJournal` failed with "too much contention"** ([#214](https://github.com/BackendKit-labs/backendkit-agent-framework/pull/214)). With more than ~20 steps finishing at once (a 26-shard fan-out) the appends raced for the same event number and ran out of their 20 attempts, even inside one process; the journal fails closed, so the run ended `failed`. Appends of a run are now serialised per process and the race between processes retries with jitter (`@backendkit-labs/retry`).

And one that was **not** a bug but is worth knowing: after a kill, the dead orchestrator's already-queued jobs keep running on the workers (29 steps ran 43 times in total; the surplus is work in flight, run again at least once). Steps with an external effect must use `input.idempotencyKey`.

The **Lua scripts** of `RedisRunJournal` had never run against a real Redis: they pass (the 6 contract tests of `agent-flow-queue` also run against it with `REDIS_HOST=127.0.0.1 REDIS_PORT=6390`).

## Would this be useful for Hermes in Steward?

Read from `steward/docs` (ADR-0006, ADR-0012, SPEC-0005, SPEC-0008, SPEC-0009): the goal is that **one employee operates a whole department from the Hermes console** with agents and workflows, sold as **packages per department × country × version, not bespoke implementations**.

**Yes, as a department flow template; no, as infrastructure.**

- **It fits what Steward needs.** An audit of expenses, payroll, overtime or leave is exactly the kind of work a department does in bulk and that one person cannot read line by line. The shape here is the one SPEC-0005/SPEC-0009 ask for: a deterministic flow with approval (`gate.approval: human`), an **independent verifier** (the "evaluator is not the executor" rule of the gates), a durable run that survives a restart, and a report that waits for a person. The "improvement proposed to the SDK" that SPEC-0005 lists as pending (journal, `resume`, a `'pending'` approval) is what `runFlow` + `RunJournal` + `approvals` now are.
- **What Steward would take is the template, not this code:** a `flows/audit-expenses.yaml` (the policy thresholds `APPROVAL_OVER`, `SPLIT_ITEM_MAX`, the outlier factor come from the **versioned configuration** of SPEC-0004, per country and company, not from constants) and the deterministic scan tools behind the `scanner` agent. The scoring against planted anomalies is a good **acceptance test for any department package** (`pilot/acceptance.mjs` style): a package is accepted when it finds what was planted and invents nothing.
- **Redis and the queue are not a Steward requirement.** SPEC-0008 proposes taking Redis out of the authentication service, Chamberlain (that was derived by the assistant, **not confirmed by the owner**), and Steward keeps approvals and runs in local files. A single Hermes process needs `FileRunJournal` (which is what #214 makes sound for a wide fan-out) and an in-process executor. `QueueStepExecutor` and `RedisRunJournal` only matter if Hermes runs as several instances or the heavy scanning goes to separate workers. `redis:check` is a test of the **SDK**, which is what it is here for.
- **What the example does not settle for Steward:** (1) **routing approvals by level** (who approves what by department hierarchy: the organization levels and `canApprove` of SPEC-0005) is not in the SDK: here a person simply approves; (2) **isolation per department**: the journal can filter by `tenantId`, but the department scope (`scopeId`) is Steward's; (3) **the journal is as sensitive as the data**: step outputs are stored as they are (the findings name employees), and `redact` only covers previews and errors, so Steward must treat the run store like the audit log; (4) a model in the loop (verifier, report) is the part that needs the live tests Steward already does with DeepSeek: none of it is exercised here.

## Files

`dataset.ts` (records, planted anomalies, truth) · `analysis.ts` (what each agent does) · `audit-flow.ts` (the flow) · `audit-executor.ts` (the `StepExecutor`) · `audit-run.ts` (run and score) · `audit-smoke.ts` (offline checks) · `audit-local-orchestrator.ts`, `ndjson-check.ts` (the file journal with a kill) · `audit-worker.ts`, `audit-orchestrator.ts` (the real processes) · `redis-check.ts` (the Redis checks) · `docker-compose.yml` (the throwaway Redis).
