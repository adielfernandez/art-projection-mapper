/**
 * Small vanilla-DOM control helpers. Each control reads its value through `get`
 * and writes through `set` (a store action). `sync()` refreshes from state and never
 * overwrites a field the user is currently typing in.
 */

export type Sync = () => void;

/** Collects sync callbacks for one panel region. */
export class Binder {
  private syncs: Sync[] = [];
  add(fn: Sync): void {
    this.syncs.push(fn);
  }
  syncAll(): void {
    for (const fn of this.syncs) fn();
  }
  clear(): void {
    this.syncs.length = 0;
  }
}

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; title?: string; type?: string } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.type && el instanceof HTMLInputElement) el.type = props.type;
  if (props.type && el instanceof HTMLButtonElement) el.type = props.type as 'button';
  for (const c of children) if (c) el.append(c);
  return el;
}

export function button(label: string, onClick: (e: MouseEvent) => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}`.trim(), text: label, type: 'button' });
  b.addEventListener('click', onClick);
  return b;
}

const isEditing = (el: Element) => document.activeElement === el;

function fmt(v: number, decimals: number): string {
  // Trim trailing zeros so 0.5 reads as "0.5", not "0.500".
  return String(Number(v.toFixed(decimals)));
}

export interface NumberOpts {
  get: () => number;
  set: (v: number) => void;
  step: number;
  decimals?: number;
  /** Hard limits enforced on typed values. */
  min?: number;
  max?: number;
}

/** Number input that commits on change (Enter, blur or spinner), not on each keystroke. */
export function numberInput(b: Binder, o: NumberOpts): HTMLInputElement {
  const decimals = o.decimals ?? 3;
  const input = h('input', { type: 'number', class: 'num' });
  input.step = String(o.step);
  if (o.min !== undefined) input.min = String(o.min);
  if (o.max !== undefined) input.max = String(o.max);
  const sync = () => {
    if (!isEditing(input)) input.value = fmt(o.get(), decimals);
  };
  input.addEventListener('change', () => {
    let v = input.valueAsNumber;
    if (!Number.isFinite(v)) return sync();
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    o.set(v);
    input.value = fmt(o.get(), decimals);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.blur();
      sync();
    }
  });
  input.addEventListener('blur', sync);
  b.add(sync);
  sync();
  return input;
}

export interface SliderOpts extends NumberOpts {
  sliderMin: number;
  sliderMax: number;
}

/** Labeled range slider (live) paired with a number input (precise). */
export function sliderRow(b: Binder, label: string, o: SliderOpts): HTMLElement {
  const range = h('input', { type: 'range', class: 'range' });
  range.min = String(o.sliderMin);
  range.max = String(o.sliderMax);
  range.step = String(o.step);
  range.addEventListener('input', () => o.set(range.valueAsNumber));
  b.add(() => {
    if (!isEditing(range)) range.value = String(o.get());
  });
  range.value = String(o.get());
  // Leave the slider after use so arrow keys go back to nudging points.
  range.addEventListener('pointerup', () => range.blur());
  return row(label, range, numberInput(b, o));
}

export function numberRow(b: Binder, label: string, o: NumberOpts): HTMLElement {
  return row(label, numberInput(b, o));
}

export function colorRow(b: Binder, label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const input = h('input', { type: 'color', class: 'color' });
  input.addEventListener('input', () => set(input.value.toUpperCase()));
  const sync = () => {
    if (!isEditing(input)) input.value = get().toLowerCase();
  };
  b.add(sync);
  sync();
  return row(label, input);
}

/** A dropdown. `options` are [value, label] pairs. */
export function selectRow<T extends string>(
  b: Binder,
  label: string,
  options: readonly (readonly [T, string])[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const select = h('select', { class: 'select' });
  for (const [value, text] of options) select.append(Object.assign(h('option', { text }), { value }));
  select.addEventListener('change', () => {
    set(select.value as T);
    select.blur();
  });
  const sync = () => {
    if (document.activeElement !== select) select.value = get();
  };
  b.add(sync);
  sync();
  return row(label, select);
}

/** A color picker laid out like a checkbox row: a small swatch on the left, then the label. */
export function colorCheckRow(b: Binder, label: string, get: () => string, set: (v: string) => void): HTMLElement {
  const input = h('input', { type: 'color', class: 'color swatch-input' });
  input.addEventListener('input', () => set(input.value.toUpperCase()));
  const sync = () => {
    if (!isEditing(input)) input.value = get().toLowerCase();
  };
  b.add(sync);
  sync();
  return h('label', { class: 'row check' }, [input, h('span', { text: label })]);
}

export function checkboxRow(b: Binder, label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => {
    set(input.checked);
    input.blur();
  });
  const sync = () => (input.checked = get());
  b.add(sync);
  sync();
  const lab = h('label', { class: 'row check' }, [input, h('span', { text: label })]);
  return lab;
}

const NOTE_MS = 4000;
const FADE_MS = 400;
const noteTimers = new WeakMap<HTMLElement, number>();

/**
 * Show a note, or keep it until replaced. With `fade`, it fades out and hides itself after
 * 4 s; showing it again restarts that.
 */
export function showNote(el: HTMLElement, text: string, kind: string, fade: boolean): void {
  window.clearTimeout(noteTimers.get(el));
  el.className = `message ${kind}`;
  el.textContent = text;
  el.hidden = false;
  if (!fade) return;
  noteTimers.set(el, window.setTimeout(() => {
    el.classList.add('fading');
    noteTimers.set(el, window.setTimeout(() => (el.hidden = true), FADE_MS));
  }, NOTE_MS));
}

/** Attach hover help text (shown by helpTooltip.ts). */
export function withHelp<T extends HTMLElement>(el: T, text: string): T {
  el.dataset.help = text;
  return el;
}

export function row(label: string, ...controls: HTMLElement[]): HTMLElement {
  return h('div', { class: 'row' }, [h('span', { class: 'label', text: label }), h('div', { class: 'controls' }, controls)]);
}

/**
 * Collapsible section. Open/closed state is remembered by `key` across rebuilds.
 * `headerExtras` render right-aligned in the header (clicks on them don't toggle).
 */
export function section(
  openState: Map<string, boolean>,
  key: string,
  title: string | HTMLElement,
  body: Child[],
  opts: { defaultOpen?: boolean; headerExtras?: HTMLElement[]; class?: string } = {},
): HTMLDetailsElement {
  const details = h('details', { class: `section ${opts.class ?? ''}`.trim() });
  details.open = openState.get(key) ?? opts.defaultOpen ?? false;
  details.addEventListener('toggle', () => openState.set(key, details.open));
  const titleEl = typeof title === 'string' ? h('span', { class: 'title', text: title }) : title;
  const extras = h('span', { class: 'header-extras' }, opts.headerExtras ?? []);
  // Buttons inside <summary> would toggle the section; stop that.
  extras.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, input, label')) e.preventDefault();
  });
  details.append(h('summary', {}, [titleEl, extras]), h('div', { class: 'section-body' }, body));
  return details;
}

export interface TextOpts {
  get: () => string;
  set: (v: string) => void;
  /** Commit only on change (Enter/blur) instead of on every keystroke. */
  commitOnChange?: boolean;
  placeholder?: string;
}

export function textRow(b: Binder, label: string, o: TextOpts): HTMLElement {
  const input = h('input', { type: 'text', class: 'text' });
  if (o.placeholder) input.placeholder = o.placeholder;
  input.spellcheck = false;
  const sync = () => {
    if (!isEditing(input)) input.value = o.get();
  };
  input.addEventListener(o.commitOnChange ? 'change' : 'input', () => o.set(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.blur();
      sync();
    }
  });
  input.addEventListener('blur', sync);
  b.add(sync);
  sync();
  return row(label, input);
}
