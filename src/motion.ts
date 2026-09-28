const EXIT_MS = 120;

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function closeWithMotion(dialog: HTMLDialogElement, done?: () => void): void {
  if (!dialog.open || dialog.classList.contains('closing')) return;
  if (prefersReducedMotion()) {
    dialog.close();
    done?.();
    return;
  }
  dialog.classList.add('closing');
  window.setTimeout(() => {
    dialog.classList.remove('closing');
    dialog.close();
    done?.();
  }, EXIT_MS);
}

export class GlidingHighlight {
  private readonly container: HTMLElement;
  private readonly bar: HTMLElement;
  private lastTop: number | null = null;

  constructor(container: HTMLElement, className: string) {
    this.container = container;
    this.bar = document.createElement('div');
    this.bar.className = className;
    this.bar.setAttribute('aria-hidden', 'true');
  }

  moveTo(target: HTMLElement | null): void {
    if (target == null) {
      this.bar.style.opacity = '0';
      this.lastTop = null;
      return;
    }
    if (this.bar.parentElement !== this.container) this.container.prepend(this.bar);
    const top = target.offsetTop;
    const height = target.offsetHeight;
    const isJump = this.lastTop == null || Math.abs(top - this.lastTop) > height * 6 || prefersReducedMotion();
    this.bar.classList.toggle('instant', isJump);
    this.bar.style.height = `${height}px`;
    this.bar.style.transform = `translate3d(0, ${top}px, 0)`;
    this.bar.style.opacity = '1';
    this.lastTop = top;
  }
}

export function animateDialogCancel(root: Document = document): void {
  root.addEventListener(
    'cancel',
    (event) => {
      const dialog = event.target;
      if (!(dialog instanceof HTMLDialogElement) || event.defaultPrevented || prefersReducedMotion()) return;
      event.preventDefault();
      closeWithMotion(dialog);
    },
    true,
  );
}

const hideTimers = new WeakMap<HTMLElement, number>();

export function setVisibleWithMotion(element: HTMLElement, isVisible: boolean, exitMs = 140): void {
  window.clearTimeout(hideTimers.get(element));
  if (isVisible) {
    if (!element.hidden && !element.classList.contains('leaving')) return;
    element.classList.remove('leaving');
    element.hidden = false;
    element.classList.remove('entering');
    void element.offsetWidth;
    element.classList.add('entering');
    return;
  }
  if (element.hidden) return;
  if (prefersReducedMotion()) {
    element.hidden = true;
    return;
  }
  element.classList.remove('entering');
  element.classList.add('leaving');
  hideTimers.set(
    element,
    window.setTimeout(() => {
      element.classList.remove('leaving');
      element.hidden = true;
    }, exitMs),
  );
}

export function flash(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.classList.remove('flash');
  void element.offsetWidth;
  element.classList.add('flash');
  element.addEventListener('animationend', () => element.classList.remove('flash'), { once: true });
}
