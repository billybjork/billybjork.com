import '../project/styles.css';
import './styles.css';
import { registerHomepageRuntime } from '../core/runtime-registry';
import { initProjectInteractions } from '../project/interactions';
import { HomepageController } from './controller';

const controller = new HomepageController();
initProjectInteractions();
registerHomepageRuntime(controller);
controller.init();
