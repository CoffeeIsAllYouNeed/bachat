/**
 * One AI agent per AI task. All agents share the same Gemini API (via
 * geminiRequest: proxy, redaction, retry, model fallback) but each has its own
 * role, rules, temperature and run status.
 */
import { create } from 'zustand';

export type AgentId =
  | 'categoriser'
  | 'statement'
  | 'voice'
  | 'savings'
  | 'goalPlanner'
  | 'replanner'
  | 'offPlan'
  | 'recap'
  | 'assistant'
  | 'autopilot';

export interface AgentSpec {
  id: AgentId;
  name: string;
  job: string;
  role: string;
  temperature: number;
}

const BASE =
  'You are one agent inside Bachat, an Indian personal finance coach. All numbers are computed on the device; never invent or change numbers. Never recommend specific stocks, funds or other securities.';

export const AGENTS: Record<AgentId, AgentSpec> = {
  categoriser: { id: 'categoriser', name: 'Categoriser', job: 'Sorts unclear transactions using your past corrections', role: 'Role: Categoriser agent. Assign each transaction a category, following the user’s past corrections first.', temperature: 0 },
  statement: { id: 'statement', name: 'Statement reader', job: 'Reads messy bank statements', role: 'Role: Statement reader agent. Extract transactions from bank statements exactly as printed.', temperature: 0 },
  voice: { id: 'voice', name: 'Voice', job: 'Turns speech into a request', role: 'Role: Voice agent. Transcribe the user’s voice request faithfully.', temperature: 0 },
  savings: { id: 'savings', name: 'Savings coach', job: 'Finds where you can save more', role: 'Role: Savings coach agent. Explain why each saving idea fits this user and the easiest next step.', temperature: 0.3 },
  goalPlanner: { id: 'goalPlanner', name: 'Goal planner', job: 'Turns goals into 2–3 concrete moves', role: 'Role: Goal planner agent. Turn the user’s real spending into a few concrete, doable moves for the goal.', temperature: 0.3 },
  replanner: { id: 'replanner', name: 'Re-planner', job: 'Understands life changes (“what if…”)', role: 'Role: Re-planner agent. Convert a described life change into structured adjustments.', temperature: 0 },
  offPlan: { id: 'offPlan', name: 'Off-plan explainer', job: 'Explains why you are going off plan', role: 'Role: Off-plan agent. Explain briefly and kindly why spending is ahead of plan.', temperature: 0.3 },
  recap: { id: 'recap', name: 'Review recap', job: 'Writes the day/week/month/year recap', role: 'Role: Recap agent. Summarise the period in 1–2 plain sentences.', temperature: 0.3 },
  assistant: { id: 'assistant', name: 'Assistant', job: 'Answers questions using the app’s tools', role: 'Role: Assistant agent. Use the tools to look things up; propose changes, never apply them yourself.', temperature: 0.3 },
  autopilot: { id: 'autopilot', name: 'Autopilot', job: 'Runs the other agents after each refresh', role: 'Role: Autopilot agent.', temperature: 0 },
};

export const AGENT_LIST: AgentSpec[] = Object.values(AGENTS);

/** System instruction for an agent: shared base + its role + the task's own rules. */
export function agentSystem(id: AgentId, taskRules?: string): string {
  return [BASE, AGENTS[id].role, taskRules].filter(Boolean).join('\n\n');
}

export interface AgentRun {
  at: number;
  ok: boolean;
}

interface AgentRunsState {
  runs: Partial<Record<AgentId, AgentRun>>;
  record: (id: AgentId, ok: boolean) => void;
}

/** In-memory last run per agent (shown in Settings → AI). */
export const useAgentRuns = create<AgentRunsState>()((set) => ({
  runs: {},
  record: (id, ok) => set((s) => ({ runs: { ...s.runs, [id]: { at: Date.now(), ok } } })),
}));

export function recordAgentRun(id: AgentId | undefined, ok: boolean): void {
  if (id) useAgentRuns.getState().record(id, ok);
}
