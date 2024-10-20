(function() {
    /**
     * Animates project items by adding the 'fade-in' class with staggered delays.
     * @param {NodeList | Array} items - The project items to animate.
     */
    const animateProjectItems = (items) => {
        items.forEach((item, index) => {
            // Avoid re-animating items that already have the fade-in or no-fade class
            if (!item.classList.contains('fade-in') && !item.classList.contains('no-fade')) {
                // Set a staggered delay for each item (e.g., 150ms apart)
                item.style.animationDelay = `${index * 100}ms`;
                // Add the 'fade-in' class to trigger the animation
                item.classList.add('fade-in');
            }
        });
    };

    /**
     * Resets the background position of a thumbnail element
     * @param {HTMLElement} thumbnail - The thumbnail element to reset
     */
    const resetThumbnailPosition = (thumbnail) => {
        if (thumbnail) {
            thumbnail.style.backgroundPosition = '0 0';
        }
    };

    /**
     * Callback for IntersectionObserver to handle visibility of thumbnails for animation
     * @param {IntersectionObserverEntry[]} entries 
     * @param {IntersectionObserver} observer 
     */
    const handleIntersection = (entries, observer) => {
        entries.forEach(entry => {
            entry.target.dataset.animate = entry.isIntersecting ? 'true' : 'false';
        });
    };

    // Initialize IntersectionObserver for handling thumbnail animations
    const observer = new IntersectionObserver(handleIntersection, {
        rootMargin: '0px',
        threshold: 0.1
    });

    /**
     * Updates the background positions of all thumbnails based on animation progress
     */
    let animationProgress = 0; // in frames

    const updateThumbnails = () => {
        const thumbnails = document.querySelectorAll('.thumbnail');

        thumbnails.forEach(thumbnail => {
            const totalFrames = parseInt(thumbnail.dataset.frames, 10);
            const frameWidth = parseInt(thumbnail.dataset.frameWidth, 10);
            const frameHeight = parseInt(thumbnail.dataset.frameHeight, 10);
            const columns = parseInt(thumbnail.dataset.columns, 10);

            const rows = Math.ceil(totalFrames / columns);
            const spriteSheetWidth = frameWidth * columns;
            const spriteSheetHeight = frameHeight * rows;
            thumbnail.style.backgroundSize = `${spriteSheetWidth}px ${spriteSheetHeight}px`;

            let frameIndex = Math.floor(animationProgress) % totalFrames;
            if (frameIndex < 0) frameIndex += totalFrames;

            const frameX = (frameIndex % columns) * frameWidth;
            const frameY = Math.floor(frameIndex / columns) * frameHeight;

            thumbnail.style.backgroundPosition = `-${frameX}px -${frameY}px`;
        });
    };

    /**
     * Initializes lazy loading for thumbnails within a given root
     * @param {HTMLElement} root - The root element to search for lazy thumbnails
     */
    const initializeLazyThumbnails = (root = document) => {
        const lazyThumbnails = root.querySelectorAll('.lazy-thumbnail');

        if ('IntersectionObserver' in window) {
            const thumbnailObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const thumbnail = entry.target;
                        const bgImage = thumbnail.getAttribute('data-bg');
                        if (bgImage) {
                            thumbnail.style.backgroundImage = `url('${bgImage}')`;
                            thumbnail.removeAttribute('data-bg');
                        }
                        observer.unobserve(thumbnail);
                    }
                });
            }, {
                rootMargin: '0px 0px 50px 0px',
                threshold: 0.1
            });

            lazyThumbnails.forEach(thumbnail => {
                // Avoid observing already processed thumbnails
                if (thumbnail.getAttribute('data-bg')) {
                    thumbnailObserver.observe(thumbnail);
                }
            });
        } else {
            // Fallback for browsers that don't support IntersectionObserver
            lazyThumbnails.forEach(thumbnail => {
                const bgImage = thumbnail.getAttribute('data-bg');
                if (bgImage) {
                    thumbnail.style.backgroundImage = `url('${bgImage}')`;
                    thumbnail.removeAttribute('data-bg');
                }
            });
        }
    };

    // Scroll Handling for Thumbnail Animations
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    let lastScrollEventTime = Date.now();
    let animationSpeed = 0; // frames per second
    let lastAnimationFrameTime = Date.now();

    const handleScroll = () => {
        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const now = Date.now();
        const deltaTime = (now - lastScrollEventTime) / 1000; // Convert to seconds

        if (deltaTime > 0) {
            const scrollVelocity = (currentScrollTop - lastScrollTop) / deltaTime; // pixels per second

            // Convert scrollVelocity to animationSpeed (frames per second)
            const pixelsPerFrame = 3; // Adjust to control base animation speed (decrease to speed up)
            animationSpeed = scrollVelocity / pixelsPerFrame; // frames per second

            // Cap the animationSpeed to prevent it from becoming too fast
            const maxAnimationSpeed = 30; // Maximum frames per second
            const minAnimationSpeed = -30; // Minimum frames per second (for upward scroll)
            animationSpeed = Math.max(minAnimationSpeed, Math.min(maxAnimationSpeed, animationSpeed));
        }

        lastScrollTop = currentScrollTop;
        lastScrollEventTime = now;
    };

    const animationLoop = () => {
        const now = Date.now();
        const deltaTime = (now - lastAnimationFrameTime) / 1000; // in seconds
        lastAnimationFrameTime = now;

        // Apply dynamic deceleration to the animation speed
        const baseDeceleration = 15; // Base deceleration (frames per second squared)
        const speedFactor = Math.abs(animationSpeed) * 0.1; // Additional deceleration based on current speed
        const dynamicDeceleration = baseDeceleration + speedFactor; // Total deceleration

        if (animationSpeed > 0) {
            animationSpeed = Math.max(0, animationSpeed - dynamicDeceleration * deltaTime);
        } else if (animationSpeed < 0) {
            animationSpeed = Math.min(0, animationSpeed + dynamicDeceleration * deltaTime);
        }

        // Update animation progress based on animation speed
        animationProgress += animationSpeed * deltaTime;

        // Ensure animationProgress wraps around within totalFrames (assuming 60 total frames)
        animationProgress = animationProgress % 60;
        if (animationProgress < 0) {
            animationProgress += 60;
        }

        // Update the thumbnails
        updateThumbnails();

        // Continue the animation loop
        requestAnimationFrame(animationLoop);
    };

    // Initialize the animation loop
    lastAnimationFrameTime = Date.now();
    requestAnimationFrame(animationLoop);

    /**
     * Initializes all necessary elements and event listeners related to thumbnails.
     */
    const initializeThumbnails = () => {
        // Detect if the current path is the root URL
        const isRoot = window.location.pathname === '/';
        const projectList = document.getElementById('project-list');

        if (isRoot) {
            // Animate existing project items on initial load only on root URL
            const existingProjectItems = document.querySelectorAll('.project-item');
            animateProjectItems(existingProjectItems);
        } else {
            // Directly show project items without animation
            const existingProjectItems = document.querySelectorAll('.project-item');
            existingProjectItems.forEach(item => {
                item.classList.add('no-fade');
            });
        }

        // Observe thumbnails for animation
        document.querySelectorAll('.thumbnail').forEach(thumbnail => {
            observer.observe(thumbnail); // Start observing each thumbnail
        });

        // Initialize lazy loading for thumbnails
        initializeLazyThumbnails();

        // Attach scroll event listener
        window.addEventListener('scroll', handleScroll);
    };

    // Initialize on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeThumbnails);

    // Expose animateProjectItems and resetThumbnailPosition if needed
    window.animateProjectItems = animateProjectItems;
    window.resetThumbnailPosition = resetThumbnailPosition;
})();