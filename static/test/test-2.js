// Bootstrap for /test-2 page.
(function() {
    'use strict';

    function init() {
        const factory = window.Test2TransitionManager;
        if (!factory || typeof factory.create !== 'function') {
            console.error('Missing Test2TransitionManager factory.');
            return;
        }

        const listScene = document.getElementById('t2-list-scene');
        const detailScene = document.getElementById('t2-detail-scene');
        const detailTitle = document.getElementById('t2-detail-title');
        const detailHeroFrame = document.getElementById('t2-detail-hero-frame');
        const detailHeroMedia = document.getElementById('t2-detail-hero-media');
        const detailContent = document.getElementById('t2-detail-content');
        const transitionLayer = document.getElementById('t2-transition-layer');

        if (!listScene || !detailScene || !detailTitle || !detailHeroFrame || !detailHeroMedia || !detailContent || !transitionLayer) {
            console.error('Missing required /test-2 scene elements.');
            return;
        }

        const manager = factory.create({
            listScene,
            detailScene,
            detailTitle,
            detailHeroFrame,
            detailHeroMedia,
            detailContent,
            transitionLayer,
            basePath: listScene.dataset.testBasePath || '/test-2',
            initialSlug: listScene.dataset.initialProjectSlug || '',
            initialDirectEntry: listScene.dataset.initialProjectDirectEntry === 'true',
        });
        manager.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
