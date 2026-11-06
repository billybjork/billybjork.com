import { readPositiveNumber } from '../core/numbers';
import { SpriteThumbnail, type SpriteSheet } from './sprite-runtime';

const DEFAULT_ASPECT_RATIO = 16 / 9;

/** A homepage list item, parsed once from the markup `templates/index.html` renders. */
export interface ProjectCard {
  slug: string;
  cardEl: HTMLElement;
  openButton: HTMLElement;
  thumbFrame: HTMLElement;
  heading: HTMLElement | null;
  title: string;
  formattedDate: string;
  thumbnailUrl: string;
  heroAspectRatio: number;
  thumbnail: SpriteThumbnail;
}

function readSpriteSheet(data: DOMStringMap, heroAspectRatio: number): SpriteSheet | null {
  const url = data.spriteSheet;
  const frames = readPositiveNumber(data.frames);
  if (!url || !frames) return null;

  return {
    url,
    frames,
    columns: readPositiveNumber(data.columns) ?? 1,
    rows: readPositiveNumber(data.rows) ?? 1,
    aspectRatio: readPositiveNumber(data.spriteAspectRatio) ?? heroAspectRatio,
  };
}

function readProjectCard(cardEl: HTMLElement): ProjectCard | null {
  const data = cardEl.dataset;
  const openButton = cardEl.querySelector<HTMLElement>('button[data-open-project]');
  const thumbFrame = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-frame]');
  const thumbMedia = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-media]');
  if (!data.slug || !openButton || !thumbFrame || !thumbMedia) return null;

  const heroAspectRatio = readPositiveNumber(data.heroAspectRatio) ?? DEFAULT_ASPECT_RATIO;
  const thumbnailUrl = data.thumbnail ?? '';

  return {
    slug: data.slug,
    cardEl,
    openButton,
    thumbFrame,
    heading: cardEl.querySelector<HTMLElement>('.homepage-card-heading'),
    title: data.title || data.slug,
    formattedDate: data.formattedDate ?? '',
    thumbnailUrl,
    heroAspectRatio,
    thumbnail: new SpriteThumbnail({
      cardEl,
      thumbFrame,
      thumbMedia,
      thumbnailUrl,
      sheet: readSpriteSheet(data, heroAspectRatio),
      displayAspectRatio: heroAspectRatio,
    }),
  };
}

export function readProjectCards(listScene: HTMLElement): ProjectCard[] {
  return Array.from(listScene.querySelectorAll<HTMLElement>('[data-homepage-project-card]'))
    .map(readProjectCard)
    .filter((card): card is ProjectCard => card !== null);
}
