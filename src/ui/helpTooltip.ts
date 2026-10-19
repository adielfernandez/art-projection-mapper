/**
 * Hover help for any panel element with `data-help`. One shared tooltip, shown beside the
 * panel (over the stage) so it never covers the controls being used.
 */

const SHOW_DELAY_MS = 400;
/** After a tooltip was visible, moving to another row shows the next one immediately. */
const WARM_MS = 300;

export function attachHelpTooltips(panel: HTMLElement): void {
  const tip = document.createElement('div');
  tip.className = 'help-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  panel.append(tip);

  let target: HTMLElement | null = null;
  let showTimer = 0;
  let lastHidden = 0;

  const place = (el: HTMLElement) => {
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
    const onLeft = p.left < window.innerWidth / 2;
    tip.style.left = onLeft ? `${p.right + gap}px` : '';
    tip.style.right = onLeft ? '' : `${window.innerWidth - p.left + gap}px`;
    const top = Math.min(r.top + r.height / 2 - tip.offsetHeight / 2, window.innerHeight - tip.offsetHeight - gap);
    tip.style.top = `${Math.max(gap, top)}px`;
  };

  const show = (el: HTMLElement) => {
    tip.textContent = el.dataset.help ?? '';
    tip.hidden = false;
    place(el);
  };

  const hide = () => {
    window.clearTimeout(showTimer);
    if (!tip.hidden) lastHidden = performance.now();
    tip.hidden = true;
    target = null;
  };

  panel.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-help]');
    if (el === target) return;
    window.clearTimeout(showTimer);
    if (!el) return hide();
    const warm = !tip.hidden || performance.now() - lastHidden < WARM_MS;
    target = el;
    if (warm) show(el);
    else showTimer = window.setTimeout(() => target === el && show(el), SHOW_DELAY_MS);
  });
  panel.addEventListener('pointerleave', hide);
  // The tooltip is positioned against the row; scrolling would leave it stranded.
  panel.addEventListener('scroll', hide, true);
}
