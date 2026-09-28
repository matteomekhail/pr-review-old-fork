import './styles.css';
import { approvePull, usesMergeQueue, fetchBody, fetchDiff, fetchMergeStates, fetchQueue, type MergeState, mergePull, openInBrowser, type MergeMethod, type PullRequest, type QueueKind } from './github';
import { DiffView, parseDiff, type DiffStyle, type ParsedFile } from './diffs';
import { sanitizeHtml } from './sanitize';
import { CommandRegistry, renderShortcut, type Command } from './commands';
import { CommandPalette } from './palette';
import { Layout } from './layout';
import { Lightbox, collectMedia } from './lightbox';
import { enableWindowDrag } from './window-drag';
import { enableTooltips } from './tooltip';
import { groupPulls, type PullGroup } from './grouping';
import { imageUrlsInHtml, preloadImages } from './image-cache';
import { routeLinksToBrowser } from './external-links';
import { isSemanticMatch, semanticMatches } from './semantic-search';
import { isReady, isRecent, isSmall, matchesSmartFilter, sortPulls, type SmartFilter, type SortOrder } from './smart';
import { assessReadiness, isReadinessAvailable, type ReadinessResult } from './readiness';

interface State {
  kind: QueueKind;
  pulls: PullRequest[];
  filter: string;
  smartFilter: SmartFilter;
  sortOrder: SortOrder;
  checkedIds: Set<string>;
  selectedId: string | null;
  activeFileIndex: number;
  diffStyle: DiffStyle;
}

const PREFETCH_AHEAD = 5;
const DIFF_CACHE_LIMIT = 24;
const QUEUE_REFRESH_MS = 120_000;
const VIEW_TITLES: Record<QueueKind, string> = { review: 'Review requested', involved: 'Involved', mine: 'Created by me' };
const MERGE_LABELS: Record<MergeMethod, string> = { squash: 'Squash and merge', merge: 'Merge', rebase: 'Rebase and merge' };

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found == null) throw new Error(`missing #${id}`);
  return found as T;
};

const dom = {
  list: element<HTMLOListElement>('pr-list'),
  filter: element<HTMLInputElement>('filter'),
  viewTitle: element('view-title'),
  empty: element('empty'),
  pr: element('pr'),
  crumbs: element('crumbs'),
  statusBar: element('status-bar'),
  descPane: element('desc-pane'),
  inspector: element('inspector'),
  bodySplit: element('pr-body-split'),
  toggleMode: element<HTMLButtonElement>('toggle-mode'),
  files: element('files'),
  fileCount: element('file-count'),
  diffRoot: element('diff-root'),
  toggleAll: element<HTMLButtonElement>('toggle-all'),
  approve: element<HTMLButtonElement>('approve'),
  merge: element<HTMLButtonElement>('merge'),
  mergeMethod: element<HTMLSelectElement>('merge-method'),
  confirm: element<HTMLDialogElement>('confirm'),
  confirmTitle: element('confirm-title'),
  confirmText: element('confirm-text'),
  help: element<HTMLDialogElement>('help'),
  shortcutList: element('shortcut-list'),
  sort: element<HTMLSelectElement>('sort'),
  filterBar: element('filter-bar'),
  bulkBar: element('bulk-bar'),
  bulkCount: element('bulk-count'),
  bulkMerge: element<HTMLButtonElement>('bulk-merge'),
  bulkApprove: element<HTMLButtonElement>('bulk-approve'),
  bulkConfirm: element<HTMLDialogElement>('bulk-confirm'),
  bulkConfirmTitle: element('bulk-confirm-title'),
  bulkConfirmList: element('bulk-confirm-list'),
  bulkConfirmNote: element('bulk-confirm-note'),
  toast: element('toast'),
};

const state: State = {
  kind: 'mine',
  pulls: [],
  filter: '',
  smartFilter: (localStorage.getItem('smartFilter') as SmartFilter | null) ?? 'all',
  sortOrder: (localStorage.getItem('sortOrder') as SortOrder | null) ?? 'smart',
  checkedIds: new Set<string>(),
  selectedId: null,
  activeFileIndex: 0,
  diffStyle: localStorage.getItem('diffStyle') === 'unified' ? 'unified' : 'split',
};

const diffCache = new Map<string, Promise<ParsedFile[]>>();
const queueCache = new Map<QueueKind, PullRequest[]>();
let isSelectedQueued = false;
const diffView = new DiffView(dom.diffRoot, state.diffStyle, { onToggle: (id, isCollapsed) => markFileCollapsed(id, isCollapsed) });
let currentFiles: ParsedFile[] = [];
let renderToken = 0;
let toastTimer: number | undefined;

dom.mergeMethod.value = localStorage.getItem('mergeMethod') ?? 'squash';
syncMergeLabel();

function syncMergeLabel(): void {
  const selectedCount = state.checkedIds.size;
  const baseLabel = isSelectedQueued ? 'Merge when ready' : MERGE_LABELS[dom.mergeMethod.value as MergeMethod];
  const label = selectedCount > 1 ? `${isSelectedQueued ? 'Queue' : 'Merge'} ${selectedCount} selected` : baseLabel;
  dom.merge.innerHTML = `${label} <kbd>⌘</kbd><kbd>↵</kbd>`;
  dom.merge.title = isSelectedQueued ? 'Add to merge queue  ⌘↵' : 'Merge  ⌘↵';
  dom.mergeMethod.hidden = isSelectedQueued;
}

type ToastTone = 'info' | 'success' | 'error';

