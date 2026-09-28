import { renderKeys, type Command, type CommandRegistry } from './commands';
import { closeWithMotion, GlidingHighlight } from './motion';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function score(command: Command, query: string): number {
  if (query === '') return 1;
  const haystack = `${command.title} ${command.section} ${command.aliases ?? ''}`.toLowerCase();
  if (haystack.startsWith(query)) return 3;
  if (haystack.includes(query)) return 2;
  let index = 0;
  for (const character of query) {
    index = haystack.indexOf(character, index);
    if (index < 0) return 0;
    index += 1;
  }
  return 1;
}

export class CommandPalette {
  private readonly dialog: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly registry: CommandRegistry;
  private results: Command[] = [];
  private activeIndex = 0;
  private highlight!: GlidingHighlight;

  constructor(registry: CommandRegistry) {
    this.registry = registry;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'palette';
    this.dialog.innerHTML = `<input placeholder="Type a command or search…" spellcheck="false" autocomplete="off" /><div class="palette-list" role="listbox"></div><footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> run</span><span><kbd>esc</kbd> close</span></footer>`;
    document.body.append(this.dialog);
    this.input = this.dialog.querySelector('input') as HTMLInputElement;
    this.list = this.dialog.querySelector('.palette-list') as HTMLElement;
    this.highlight = new GlidingHighlight(this.list, 'palette-glide');
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', this.handleKey);
    this.list.addEventListener('pointermove', (event) => this.hover(event));
    this.list.addEventListener('click', (event) => this.clickRow(event));
    this.dialog.addEventListener('click', (event) => event.target === this.dialog && this.close());
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.dialog.open) return this.close();
    this.input.value = '';
    this.activeIndex = 0;
    this.render();
    this.dialog.showModal();
    this.input.focus();
  }

  close(): void {
    closeWithMotion(this.dialog);
  }

  private render(): void {
    const query = this.input.value.trim().toLowerCase();
    this.results = this.registry
      .list()
      .filter((command) => command.isEnabled?.() !== false)
      .map((command) => ({ command, rank: score(command, query) }))
      .filter(({ rank }) => rank > 0)
      .sort((left, right) => right.rank - left.rank)
      .map(({ command }) => command);
    this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.results.length - 1));
    let section = '';
    this.list.innerHTML = this.results
      .map((command, index) => {
        const heading = query === '' && command.section !== section ? `<div class="palette-section">${escapeHtml((section = command.section))}</div>` : '';
        return `${heading}<div class="palette-row${index === this.activeIndex ? ' active' : ''}" data-index="${index}" role="option"><span>${escapeHtml(command.title)}</span><span class="keys">${renderKeys(command.keys)}</span></div>`;
      })
      .join('');
    if (this.results.length === 0) this.list.innerHTML = '<div class="palette-empty">No commands</div>';
    this.highlight.moveTo(this.list.querySelector<HTMLElement>('.palette-row.active'));
  }

  private setActive(index: number): void {
    this.activeIndex = Math.min(this.results.length - 1, Math.max(0, index));
    this.list.querySelector('.active')?.classList.remove('active');
    const row = this.list.querySelector<HTMLElement>(`[data-index="${this.activeIndex}"]`);
    row?.classList.add('active');
    row?.scrollIntoView({ block: 'nearest' });
    this.highlight.moveTo(row ?? null);
  }

  private run(index: number): void {
    const command = this.results[index];
    if (command == null) return;
    this.close();
    command.run();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setActive(this.activeIndex + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.setActive(this.activeIndex - 1);
        return;
      case 'Enter':
        event.preventDefault();
        this.run(this.activeIndex);
        return;
      default:
        return;
    }
  };

  private hover(event: PointerEvent): void {
    const index = Number((event.target as HTMLElement).closest<HTMLElement>('.palette-row')?.dataset.index);
    if (Number.isInteger(index) && index !== this.activeIndex) this.setActive(index);
  }

  private clickRow(event: MouseEvent): void {
    const index = Number((event.target as HTMLElement).closest<HTMLElement>('.palette-row')?.dataset.index);
    if (Number.isInteger(index)) this.run(index);
  }
}
