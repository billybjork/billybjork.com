import './styles.css';
import { registerHomepageRuntime } from '../core/runtime-registry';
import { initProjectInteractions } from '../project/interactions';
import { HomepageController } from './controller';

function initHomepage(): void {
  const controller = new HomepageController();
  initProjectInteractions();
  registerHomepageRuntime(controller);
  controller.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHomepage, { once: true });
} else {
  initHomepage();
}
