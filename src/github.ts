import { invoke } from '@tauri-apps/api/core';

export type QueueKind = 'review' | 'mine' | 'involved';
export type MergeMethod = 'squash' | 'merge' | 'rebase';
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type CheckState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
  baseRefName: string;
  mergeable: MergeableState;
  mergeStateStatus: string;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  author: { login: string; avatarUrl: string } | null;
  repository: { nameWithOwner: string };
  checkState: CheckState | null;
}

export interface MergeState {
  id: string;
  mergeable: MergeableState;
  mergeStateStatus: string;
}

interface RawPullRequest extends Omit<PullRequest, 'checkState' | 'mergeable' | 'mergeStateStatus'> {
  commits: { nodes: { commit: { statusCheckRollup: { state: CheckState } | null } }[] };
}

interface QueuePage {
  data?: { search: { nodes: (RawPullRequest | Record<string, never>)[] } };
  errors?: { message: string }[];
}

function isPullRequest(node: RawPullRequest | Record<string, never>): node is RawPullRequest {
  return typeof node.number === 'number';
}

function toPullRequest({ commits, ...pull }: RawPullRequest): PullRequest {
  return { ...pull, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', checkState: commits.nodes[0]?.commit.statusCheckRollup?.state ?? null };
}

const MERGE_STATE_BATCH = 20;

interface MergeStateResponse {
  data?: { nodes: (MergeState | null)[] };
  errors?: { message: string }[];
}

export async function fetchMergeStates(ids: readonly string[], onBatch: (states: MergeState[]) => void): Promise<void> {
  const batches = Array.from({ length: Math.ceil(ids.length / MERGE_STATE_BATCH) }, (_, index) => ids.slice(index * MERGE_STATE_BATCH, (index + 1) * MERGE_STATE_BATCH));
  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const response: MergeStateResponse = JSON.parse(await invoke<string>('merge_states', { ids: batch }));
      if (response.data == null) throw new Error(response.errors?.map((error) => error.message).join('; ') ?? 'Empty response');
      onBatch(response.data.nodes.filter((node): node is MergeState => node?.id != null));
    }),
  );
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure != null) throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
}

export async function fetchQueue(kind: QueueKind): Promise<PullRequest[]> {
  const parsed: QueuePage | QueuePage[] = JSON.parse(await invoke<string>('queue', { kind }));
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const failed = pages.find((page) => page.data == null);
  if (failed != null) throw new Error(failed.errors?.map((error) => error.message).join('; ') ?? 'Empty response');
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.data?.search.nodes ?? [])
    .filter(isPullRequest)
    .filter((node) => !seen.has(node.id) && seen.add(node.id) != null)
    .map(toPullRequest);
}

export function fetchBody(pull: PullRequest): Promise<string> {
  return invoke<string>('body', { repo: pull.repository.nameWithOwner, number: pull.number });
}

export function fetchDiff(pull: PullRequest): Promise<string> {
  return invoke<string>('diff', { repo: pull.repository.nameWithOwner, number: pull.number });
}

export function approvePull(pull: PullRequest): Promise<string> {
  return invoke<string>('approve', { repo: pull.repository.nameWithOwner, number: pull.number });
}

export function mergePull(pull: PullRequest, method: MergeMethod): Promise<string> {
  return invoke<string>('merge', { repo: pull.repository.nameWithOwner, number: pull.number, method });
}

export function openInBrowser(url: string): Promise<void> {
  return invoke<void>('open_in_browser', { url });
}
