/**
 * Small DOM helpers.
 *
 * The interface is built with plain elements rather than a framework: the game
 * state is already a single mutable object, so a render function that rebuilds
 * a panel from it is simpler and faster than reconciling a virtual tree.
 */

export type Child = Node | string | number | false | null | undefined;

export interface Attrs {
  class?: string;
  id?: string;
  title?: string;
  type?: string;
  value?: string;
  disabled?: boolean;
  style?: string;
  dataset?: Record<string, string>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs.class) node.className = attrs.class;
  if (attrs.id) node.id = attrs.id;
  if (attrs.title) node.title = attrs.title;
  if (attrs.style) node.setAttribute('style', attrs.style);
  if (attrs.type && 'type' in node) (node as unknown as HTMLInputElement).type = attrs.type;
  if (attrs.value !== undefined && 'value' in node) {
    (node as unknown as HTMLInputElement).value = attrs.value;
  }
  if (attrs.disabled && 'disabled' in node) {
    (node as unknown as HTMLButtonElement).disabled = true;
  }
  if (attrs.dataset) for (const [key, value] of Object.entries(attrs.dataset)) node.dataset[key] = value;
  if (attrs.onClick) node.addEventListener('click', attrs.onClick as EventListener);
  if (attrs.onInput) node.addEventListener('input', attrs.onInput as EventListener);
  if (attrs.onChange) node.addEventListener('change', attrs.onChange as EventListener);
  append(node, children);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A labelled value row, the workhorse of the information panels. */
export function row(label: string, value: Child, extraClass = ''): HTMLElement {
  return el('div', { class: `row ${extraClass}`.trim() },
    el('span', { class: 'row-label' }, label),
    el('span', { class: 'row-value' }, value),
  );
}

/** Formats a signed number with a thousands separator, for money. */
export function money(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('en-GB')}`;
}

export function count(value: number): string {
  return Math.round(value).toLocaleString('en-GB');
}

/** A small coloured swatch, used for faction colours. */
export function swatch(colour: string): HTMLElement {
  return el('span', { class: 'swatch', style: `background:${colour}` });
}

/** Turns a snake_case data value into something readable. */
export function pretty(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** A horizontal bar for a 0..1 proportion. */
export function bar(fraction: number, colour: string): HTMLElement {
  const clamped = Math.max(0, Math.min(1, fraction));
  return el('span', { class: 'bar' },
    el('span', { class: 'bar-fill', style: `width:${(clamped * 100).toFixed(1)}%;background:${colour}` }),
  );
}
