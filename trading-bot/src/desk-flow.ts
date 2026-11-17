/**
 * The research desk as a flow: for one symbol, three analysts work at the same time (technical, regime, exposure), a decider
 * reads what they found, and an executor places the order behind a person's approval. It is the same object whether it is
 * written here, loaded from YAML or planned by a model (`planFlow`).
 */
import { parseFlow, type FlowDefinition } from '@backendkit-labs/agent-core';

export const DESK_AGENTS = ['technical', 'regime', 'risk', 'decider', 'executor'] as const;
export type DeskAgent = typeof DESK_AGENTS[number];

export const entryFlowYaml = (symbol: string): string => `
flow: entry-${symbol}
version: 1
trigger:
  type: manual
steps:
  # No \`after\`: the three analysts run together.
  - id: technical
    agent: technical
    prompt: "Symbol {{payload.symbol}}, bar {{payload.bar}}. Read the indicators and give your technical verdict."
    timeoutMs: 20000
  - id: regime
    agent: regime
    prompt: "Symbol {{payload.symbol}}, bar {{payload.bar}}. Read the last 20 candles and say how volatile the market is."
    timeoutMs: 20000
  - id: exposure
    agent: risk
    prompt: "Symbol {{payload.symbol}}, bar {{payload.bar}}. Read the portfolio and say whether there is room for a new position."
    timeoutMs: 20000
  # Waits for the three. If one failed the flow runs it anyway (onStepFailure: continue) and the decider sees what is missing.
  - id: decision
    agent: decider
    prompt: "Symbol {{payload.symbol}}, bar {{payload.bar}}. Decide with the analysis you were given."
    after: [technical, regime, exposure]
  # Only when the decision is to enter: a SKIP never reaches a person. And the order waits for one to approve it.
  - id: execute
    agent: executor
    prompt: "Symbol {{payload.symbol}}, bar {{payload.bar}}. Carry out the decision."
    after: [decision]
    when: { step: decision, contains: "DECISION: ENTER" }
    gate:
      approval: human
`;

export const entryFlow = (symbol: string): FlowDefinition => parseFlow(entryFlowYaml(symbol));
