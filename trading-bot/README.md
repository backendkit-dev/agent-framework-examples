# trading-bot

A paper-trading bot built as a **test bench for `@backendkit-labs/agent-core`**: an LLM reasons, deterministic tools act, and the framework's **memory** and **learning** make the bot improve from its own losing trades.

**No real money and no exchange.** The market is synthetic and seeded (same seed, same candles).

## What it exercises

| Layer | What it is | Framework piece |
|---|---|---|
| Reasoning | an LLM (DeepSeek live, or an offline mock) | `createBaseEngine`, providers |
| Action | `get_candles`, `get_indicators`, `get_portfolio`, `place_order`, `close_position`, all deterministic | `defineTool`, `errorHints` |
| Safety | a risk gate in `place_order` (size, open positions, loss limit) plus rules a person approved, read through the framework | `ToolError`, `learnedRules` |
| Memory | episodic (each trade), semantic (the playbook), procedural (which entries worked) | `createMemorySystem` |
| Learning | losing trades and refusals become lessons in the prompt and proposed rules that wait for a person; runs in simulated time | `createLearning({ dir, stamp: 'clock' })`, `trackOutcome`, `Experience.context`, the `learning` option |
| Reporting | what each session did, the prompt the model got, the budget | `RunResult`, `emitSystemPrompt`, `engine.budgetExceeded`, `agent-testkit` |

The market has three hidden regimes. In a `range` it spikes through the recent high and falls back (a false breakout); in a trend, breakouts keep going. The bot is never told the regime: it has to find out which breakouts are worth taking from its own results. The learning module learns it as `breakout/trend_flat`.

## Run it

It uses the framework **from source** (`tsconfig` paths to `../../agent-framework/packages`), so it tries what is not published yet. Build the framework once (`npm run build` in `agent-framework`), then:

```bash
npm install
npm run smoke        # 32 checks, offline, ~1 min
npm run sim          # the same seed side by side: naive, with memory, with learning, with and without approval
npm run live         # 14 sessions with DeepSeek (needs DEEPSEEK_API_KEY; costs a few cents, capped)
npm run live -- 30 7 # sessions, seed
```

## How the loop works

1. Each session the runner settles the broker (stops and targets), then the bot reasons over the tools and acts.
2. When a position closes, **deterministic code** records it: a loss is not a tool error (the order was accepted), so the audit sink never sees it. Winners are recorded too, so a failure is judged against how often *that* entry works.
3. The same false breakout in the same kind of trend, seen enough times and often enough, becomes a **lesson** in the prompt (`### breakout/trend_flat`) and a **proposed rule**.
4. A person approves the rule (here the simulated operator). Only then does the risk gate refuse that entry, whatever the model says.
5. Refusals of the gate are failures of `place_order` with a code (`RISK_MAX_POSITION`...). When one repeats, the lesson is the hint its author wrote.

## What the offline mock is, and is not

`mock-llm.ts` decides from the tool results so that the bench runs fast and the same every time. It checks **plumbing, not intelligence**. With `readsLessons` it follows what the lessons in its prompt say: that is a scripted imitation of a model that reads its prompt. Only `npm run live` says anything about a real LLM, and with a few sessions even that is anecdotal. One seed is not evidence either: the table printed by `sim` and `smoke` is an illustration.

Where the rule and the lesson would give the same result, the bench separates them with a bot that **ignores** lessons: the approved rule alone still keeps it out of the blocked entries.

## Files

`market.ts`, `indicators.ts`, `broker.ts` (the paper world) · `risk.ts`, `tools.ts` (the deterministic tools) · `learning.ts`, `memory.ts` (the framework wiring) · `agent.ts` (the engine) · `mock-llm.ts` · `sim.ts` (loop and report) · `smoke.ts`, `live.ts`, `tune.ts` (checks, live run, market statistics) · `FINDINGS.md` (what the framework could do better).

## The research desk: orchestration and multitasking

The same market and tools, but the decision is made by **five agents orchestrated as a flow** (`@backendkit-labs/agent-core` 0.43.0, SPEC-0023) instead of one agent doing everything:

```
for each symbol, at the same time:
  technical ┐
  regime    ├─ (in parallel) ─> decision ─> execute   (a person approves the order)
  risk      ┘
```

| Piece | File | Framework piece |
|---|---|---|
| The flow as YAML (`after`, `timeoutMs`, `gate.approval: human`) | `desk-flow.ts` | `parseFlow`, `runFlow` |
| Five agents, each with its own prompt and only its own tools | `desk-agents.ts` | `StepExecutor`, `createBaseEngine` |
| Offline models that read their ROLE | `desk-mock-llm.ts` | |
| One flow per symbol at once, a cap per agent, a simulated person approving | `desk-sim.ts` | `KeyedConcurrencyLimiter`, `approve` |
| The checks | `desk-smoke.ts` | `MemoryRunJournal`, `NdjsonRunJournal`, `createApprovalHandler`, `planFlow` |
| A real model in every agent (and optionally the queue and Redis) | `desk-live.ts` | `agent-flow-queue` |

```bash
npm run desk:smoke   # 9 checks, offline, ~1 min: parallel analysts, order between steps, cap per agent, a failed analyst,
                     # an order that waits for a person (and is placed once), a "no", a crash and resume, a plan by a model
npm run desk         # the desk over a simulated market (seed, bars): flows, orders, and how much parallelism paid
npm run desk:live    # DeepSeek in every agent, 3 sessions x 2 symbols, capped at 0.08 USD
REDIS_URL=redis://localhost:6379 npm run desk:live   # steps through BullMQ and runs in Redis (see FINDINGS)
```

What the checks assert is the **orchestration**, not the intelligence of a model (the mock only reads its role). What a real model does is what `desk:live` shows.
