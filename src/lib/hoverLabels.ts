// src/lib/hoverLabels.ts
//
// Hover labels for icon-only controls, drawn INSIDE the page.
//
// About 100 icon buttons and switches across every window carry an
// accessible name (aria-label) but show nothing on hover (UI audit
// 2026-11-08). A native `title` is not the fix: Chromium draws it as an OS
// window outside content protection, so it leaks into screen shares — which
// is why nativeTooltipGuard.mjs strips titles from the overlay family, and
// from the launcher while undetectable.
//
// So one shared label is drawn in the DOM, like the `.t-tt` tooltips:
// content protection hides it from captures, and `html[data-tooltips='off']`
// (stealthTooltips.mjs) hides it entirely while undetectable. Controls that
// already explain themselves are left alone: a visible text label, a live
// native title, or their own `.t-tt` tooltip.

const CONTROL = 'button, a[href], [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="checkbox"]';
const SHOW_DELAY_MS = 450;
const EDGE = 4;

/** The parts of an element the label decision reads (a DOM Element satisfies it). */
export interface LabelTarget {
  getAttribute(name: string): string | null;
  closest(selector: string): unknown;
}

/**
 * The label to show for a hovered control, or null when it needs none.
 * `visibleText` is the control's rendered text (innerText).
 */
export function hoverLabelFor(el: LabelTarget | null, visibleText: string): string | null {
  if (!el) return null;
  if ((el.getAttribute('title') ?? '').trim()) return null; // a native tooltip already shows
  if (el.closest('.t-tt-wrap')) return null; // it has its own in-page tooltip
  if (visibleText.trim()) return null; // its text already says what it does
  // nativeTooltipGuard moves a stripped title onto aria-label for icon-only
  // controls and keeps the original in data-native-title.
  const label = (el.getAttribute('aria-label') ?? el.getAttribute('data-native-title') ?? '').trim();
  return label || null;
}

export interface Box { left: number; top: number; right: number; bottom: number }

/** Below the control, centred; above it when there is no room below; kept inside the view. */
export function placeLabel(
  anchor: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  gap = 6,
): { left: number; top: number; side: 'below' | 'above' } {
  let top = anchor.bottom + gap;
  let side: 'below' | 'above' = 'below';
  if (top + tip.height > view.height - EDGE && anchor.top - gap - tip.height >= EDGE) {
    top = anchor.top - gap - tip.height;
    side = 'above';
  }
  const centre = (anchor.left + anchor.right) / 2;
  const left = Math.max(EDGE, Math.min(centre - tip.width / 2, view.width - tip.width - EDGE));
  top = Math.max(EDGE, Math.min(top, view.height - tip.height - EDGE));
  return { left: Math.round(left), top: Math.round(top), side };
}

/** Install once per window. Returns a disposer. */
export function installHoverLabels(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  const tip = doc.createElement('div');
  tip.className = 'hover-label';
  tip.setAttribute('aria-hidden', 'true'); // the control's own aria-label already names it
  (doc.body ?? doc.documentElement).appendChild(tip);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Element | null = null;
  const hide = () => {
    clearTimeout(timer);
    current = null;
    tip.classList.remove('is-on');
  };

  const onOver = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.(CONTROL) ?? null;
    if (el === current) return;
    hide();
    if (!el) return;
    const label = hoverLabelFor(el, (el as HTMLElement).innerText ?? el.textContent ?? '');
    if (!label) return;
    current = el;
    timer = setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      tip.textContent = label;
      const p = placeLabel(el.getBoundingClientRect(), tip.getBoundingClientRect(),
        { width: win.innerWidth, height: win.innerHeight });
      tip.style.left = `${p.left}px`;
      tip.style.top = `${p.top}px`;
      tip.classList.add('is-on');
    }, SHOW_DELAY_MS);
  };
  const onOut = (e: Event) => { if (!(e as PointerEvent).relatedTarget) hide(); };
  // Only a scroll that moves the hovered control: the overlay scrolls its own
  // transcript and streaming answer all session, which would blank every label.
  const onScroll = (e: Event) => {
    const box = e.target as Node | null;
    if (current && box && (box === doc || box.contains?.(current))) hide();
  };

  doc.addEventListener('pointerover', onOver, true);
  doc.addEventListener('pointerout', onOut, true);
  doc.addEventListener('pointerdown', hide, true);
  doc.addEventListener('keydown', hide, true);
  doc.addEventListener('scroll', onScroll, true);
  win.addEventListener('blur', hide);
  return () => {
    hide();
    doc.removeEventListener('pointerover', onOver, true);
    doc.removeEventListener('pointerout', onOut, true);
    doc.removeEventListener('pointerdown', hide, true);
    doc.removeEventListener('keydown', hide, true);
    doc.removeEventListener('scroll', onScroll, true);
    win.removeEventListener('blur', hide);
    tip.remove();
  };
}
