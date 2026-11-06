import type { Alignment } from '../types/blocks';

interface MediaStyleBlock {
  style?: string | null;
  align?: Alignment;
}

type StyleMap = Record<string, string | undefined>;

const ALIGNMENT_DECLARATION = /^(margin-(left|right)\s*:\s*auto|display\s*:\s*block)$/;

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

/** What is left of a media style once its alignment and display declarations are gone. */
export function sizeStyleOf(style: string | null | undefined): string {
  return (style ?? '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !ALIGNMENT_DECLARATION.test(declaration))
    .join('; ');
}

/** A media style with the size kept and the alignment rebuilt from `block.align`. */
export function buildMediaStyleString(block: MediaStyleBlock): string {
  return ['display: block', sizeStyleOf(block.style), alignmentMargins(block.align ?? 'left')]
    .filter(Boolean)
    .join('; ');
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

export function parseStyle(style: string | null | undefined): StyleMap {
  const styles: StyleMap = {};
  if (!style) return styles;

  style.split(';').forEach((part) => {
    const [prop, ...rest] = part.split(':');
    if (!prop) return;
    const value = rest.join(':').trim();
    if (!value) return;
    styles[prop.trim().toLowerCase()] = value;
  });
  return styles;
}

export function serializeStyle(styles: StyleMap): string {
  return Object.entries(styles)
    .filter(([, value]) => value)
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
}

export function styleHasWidth(style: string | null | undefined): boolean {
  return !!style && /(^|;)\s*width\s*:/.test(style);
}

export function styleHasHeight(style: string | null | undefined): boolean {
  return !!style && /(^|;)\s*height\s*:/.test(style);
}
