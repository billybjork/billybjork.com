(function() {
    /**
     * ============================
     * Utility Functions
     * ============================
     */

    /**
     * Resets the background position of a thumbnail element.
     * @param {HTMLElement} thumbnail - The thumbnail element to reset.
     */
    const resetThumbnailPosition = (thumbnail) => {
        if (thumbnail) {
            thumbnail.style.backgroundPosition = '0 0';
        }
    };

    /**
     * Scrolls smoothly to a given project header with an offset.
     * @param {HTMLElement} projectHeader - The project header element to scroll to.
     */
    const scrollToProjectHeader = (projectHeader) => {
        const offset = 40; // Desired padding in pixels from the top.
        const headerRect = projectHeader.getBoundingClientRect();
        const absoluteElementTop = headerRect.top + window.pageYOffset;
        const scrollToPosition = absoluteElementTop - offset;

        window.scrollTo({
            top: scrollToPosition,
            behavior: 'smooth'
        });
    };

    /**
     * Generic function to display notifications
     * @param {string} message - The message to display
     * @param {boolean} isError - Flag indicating if the message is an error
     */
    const showNotification = (message, isError = false) => {
        const notification = document.createElement('div');
        notification.className = `copy-notification${isError ? ' error' : ''}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 4000); // Remove after 4 seconds to match the animation
    };

    /**
     * Copies text to clipboard and shows a notification
     * @param {string} text - The text to copy
     * @param {string} notificationMessage - The message to display after copying
     */
    const copyToClipboard = (text, notificationMessage = 'URL copied to clipboard!') => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    showNotification(notificationMessage);
                })
                .catch(err => {
                    console.error('Failed to copy using Clipboard API: ', err);
                    showNotification('Failed to copy the URL.', true);
                });
        } else {
            console.warn('Clipboard API not supported in this browser.');
            showNotification('Copy to clipboard not supported in this browser.', true);
        }
    };

    // Expose copyToClipboard to the global scope if needed
    window.copyToClipboard = copyToClipboard;

    /**
     * Opens external links in new tabs.
     * Excludes anchor links, relative links, and same-domain links.
     * @param {HTMLElement} root - The root element to search for links.
     */
    const openExternalLinksInNewTab = (root = document) => {
        const links = root.querySelectorAll('a[href]');
        const currentHost = window.location.host;

        links.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // Skip anchor links, relative links, mailto, tel, etc.
            if (href.startsWith('#') ||
                href.startsWith('/') ||
                href.startsWith('../') ||
                href.startsWith('mailto:') ||
                href.startsWith('tel:')) {
                return;
            }

            // Check if it's an external URL
            try {
                const url = new URL(href, window.location.origin);
                if (url.host !== currentHost) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                }
            } catch (e) {
                // Invalid URL, skip
            }
        });
    };

    /**
     * ============================
     * Intersection Observer for Project Items
     * ============================
     */

    /**
     * Callback for IntersectionObserver to handle visibility of project items.
     * Adds the 'fade-in' class when the project item enters the viewport.
     * @param {IntersectionObserverEntry[]} entries 
     * @param {IntersectionObserver} observer 
     */
    const handleProjectIntersection = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const projectItem = entry.target;
                projectItem.classList.add('fade-in');
                observer.unobserve(projectItem); // Stop observing once animated
            }
        });
    };

    // Initialize the Intersection Observer for project items
    const projectObserver = new IntersectionObserver(handleProjectIntersection, {
        root: null, // Use the viewport as the container
        rootMargin: '0px',
        threshold: 0.1 // Trigger when 10% of the item is visible
    });

    /**
     * Observes all project items that haven't been animated yet.
     * @param {NodeList | Array} projectItems 
     */
    const observeProjectItems = (projectItems) => {
        projectItems.forEach(item => {
            // Only observe items that don't have 'fade-in' or 'no-fade' classes
            if (!item.classList.contains('fade-in') && !item.classList.contains('no-fade')) {
                projectObserver.observe(item);
            }
        });
    };

    /**
     * Initializes the observer for existing project items on page load.
     */
    const initializeProjectObserver = () => {
        const existingProjectItems = document.querySelectorAll('.project-item');
        observeProjectItems(existingProjectItems);
    };

    /**
     * ============================
     * Intersection Observer for Thumbnails
     * ============================
     */

    /**
     * Callback for IntersectionObserver to handle lazy loading of thumbnails.
     * Sets the background image when the thumbnail enters the viewport.
     * @param {IntersectionObserverEntry[]} entries 
     * @param {IntersectionObserver} observer 
     */
    const handleThumbnailIntersection = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const thumbnail = entry.target;
                const bgImage = thumbnail.getAttribute('data-bg');
                if (bgImage) {
                    const img = new Image();
                    img.onload = () => {
                        thumbnail.style.backgroundImage = `url('${bgImage}')`;
                        thumbnail.removeAttribute('data-bg');
                        requestAnimationFrame(() => {
                            thumbnail.classList.remove('lazy-thumbnail');
                        });
                    };
                    img.src = bgImage;
                }
                observer.unobserve(thumbnail);
            }
        });
    };

    // Initialize the Intersection Observer for thumbnails
    const thumbnailObserver = new IntersectionObserver(handleThumbnailIntersection, {
        rootMargin: '0px 0px 50px 0px', // Start loading before the thumbnail fully enters the viewport
        threshold: 0.1 // Trigger when 10% of the thumbnail is visible
    });

    /**
     * Initializes lazy loading for thumbnails within a given root.
     * @param {HTMLElement} root - The root element to search for lazy thumbnails.
     */
    const initializeLazyThumbnails = (root = document) => {
        const lazyThumbnails = root.querySelectorAll('.lazy-thumbnail');

        lazyThumbnails.forEach(thumbnail => {
            // Avoid observing already processed thumbnails
            if (thumbnail.getAttribute('data-bg')) {
                thumbnailObserver.observe(thumbnail);
            }
        });
    };

    /**
     * ============================
     * HLS Video Player Setup and Cleanup
     * ============================
     */

    const HLS_JS_SRC = document.body.dataset.hlsJsSrc || 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
    let hlsScriptPromise = null;

    /**
     * Lazy-load HLS.js only when needed.
     * @returns {Promise<void>}
     */
    const loadHlsScript = () => {
        if (window.Hls) {
            return Promise.resolve();
        }
        if (hlsScriptPromise) {
            return hlsScriptPromise;
        }

        hlsScriptPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HLS_JS_SRC;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load HLS.js'));
            document.head.appendChild(script);
        });

        return hlsScriptPromise;
    };

    /**
     * Sets up HLS video player for a given video element.
     * @param {HTMLVideoElement} videoElement - The video element to initialize.
     * @param {boolean} autoplay - Whether to autoplay the video.
     * @returns {Promise}
     */
    const setupHLSPlayer = (videoElement, autoplay = false) => {
        return new Promise((resolve, reject) => {
            const streamUrl = videoElement.dataset.hlsUrl;
            if (!streamUrl) {
                console.error('No HLS URL provided for video element');
                reject('No HLS URL provided');
                return;
            }

            // Add 'hls-video' class to identify HLS-initialized videos
            videoElement.classList.add('hls-video');

            const initializeVideo = () => {
                // Don't autoplay if edit mode is active
                if (autoplay && !document.body.classList.contains('editing')) {
                    videoElement.play().catch(e => {
                        if (e.name !== 'AbortError') {
                            console.error("Autoplay failed:", e);
                        }
                    });
                }
                resolve();
            };

            const canPlayNative = videoElement.canPlayType('application/vnd.apple.mpegurl');

            const initializeHls = () => {
                if (!window.Hls || !Hls.isSupported()) {
                    if (canPlayNative) {
                        videoElement.src = streamUrl;
                        videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
                        return;
                    }
                    console.error('HLS is not supported in this browser');
                    reject('HLS is not supported');
                    return;
                }

                // Prevent multiple HLS instances on the same video
                if (videoElement.hlsInstance) {
                    console.warn('HLS instance already exists for this video element. Destroying existing instance.');
                    videoElement.hlsInstance.destroy();
                }

                const hls = new Hls();
                videoElement.hlsInstance = hls;  // Store instance for cleanup
                hls.loadSource(streamUrl);
                hls.attachMedia(videoElement);
                hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                    hls.on(Hls.Events.MANIFEST_PARSED, initializeVideo);
                });
                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.error('Fatal network error encountered, trying to recover');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.error('Fatal media error encountered, trying to recover');
                                hls.recoverMediaError();
                                break;
                            default:
                                // Cannot recover
                                console.error('Fatal error encountered, destroying HLS instance:', data);
                                hls.destroy();
                                videoElement.hlsInstance = null;
                                reject(data);
                                break;
                        }
                    } else {
                        // Non-fatal error
                        if (data.details === 'bufferAppendError') {
                            // Ignore bufferAppendError or handle differently
                            console.warn('HLS.js bufferAppendError encountered and ignored:', data);
                            // Optionally, attempt to recover
                            hls.recoverMediaError();
                        } else {
                            console.warn('HLS.js non-fatal error:', data);
                        }
                    }
                });
            };

            if (window.Hls && Hls.isSupported()) {
                initializeHls();
                return;
            }

            if (!window.Hls && canPlayNative) {
                videoElement.src = streamUrl;
                videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
                return;
            }

            loadHlsScript()
                .then(initializeHls)
                .catch(err => {
                    if (canPlayNative) {
                        videoElement.src = streamUrl;
                        videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
                        return;
                    }
                    console.error('Failed to load HLS.js:', err);
                    reject(err);
                });
        });
    };

    /**
     * Destroys the HLS player instance and revokes the blob URL.
     * @param {HTMLVideoElement} videoElement - The video element to clean up.
     */
    const destroyHLSPlayer = (videoElement) => {
        if (videoElement.hlsInstance) {
            videoElement.hlsInstance.destroy();
            videoElement.hlsInstance = null;
        }
        if (videoElement.src && videoElement.src.startsWith('blob:')) {
            const blobUrl = videoElement.src; // Store the Blob URL
            URL.revokeObjectURL(blobUrl); // Revoke the Blob URL first
            videoElement.src = ''; // Then clear the src attribute
        }
    };

    /**
     * ============================
     * Project Item Handling
     * ============================
     */

    /**
     * Handles the opening or closing of project content.
     * @param {HTMLElement} projectItem - The project item element.
     * @param {boolean} smoothScroll - Whether to scroll smoothly (default: true).
     */
    const handleProjectContent = async (projectItem, smoothScroll = true) => {
        try {
            const video = projectItem.querySelector('video.project-video, video.lazy-video');
            const thumbnail = projectItem.querySelector('.thumbnail');

            if (projectItem.classList.contains('active')) {
                // Project is being opened
                if (video) {
                    await setupHLSPlayer(video, true);
                }

                // Scroll to the project header using the custom function
                const projectHeader = projectItem.querySelector('.project-header');
                if (projectHeader && smoothScroll) {
                    scrollToProjectHeader(projectHeader);
                }

            } else {
                // Project is being closed
                if (video) {
                    video.pause();
                    destroyHLSPlayer(video);
                }
                if (thumbnail) {
                    resetThumbnailPosition(thumbnail);
                }
            }

            // Update all thumbnails
            if (typeof updateThumbnails === 'function') {
                updateThumbnails();
            }
        } catch (error) {
            console.error('Error in handleProjectContent:', error);
        }
    };

    /**
     * Closes all open projects by removing their content and cleaning up resources.
     */
    const closeAllOpenProjects = () => {
        const openProjectItems = document.querySelectorAll('.project-item.active');
        openProjectItems.forEach(projectItem => {
            // Remove 'active' class
            projectItem.classList.remove('active');

            // Find video and destroy player
            const video = projectItem.querySelector('video.project-video');
            if (video) {
                video.pause();
                destroyHLSPlayer(video);
            }

            // Remove project details content
            const projectDetails = projectItem.querySelector('.project-details');
            if (projectDetails) {
                projectDetails.innerHTML = '';
            }

            // Reset thumbnail position if needed
            const thumbnail = projectItem.querySelector('.thumbnail');
            if (thumbnail) {
                resetThumbnailPosition(thumbnail);
            }
        });
    };

    /**
     * ============================
     * Animation Loop for Thumbnails
     * ============================
     */

    /**
     * Updates the background positions of all thumbnails based on animation progress.
     */
    let animationProgress = 0; // in frames

    const updateThumbnails = () => {
        const thumbnails = document.querySelectorAll('.thumbnail');

        if (!thumbnails.length) {
            return;
        }

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
     * Scroll Handling for Thumbnail Animations.
     * Adjusts animation speed based on scroll velocity.
     */
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    let lastScrollEventTime = Date.now();
    let animationSpeed = 0; // frames per second
    let lastAnimationFrameTime = Date.now();
    let animationFrameId = null;

    const startAnimationLoop = () => {
        if (animationFrameId !== null || document.hidden) return;
        lastAnimationFrameTime = Date.now();
        animationFrameId = requestAnimationFrame(animationLoop);
    };

    const stopAnimationLoop = () => {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    };

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

        if (Math.abs(animationSpeed) > 0.01) {
            startAnimationLoop();
        }
    };

    const animationLoop = () => {
        if (document.hidden) {
            stopAnimationLoop();
            return;
        }

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

        // Keep animationProgress from growing unbounded (per-thumbnail wrapping
        // is handled in updateThumbnails via % totalFrames)
        if (animationProgress > 1e6) animationProgress -= 1e6;
        if (animationProgress < -1e6) animationProgress += 1e6;

        // Update the thumbnails
        updateThumbnails();

        if (Math.abs(animationSpeed) > 0.01) {
            animationFrameId = requestAnimationFrame(animationLoop);
        } else {
            animationSpeed = 0;
            stopAnimationLoop();
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAnimationLoop();
        } else if (Math.abs(animationSpeed) > 0.01) {
            startAnimationLoop();
        }
    });

    /**
     * ============================
     * Initialization Functions
     * ============================
     */

    /**
     * Initializes all necessary elements and event listeners related to thumbnails.
     */
    const initializeThumbnails = () => {
        // Detect if the current path is the root URL
        const isRoot = window.location.pathname === '/';
        const projectList = document.getElementById('project-list');

        if (isRoot) {
            // Project items will be animated via Intersection Observer
        } else {
            // Directly show project items without animation
            const existingProjectItems = document.querySelectorAll('.project-item');
            existingProjectItems.forEach(item => {
                item.classList.add('no-fade');
            });
        }

        // Initialize lazy loading for thumbnails
        initializeLazyThumbnails();
        updateThumbnails();

        // Attach scroll event listener
        window.addEventListener('scroll', handleScroll);
    };

    /**
     * Initializes all necessary elements and event listeners related to projects.
     */
    const initializeProjects = () => {
        // Initialize lazy loading for videos
        initializeLazyVideos();

        // Initialize lazy loading for thumbnails
        initializeLazyThumbnails();

        // Handle initial load (e.g., when navigating directly to an open project)
        handleInitialLoad();
    };

    /**
     * Handles the initial load of a project if it's already active.
     */
    const handleInitialLoad = () => {
        const openProjectItem = document.querySelector('.project-item.active');
        if (openProjectItem) {
            // Use DOMContentLoaded or ensure it's already loaded
            if (document.readyState === 'complete') {
                handleProjectContent(openProjectItem, false);
            } else {
                window.addEventListener('load', () => {
                    handleProjectContent(openProjectItem, false); // Open the project without smooth scrolling
                });
            }
        }
    };

    /**
     * ============================
     * Project Event Handlers
     * ============================
     */

    /**
     * Handles project:beforeSwap event to perform cleanup before content is swapped.
     * @param {Event} event - The custom event.
     */
    const handleProjectBeforeSwap = (event) => {
        cleanupActiveHLSPlayers();
    };

    /**
     * Handles project:afterSwap event to set up newly loaded project content.
     * @param {Event} event - The custom event.
     */
    const handleProjectAfterSwap = (event) => {
        const { element, slug, isOpen, smoothScroll = true } = event.detail;

        if (!element) return;

        const projectItem = element.closest('.project-item');
        if (!projectItem) return;

        if (isOpen) {
            // Initialize HLS player if video is present
            const video = element.querySelector('video.project-video');
            if (video) {
                setupHLSPlayer(video, true).catch(err => {
                    console.error('Failed to initialize HLS player:', err);
                });
            }

            // Scroll to the project header
            const projectHeader = projectItem.querySelector('.project-header');
            if (projectHeader && smoothScroll) {
                scrollToProjectHeader(projectHeader);
            }
        } else {
            // Clean up resources when closing
            const video = projectItem.querySelector('video.project-video');
            if (video) {
                video.pause();
                destroyHLSPlayer(video);
            }
            const thumbnail = projectItem.querySelector('.thumbnail');
            if (thumbnail) {
                resetThumbnailPosition(thumbnail);
            }
        }

        // Initialize lazy loading for newly inserted thumbnails and videos
        initializeLazyThumbnails(element);
        initializeLazyVideos(element);
        updateThumbnails();

        // Open external links in new tabs
        openExternalLinksInNewTab(element);
    };

    /**
     * Handles projects:loaded event for infinite scroll (new projects added to page).
     * @param {Event} event - The custom event.
     */
    const handleProjectsLoaded = (event) => {
        // Select all new project items that do not have 'fade-in' or 'no-fade' classes
        const newProjectItems = document.querySelectorAll('.project-item:not(.fade-in):not(.no-fade)');

        // Observe the newly added project items
        observeProjectItems(newProjectItems);

        // Initialize lazy loading for new thumbnails
        initializeLazyThumbnails();
        updateThumbnails();
    };

    /**
     * Handles project:loaded event for project items.
     * @param {Event} event - The custom event.
     */
    const handleProjectLoaded = (event) => {
        const { element } = event.detail;
        const projectItem = element?.closest('.project-item');
        if (projectItem) {
            handleProjectContent(projectItem);
        }
    };

    /**
     * ============================
     * Video Initialization
     * ============================
     */

    /**
     * Initializes lazy loading for video elements within a given root.
     * @param {HTMLElement} root - The root element to search for lazy videos.
     */
    const initializeLazyVideos = (root = document) => {
        const lazyVideos = root.querySelectorAll('video.lazy-video, video.project-video');

        if ('IntersectionObserver' in window) {
            const videoObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const video = entry.target;
                        setupHLSPlayer(video, false).catch(err => {
                            console.error('Failed to initialize HLS player for video:', err);
                        });
                        observer.unobserve(video);
                        video.dataset.loaded = 'true'; // Mark as loaded to prevent re-observing
                    }
                });
            }, {
                rootMargin: '0px 0px 200px 0px', // Start loading before the video fully enters the viewport
                threshold: 0.25 // 25% of the video is visible
            });

            lazyVideos.forEach(video => {
                // Avoid observing videos that have already been initialized
                if (!video.dataset.loaded) {
                    videoObserver.observe(video);
                }
            });
        } else {
            // Fallback for browsers that don't support IntersectionObserver
            lazyVideos.forEach(video => {
                setupHLSPlayer(video, false).catch(err => {
                    console.error('Failed to initialize HLS player for video:', err);
                });
                video.dataset.loaded = 'true'; // Mark as loaded
            });
        }
    };

    /**
     * ============================
     * Cleanup Functions
     * ============================
     */

    /**
     * Cleans up all active HLS players in the current DOM.
     */
    const cleanupActiveHLSPlayers = () => {
        const activeVideos = document.querySelectorAll('video.hls-video');
        activeVideos.forEach(video => {
            destroyHLSPlayer(video);
        });

        // Additionally, clean up any HLS instances not marked with 'hls-video'
        const videosWithHlsInstance = document.querySelectorAll('video');
        videosWithHlsInstance.forEach(video => {
            if (video.hlsInstance) {
                destroyHLSPlayer(video);
            }
        });
    };

    /**
     * ============================
     * Event Listeners and Initialization
     * ============================
     */

    /**
     * Initializes all functionalities related to projects.
     */
    const initializeAll = () => {
        initializeThumbnails();
        initializeProjects();
        initializeProjectObserver();
        openExternalLinksInNewTab();

        // Attach the window unload event listener to clean up HLS players
        window.addEventListener('beforeunload', cleanupActiveHLSPlayers);
    };

    /**
     * Initializes event listeners for project loader and other interactive elements.
     */
    const initializeEventListeners = () => {
        // Project Loader Event Listeners
        document.body.addEventListener('project:afterSwap', handleProjectAfterSwap);
        document.body.addEventListener('project:beforeSwap', handleProjectBeforeSwap);
        document.body.addEventListener('project:loaded', handleProjectLoaded);
        document.body.addEventListener('projects:loaded', handleProjectsLoaded);
        document.body.addEventListener('project:error', () => {
            showNotification('Failed to load content. Please try again.', true);
        });

        // Event delegation for elements with class 'copy-text-link'
        document.body.addEventListener('click', (event) => {
            const button = event.target.closest('.copy-text-link');
            if (button) {
                event.preventDefault(); // Prevent default button behavior if any

                const textToCopy = button.getAttribute('data-copy-text');
                const notificationMessage = button.getAttribute('data-notification-message') || 'URL copied to clipboard!';

                if (textToCopy) {
                    copyToClipboard(textToCopy, notificationMessage);
                } else {
                    console.warn('No copy text provided for copying.');
                    showNotification('No content available to copy.', true);
                }
            }
        });

        // Event delegation for close project buttons (isolation mode only)
        // Non-isolation mode close is handled by project-loader.js
        document.body.addEventListener('click', function(event) {
            const target = event.target.closest('.close-project');
            if (target) {
                const isIsolationMode = document.body.dataset.isolationMode === 'true';
                if (isIsolationMode) {
                    event.preventDefault();
                    closeProject(target);
                }
            }
        });

        // Image lightbox: click to enlarge images in project content
        document.body.addEventListener('click', function(event) {
            const img = event.target.closest('.project-content img');
            if (!img) return;

            const overlay = document.createElement('div');
            overlay.className = 'image-lightbox';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'image-lightbox-close';
            closeBtn.innerHTML = '&times;';

            const enlargedImg = document.createElement('img');
            enlargedImg.src = img.src;
            enlargedImg.alt = img.alt || '';

            overlay.appendChild(closeBtn);
            overlay.appendChild(enlargedImg);
            document.body.appendChild(overlay);

            // Trigger fade-in
            requestAnimationFrame(() => overlay.classList.add('visible'));

            const closeLightbox = () => {
                overlay.classList.remove('visible');
                overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
            };

            closeBtn.addEventListener('click', closeLightbox);
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) closeLightbox();
            });
        });

        // Escape key closes lightbox first, then open project (same as clicking X)
        // Skip if edit mode is active - edit mode handles its own Escape
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                // Don't close project if edit mode is active
                if (document.body.classList.contains('editing')) {
                    return;
                }

                // Close lightbox first if one is open
                const lightbox = document.querySelector('.image-lightbox');
                if (lightbox) {
                    lightbox.classList.remove('visible');
                    lightbox.addEventListener('transitionend', () => lightbox.remove(), { once: true });
                    return;
                }

                const activeProject = document.querySelector('.project-item.active');
                if (activeProject) {
                    const closeBtn = activeProject.querySelector('.close-project');
                    if (closeBtn) {
                        const isIsolationMode = document.body.dataset.isolationMode === 'true';
                        if (isIsolationMode) {
                            closeProject(closeBtn);
                        } else {
                            // Use ProjectLoader for non-isolation mode
                            const slug = activeProject.dataset.slug;
                            if (slug && window.ProjectLoader) {
                                window.ProjectLoader.closeProject(slug);
                            }
                        }
                    }
                }
            }
        });
    };

    /**
     * Initializes event listeners and other setups after DOM is fully loaded.
     */
    const initialize = () => {
        initializeAll();
        initializeEventListeners();
    };

    // Initialize on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initialize);

    // Handle hash scrolling (native scrollIntoView)
    const scrollToHashTarget = () => {
        if (window.location.hash) {
            // Use getElementById instead of querySelector to handle IDs starting with numbers
            const target = document.getElementById(window.location.hash.slice(1));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        }
    };

    window.addEventListener('load', scrollToHashTarget);
    window.addEventListener('hashchange', scrollToHashTarget);

    /**
     * Closes a specific project item smoothly.
     * @param {HTMLElement} button - The close button element.
     */
    function closeProject(button) {
        const projectItem = button.closest('.project-item');
        if (projectItem) {
            const isIsolationMode = document.body.dataset.isolationMode === 'true';

            if (isIsolationMode) {
                // Add the fade-out class to trigger the CSS animation
                projectItem.classList.add('fade-out');

                // Listen for the animationend event
                projectItem.addEventListener('animationend', function handler() {
                    // Remove the event listener to avoid multiple triggers
                    projectItem.removeEventListener('animationend', handler);
                    // Navigate back to the root URL (preserve show_drafts if active)
                    const url = new URL('/', window.location.origin);
                    const params = new URLSearchParams(window.location.search);
                    const hasShowDrafts = params.get('show_drafts') === 'true'
                        || sessionStorage.getItem('bb_show_drafts') === 'true';
                    if (hasShowDrafts) {
                        url.searchParams.set('show_drafts', 'true');
                    }
                    window.location.href = url.toString();
                });
            } else {
                // Existing behavior for normal mode
                projectItem.classList.remove('active');

                // Clean up resources
                const video = projectItem.querySelector('video.project-video');
                if (video) {
                    video.pause();
                    destroyHLSPlayer(video);
                }

                const thumbnail = projectItem.querySelector('.thumbnail');
                if (thumbnail) {
                    resetThumbnailPosition(thumbnail);
                }

                const projectDetails = projectItem.querySelector('.project-details');
                if (projectDetails) {
                    projectDetails.innerHTML = '';
                }
            }
        }
    }

    // Expose necessary functions to the global scope
    window.handleProjectContent = handleProjectContent;
    window.closeAllOpenProjects = closeAllOpenProjects;
    window.cleanupActiveHLSPlayers = cleanupActiveHLSPlayers;
})();
