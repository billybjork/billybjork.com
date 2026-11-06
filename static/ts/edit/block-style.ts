import type { Alignment } from '../types/blocks';

interface MediaStyleBlock {
  style?: string | null;
  align?: Alignment;
}

function alignmentMargins(align: Alignment): string {
  switch (align) {
    case 'center': return 'margin-left: auto; margin-right: auto';
    case 'right': return 'margin-left: auto';
    default: return '';
  }
}

export function parseAlignmentFromStyle(style: string | null | undefined): Alignment {
  if (!style) return 'left';
  const hasMarginLeft = style.includes('margin-left: auto') || style.includes('margin-left:auto');
  const hasMarginRight = style.includes('margin-right: auto') || style.includes('margin-right:auto');

  if (hasMarginLeft && hasMarginRight) return 'center';
  if (hasMarginLeft) return 'right';
  return 'left';
}

/** A media style with the size kept and the alignment rebuilt from `block.align`. */
export function buildMediaStyleString(block: MediaStyleBlock): string {
  const styleParts: string[] = ['display: block'];

  if (block.style) {
    const sizeStyle = block.style
      .replace(/margin-left:\s*auto;?\s*/g, '')
      .replace(/margin-right:\s*auto;?\s*/g, '')
      .replace(/display:\s*block;?\s*/g, '')
      .trim();
    if (sizeStyle) styleParts.push(sizeStyle);
  }

  const margins = alignmentMargins(block.align ?? 'left');
  if (margins) styleParts.push(margins);

  return styleParts.join('; ');
}

export function getTextAlignmentStyle(align: Alignment | undefined): string {
  if (!align || align === 'left') return '';
  return `text-align: ${align}`;
}

export function parseTextAlignmentFromStyle(style: string | null | undefined): Alignment {
  if (!style) return 'left';
  const match = style.match(/text-align:\s*(left|center|right)/);
  return (match?.[1] as Alignment) ?? 'left';
}
