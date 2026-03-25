import './styles.css';
import { registerHomepageRuntime } from '../core/runtime-registry';
import { HomepageController } from './controller';

function initHomepage(): void {
  const listScene = document.getElementById('homepage-list-scene');
  const detailScene = document.getElementById('homepage-detail-scene');
  const detailDate = document.getElementById('homepage-detail-date');
  const detailTitle = document.getElementById('homepage-detail-title');
  const detailHeroFrame = document.getElementById('homepage-detail-hero-frame');
  const detailHeroMedia = document.getElementById('homepage-detail-hero-media');
  const detailContent = document.getElementById('homepage-detail-content');
  const transitionLayer = document.getElementById('homepage-transition-layer');

  if (
    !(listScene instanceof HTMLElement)
    || !(detailScene instanceof HTMLElement)
    || !(detailDate instanceof HTMLElement)
    || !(detailTitle instanceof HTMLElement)
    || !(detailHeroFrame instanceof HTMLElement)
    || !(detailHeroMedia instanceof HTMLElement)
    || !(detailContent instanceof HTMLElement)
    || !(transitionLayer instanceof HTMLElement)
  ) {
    return;
  }

  const controller = new HomepageController({
    listScene,
    detailScene,
    detailDate,
    detailTitle,
    detailHeroFrame,
    detailHeroMedia,
    detailContent,
    transitionLayer,
  });

  registerHomepageRuntime(controller);
  controller.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHomepage, { once: true });
} else {
  initHomepage();
}
