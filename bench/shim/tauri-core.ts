import { generateBody, generateDiff, generatePulls, type FixturePull } from '../fixtures';

const COUNT = Number(new URLSearchParams(location.search).get('pulls') ?? 120);
const LATENCY_MS = Number(new URLSearchParams(location.search).get('latency') ?? 0);
const pulls = generatePulls(COUNT);
const byId = new Map(pulls.map((pull) => [pull.id, pull]));
const byNumber = new Map(pulls.map((pull) => [pull.number, pull]));
const calls: Record<string, number> = {};

Object.assign(window, { __shimCalls: calls });

function mergeStateOf(pull: FixturePull): { id: string; mergeable: string; mergeStateStatus: string } {
  const conflicted = pull.number % 13 === 0;
  const failing = pull.commits.nodes[0]?.commit.statusCheckRollup?.state === 'FAILURE';
  const status = conflicted ? 'DIRTY' : pull.isDraft ? 'DRAFT' : failing ? 'UNSTABLE' : pull.reviewDecision === 'APPROVED' ? 'CLEAN' : 'BLOCKED';
  return { id: pull.id, mergeable: conflicted ? 'CONFLICTING' : 'MERGEABLE', mergeStateStatus: status };
}

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  queue: () => JSON.stringify([{ data: { search: { nodes: pulls } } }]),
  merge_states: (args) => JSON.stringify({ data: { nodes: (args.ids as string[]).map((id) => byId.get(id)).filter((pull) => pull != null).map((pull) => mergeStateOf(pull as FixturePull)) } }),
  body: (args) => generateBody(byNumber.get(args.number as number) ?? pulls[0]!),
  diff: (args) => generateDiff(byNumber.get(args.number as number) ?? pulls[0]!),
  conversation: () => JSON.stringify({ data: { repository: { pullRequest: { comments: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] } } } } }),
  viewer: () => 'someone-else',
  merge_queue: () => JSON.stringify({ data: { repository: { mergeQueue: null } } }),
  readiness_available: () => false,
  review_context: () => { throw new Error('offline harness'); },
  readiness: () => { throw new Error('offline harness'); },
  approve: () => 'ok',
  merge: () => 'ok',
  open_in_browser: () => undefined,
};

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  calls[command] = (calls[command] ?? 0) + 1;
  const handler = handlers[command];
  if (handler == null) throw new Error(`harness: unhandled command ${command}`);
  if (LATENCY_MS > 0) await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  return handler(args) as T;
}
