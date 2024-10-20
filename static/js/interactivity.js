/**
 * Initializes TinyMCE for a given selector
 * @param {string} selector - The selector for the textarea to initialize TinyMCE on
 * @param {Object} additionalOptions - Additional options to merge with the default TinyMCE config
 */
function initTinyMCE(selector, additionalOptions = {}) {
    const defaultOptions = {
        plugins: 'anchor autolink charmap codesample emoticons image link lists media searchreplace table visualblocks wordcount linkchecker',
        toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link image media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
        mergetags_list: [
            { value: 'First.Name', title: 'First Name' },
            { value: 'Email', title: 'Email' },
        ],
        setup: function(editor) {
            editor.on('change', function() {
                tinymce.triggerSave();
            });
        }
    };

    tinymce.init({ ...defaultOptions, ...additionalOptions, selector });
}

(function() {
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
     * Sets up HLS video player for a given video element
     * @param {HTMLVideoElement} videoElement - The video element to initialize
     * @param {boolean} autoplay - Whether to autoplay the video
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
                if (autoplay) {
                    videoElement.play().catch(e => {
                        if (e.name !== 'AbortError') { // Only log errors that are not AbortError
                            console.error("Autoplay failed:", e);
                        }
                        // Optionally, handle AbortError differently if needed
                    });
                }
                resolve();
            };
    
            if (Hls.isSupported()) {
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
            } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                videoElement.src = streamUrl;
                videoElement.addEventListener('loadedmetadata', initializeVideo);
            } else {
                console.error('HLS is not supported in this browser');
                reject('HLS is not supported');
            }
        });
    };    

    /**
     * Destroys the HLS player instance and revokes the blob URL
     * @param {HTMLVideoElement} videoElement - The video element to clean up
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
     * Initializes lazy loading for video elements within a given root
     * @param {HTMLElement} root - The root element to search for lazy videos
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

    /**
     * Custom function to scroll to the project header with an offset
     * @param {HTMLElement} projectHeader - The project header element to scroll to
     */
    const scrollToProjectHeader = (projectHeader) => {
        const offset = 40; // Desired padding in pixels from the top
        const headerRect = projectHeader.getBoundingClientRect();
        const absoluteElementTop = headerRect.top + window.pageYOffset;
        const scrollToPosition = absoluteElementTop - offset;

        window.scrollTo({
            top: scrollToPosition,
            behavior: 'smooth'
        });
    };

    /**
    * Handles the opening or closing of project content
    * @param {HTMLElement} projectItem - The project item element
    * @param {boolean} smoothScroll - Whether to scroll smoothly (default: true)
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
            updateThumbnails();
        } catch (error) {
            console.error('Error in handleProjectContent:', error);
        }
    };

    /**
     * Scroll event handler to update scroll velocity and animation speed
     */
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    let lastScrollEventTime = Date.now();
    let animationSpeed = 0; // frames per second
    let animationProgress = 0; // in frames
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

    window.addEventListener('scroll', handleScroll);

    /**
     * Animation loop using requestAnimationFrame to update thumbnails
     */
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

    // Start the animation loop
    lastAnimationFrameTime = Date.now();
    requestAnimationFrame(animationLoop);

    /**
     * Closes all open projects by removing their content and cleaning up resources
     */
    function closeAllOpenProjects() {
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
    }

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
     * Handles HTMX beforeRequest event to close any open projects before making a new request
     * @param {Event} event - The HTMX event
     */
    const handleHTMXBeforeRequest = (event) => {
        const triggerElt = event.detail.elt;
        const projectItem = triggerElt.closest('.project-item');

        if (triggerElt.matches('.project-header, .thumbnail') && projectItem.classList.contains('active')) {
            // Prevent HTMX request if the project is already open
            event.preventDefault();
        } else {
            // Close any open projects before proceeding
            closeAllOpenProjects();
        }
    };

    /**
     * Handles HTMX beforeSwap event to perform cleanup before content is swapped.
     * @param {Event} event - The HTMX event.
     */
    const handleHTMXBeforeSwap = (event) => {
        cleanupActiveHLSPlayers();
    };

    /**
     * Handles HTMX afterSwap event to animate newly loaded project items
     * @param {Event} event - The HTMX event
     */
    const handleHTMXAfterSwap = (event) => {
        const { elt } = event.detail;

        // Check if the swapped element is an infinite scroll sentinel
        if (elt.id && elt.id.startsWith('infinite-scroll-sentinel')) {
            // Select all new project items that do not have 'fade-in' or 'no-fade' classes
            const newProjectItems = elt.parentElement.querySelectorAll('.project-item:not(.fade-in):not(.no-fade)');

            if (window.location.pathname === '/') {
                // Animate the newly loaded project items
                animateProjectItems(newProjectItems);
            } else {
                // Ensure newly loaded project items are visible without animation
                newProjectItems.forEach(item => {
                    item.classList.add('no-fade');
                });
            }
        }

        // Existing logic for handling project-details swaps
        if (elt.classList.contains('project-details')) {
            const projectItem = elt.closest('.project-item');
            if (elt.innerHTML.trim() !== '') {
                projectItem.classList.add('active');

                // Initialize HLS player if video is present
                const video = elt.querySelector('video.project-video');
                if (video) {
                    setupHLSPlayer(video, true).catch(err => {
                        console.error('Failed to initialize HLS player:', err);
                    });
                }

                // Scroll to the project header using the custom function
                const projectHeader = projectItem.querySelector('.project-header');
                if (projectHeader) {
                    scrollToProjectHeader(projectHeader);
                }
            } else {
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
            }
        }

        // Initialize lazy loading for newly inserted thumbnails and videos
        initializeLazyThumbnails(elt);
        initializeLazyVideos(elt);
    };

    /**
     * Handles HTMX load event for project items
     * @param {Event} event - The HTMX event
     */
    const handleHTMXLoad = (event) => {
        const { elt } = event.detail;
        if (elt.classList.contains('project-item')) {
            handleProjectContent(elt);
        }
    };

    /**
     * Handles the initial load of a project if it's already active
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
     * Initializes all necessary elements and event listeners
     */
    const initialize = () => {
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

        // Initialize lazy loading for videos
        initializeLazyVideos();

        // Handle initial load (e.g., when navigating directly to an open project)
        handleInitialLoad();

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

        // Event listener for close project buttons using event delegation
        document.body.addEventListener('click', function(event) {
            const target = event.target.closest('.close-project');
            if (target) {
                const isIsolationMode = document.body.dataset.isolationMode === 'true';
                if (isIsolationMode) {
                    event.preventDefault();
                    closeProject(target);
                }
                // Else, let HTMX handle the click
            }
        });
    };

    /**
     * Closes a specific project item smoothly.
     * @param {HTMLElement} button - The close button element.
     * @returns {Promise} Resolves when the close transition is complete.
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
                    // Navigate back to the root URL
                    window.location.href = '/';
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

    /**
     * Handles window unload events to ensure all HLS players are destroyed.
     */
    const handleWindowUnload = () => {
        cleanupActiveHLSPlayers();
    };

    // Attach the window unload event listener
    window.addEventListener('beforeunload', handleWindowUnload);

    // Event listeners for HTMX
    document.body.addEventListener('htmx:afterSwap', handleHTMXAfterSwap);
    document.body.addEventListener('htmx:beforeRequest', handleHTMXBeforeRequest);
    document.body.addEventListener('htmx:load', handleHTMXLoad);
    document.body.addEventListener('htmx:beforeSwap', handleHTMXBeforeSwap);

    // Initialize on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initialize);
})();