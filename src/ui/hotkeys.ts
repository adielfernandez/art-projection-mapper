import type { Store } from '../state/store';

/** True when keyboard focus is in a field that should receive keys itself. */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    // Range sliders count as inputs too, so arrows don't move a slider and a point at once.
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface HotkeyHandlers {
  togglePanel?: () => void;
}

export function attachHotkeys(store: Store, handlers: HotkeyHandlers = {}): void {
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(document.activeElement)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;

    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (mod) return;

    if (key === 'd' || key === 'D') {
      store.setDebugVisible(!store.runtime.debugVisible);
      return;
    }
    if (key === 'x' || key === 'X') {
      handlers.togglePanel?.();
      return;
    }
    if (key === ' ') {
      // Always pause/play, even with a panel button or checkbox focused (Space would click it).
      e.preventDefault();
      if (!e.repeat) store.setPaused(!store.runtime.paused);
      return;
    }

    // Point editing keys only act while debug visuals are shown.
    if (!store.runtime.debugVisible) return;

    if (key === 'Tab') {
      e.preventDefault();
      store.cycleSelection(e.shiftKey ? -1 : 1);
      return;
    }
    if (key === 'Escape') {
      store.select(null);
      return;
    }
    const dir = ARROWS[key];
    const sel = store.runtime.selected;
    if (dir && sel) {
      e.preventDefault();
      const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
      store.nudge(sel, dir[0] * step, dir[1] * step);
    }
  });

  window.addEventListener('keyup', (e) => {
    // Alt alone can move focus to browser chrome on Windows; swallow it.
    if (e.key === 'Alt') e.preventDefault();
    // Buttons and checkboxes act on Space's keyup; Space is the pause key instead.
    if (e.key === ' ' && !isTypingTarget(document.activeElement)) e.preventDefault();
  });
}
