import { alignmentMargins, type Alignment } from '../core/alignment';

interface MediaStyleBlock {
  style?: string | null;
  align?: Alignment;
}

type StyleMap = Record<string, string | undefined>;

const ALIGNMENT_DECLARATION = /^(margin-(left|right)\s*:\s*auto|display\s*:\s*block)$/;

export function sizeStyleOf(style: string | null | undefined): string {
  return (style ?? '')
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration && !ALIGNMENT_DECLARATION.test(declaration))
    .join('; ');
}

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
