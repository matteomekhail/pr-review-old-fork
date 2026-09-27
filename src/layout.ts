export type PaneId = 'sidebar' | 'list' | 'inspector' | 'description';

interface PaneSpec {
  variable: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: 'left' | 'right';
}

interface LayoutState {
  widths: Record<PaneId, number>;
  hidden: Record<PaneId, boolean>;
}

const STORAGE_KEY = 'layout.v1';

const PANES: Record<PaneId, PaneSpec> = {
  sidebar: { variable: '--sidebar-w', defaultWidth: 220, minWidth: 150, maxWidth: 520, side: 'left' },
  list: { variable: '--list-w', defaultWidth: 420, minWidth: 220, maxWidth: 4_000, side: 'left' },
  inspector: { variable: '--inspector-w', defaultWidth: 272, minWidth: 180, maxWidth: 4_000, side: 'right' },
  description: { variable: '--desc-w', defaultWidth: 520, minWidth: 220, maxWidth: 4_000, side: 'left' },
};

const PANE_IDS = Object.keys(PANES) as PaneId[];

function defaultState(): LayoutState {
  return {
    widths: { sidebar: PANES.sidebar.defaultWidth, list: PANES.list.defaultWidth, inspector: PANES.inspector.defaultWidth, description: PANES.description.defaultWidth },
    hidden: { sidebar: false, list: false, inspector: false, description: false },
  };
}

function loadState(): LayoutState {
  const fallback = defaultState();
  try {
    const saved: Partial<LayoutState> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { widths: { ...fallback.widths, ...saved.widths }, hidden: { ...fallback.hidden, ...saved.hidden } };
  } catch {
    return fallback;
  }
}

const MIN_MAIN_WIDTH = 280;

function clamp(pane: PaneId, width: number, others: number): number {
  const { minWidth, maxWidth } = PANES[pane];
  const room = window.innerWidth - others - MIN_MAIN_WIDTH;
  return Math.round(Math.max(minWidth, Math.min(maxWidth, room, width)));
}

export class Layout {
  private state = loadState();
  private readonly root: HTMLElement;
  private readonly onChange: () => void;

  constructor(root: HTMLElement, onChange: () => void) {
    this.root = root;
    this.onChange = onChange;
    this.apply();
    root.querySelectorAll<HTMLElement>('[data-resize]').forEach((handle) => this.bindHandle(handle));
  }

  isHidden(pane: PaneId): boolean {
    return this.state.hidden[pane];
  }

  isFocused(): boolean {
    return PANE_IDS.every((pane) => this.state.hidden[pane]);
  }

  toggle(pane: PaneId): void {
    this.state.hidden[pane] = !this.state.hidden[pane];
    this.commit();
  }

  toggleFocus(): void {
    const shouldHide = !this.isFocused();
    PANE_IDS.forEach((pane) => (this.state.hidden[pane] = shouldHide));
    this.commit();
  }

  reset(): void {
    this.state = defaultState();
    this.commit();
  }

  private commit(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this.apply();
    this.onChange();
  }

  private apply(): void {
    PANE_IDS.forEach((pane) => {
      this.root.style.setProperty(PANES[pane].variable, `${this.state.hidden[pane] ? 0 : this.state.widths[pane]}px`);
      this.root.classList.toggle(`hide-${pane}`, this.state.hidden[pane]);
    });
  }

  private occupiedWidth(except: PaneId): number {
    const isSide = this.root.classList.contains('mode-side');
    const visible: PaneId[] = isSide ? ['sidebar', 'list', 'description'] : ['sidebar', 'list', 'inspector'];
    return visible.filter((pane) => pane !== except && !this.state.hidden[pane]).reduce((total, pane) => total + this.state.widths[pane], 0);
  }

  private bindHandle(handle: HTMLElement): void {
    const pane = handle.dataset.resize as PaneId;
    handle.addEventListener('dblclick', () => {
      this.state.widths[pane] = PANES[pane].defaultWidth;
      this.commit();
    });
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || this.state.hidden[pane]) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = this.state.widths[pane];
      const direction = PANES[pane].side === 'left' ? 1 : -1;
      document.body.classList.add('resizing');
      handle.classList.add('dragging');
      let frame = 0;
      const move = (moveEvent: PointerEvent): void => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          this.state.widths[pane] = clamp(pane, startWidth + (moveEvent.clientX - startX) * direction, this.occupiedWidth(pane));
          this.apply();
        });
      };
      const end = (): void => {
        cancelAnimationFrame(frame);
        handle.removeEventListener('pointermove', move);
        document.body.classList.remove('resizing');
        handle.classList.remove('dragging');
        this.commit();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end, { once: true });
      handle.addEventListener('pointercancel', end, { once: true });
    });
  }
}