const TOAST_ICONS: Record<ToastTone, string> = {
  info: '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  success: '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.2 10.3l2.5 2.5 5.1-5.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg viewBox="0 0 20 20" width="18" height="18"><circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 5.8v5.4M10 14.1v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const SUCCESS_PATTERN = /^(approved|merged|queued|copied|added|#\d+ (queued|added))/i;

function toast(message: string, isError = false): void {
  const tone: ToastTone = isError ? 'error' : SUCCESS_PATTERN.test(message) ? 'success' : 'info';
  dom.toast.innerHTML = `<span class="toast-icon">${TOAST_ICONS[tone]}</span><span class="toast-text"></span>`;
  const text = dom.toast.querySelector('.toast-text');
  if (text != null) text.textContent = message;
  dom.toast.className = `show ${tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (dom.toast.className = tone), isError ? 9000 : 4500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

function diffKey(pull: PullRequest): string {
  return `${pull.id}:${pull.updatedAt}`;
}

const bodyCache = new Map<string, Promise<string>>();

function loadBody(pull: PullRequest, isPriority = false): Promise<string> {
  const key = diffKey(pull);
  const cached = bodyCache.get(key);
  if (cached != null) {
    void cached.then((html) => preloadImages(imageUrlsInHtml(html), isPriority), () => undefined);
    return cached;
  }
  const pending = fetchBody(pull).then((html) => {
    preloadImages(imageUrlsInHtml(html), isPriority);
    return html;
  });
  pending.catch(() => bodyCache.delete(key));
  bodyCache.set(key, pending);
  if (bodyCache.size > DIFF_CACHE_LIMIT) bodyCache.delete(bodyCache.keys().next().value ?? '');
  return pending;
}

function loadDiff(pull: PullRequest): Promise<ParsedFile[]> {
  const key = diffKey(pull);
  const cached = diffCache.get(key);
  if (cached != null) return cached;
  const pending = fetchDiff(pull).then((patch) => parseDiff(key, patch));
  pending.catch(() => diffCache.delete(key));
  diffCache.set(key, pending);
  if (diffCache.size > DIFF_CACHE_LIMIT) diffCache.delete(diffCache.keys().next().value ?? '');
  return pending;
}

const SEMANTIC_DEBOUNCE_MS = 450;
const SEMANTIC_MIN_CHARS = 3;
let semanticQuery = '';
let semanticScores = new Map<string, number>();
let isSemanticLoading = false;
let semanticTimer: number | undefined;
let semanticAbort: AbortController | null = null;

function literalMatch(pull: PullRequest, needle: string): boolean {
  return `${pull.title} ${pull.repository.nameWithOwner} #${pull.number} ${pull.author?.login ?? ''} ${pull.headRefName}`.toLowerCase().includes(needle);
}

function matchesText(pull: PullRequest, needle: string): boolean {
  if (needle === '') return true;
  if (literalMatch(pull, needle)) return true;
  return semanticQuery === needle && isSemanticMatch(semanticScores.get(pull.id));
}

function renderSearchState(): void {
  const box = dom.filter.closest('.search');
  box?.classList.toggle('searching', isSemanticLoading);
  const needle = state.filter.trim().toLowerCase();
  const extra = needle !== '' && semanticQuery === needle ? state.pulls.filter((pull) => !literalMatch(pull, needle) && isSemanticMatch(semanticScores.get(pull.id))).length : 0;
  box?.setAttribute('data-hint', isSemanticLoading ? 'Jev…' : extra > 0 ? `+${extra} Jev` : '');
}

function scheduleSemanticSearch(): void {
  window.clearTimeout(semanticTimer);
  semanticAbort?.abort();
  const needle = state.filter.trim().toLowerCase();
  if (!isAiEnabled || needle.length < SEMANTIC_MIN_CHARS || /^#?\d+$/.test(needle)) {
    isSemanticLoading = false;
    renderSearchState();
    return;
  }
  semanticTimer = window.setTimeout(() => {
    const controller = new AbortController();
    semanticAbort = controller;
    isSemanticLoading = true;
    renderSearchState();
    void semanticMatches(needle, state.pulls, controller.signal)
      .then((scores) => {
        if (controller.signal.aborted || state.filter.trim().toLowerCase() !== needle) return;
        semanticQuery = needle;
        semanticScores = scores;
        renderList();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn('semantic search failed', errorMessage(error));
      })
      .finally(() => {
        if (semanticAbort === controller) {
          isSemanticLoading = false;
          renderSearchState();
        }
      });
  }, SEMANTIC_DEBOUNCE_MS);
}

function filteredPulls(): PullRequest[] {
  const needle = state.filter.trim().toLowerCase();
  const now = Date.now();
  const matching = state.pulls.filter((pull) => matchesSmartFilter(pull, state.smartFilter, now) && matchesText(pull, needle));
  return sortPulls(matching, state.sortOrder, now, aiScoreFor);
}

function visiblePulls(): PullRequest[] {
  const pulls = filteredPulls();
  if (!isGrouped || groups.length === 0) return pulls;
  return listSections(pulls).flatMap((section) => (section.group != null && collapsedGroups.has(section.group.id) ? [] : section.pulls));
}

function renderSmartCounts(): void {
  const now = Date.now();
  const counts: Record<SmartFilter, number> = {
    all: state.pulls.length,
    ready: state.pulls.filter(isReady).length,
    small: state.pulls.filter(isSmall).length,
    recent: state.pulls.filter((pull) => isRecent(pull, now)).length,
  };
  dom.filterBar.querySelectorAll<HTMLElement>('[data-smart-count]').forEach((badge) => (badge.textContent = String(counts[badge.dataset.smartCount as SmartFilter])));
  dom.filterBar.querySelectorAll<HTMLElement>('[data-smart]').forEach((chip) => chip.classList.toggle('active', chip.dataset.smart === state.smartFilter));
  dom.sort.value = state.sortOrder;
}

function selectedPull(): PullRequest | undefined {
  return state.pulls.find((pull) => pull.id === state.selectedId);
}

function queueLabel(pull: PullRequest): string {
  const entry = pull.queueEntry;
  if (entry == null) return '';
  const phase = entry.state === 'AWAITING_CHECKS' ? 'running checks' : entry.state === 'MERGEABLE' ? 'merging' : entry.state === 'UNMERGEABLE' ? 'failed' : entry.state.toLowerCase().replace(/_/g, ' ');
  return `In merge queue · #${entry.position + 1} · ${phase}`;
}

function statusIcon(pull: PullRequest): string {
  if (pull.queueEntry != null) return `<span class="status queued" title="${escapeHtml(queueLabel(pull))}"></span>`;
  if (pull.isDraft) return '<span class="status draft" title="Draft"></span>';
  if (pull.mergeable === 'CONFLICTING') return '<span class="status conflict" title="Conflicts"></span>';
  if (pull.reviewDecision === 'APPROVED') return '<span class="status approved" title="Approved"></span>';
  if (pull.reviewDecision === 'CHANGES_REQUESTED') return '<span class="status changes" title="Changes requested"></span>';
  return '<span class="status open" title="Open"></span>';
}

function checksIcon(pull: PullRequest): string {
  switch (pull.checkState) {
    case 'SUCCESS':
      return '<span class="check ok" title="Checks passed">✓</span>';
    case 'FAILURE':
    case 'ERROR':
      return '<span class="check bad" title="Checks failed">✕</span>';
    case 'PENDING':
    case 'EXPECTED':
      return '<span class="check wait" title="Checks running">◌</span>';
    case null:
      return '';
    default:
      return pull.checkState satisfies never;
  }
}

function readinessDot(pull: PullRequest): string {
  const score = aiScoreFor(pull);
  if (score == null) return '';
  const percent = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const toneName = percent >= 65 ? 'ok' : percent >= 40 ? 'wait' : 'bad';
  return `<span class="ai-score ${toneName}" title="Jev readiness ${percent}%">${percent}</span>`;
}

function avatar(pull: PullRequest): string {
  const url = pull.author?.avatarUrl;
  return url == null ? '<span class="avatar"></span>' : `<img class="avatar" src="${escapeHtml(url)}&s=40" alt="" loading="lazy" />`;
}

function repoName(pull: PullRequest): string {
  return pull.repository.nameWithOwner.split('/')[1] ?? pull.repository.nameWithOwner;
}

function mostCommonRepo(): string | undefined {
  const counts = new Map<string, number>();
  state.pulls.forEach((pull) => counts.set(pull.repository.nameWithOwner, (counts.get(pull.repository.nameWithOwner) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function repoTag(pull: PullRequest, primaryRepo: string | undefined): string {
  if (pull.repository.nameWithOwner === primaryRepo) return '';
  return `<span class="repo-tag">${escapeHtml(repoName(pull).replace(/^terraform-provider-/, 'tf-'))}</span>`;
}

function renderCounts(): void {
  document.querySelectorAll<HTMLElement>('[data-count]').forEach((badge) => {
    const pulls = queueCache.get(badge.dataset.count as QueueKind);
    badge.textContent = pulls == null ? '' : String(pulls.length);
  });
}

const GROUPS_CACHE_KEY = 'jevGroups.v2';
let isGrouped = localStorage.getItem('grouped') === '1';
let groups: PullGroup[] = [];
let groupsSignature = '';
let isGrouping = false;
const collapsedGroups = new Set<string>(JSON.parse(localStorage.getItem('collapsedGroups') ?? '[]') as string[]);

function pullsSignature(pulls: readonly PullRequest[]): string {
  return pulls.map((pull) => pull.id).sort().join(',');
}

function loadCachedGroups(pulls: readonly PullRequest[]): void {
  try {
    const cached = JSON.parse(localStorage.getItem(GROUPS_CACHE_KEY) ?? 'null') as { signature: string; groups: PullGroup[] } | null;
    if (cached?.signature === pullsSignature(pulls)) {
      groups = cached.groups;
      groupsSignature = cached.signature;
    }
  } catch {
    groups = [];
  }
}

async function ensureGroups(isUserInitiated = false): Promise<void> {
  const signature = pullsSignature(state.pulls);
  if (!isGrouped || !isAiEnabled || isGrouping || signature === groupsSignature || state.pulls.length < 2) return;
  loadCachedGroups(state.pulls);
  if (groupsSignature === signature) return renderList();
  isGrouping = true;
  renderList();
  try {
    groups = await groupPulls(state.pulls);
    groupsSignature = signature;
    localStorage.setItem(GROUPS_CACHE_KEY, JSON.stringify({ signature, groups }));
    if (isUserInitiated) toast(`Grouped related work into ${groups.length} group${groups.length === 1 ? '' : 's'}`);
  } catch (error) {
    if (isUserInitiated) toast(`Grouping failed: ${errorMessage(error)}`, true);
    else console.warn('background regroup failed', errorMessage(error));
  } finally {
    isGrouping = false;
    renderList();
  }
}

function toggleGrouping(): void {
  if (!isAiEnabled) {
    toast('Grouping uses Jev. Set OPENROUTER_API_KEY to enable it.', true);
    return;
  }
  isGrouped = !isGrouped;
  localStorage.setItem('grouped', isGrouped ? '1' : '0');
  renderList();
  if (!isGrouped) toast('Grouping off');
  void ensureGroups(true);
}

function averageReadiness(pulls: PullRequest[]): number {
  const now = Date.now();
  const scores = pulls.map((pull) => aiScoreFor(pull) ?? (isReady(pull) ? 0.6 : 0.2) - Math.min(0.2, (now - Date.parse(pull.updatedAt)) / 8.64e8));
  return scores.reduce((total, score) => total + score, 0) / Math.max(1, scores.length);
}

interface ListSection {
  group: PullGroup | null;
  pulls: PullRequest[];
}

function listSections(pulls: PullRequest[]): ListSection[] {
  if (!isGrouped || groups.length === 0) return [{ group: null, pulls }];
  const order = new Map(pulls.map((pull, index) => [pull.id, index]));
  const assigned = new Set<string>();
  const sections = groups
    .map((group): ListSection => {
      const members = group.pullIds.filter((id) => order.has(id)).sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
      members.forEach((id) => assigned.add(id));
      return { group, pulls: members.map((id) => pulls[order.get(id) ?? 0] as PullRequest) };
    })
    .filter((section) => section.pulls.length > 0)
    .sort((left, right) => averageReadiness(right.pulls) - averageReadiness(left.pulls));
  const rest = pulls.filter((pull) => !assigned.has(pull.id));
  if (rest.length > 0) sections.push({ group: { id: 'ungrouped', label: 'Other', pullIds: rest.map((pull) => pull.id) }, pulls: rest });
  return sections;
}

function groupHeader(section: ListSection): string {
  const group = section.group;
  if (group == null) return '';
  const isCollapsed = collapsedGroups.has(group.id);
  const ready = section.pulls.filter(isReady).length;
  const lines = section.pulls.reduce((total, pull) => total + pull.additions + pull.deletions, 0);
  const readiness = Math.round(Math.max(0, Math.min(1, averageReadiness(section.pulls))) * 100);
  return `<li class="group-row${isCollapsed ? ' collapsed' : ''}" data-group="${escapeHtml(group.id)}">
    <span class="caret">›</span>
    <span class="group-label" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
    <span class="group-meta"><span class="group-count">${section.pulls.length}</span>${ready > 0 ? `<span class="group-ready" title="${ready} ready to merge"><i class="dot-ok"></i>${ready}</span>` : ''}<span class="group-lines">${lines.toLocaleString()} lines</span>${isAiEnabled ? `<span class="ai-score ${readiness >= 65 ? 'ok' : readiness >= 40 ? 'wait' : 'bad'}" title="Average readiness">${readiness}</span>` : ''}
    <button class="group-select" data-group-select="${escapeHtml(group.id)}" title="Select all in group">Select</button></span>
  </li>`;
}

function renderList(): void {
  const pulls = filteredPulls();
  const primaryRepo = mostCommonRepo();
  const sections = listSections(pulls);
  const groupingNote = !isGrouped ? '' : isGrouping ? '<li class="group-status"><span class="spinner"></span>Grouping related work with Jev…</li>' : groups.length === 0 ? '<li class="group-status">No groups yet · press T again or run “Regroup with Jev”</li>' : '';
  dom.list.classList.toggle('grouped', isGrouped && groups.length > 0);
  dom.list.innerHTML = groupingNote + sections.map((section) => groupHeader(section) + (section.group != null && collapsedGroups.has(section.group.id) ? '' : section.pulls
    .map(
      (pull) => `<li data-id="${pull.id}" class="${pull.id === state.selectedId ? 'selected' : ''}${state.checkedIds.has(pull.id) ? ' checked' : ''}${pull.queueEntry != null ? ' queued' : ''}">
        <span class="check-box" data-check="${pull.id}" role="checkbox" aria-checked="${state.checkedIds.has(pull.id)}" title="Select  E / ⇧V"></span>
        ${statusIcon(pull)}
        <span class="id" title="${escapeHtml(pull.repository.nameWithOwner)}">${repoTag(pull, primaryRepo)}#${pull.number}</span>
        <span class="t">${escapeHtml(pull.title)}${state.filter.trim() !== '' && !literalMatch(pull, state.filter.trim().toLowerCase()) && isSemanticMatch(semanticScores.get(pull.id)) ? '<span class="jev-match" title="Matched by Jev">Jev</span>' : ''}</span>
        <span class="right">${pull.queueEntry != null ? `<span class="queue-pill" title="${escapeHtml(queueLabel(pull))}">Queued</span>` : ''}${readinessDot(pull)}${checksIcon(pull)}<span class="delta"><i class="add">+${pull.additions}</i> <i class="del">−${pull.deletions}</i></span><span class="age">${relativeTime(pull.updatedAt)}</span>${avatar(pull)}</span>
      </li>`,
    )
    .join(''))).join('');
  document.getElementById('toggle-grouping')?.classList.toggle('active', isGrouped);
  renderCounts();
  renderSmartCounts();
  renderBulkBar();
  if (pulls.length > 0) return;
  dom.pr.hidden = true;
  dom.empty.hidden = false;
  dom.empty.textContent = state.pulls.length === 0 ? 'No pull requests here.' : 'No matches.';
}

function mergeState(pull: PullRequest): { label: string; tone: string } {
  if (pull.queueEntry != null) return { label: pull.queueEntry.state === 'UNMERGEABLE' ? 'Queue failed' : `In merge queue #${pull.queueEntry.position + 1}`, tone: pull.queueEntry.state === 'UNMERGEABLE' ? 'bad' : 'wait' };
  if (pull.isDraft) return { label: 'Draft', tone: 'muted' };
  if (pull.mergeable === 'CONFLICTING') return { label: 'Conflicts', tone: 'bad' };
  switch (pull.mergeStateStatus) {
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { label: 'Ready', tone: 'ok' };
    case 'UNSTABLE':
      return { label: 'Checks failing', tone: 'wait' };
    case 'BLOCKED':
      return { label: 'Blocked', tone: 'bad' };
    case 'BEHIND':
      return { label: 'Behind base', tone: 'wait' };
    default:
      return { label: 'Checking…', tone: 'muted' };
  }
}

function reviewLabel(pull: PullRequest): { label: string; tone: string } {
  switch (pull.reviewDecision) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'ok' };
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', tone: 'bad' };
    case 'REVIEW_REQUIRED':
      return { label: 'Review required', tone: 'wait' };
    case null:
      return { label: 'None', tone: 'muted' };
    default:
      return pull.reviewDecision satisfies never;
  }
}

function checksLabel(pull: PullRequest): { label: string; tone: string } {
  switch (pull.checkState) {
    case 'SUCCESS':
      return { label: 'Passing', tone: 'ok' };
    case 'FAILURE':
    case 'ERROR':
      return { label: 'Failing', tone: 'bad' };
    case 'PENDING':
    case 'EXPECTED':
      return { label: 'Running', tone: 'wait' };
    case null:
      return { label: 'None', tone: 'muted' };
    default:
      return pull.checkState satisfies never;
  }
}



function descriptionHtml(bodyHtml: string): string {
  return bodyHtml.trim() === '' ? '<p class="muted">No description provided.</p>' : sanitizeHtml(bodyHtml);
}

function renderDescription(pull: PullRequest): HTMLElement {
  const wrapper = document.createElement('article');
  wrapper.className = 'description';
  const body = '<p class="muted loading-body">Loading description…</p>';
  wrapper.innerHTML = `
    <h1>${escapeHtml(pull.title)}</h1>
    <div class="byline">${avatar(pull)}<b>${escapeHtml(pull.author?.login ?? 'ghost')}</b> opened ${relativeTime(pull.createdAt)} ago · <code>${escapeHtml(pull.headRefName)}</code> → <code>${escapeHtml(pull.baseRefName)}</code></div>
    <div class="markdown">${body}</div>
    <div class="files-divider"><span>${pull.changedFiles} files changed</span><span><i class="add">+${pull.additions}</i> <i class="del">−${pull.deletions}</i></span></div>`;
  return wrapper;
}


function chip(content: string, title: string, className = ''): string {
  return `<span class="chip-meta ${className}" title="${escapeHtml(title)}">${content}</span>`;
}

function toneChip({ label, tone: toneName }: { label: string; tone: string }, title: string): string {
  return chip(`<i class="dot-${toneName}"></i>${escapeHtml(label)}`, title, `tone-${toneName}`);
}

function readinessChip(pull: PullRequest): string {
  if (!isAiEnabled) return '';
  const result = aiResults.get(aiKey(pull));
  if (result == null) return chip(aiPending.has(aiKey(pull)) ? '<span class="spinner"></span>Jev' : 'Jev —', 'Jev readiness');
  const percent = Math.round(Math.max(0, Math.min(1, result.score)) * 100);
  const toneName = percent >= 65 ? 'ok' : percent >= 40 ? 'wait' : 'bad';
  const detail = `Jev readiness ${percent}% · ${result.reason}\nevidence ${Math.round(result.evidence * 100)} · open concerns ${Math.round(result.blocker * 100)} · risk ${Math.round(result.risk * 100)} · scope ${Math.round(result.scope * 100)}`;
  return chip(`<b>${percent}</b><span class="reason">${escapeHtml(result.reason)}</span>`, detail, `readiness tone-${toneName}`);
}

function renderDetailMeta(pull: PullRequest): void {
  const checks = checksLabel(pull);
  const review = reviewLabel(pull);
  const merge = mergeState(pull);
  dom.statusBar.innerHTML = [
    readinessChip(pull),
    toneChip(merge, `Merge status: ${merge.label}`),
    review.tone === 'muted' ? '' : toneChip(review, `Review: ${review.label}`),
    checks.tone === 'muted' ? '' : toneChip(checks, `Checks: ${checks.label}`),
    '<span class="meta-sep"></span>',
    chip(`${avatar(pull)}${escapeHtml(pull.author?.login ?? 'ghost')}`, 'Author', 'plain'),
    chip(`<code>${escapeHtml(pull.headRefName)}</code><span class="arrow">→</span><code>${escapeHtml(pull.baseRefName)}</code>`, `${pull.headRefName} → ${pull.baseRefName}`, 'plain branch'),
    chip(`<i class="add">+${pull.additions}</i><i class="del">−${pull.deletions}</i>`, `${pull.changedFiles} files changed`, 'plain delta'),
    chip(relativeTime(pull.updatedAt), `Updated ${relativeTime(pull.updatedAt)} ago`, 'plain muted-chip'),
  ].join('');
  dom.merge.disabled = pull.isDraft || pull.mergeable === 'CONFLICTING' || pull.queueEntry != null;
  if (pull.queueEntry != null) dom.merge.innerHTML = `In queue #${pull.queueEntry.position + 1}`;
}

function syncQueueState(pull: PullRequest): void {
  isSelectedQueued = false;
  syncMergeLabel();
  void usesMergeQueue(pull).then((isQueued) => {
    if (selectedPull()?.id !== pull.id) return;
    isSelectedQueued = isQueued;
    syncMergeLabel();
  });
}

function renderDetail(pull: PullRequest): void {
  syncQueueState(pull);
  dom.crumbs.innerHTML = `<span class="repo" title="${escapeHtml(pull.repository.nameWithOwner)}">${escapeHtml(repoName(pull))}</span><span class="sep">›</span><a class="cur pr-link" href="${escapeHtml(pull.url)}" title="Open on GitHub  O">#${pull.number}</a>`;
  renderDetailMeta(pull);
  const description = renderDescription(pull);
  if (reviewMode === 'side') {
    dom.descPane.replaceChildren(description);
    diffView.setHeader(undefined);
  } else {
    dom.descPane.replaceChildren();
    diffView.setHeader(description);
  }
  const token = renderToken;
  void loadBody(pull, true).then(
    (bodyHtml) => {
      if (token !== renderToken) return;
      const target = description.querySelector('.markdown');
      if (target != null) target.innerHTML = descriptionHtml(bodyHtml);
    },
    (error: unknown) => {
      if (token !== renderToken) return;
      const target = description.querySelector('.markdown');
      if (target != null) target.innerHTML = `<p class="error">Could not load description: ${escapeHtml(errorMessage(error))}</p>`;
    },
  );
}

function fileLabel(file: ParsedFile): string {
  const slash = file.diff.name.lastIndexOf('/');
  const directory = slash >= 0 ? file.diff.name.slice(0, slash + 1) : '';
  return `<span class="base">${escapeHtml(file.diff.name.slice(slash + 1))}</span><span class="dir">${escapeHtml(directory)}</span>`;
}

let isFilesCollapsed = localStorage.getItem('filesCollapsed') === '1';

function applyFilesCollapsed(): void {
  document.querySelector('.file-tree')?.classList.toggle('collapsed', isFilesCollapsed);
  const title = document.querySelector('.file-tree .section-title');
  title?.setAttribute('aria-expanded', String(!isFilesCollapsed));
}

function toggleFilesSection(): void {
  isFilesCollapsed = !isFilesCollapsed;
  localStorage.setItem('filesCollapsed', isFilesCollapsed ? '1' : '0');
  applyFilesCollapsed();
}

function renderFiles(files: ParsedFile[]): void {
  dom.fileCount.textContent = String(files.length);
  dom.files.innerHTML = files
    .map(
      (file, index) => `<button data-index="${index}" data-id="${escapeHtml(file.id)}" class="file ${file.diff.type}${diffView.isCollapsed(file.id) ? ' collapsed' : ''}" title="${escapeHtml(file.diff.name)}">
        <span class="name">${fileLabel(file)}</span><span class="counts"><i class="add">+${file.additions}</i><i class="del">−${file.deletions}</i></span>
      </button>`,
    )
    .join('');
  syncToggleAll();
}

function markFileCollapsed(id: string, isCollapsed: boolean): void {
  dom.files.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.toggle('collapsed', isCollapsed);
  syncToggleAll();
}

function syncToggleAll(): void {
  const isAllCollapsed = currentFiles.length > 0 && diffView.collapsedCount() === currentFiles.length;
  dom.toggleAll.innerHTML = `${isAllCollapsed ? 'Expand all' : 'Collapse all'} <kbd>⇧</kbd><kbd>C</kbd>`;
}

function setActiveFile(index: number): void {
  const file = currentFiles[index];
  if (file == null) return;
  state.activeFileIndex = index;
  dom.files.querySelector('.active')?.classList.remove('active');
  const button = dom.files.querySelector<HTMLElement>(`[data-index="${index}"]`);
  button?.classList.add('active');
  button?.scrollIntoView({ block: 'nearest' });
  if (diffView.isCollapsed(file.id)) diffView.toggle(file.id, false);
  diffView.scrollToFile(file.id);
}

function prefetchAround(pull: PullRequest): void {
  const pulls = visiblePulls();
  const index = pulls.findIndex((candidate) => candidate.id === pull.id);
  const neighbours = [...pulls.slice(index + 1, index + 1 + PREFETCH_AHEAD), ...(index > 0 ? [pulls[index - 1]] : [])];
  window.setTimeout(
    () =>
      neighbours.forEach((candidate) => {
        if (candidate == null) return;
        void loadDiff(candidate).catch(() => undefined);
        void loadBody(candidate).catch(() => undefined);
      }),
    120,
  );
}

async function select(pull: PullRequest): Promise<void> {
  const token = ++renderToken;
  state.selectedId = pull.id;
  state.activeFileIndex = -1;
  dom.list.querySelector('.selected')?.classList.remove('selected');
  const row = dom.list.querySelector<HTMLElement>(`[data-id="${pull.id}"]`);
  row?.classList.add('selected');
  row?.scrollIntoView({ block: 'nearest' });
  dom.empty.hidden = true;
  dom.pr.hidden = false;
  currentFiles = [];
  diffView.show([]);
  renderDetail(pull);
  dom.files.innerHTML = '<div class="muted pad">Loading…</div>';
  prefetchAround(pull);
  try {
    const files = await loadDiff(pull);
    if (token !== renderToken) return;
    currentFiles = files;
    diffView.show(files);
    renderFiles(files);
  } catch (error) {
    if (token !== renderToken) return;
    dom.files.innerHTML = `<div class="error pad">${escapeHtml(errorMessage(error))}</div>`;
  }
}

function movePull(delta: number): void {
  const pulls = visiblePulls();
  if (pulls.length === 0) return;
  const index = pulls.findIndex((pull) => pull.id === state.selectedId);
  const next = pulls[Math.min(pulls.length - 1, Math.max(0, index + delta))];
  if (next != null && next.id !== state.selectedId) void select(next);
  if (next != null && visualAnchorId != null) {
    state.selectedId = next.id;
    syncVisualRange();
  }
}

const LIST_PAGE_ROWS = 10;
const DIFF_LINE_PX = 60;

function listPageSize(): number {
  const rowHeight = dom.list.querySelector<HTMLElement>('li')?.offsetHeight ?? 40;
  return Math.max(1, Math.floor(dom.list.clientHeight / rowHeight / 2)) || LIST_PAGE_ROWS;
}

function jumpPull(position: 'first' | 'last'): void {
  const pulls = visiblePulls();
  const target = position === 'first' ? pulls[0] : pulls.at(-1);
  if (target != null && target.id !== state.selectedId) void select(target);
}

type PaneTarget = 'list' | 'middle' | 'right';
type VimMotion = 'half-down' | 'half-up' | 'page-down' | 'page-up' | 'line-down' | 'line-up' | 'top' | 'bottom';

const PANE_MODIFIER: Record<PaneTarget, string> = { list: '⌃', middle: '⌥', right: '⌘' };
const PANE_LABEL: Record<PaneTarget, string> = { list: 'list', middle: 'middle pane', right: 'right pane' };
const MOTION_KEYS: Record<VimMotion, string> = { 'half-down': 'd', 'half-up': 'u', 'page-down': 'f', 'page-up': 'b', 'line-down': 'e', 'line-up': 'y', top: 'g', bottom: '⇧g' };
const MOTION_TITLE: Record<VimMotion, string> = { 'half-down': 'Half page down', 'half-up': 'Half page up', 'page-down': 'Page down', 'page-up': 'Page up', 'line-down': 'Scroll down', 'line-up': 'Scroll up', top: 'Top', bottom: 'Bottom' };
const SKIPPED_MOTIONS: Partial<Record<PaneTarget, VimMotion[]>> = { right: ['page-down', 'page-up'] };
const EXTRA_MOTION_KEYS: Partial<Record<PaneTarget, Partial<Record<VimMotion, string[]>>>> = {
  list: { 'line-down': ['⌃n'], 'line-up': ['⌃p'] },
  middle: { 'line-down': ['⌥j'], 'line-up': ['⌥k'] },
};

function paneElement(pane: Exclude<PaneTarget, 'list'>): HTMLElement {
  if (reviewMode === 'side') return pane === 'middle' ? dom.descPane : dom.diffRoot;
  return pane === 'middle' ? dom.diffRoot : dom.files;
}

function scrollPane(pane: Exclude<PaneTarget, 'list'>, motion: VimMotion): void {
  const target = paneElement(pane);
  const page = target.clientHeight;
  const deltas: Record<VimMotion, number> = {
    'half-down': page * 0.5, 'half-up': -page * 0.5, 'page-down': page * 0.9, 'page-up': -page * 0.9,
    'line-down': DIFF_LINE_PX, 'line-up': -DIFF_LINE_PX, top: -target.scrollHeight, bottom: target.scrollHeight,
  };
  if (target === dom.diffRoot) diffView.scrollBy(deltas[motion]);
  else target.scrollTop = Math.max(0, Math.min(target.scrollHeight - target.clientHeight, target.scrollTop + deltas[motion]));
}

function moveList(motion: VimMotion): void {
  const half = listPageSize();
  const steps: Record<VimMotion, number> = { 'half-down': half, 'half-up': -half, 'page-down': half * 2, 'page-up': -half * 2, 'line-down': 1, 'line-up': -1, top: -Infinity, bottom: Infinity };
  const step = steps[motion];
  if (step === -Infinity) return jumpPull('first');
  if (step === Infinity) return jumpPull('last');
  movePull(step);
}

function vimCommands(): Command[] {
  const panes: PaneTarget[] = ['list', 'middle', 'right'];
  const motions = Object.keys(MOTION_KEYS) as VimMotion[];
  return panes.flatMap((pane) =>
    motions.filter((motion) => !(SKIPPED_MOTIONS[pane] ?? []).includes(motion)).map((motion): Command => ({
      id: `vim-${pane}-${motion}`,
      section: `Vim · ${PANE_LABEL[pane]} (${PANE_MODIFIER[pane]})`,
      title: `${MOTION_TITLE[motion]} in ${PANE_LABEL[pane]}`,
      aliases: 'vim scroll',
      keys: [`${PANE_MODIFIER[pane]}${MOTION_KEYS[motion]}`, ...(EXTRA_MOTION_KEYS[pane]?.[motion] ?? [])],
      run: () => (pane === 'list' ? moveList(motion) : scrollPane(pane, motion)),
      isEnabled: pane === 'list' ? undefined : hasPull,
    })),
  );
}

function moveFile(delta: number): void {
  if (currentFiles.length === 0) return;
  setActiveFile(Math.min(currentFiles.length - 1, Math.max(0, state.activeFileIndex + delta)));
}

function toggleCurrentFile(): void {
  const file = currentFiles[Math.max(0, state.activeFileIndex)];
  if (file != null) diffView.toggle(file.id);
}

function toggleAllFiles(): void {
  diffView.setAllCollapsed(diffView.collapsedCount() !== currentFiles.length);
}

const mergeStateCache = new Map<string, { updatedAt: string; state: MergeState }>();

const AI_CONCURRENCY = 4;
const AI_CACHE_KEY = 'jevReadiness.v1';
const aiResults = new Map<string, ReadinessResult>(Object.entries(JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}') as Record<string, ReadinessResult>));
const aiPending = new Set<string>();
let isAiEnabled = false;
let aiRenderFrame = 0;

function aiKey(pull: PullRequest): string {
  return `${pull.id}:${pull.updatedAt}`;
}

function aiScoreFor(pull: PullRequest): number | undefined {
  return isAiEnabled ? aiResults.get(aiKey(pull))?.score : undefined;
}

function persistAiResults(): void {
  const live = new Set(state.pulls.map(aiKey));
  const kept = Object.fromEntries([...aiResults.entries()].filter(([key]) => live.has(key)).slice(-400));
  localStorage.setItem(AI_CACHE_KEY, JSON.stringify(kept));
}

function scheduleAiRender(): void {
  cancelAnimationFrame(aiRenderFrame);
  aiRenderFrame = requestAnimationFrame(() => {
    const selectedRow = dom.list.querySelector<HTMLElement>('li.selected');
    const offset = selectedRow == null ? null : selectedRow.offsetTop - dom.list.scrollTop;
    renderList();
    const nextRow = dom.list.querySelector<HTMLElement>('li.selected');
    if (offset != null && nextRow != null) dom.list.scrollTop = nextRow.offsetTop - offset;
    const pull = selectedPull();
    if (pull != null) renderDetailMeta(pull);
    renderAiStatus();
  });
}

function renderAiStatus(): void {
  const badge = document.getElementById('ai-status');
  if (badge == null) return;
  if (!isAiEnabled) {
    badge.textContent = 'Rules';
    badge.title = 'Built-in rules · set OPENROUTER_API_KEY for Jev';
    badge.className = 'ai-status off';
    return;
  }
  const scored = state.pulls.filter((pull) => aiResults.has(aiKey(pull))).length;
  badge.textContent = aiPending.size > 0 ? `Jev ${scored}/${state.pulls.length}` : 'Jev';
  badge.title = 'Smart sort ranks by Jev readiness via OpenRouter';
  badge.className = aiPending.size > 0 ? 'ai-status busy' : 'ai-status on';
}

async function scoreWithJev(pulls: PullRequest[]): Promise<void> {
  if (!isAiEnabled) return;
  const queue = pulls.filter((pull) => !pull.isDraft && !aiResults.has(aiKey(pull)) && !aiPending.has(aiKey(pull)));
  queue.forEach((pull) => aiPending.add(aiKey(pull)));
  renderAiStatus();
  const worker = async (): Promise<void> => {
    for (let pull = queue.shift(); pull != null; pull = queue.shift()) {
      const key = aiKey(pull);
      try {
        aiResults.set(key, await assessReadiness(pull));
      } catch (error) {
        console.warn('jev readiness failed', pull.number, errorMessage(error));
      } finally {
        aiPending.delete(key);
        scheduleAiRender();
      }
    }
  };
  await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
  persistAiResults();
}
let mergeStateRenderFrame = 0;

function applyMergeStates(kind: QueueKind, states: MergeState[]): void {
  const byId = new Map(states.map((mergeState) => [mergeState.id, mergeState]));
  const pulls = queueCache.get(kind);
  if (pulls == null) return;
  const updated = pulls.map((pull) => {
    const mergeState = byId.get(pull.id);
    if (mergeState == null) return pull;
    mergeStateCache.set(pull.id, { updatedAt: pull.updatedAt, state: mergeState });
    return { ...pull, mergeable: mergeState.mergeable, mergeStateStatus: mergeState.mergeStateStatus };
  });
  queueCache.set(kind, updated);
  if (kind !== state.kind) return;
  state.pulls = updated;
  cancelAnimationFrame(mergeStateRenderFrame);
  mergeStateRenderFrame = requestAnimationFrame(() => {
    renderList();
    const pull = selectedPull();
    if (pull != null) renderDetailMeta(pull);
  });
}

function loadMergeStates(kind: QueueKind, pulls: PullRequest[]): Promise<void> {
  const stale = pulls.filter((pull) => mergeStateCache.get(pull.id)?.updatedAt !== pull.updatedAt).map((pull) => pull.id);
  if (stale.length === 0) return Promise.resolve();
  return fetchMergeStates(stale, (states) => applyMergeStates(kind, states));
}

const inFlight = new Map<QueueKind, Promise<void>>();
const lastFetchedAt = new Map<QueueKind, number>();
const MIN_REFRESH_GAP_MS = 20_000;

let refreshTicker: number | undefined;

function renderRefreshStatus(): void {
  const status = document.getElementById('refresh-status');
  const button = document.getElementById('refresh-button');
  const isLoading = inFlight.has(state.kind);
  button?.classList.toggle('spinning', isLoading);
  document.getElementById('list-pane')?.classList.toggle('loading', isLoading);
  status?.classList.toggle('active', isLoading);
  if (status == null) return;
  if (isLoading) {
    status.textContent = 'Refreshing…';
    return;
  }
  const at = lastFetchedAt.get(state.kind);
  if (at == null) {
    status.textContent = '';
    return;
  }
  const seconds = Math.round((Date.now() - at) / 1000);
  status.textContent = seconds < 10 ? 'Just now' : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
  status.title = `Last refreshed ${new Date(at).toLocaleTimeString()}`;
}

function summarizeChange(before: PullRequest[], after: PullRequest[]): string {
  const beforeIds = new Set(before.map((pull) => pull.id));
  const afterIds = new Set(after.map((pull) => pull.id));
  const added = after.filter((pull) => !beforeIds.has(pull.id)).length;
  const removed = before.filter((pull) => !afterIds.has(pull.id)).length;
  const beforeById = new Map(before.map((pull) => [pull.id, pull]));
  const updated = after.filter((pull) => {
    const previous = beforeById.get(pull.id);
    return previous != null && previous.updatedAt !== pull.updatedAt;
  }).length;
  const parts = [added > 0 ? `${added} new` : '', removed > 0 ? `${removed} closed or merged` : '', updated > 0 ? `${updated} updated` : ''].filter((part) => part !== '');
  return parts.length === 0 ? `Up to date · ${after.length} PRs` : `Refreshed · ${parts.join(' · ')}`;
}

function manualRefresh(): void {
  const before = queueCache.get(state.kind) ?? [];
  const kind = state.kind;
  const started = Date.now();
  if (inFlight.has(kind)) {
    toast('Already refreshing…');
    return;
  }
  toast('Refreshing pull requests…');
  const pending = refresh(kind, true);
  renderRefreshStatus();
  void pending.then(() => {
    if (kind !== state.kind || !lastFetchedAt.has(kind) || (lastFetchedAt.get(kind) ?? 0) < started) return;
    toast(summarizeChange(before, queueCache.get(kind) ?? []));
  });
}

function refresh(kind: QueueKind, isForced = false): Promise<void> {
  const running = inFlight.get(kind);
  if (running != null) return running;
  if (!isForced && Date.now() - (lastFetchedAt.get(kind) ?? 0) < MIN_REFRESH_GAP_MS) return Promise.resolve();
  const pending = fetchQueue(kind)
    .then((pulls) => {
      lastFetchedAt.set(kind, Date.now());
      const merged = pulls.map((pull) => mergeStateCache.get(pull.id)?.updatedAt === pull.updatedAt ? { ...pull, ...mergeStateCache.get(pull.id)?.state } : pull);
      queueCache.set(kind, merged);
      renderCounts();
      if (kind === state.kind) applyQueue(merged);
      if (kind === state.kind) void scoreWithJev(merged);
      if (kind === state.kind) void ensureGroups();
      void loadMergeStates(kind, merged).catch((error: unknown) => console.warn('merge states failed', errorMessage(error)));
    })
    .catch((error: unknown) => {
      if (kind !== state.kind) return;
      toast(`GitHub: ${errorMessage(error).split('\n')[0]}`, true);
      if (state.pulls.length === 0) dom.empty.textContent = `Could not load: ${errorMessage(error)}`;
    })
    .finally(() => {
      inFlight.delete(kind);
      renderRefreshStatus();
    });
  inFlight.set(kind, pending);
  renderRefreshStatus();
  return pending;
}

function applyQueue(pulls: PullRequest[]): void {
  const previous = selectedPull();
  state.pulls = pulls;
  renderList();
  const stillThere = previous == null ? undefined : pulls.find((pull) => pull.id === previous.id);
  if (stillThere != null) {
    if (stillThere.updatedAt !== previous?.updatedAt) void select(stillThere);
    return;
  }
  const first = visiblePulls()[0];
  if (first != null) void select(first);
}

function switchKind(kind: QueueKind): void {
  state.kind = kind;
  state.checkedIds.clear();
  state.selectedId = null;
  dom.viewTitle.textContent = VIEW_TITLES[kind];
  document.querySelectorAll<HTMLButtonElement>('.views button').forEach((button) => button.classList.toggle('active', button.dataset.kind === kind));
  state.pulls = queueCache.get(kind) ?? [];
  renderList();
  const first = visiblePulls()[0];
  if (first != null) void select(first);
  void scoreWithJev(state.pulls);
  renderRefreshStatus();
  groupsSignature = '';
  void ensureGroups();
  void refresh(kind);
}

function checkedPulls(): PullRequest[] {
  return state.pulls.filter((pull) => state.checkedIds.has(pull.id));
}

function renderBulkBar(): void {
  const checked = checkedPulls();
  const hasSelection = checked.length > 0;
  syncMergeLabel();
  dom.bulkBar.hidden = !hasSelection;
  dom.list.classList.toggle('selecting', hasSelection);
  if (!hasSelection) return;
  const readyCount = checked.filter(isReady).length;
  dom.bulkCount.innerHTML = `<b>${checked.length}</b> selected${readyCount < checked.length ? ` · <span class="warn">${checked.length - readyCount} not ready</span>` : ''}`;
  dom.bulkMerge.disabled = checked.every((pull) => pull.isDraft || pull.mergeable === 'CONFLICTING');
}

function setChecked(ids: Iterable<string>, isChecked: boolean): void {
  for (const id of ids) {
    if (isChecked) state.checkedIds.add(id);
    else state.checkedIds.delete(id);
  }
  dom.list.querySelectorAll<HTMLElement>('li').forEach((row) => {
    const isRowChecked = state.checkedIds.has(row.dataset.id ?? '');
    row.classList.toggle('checked', isRowChecked);
    row.querySelector('.check-box')?.setAttribute('aria-checked', String(isRowChecked));
  });
  renderBulkBar();
}

let checkAnchorId: string | null = null;

function toggleChecked(id: string, isRange: boolean): void {
  const pulls = visiblePulls();
  const anchorIndex = pulls.findIndex((pull) => pull.id === checkAnchorId);
  const targetIndex = pulls.findIndex((pull) => pull.id === id);
  if (isRange && anchorIndex >= 0 && targetIndex >= 0) {
    const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    setChecked(pulls.slice(start, end + 1).map((pull) => pull.id), true);
    return;
  }
  checkAnchorId = id;
  setChecked([id], !state.checkedIds.has(id));
}

function toggleCheckedCurrent(isRange: boolean): void {
  if (state.selectedId != null) toggleChecked(state.selectedId, isRange);
}

let visualAnchorId: string | null = null;

function toggleVisualMode(): void {
  if (visualAnchorId != null) {
    visualAnchorId = null;
    dom.list.classList.remove('visual');
    toast(`${state.checkedIds.size} selected`);
    return;
  }
  if (state.selectedId == null) return;
  visualAnchorId = state.selectedId;
  dom.list.classList.add('visual');
  setChecked([state.selectedId], true);
  toast('Visual mode: J/K to extend, ⌘⇧↵ merge, ⇧A approve, Esc to exit');
}

function syncVisualRange(): void {
  if (visualAnchorId == null || state.selectedId == null) return;
  const pulls = visiblePulls();
  const anchor = pulls.findIndex((pull) => pull.id === visualAnchorId);
  const cursor = pulls.findIndex((pull) => pull.id === state.selectedId);
  if (anchor < 0 || cursor < 0) return;
  const [start, end] = anchor < cursor ? [anchor, cursor] : [cursor, anchor];
  const range = new Set(pulls.slice(start, end + 1).map((pull) => pull.id));
  setChecked([...state.checkedIds].filter((id) => !range.has(id)), false);
  setChecked(range, true);
}

function extendSelection(delta: number): void {
  if (state.selectedId == null) return;
  if (!state.checkedIds.has(state.selectedId)) setChecked([state.selectedId], true);
  movePull(delta);
  if (state.selectedId != null) setChecked([state.selectedId], true);
}

function selectAllVisible(): void {
  const pulls = visiblePulls();
  const isAllChecked = pulls.every((pull) => state.checkedIds.has(pull.id));
  setChecked(pulls.map((pull) => pull.id), !isAllChecked);
}

function selectReady(): void {
  setChecked(visiblePulls().filter(isReady).map((pull) => pull.id), true);
}

function clearChecked(): void {
  checkAnchorId = null;
  visualAnchorId = null;
  dom.list.classList.remove('visual');
  setChecked([...state.checkedIds], false);
}

function setSmartFilter(filter: SmartFilter): void {
  state.smartFilter = state.smartFilter === filter && filter !== 'all' ? 'all' : filter;
  localStorage.setItem('smartFilter', state.smartFilter);
  renderList();
  const first = visiblePulls()[0];
  if (first != null && !visiblePulls().some((pull) => pull.id === state.selectedId)) void select(first);
}

function setSortOrder(order: SortOrder): void {
  state.sortOrder = order;
  localStorage.setItem('sortOrder', order);
  renderList();
}

function cycleSortOrder(): void {
  const orders: SortOrder[] = ['smart', 'updated', 'size'];
  const next = orders[(orders.indexOf(state.sortOrder) + 1) % orders.length] ?? 'smart';
  setSortOrder(next);
  toast(`Sort: ${dom.sort.selectedOptions[0]?.textContent ?? next}`);
}

function confirmBulkMerge(pulls: PullRequest[], method: MergeMethod): Promise<boolean> {
  const notReady = pulls.filter((pull) => !isReady(pull)).length;
  dom.bulkConfirmTitle.textContent = `${MERGE_LABELS[method]} ${pulls.length} pull request${pulls.length === 1 ? '' : 's'}?`;
  dom.bulkConfirmList.innerHTML = pulls
    .map((pull) => `<li>${statusIcon(pull)}<span class="id">#${pull.number}</span><span class="t">${escapeHtml(pull.title)}${state.filter.trim() !== '' && !literalMatch(pull, state.filter.trim().toLowerCase()) && isSemanticMatch(semanticScores.get(pull.id)) ? '<span class="jev-match" title="Matched by Jev">Jev</span>' : ''}</span>${isReady(pull) ? '<span class="tone ok"><i></i>Ready</span>' : `<span class="tone wait"><i></i>${escapeHtml(mergeState(pull).label)}</span>`}</li>`)
    .join('');
  dom.bulkConfirmNote.textContent = notReady > 0 ? `${notReady} not ready. GitHub will reject any that branch protection blocks; the rest still merge.` : 'Merged one at a time, in this order. Branch protection and merge queues still apply.';
  dom.bulkConfirm.returnValue = '';
  dom.bulkConfirm.showModal();
  return new Promise((resolve) => dom.bulkConfirm.addEventListener('close', () => resolve(dom.bulkConfirm.returnValue === 'ok'), { once: true }));
}

async function bulkMerge(): Promise<void> {
  const pulls = checkedPulls().filter((pull) => !pull.isDraft && pull.mergeable !== 'CONFLICTING');
  if (pulls.length === 0) return;
  const method = dom.mergeMethod.value as MergeMethod;
  const queueFlags = await Promise.all(pulls.map(usesMergeQueue));
  const isAllQueued = queueFlags.every(Boolean);
  if (!isAllQueued && !(await confirmBulkMerge(pulls, method))) return;
  dom.bulkMerge.disabled = true;
  const failures: string[] = [];
  let merged = 0;
  for (const [index, pull] of pulls.entries()) {
    toast(`${isAllQueued ? 'Queueing' : 'Merging'} ${index + 1}/${pulls.length}: #${pull.number}`);
    try {
      await mergePull(pull, method);
      merged += 1;
      state.checkedIds.delete(pull.id);
      state.pulls = state.pulls.filter((candidate) => candidate.id !== pull.id);
      renderList();
    } catch (error) {
      failures.push(`#${pull.number}: ${errorMessage(error).split('\n')[0]}`);
    }
  }
  const verb = isAllQueued ? 'Queued' : 'Merged';
  toast(failures.length === 0 ? `${verb} ${merged} pull requests` : `${verb} ${merged}, failed ${failures.length} — ${failures.join(' · ')}`, failures.length > 0);
  dom.bulkMerge.disabled = false;
  renderBulkBar();
  void refresh(state.kind);
}

async function bulkApprove(): Promise<void> {
  const pulls = checkedPulls();
  if (pulls.length === 0) return;
  dom.bulkApprove.disabled = true;
  const results = await Promise.allSettled(pulls.map((pull) => approvePull(pull)));
  const failed = results.filter((result) => result.status === 'rejected').length;
  toast(failed === 0 ? `Approved ${pulls.length}` : `Approved ${pulls.length - failed}, failed ${failed}`, failed > 0);
  dom.bulkApprove.disabled = false;
  void refresh(state.kind);
}

async function approveSelected(): Promise<void> {
  const pull = selectedPull();
  if (pull == null || dom.approve.disabled) return;
  dom.approve.disabled = true;
  try {
    await approvePull(pull);
    toast(`Approved #${pull.number}`);
    void refresh(state.kind);
  } catch (error) {
    toast(errorMessage(error), true);
  } finally {
    dom.approve.disabled = false;
  }
}

function confirmMerge(pull: PullRequest, method: MergeMethod): Promise<boolean> {
  dom.confirmTitle.textContent = `${MERGE_LABELS[method]} #${pull.number}?`;
  dom.confirmText.innerHTML = `${escapeHtml(pull.title)}<br><span class="muted">${escapeHtml(pull.headRefName)} → ${escapeHtml(pull.baseRefName)} · ${escapeHtml(pull.repository.nameWithOwner)}</span>`;
  dom.confirm.returnValue = '';
  dom.confirm.showModal();
  return new Promise((resolve) => dom.confirm.addEventListener('close', () => resolve(dom.confirm.returnValue === 'ok'), { once: true }));
}

async function mergeSelected(): Promise<void> {
  const pull = selectedPull();
  if (pull == null || dom.merge.disabled) return;
  const method = dom.mergeMethod.value as MergeMethod;
  const isQueued = await usesMergeQueue(pull);
  if (!isQueued && !(await confirmMerge(pull, method))) return;
  dom.merge.disabled = true;
  try {
    const result = await mergePull(pull, method);
    toast(result.trim().split('\n').at(-1) ?? (isQueued ? `#${pull.number} added to the merge queue` : `Merged #${pull.number}`));
    movePull(1);
    state.pulls = state.pulls.filter((candidate) => candidate.id !== pull.id);
    renderList();
    void refresh(state.kind);
  } catch (error) {
    toast(errorMessage(error), true);
    dom.merge.disabled = false;
  }
}

function toggleStyle(): void {
  state.diffStyle = state.diffStyle === 'split' ? 'unified' : 'split';
  localStorage.setItem('diffStyle', state.diffStyle);
  diffView.setStyle(state.diffStyle);
  toast(state.diffStyle === 'split' ? 'Split view' : 'Unified view');
}

type ReviewMode = 'stacked' | 'side';
let layoutRef: Layout | null = null;
let reviewMode: ReviewMode = localStorage.getItem('reviewMode') === 'stacked' ? 'stacked' : 'side';

function applyReviewMode(): void {
  const isSide = reviewMode === 'side';
  element('app').classList.toggle('mode-side', isSide);
  diffView.setFlush(isSide);
  if (isSide) dom.inspector.append(dom.diffRoot);
  else dom.bodySplit.insertBefore(dom.diffRoot, dom.bodySplit.querySelector('.resizer[data-resize="inspector"]'));
  dom.toggleMode.innerHTML = `${isSide ? 'Stacked' : 'Side by side'} <kbd>V</kbd>`;
  const pull = selectedPull();
  if (pull != null) renderDetail(pull);
  layoutRef?.refit();
}

function toggleReviewMode(): void {
  reviewMode = reviewMode === 'side' ? 'stacked' : 'side';
  localStorage.setItem('reviewMode', reviewMode);
  applyReviewMode();
}

const layout = new Layout(element('app'), () => syncPaneButtons());
layoutRef = layout;
const lightbox = new Lightbox((url) => void openInBrowser(url).catch((error: unknown) => toast(errorMessage(error), true)));

function descriptionRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#pr-body-split .description');
}

function openMedia(index = 0): void {
  const root = descriptionRoot();
  const items = root == null ? [] : collectMedia(root);
  if (!lightbox.open(items, index)) toast('No images, videos or HTML previews in this description');
}

function openMediaFrom(target: HTMLElement): boolean {
  const root = descriptionRoot();
  if (root == null || !root.contains(target)) return false;
  const items = collectMedia(root);
  const index = items.findIndex((item) => item.source === target || item.source.contains(target) || target.contains(item.source));
  if (index < 0) return false;
  return lightbox.open(items, index);
}
const listPane = element('list-pane');
new ResizeObserver(([entry]) => listPane.classList.toggle('narrow', (entry?.contentRect.width ?? 999) < 400)).observe(listPane);
const commands = new CommandRegistry();
const palette = new CommandPalette(commands);
const hasPull = (): boolean => selectedPull() != null;
const hasFiles = (): boolean => currentFiles.length > 0;

function cycleMergeMethod(): void {
  const methods: MergeMethod[] = ['squash', 'merge', 'rebase'];
  const next = methods[(methods.indexOf(dom.mergeMethod.value as MergeMethod) + 1) % methods.length] ?? 'squash';
  dom.mergeMethod.value = next;
  localStorage.setItem('mergeMethod', next);
  syncMergeLabel();
  toast(`Merge method: ${MERGE_LABELS[next]}`);
}

type BrokenReason = 'conflicts' | 'failing checks';

function brokenReasons(pull: PullRequest): BrokenReason[] {
  const reasons: BrokenReason[] = [];
  if (pull.mergeable === 'CONFLICTING' || pull.mergeStateStatus === 'DIRTY') reasons.push('conflicts');
  if (pull.checkState === 'FAILURE' || pull.checkState === 'ERROR') reasons.push('failing checks');
  return reasons;
}

function buildFixPrompt(pulls: PullRequest[]): string {
  const lines = pulls.map((pull) => {
    const reasons = brokenReasons(pull).join(' + ');
    return `- ${pull.url}\n  repo: ${pull.repository.nameWithOwner} · branch: ${pull.headRefName} → ${pull.baseRefName} · problem: ${reasons}\n  title: ${pull.title}`;
  });
  return [
    `Fix these ${pulls.length} open pull request${pulls.length === 1 ? '' : 's'} so each one is green and mergeable again.`,
    '',
    ...lines,
    '',
    'For each pull request:',
    '1. Check out its head branch (`gh pr checkout <url>`), and pull the latest base branch.',
    '2. Merge conflicts: merge or rebase onto the base branch as the repo prefers, resolve every conflict keeping the intent of both sides, and make sure it builds.',
    '3. Failing checks: run `gh pr checks <url>`, open the failing job logs (`gh run view <run-id> --log-failed`), find the root cause, and fix it in the code. Do not skip, disable or loosen tests or lint rules to get green.',
    '4. Run the relevant tests, typecheck and lint locally before pushing.',
    '5. Push to the same branch without force-pushing unless a rebase requires it, then re-check `gh pr checks <url>` until it passes.',
    '',
    'Work through them one at a time. When done, report each PR with what was wrong, what you changed, and its final check status. If one cannot be fixed without a product decision, stop on that PR and explain why instead of guessing.',
  ].join('\n');
}

function copyFixPrompt(): void {
  const scope = state.checkedIds.size > 0 ? checkedPulls() : state.pulls;
  const broken = scope.filter((pull) => brokenReasons(pull).length > 0);
  if (broken.length === 0) {
    toast(state.checkedIds.size > 0 ? 'No conflicts or failing checks in the selection' : 'No PRs with conflicts or failing checks');
    return;
  }
  const conflicts = broken.filter((pull) => brokenReasons(pull).includes('conflicts')).length;
  const failing = broken.filter((pull) => brokenReasons(pull).includes('failing checks')).length;
  void navigator.clipboard.writeText(buildFixPrompt(broken)).then(
    () => toast(`Copied fix prompt for ${broken.length} PR${broken.length === 1 ? '' : 's'} · ${conflicts} conflicted · ${failing} failing`),
    () => toast('Clipboard unavailable', true),
  );
}

function openSelectedOnGitHub(): void {
  const pull = selectedPull();
  if (pull == null) return;
  void openInBrowser(pull.url).then(
    () => toast(`Opened #${pull.number} on GitHub`),
    (error: unknown) => toast(errorMessage(error), true),
  );
}

function copyText(text: string, label: string): void {
  void navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${label}`),
    () => toast('Clipboard unavailable', true),
  );
}

type Theme = 'dark' | 'light' | 'system';
let theme: Theme = (localStorage.getItem('theme') as Theme | null) ?? 'system';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme(): 'dark' | 'light' {
  return theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
}

function applyTheme(): void {
  const resolved = resolvedTheme();
  document.documentElement.dataset.theme = resolved;
  diffView.setThemeType(resolved);
}

function cycleTheme(): void {
  const order: Theme[] = ['system', 'dark', 'light'];
  theme = order[(order.indexOf(theme) + 1) % order.length] ?? 'system';
  localStorage.setItem('theme', theme);
  applyTheme();
  toast(`Theme: ${theme === 'system' ? `system (${resolvedTheme()})` : theme}`);
}

function syncPaneButtons(): void {
  document.getElementById('toggle-sidebar')?.classList.toggle('on', !layout.isHidden('sidebar'));
  document.getElementById('toggle-inspector')?.classList.toggle('on', !layout.isHidden('inspector'));
}

function openHelp(): void {
  let section = '';
  dom.shortcutList.innerHTML = commands
    .list()
    .map((command) => {
      const heading = command.section !== section ? `<h4>${(section = command.section)}</h4>` : '';
      const keys = command.keys.map(renderShortcut).join('<span class="or">or</span>');
      return `${heading}<div class="shortcut"><span>${command.title}</span><span class="keys">${keys}</span></div>`;
    })
    .join('');
  dom.help.showModal();
  dom.help.scrollTop = 0;
  (document.activeElement as HTMLElement | null)?.blur();
}

const VIM_COMMANDS = vimCommands();

const DIFF_SCROLL_COMMANDS: Command[] = [
  { id: 'diff-scroll-down', section: 'Diff', title: 'Scroll diff down', aliases: 'vim line', keys: ['⌘j'], run: () => diffView.scrollBy(DIFF_LINE_PX * 2), isEnabled: hasPull },
  { id: 'diff-scroll-up', section: 'Diff', title: 'Scroll diff up', aliases: 'vim line', keys: ['⌘k'], run: () => diffView.scrollBy(-DIFF_LINE_PX * 2), isEnabled: hasPull },
];

const COMMANDS: Command[] = [
  { id: 'palette', section: 'General', title: 'Open command menu', keys: ['/', '⌘⇧p'], run: () => palette.open() },
  { id: 'help', section: 'General', title: 'Keyboard shortcuts', keys: ['?', '⌘/'], run: openHelp },
  { id: 'filter', section: 'General', title: 'Filter pull requests', keys: ['f', '⌘f'], run: () => dom.filter.focus() },
  { id: 'refresh', section: 'General', title: 'Refresh', keys: ['r', '⌘r'], run: manualRefresh },

  { id: 'smart-all', section: 'Filter', title: 'Show all', aliases: 'clear filter', keys: ['⌥0'], run: () => setSmartFilter('all') },
  { id: 'smart-ready', section: 'Filter', title: 'Show ready to merge', aliases: 'green approved mergeable', keys: ['⌥1'], run: () => setSmartFilter('ready') },
  { id: 'smart-small', section: 'Filter', title: 'Show small diffs', aliases: 'tiny quick', keys: ['⌥2'], run: () => setSmartFilter('small') },
  { id: 'smart-recent', section: 'Filter', title: 'Show recently updated', aliases: 'new fresh', keys: ['⌥3'], run: () => setSmartFilter('recent') },
  { id: 'group', section: 'Filter', title: 'Group related work (Jev)', aliases: 'cluster effort category batch smart group', keys: ['t'], run: toggleGrouping },
  { id: 'regroup', section: 'Filter', title: 'Regroup with Jev', aliases: 'refresh groups cluster', keys: [], run: () => { groupsSignature = ''; localStorage.removeItem(GROUPS_CACHE_KEY); void ensureGroups(true); } },
  { id: 'sort', section: 'Filter', title: 'Cycle sort (smart / updated / smallest)', aliases: 'order', keys: ['⇧s'], run: cycleSortOrder },

  { id: 'visual', section: 'Select', title: 'Visual select mode (vim V)', aliases: 'multi range bulk vim', keys: ['⇧v'], run: toggleVisualMode, isEnabled: hasPull },
  { id: 'check', section: 'Select', title: 'Select / deselect pull request', aliases: 'check bulk multi', keys: ['e'], run: () => toggleCheckedCurrent(false), isEnabled: hasPull },
  { id: 'check-down', section: 'Select', title: 'Extend selection down', keys: ['⇧j', '⇧↓'], run: () => extendSelection(1), isEnabled: hasPull },
  { id: 'check-up', section: 'Select', title: 'Extend selection up', keys: ['⇧k', '⇧↑'], run: () => extendSelection(-1), isEnabled: hasPull },
  { id: 'check-all', section: 'Select', title: 'Select all visible', keys: ['⌘a'], run: selectAllVisible },
  { id: 'check-ready', section: 'Select', title: 'Select all ready', aliases: 'green approved', keys: ['⇧r'], run: selectReady },
  { id: 'check-clear', section: 'Select', title: 'Clear selection', keys: ['esc'], run: clearChecked, isEnabled: () => state.checkedIds.size > 0 },
  { id: 'bulk-approve', section: 'Select', title: 'Approve selected', aliases: 'bulk lgtm', keys: ['⇧a'], run: () => void bulkApprove(), isEnabled: () => state.checkedIds.size > 0 },
  { id: 'bulk-merge', section: 'Select', title: 'Merge selected…', aliases: 'bulk squash ship', keys: ['⌘⇧↵'], run: () => void bulkMerge(), isEnabled: () => state.checkedIds.size > 0 },

  { id: 'view-review', section: 'Views', title: 'Go to Review requested', keys: ['⌘1', 'g r'], run: () => switchKind('review') },
  { id: 'view-involved', section: 'Views', title: 'Go to Involved', keys: ['⌘2', 'g i'], run: () => switchKind('involved') },
  { id: 'view-mine', section: 'Views', title: 'Go to Created by me', keys: ['⌘3', 'g m'], run: () => switchKind('mine') },

  { id: 'review-mode', section: 'Layout', title: 'Toggle side-by-side (description | diff)', aliases: 'split right panel diff sidebar stacked', keys: ['v', '⌘⇧d'], run: toggleReviewMode },
  { id: 'toggle-sidebar', section: 'Layout', title: 'Toggle sidebar', aliases: 'hide show pane navigation', keys: ['⌘b', '⌘\\'], run: () => layout.toggle('sidebar') },
  { id: 'toggle-list', section: 'Layout', title: 'Toggle pull request list', aliases: 'hide show pane queue inbox', keys: ['⌘⇧b', '⌘⇧\\'], run: () => layout.toggle('list') },
  { id: 'toggle-inspector', section: 'Layout', title: 'Toggle details panel', aliases: 'inspector hide show pane properties files', keys: ['⌘i'], run: () => layout.toggle('inspector') },
  { id: 'focus-mode', section: 'Layout', title: 'Focus mode (hide all panels)', aliases: 'zen fullscreen hide panes', keys: ['⌘.', 'z'], run: () => layout.toggleFocus() },
  { id: 'theme', section: 'Layout', title: 'Cycle theme (system / dark / light)', aliases: 'light dark mode appearance color', keys: ['⌘⇧l'], run: cycleTheme },
  { id: 'reset-layout', section: 'Layout', title: 'Reset layout', aliases: 'panes widths default', keys: ['⌘⇧0'], run: () => layout.reset() },

  { id: 'next-pr', section: 'Navigate', title: 'Next pull request', keys: ['j', '↓'], run: () => movePull(1) },
  { id: 'prev-pr', section: 'Navigate', title: 'Previous pull request', keys: ['k', '↑'], run: () => movePull(-1) },
  { id: 'page-diff-down', section: 'Navigate', title: 'Page down (middle pane)', keys: ['space'], run: () => scrollPane('middle', 'page-down'), isEnabled: hasPull },
  { id: 'page-diff-up', section: 'Navigate', title: 'Page up (middle pane)', keys: ['⇧space'], run: () => scrollPane('middle', 'page-up'), isEnabled: hasPull },
  { id: 'list-first', section: 'Navigate', title: 'First pull request', aliases: 'vim top', keys: ['g g', 'Home'], run: () => jumpPull('first') },
  { id: 'list-last', section: 'Navigate', title: 'Last pull request', aliases: 'vim bottom', keys: ['⇧g', 'End'], run: () => jumpPull('last') },
  { id: 'next-file', section: 'Navigate', title: 'Next file', keys: ['n', ']c', '⌥↓'], run: () => moveFile(1), isEnabled: hasFiles },
  { id: 'prev-file', section: 'Navigate', title: 'Previous file', keys: ['p', '[c', '⌥↑'], run: () => moveFile(-1), isEnabled: hasFiles },
  { id: 'media', section: 'Navigate', title: 'Open first image / video / HTML preview', aliases: 'lightbox screenshot media picture gif recording', keys: ['i', '⌘⇧i'], run: () => openMedia(0), isEnabled: hasPull },
  { id: 'description', section: 'Navigate', title: 'Jump to description', keys: ['d', '⌘↑'], run: () => diffView.scrollToTop(), isEnabled: hasPull },

  ...VIM_COMMANDS,
  ...DIFF_SCROLL_COMMANDS,
  { id: 'toggle-file', section: 'Diff', title: 'Collapse / expand file', aliases: 'fold unfold hide', keys: ['x'], run: toggleCurrentFile, isEnabled: hasFiles },
  { id: 'toggle-files', section: 'Diff', title: 'Collapse / expand file list', aliases: 'files tree sidebar hide', keys: ['⇧f'], run: toggleFilesSection },
  { id: 'toggle-all', section: 'Diff', title: 'Collapse / expand all files', aliases: 'fold unfold hide', keys: ['⇧c'], run: toggleAllFiles, isEnabled: hasFiles },
  { id: 'diff-style', section: 'Diff', title: 'Toggle split / unified diff', aliases: 'side by side inline view', keys: ['s', '⌘⌥s'], run: toggleStyle },

  { id: 'approve', section: 'Pull request', title: 'Approve', aliases: 'lgtm review accept', keys: ['a'], run: () => void approveSelected(), isEnabled: hasPull },
  { id: 'merge', section: 'Pull request', title: 'Merge (all selected when several are checked)', aliases: 'squash ship land queue', keys: ['⌘↵', 'm'], run: () => void (state.checkedIds.size > 1 ? bulkMerge() : mergeSelected()), isEnabled: hasPull },
  { id: 'merge-method', section: 'Pull request', title: 'Cycle merge method', keys: ['⇧m'], run: cycleMergeMethod },
  { id: 'fix-prompt', section: 'Pull request', title: 'Copy agent prompt to fix conflicts and failing checks', aliases: 'broken red failing ci conflict agent devin claude codex prompt clipboard', keys: ['⇧x'], run: copyFixPrompt },
  { id: 'open', section: 'Pull request', title: 'Open on GitHub', aliases: 'browser link url web', keys: ['o', '⌘o', 'g o'], run: openSelectedOnGitHub, isEnabled: hasPull },
  { id: 'copy-url', section: 'Pull request', title: 'Copy link', keys: ['⌘⇧c', 'y'], run: () => { const pull = selectedPull(); if (pull != null) copyText(pull.url, 'link'); }, isEnabled: hasPull },
  { id: 'copy-branch', section: 'Pull request', title: 'Copy branch name', keys: ['⌘⇧.', 'b'], run: () => { const pull = selectedPull(); if (pull != null) copyText(pull.headRefName, 'branch'); }, isEnabled: hasPull },
];

const SEQUENCE_TIMEOUT_MS = 900;
const isSequenceShortcut = (shortcut: string): boolean => shortcut.includes(' ') || /^[[\]][a-z]$/.test(shortcut);
const sequenceCommands = COMMANDS.filter((command) => command.keys.some(isSequenceShortcut));
let pendingPrefix: string | null = null;
let prefixTimer: number | undefined;

commands.add(...COMMANDS.map((command) => ({ ...command, keys: command.keys.filter((shortcut) => !isSequenceShortcut(shortcut)) })));

const SEQUENCE_PREFIXES = new Set(['g', '[', ']']);

function handleSequence(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (pendingPrefix != null) {
    const shortcut = `${pendingPrefix} ${key}`;
    const bracketShortcut = `${pendingPrefix}${key}`;
    pendingPrefix = null;
    window.clearTimeout(prefixTimer);
    const command = sequenceCommands.find((candidate) => candidate.keys.includes(shortcut) || candidate.keys.includes(bracketShortcut));
    if (command == null) return false;
    event.preventDefault();
    command.run();
    return true;
  }
  if (!SEQUENCE_PREFIXES.has(key) || (event.shiftKey && key !== '[' && key !== ']')) return false;
  pendingPrefix = key;
  prefixTimer = window.setTimeout(() => (pendingPrefix = null), SEQUENCE_TIMEOUT_MS);
  event.preventDefault();
  return true;
}

document.addEventListener('keydown', (event) => {
  if ((event.isComposing && !event.altKey) || lightbox.isOpen || palette.isOpen || dom.confirm.open || dom.help.open || dom.bulkConfirm.open) return;
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
  if (isTyping && (event.key === 'Escape' || (event.key === 'Enter' && !event.metaKey))) {
    (target as HTMLElement).blur();
    event.preventDefault();
    return;
  }
  if (!isTyping && handleSequence(event)) return;
  commands.handle(event, isTyping);
});

dom.list.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const selectAll = target.closest<HTMLElement>('[data-group-select]');
  if (selectAll != null) {
    const section = listSections(filteredPulls()).find((candidate) => candidate.group?.id === selectAll.dataset.groupSelect);
    if (section != null) setChecked(section.pulls.map((pull) => pull.id), true);
    return;
  }
  const header = target.closest<HTMLElement>('.group-row');
  if (header?.dataset.group != null) {
    const id = header.dataset.group;
    if (collapsedGroups.has(id)) collapsedGroups.delete(id);
    else collapsedGroups.add(id);
    localStorage.setItem('collapsedGroups', JSON.stringify([...collapsedGroups]));
    renderList();
    return;
  }
  const row = target.closest<HTMLElement>('li');
  const rowId = row?.dataset.id;
  if (rowId != null && (target.closest('.check-box') != null || event.metaKey || event.shiftKey)) {
    event.preventDefault();
    toggleChecked(rowId, event.shiftKey);
    return;
  }
  const id = rowId;
  const pull = state.pulls.find((candidate) => candidate.id === id);
  if (pull != null) void select(pull);
});

dom.files.addEventListener('click', (event) => {
  const index = Number((event.target as HTMLElement).closest<HTMLElement>('button')?.dataset.index);
  if (Number.isInteger(index)) setActiveFile(index);
});

document.getElementById('pr-body-split')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const media = target.closest?.('.description img, .description video, .description a');
  if (media instanceof HTMLElement && openMediaFrom(media instanceof HTMLAnchorElement ? (media.querySelector('img') ?? media) : media)) {
    event.preventDefault();
    return;
  }
});

document.querySelectorAll<HTMLButtonElement>('.views button').forEach((button) =>
  button.addEventListener('click', () => switchKind(button.dataset.kind as QueueKind)),
);
dom.filter.addEventListener('input', () => {
  state.filter = dom.filter.value;
  renderList();
  renderSearchState();
  scheduleSemanticSearch();
});
dom.toggleAll.addEventListener('click', toggleAllFiles);
element('toggle-sidebar').addEventListener('click', () => layout.toggle('sidebar'));
element('toggle-inspector').addEventListener('click', () => layout.toggle('inspector'));
element('open-palette').addEventListener('click', () => palette.open());
element('open-help').addEventListener('click', openHelp);
element('open-github').addEventListener('click', openSelectedOnGitHub);
element('refresh-button').addEventListener('click', manualRefresh);
refreshTicker = window.setInterval(renderRefreshStatus, 5_000);
void refreshTicker;
dom.crumbs.addEventListener('click', (event) => {
  if (!(event.target as HTMLElement).closest('.pr-link')) return;
  event.preventDefault();
  openSelectedOnGitHub();
});
dom.toggleMode.addEventListener('click', toggleReviewMode);
applyReviewMode();
enableWindowDrag();
applyTheme();
applyFilesCollapsed();
enableTooltips();
routeLinksToBrowser(openInBrowser, (message) => toast(message, true));
systemDark.addEventListener('change', () => theme === 'system' && applyTheme());
document.querySelector('.file-tree .section-title')?.addEventListener('click', toggleFilesSection);
dom.filterBar.addEventListener('click', (event) => {
  const chip = (event.target as HTMLElement).closest<HTMLElement>('[data-smart]');
  if (chip != null) setSmartFilter(chip.dataset.smart as SmartFilter);
});
dom.sort.addEventListener('change', () => setSortOrder(dom.sort.value as SortOrder));
element('bulk-ready').addEventListener('click', selectReady);
element('bulk-clear').addEventListener('click', clearChecked);
dom.bulkApprove.addEventListener('click', () => void bulkApprove());
dom.bulkMerge.addEventListener('click', () => void bulkMerge());
syncPaneButtons();
dom.approve.addEventListener('click', () => void approveSelected());
dom.merge.addEventListener('click', () => void (state.checkedIds.size > 1 ? bulkMerge() : mergeSelected()));
dom.mergeMethod.addEventListener('change', () => {
  localStorage.setItem('mergeMethod', dom.mergeMethod.value);
  syncMergeLabel();
});
window.addEventListener('focus', () => void refresh(state.kind));
window.setInterval(() => {
  if (document.visibilityState === 'visible') void refresh(state.kind);
}, QUEUE_REFRESH_MS);

void isReadinessAvailable().then((isAvailable) => {
  isAiEnabled = isAvailable;
  renderAiStatus();
  if (isAvailable) void scoreWithJev(state.pulls);
  if (isAvailable) void ensureGroups();
});

void refresh(state.kind, true).then(() => {
  (['mine', 'review', 'involved'] satisfies QueueKind[]).filter((kind) => kind !== state.kind).forEach((kind) => void refresh(kind, true));
});
