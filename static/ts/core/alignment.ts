export type Alignment = 'left' | 'center' | 'right';

const MARGIN_LEFT_AUTO = /(?:^|;)\s*margin-left\s*:\s*auto(?:\s*!important)?\s*(?:;|$)/i;
const MARGIN_RIGHT_AUTO = /(?:^|;)\s*margin-right\s*:\s*auto(?:\s*!important)?\s*(?:;|$)/i;

/** Media is aligned by its auto margins, both in saved inline styles and on the page. */
export function parseAlignmentFromStyle(style: string | null | undefined): Alignment {
  if (!style || !MARGIN_LEFT_AUTO.test(style)) return 'left';
  return MARGIN_RIGHT_AUTO.test(style) ? 'center' : 'right';
}

export function alignmentMargins(align: Alignment): string {
  switch (align) {
    case 'center': return 'margin-left: auto; margin-right: auto';
    case 'right': return 'margin-left: auto';
    case 'left': return '';
  }
}

export function applyAlignment(element: HTMLElement, align: Alignment): void {
  element.style.marginLeft = align === 'left' ? '' : 'auto';
  element.style.marginRight = align === 'center' ? 'auto' : align === 'right' ? '0' : '';
}
