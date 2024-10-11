(() => {
    /**
     * Initializes TinyMCE for a given selector
     * @param {string} selector - The selector for the textarea to initialize TinyMCE on
     * @param {Object} additionalOptions - Additional options to merge with the default TinyMCE config
     */
    const initTinyMCE = (selector, additionalOptions = {}) => {
        const defaultOptions = {
            plugins: 'anchor autolink charmap codesample code emoticons image link lists media searchreplace table visualblocks wordcount linkchecker',
            toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link image media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
            mergetags_list: [
                { value: 'First.Name', title: 'First Name' },
                { value: 'Email', title: 'Email' },
            ],
            setup: (editor) => {
                editor.on('change', () => {
                    tinymce.triggerSave();
                });
            }
        };

        tinymce.init({ ...defaultOptions, ...additionalOptions, selector });
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
    const copyToClipboard = (text, notificationMessage) => {
        navigator.clipboard.writeText(text)
            .then(() => {
                showNotification(notificationMessage);
            })
            .catch(err => {
                console.error('Failed to copy: ', err);
                showNotification('Failed to copy the URL.', true);
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

            const initializeVideo = () => {
                adjustVideoContainerAspectRatio(videoElement);
                if (autoplay) {
                    videoElement.play().catch(e => {
                        console.error("Autoplay failed:", e);
                        // Optional: Show play button or user prompt here
                    });
                }
                resolve();
            };

            if (Hls.isSupported()) {
                const hls = new Hls();
                videoElement.hlsInstance = hls;  // Store instance for cleanup
                hls.loadSource(streamUrl);
                hls.attachMedia(videoElement);
                hls.on(Hls.Events.MANIFEST_PARSED, initializeVideo);
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
     * Adjusts the aspect ratio of the video container based on video dimensions
     * @param {HTMLVideoElement} videoElement - The video element whose container to adjust
     */
    const adjustVideoContainerAspectRatio = (videoElement) => {
        const container = videoElement.closest('.video-container');
        if (!container) return;

        const updateAspectRatio = () => {
            const { videoWidth, videoHeight } = videoElement;
            if (videoWidth && videoHeight) {
                const videoAspectRatio = videoWidth / videoHeight;
                container.style.aspectRatio = `${videoAspectRatio}`;

                const maxContainerHeight = window.innerHeight * 0.8;
                const containerWidth = container.offsetWidth;
                const containerHeight = containerWidth / videoAspectRatio;

                if (containerHeight > maxContainerHeight) {
                    const adjustedWidth = maxContainerHeight * videoAspectRatio;
                    container.style.width = `${adjustedWidth}px`;
                } else {
                    container.style.width = ''; // Reset to default if height is within limit
                }
            }
        };

        if (videoElement.readyState >= 1) {
            updateAspectRatio();
        } else {
            videoElement.addEventListener('loadedmetadata', updateAspectRatio);
        }

        window.addEventListener('resize', debounce(updateAspectRatio, 200));
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
     * Callback for IntersectionObserver to handle visibility of thumbnails
     * @param {IntersectionObserverEntry[]} entries 
     * @param {IntersectionObserver} observer 
     */
    const handleIntersection = (entries, observer) => {
        entries.forEach(entry => {
            entry.target.dataset.animate = entry.isIntersecting ? 'true' : 'false';
        });
    };

    // Initialize IntersectionObserver
    const observer = new IntersectionObserver(handleIntersection);

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
     * Handles the opening or closing of project content
     * @param {HTMLElement} projectItem - The project item element
     */
    const handleProjectContent = async (projectItem) => {
        try {
            const video = projectItem.querySelector('video.project-video');
            const videoContainer = projectItem.querySelector('.video-container');
            const thumbnail = projectItem.querySelector('.thumbnail');

            if (projectItem.classList.contains('active')) {
                // Project is being opened
                if (video && videoContainer) {
                    await setupHLSPlayer(video, true);
                }

                // Smooth scroll to the project header
                const projectHeader = projectItem.querySelector('.project-header');
                if (projectHeader) {
                    projectHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else {
                // Project is being closed
                if (video) {
                    video.pause();
                    video.src = '';
                    if (video.hlsInstance) {
                        video.hlsInstance.destroy();
                        video.hlsInstance = null;
                    }
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
     * Handles the initial load of a project if it's already active
     */
    const handleInitialLoad = async () => {
        const openProjectItem = document.querySelector('.project-item.active');
        if (openProjectItem) {
            await handleProjectContent(openProjectItem);
            const projectHeader = openProjectItem.querySelector('.project-header');
            if (projectHeader) {
                projectHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    /**
     * Toggles the 'active' class on a project item and manages the visibility of the close button
     * @param {HTMLElement} projectItem - The project item element
     * @param {boolean} isActive - Whether to activate or deactivate the project item
     */
    const toggleActiveClass = (projectItem, isActive) => {
        if (isActive) {
            projectItem.classList.add('active');
            // Show the close button
            const closeButton = projectItem.querySelector('.close-project.hidden');
            if (closeButton) {
                closeButton.classList.remove('hidden');
            }
        } else {
            projectItem.classList.remove('active');
            // Hide the close button
            const closeButton = projectItem.querySelector('.close-project:not(.hidden)');
            if (closeButton) {
                closeButton.classList.add('hidden');
            }
        }
    };

    /**
     * Debounce function to limit the rate at which a function can fire
     * @param {Function} func - The function to debounce
     * @param {number} wait - The debounce delay in milliseconds
     * @returns {Function}
     */
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
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
            const pixelsPerFrame = 1; // Adjust to control base animation speed (decrease to speed up)
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
     * Handles HTMX swap events to initialize or reset project content
     * @param {Event} event - The HTMX event
     */
    const handleHTMXSwap = (event) => {
        const target = event.target;
        if (target.classList.contains('project-details')) {
            const projectItem = target.closest('.project-item');
            const isActive = target.innerHTML.trim() !== '' && !target.querySelector('.thumbnail');
            toggleActiveClass(projectItem, isActive);

            if (isActive) {
                // Initialize HLS player if video is present
                const video = target.querySelector('video.project-video');
                if (video) {
                    setupHLSPlayer(video, true);
                }

                // Smooth scroll to the project header
                const projectHeader = projectItem.querySelector('.project-header');
                if (projectHeader) {
                    projectHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else {
                // If project is closed, pause and reset video
                const video = target.querySelector('video.project-video');
                if (video) {
                    video.pause();
                    video.src = '';
                    if (video.hlsInstance) {
                        video.hlsInstance.destroy();
                        video.hlsInstance = null;
                    }
                }
                // Reset thumbnail position if needed
                const thumbnail = target.querySelector('.thumbnail');
                if (thumbnail) {
                    resetThumbnailPosition(thumbnail);
                }
            }
        }
    };

    /**
     * Handles HTMX:afterSwap event for initializing newly loaded content
     * @param {Event} event - The HTMX event
     */
    const handleHTMXAfterSwap = (event) => {
        const { elt } = event.detail;
        if (elt.classList.contains('project-item')) {
            handleProjectContent(elt);
        } else if (elt.classList.contains('project-details')) {
            handleHTMXSwap(event);
        }
    };

    /**
     * Prevents HTMX requests when clicking on an already open project
     * @param {Event} event - The HTMX event
     */
    const preventHTMXOnActiveProject = (event) => {
        const triggerElt = event.detail.elt;
        if (triggerElt.matches('.project-header') && triggerElt.closest('.project-item').classList.contains('active')) {
            // Prevent HTMX request if the project is already open
            event.preventDefault();
        }
    };

    /**
     * Handles the initial load of the page
     */
    const handleInitialPageLoad = async () => {
        await handleInitialLoad();
    };

    /**
     * Initializes all necessary elements and event listeners
     */
    const initialize = () => {
        // Observe thumbnails
        document.querySelectorAll('.thumbnail').forEach(thumbnail => {
            observer.observe(thumbnail); // Start observing each thumbnail
        });

        // Initialize HLS player if the reel video is present
        const reelVideo = document.getElementById('reel-video-player');
        if (reelVideo) {
            setupHLSPlayer(reelVideo, false);
        }

        // Handle initial load (e.g., when navigating directly to an open project)
        handleInitialPageLoad();

        // Event delegation for elements with class 'copy-text-link'
        document.body.addEventListener('click', (event) => {
            const button = event.target.closest('.copy-text-link');
            if (button) {
                event.preventDefault(); // Prevent default button behavior if any

                const fetchUrl = button.getAttribute('data-fetch-url');
                const textToCopy = button.getAttribute('data-copy-text');
                const notificationMessage = button.getAttribute('data-notification-message') || 'URL copied to clipboard!';

                if (fetchUrl) {
                    // Fetch the share URL from the server
                    fetch(fetchUrl)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Network response was not ok: ${response.statusText}`);
                            }
                            return response.json();
                        })
                        .then(data => {
                            if (data.share_url) {
                                copyToClipboard(data.share_url, notificationMessage);
                            } else {
                                console.error('share_url not found in the response');
                                showNotification('Failed to retrieve the share URL.', true);
                            }
                        })
                        .catch(err => {
                            console.error('Failed to fetch share URL:', err);
                            showNotification('An error occurred while copying the URL.', true);
                        });
                } else if (textToCopy) {
                    // Directly copy the provided text
                    copyToClipboard(textToCopy, notificationMessage);
                } else {
                    console.warn('No text or fetch URL provided for copying.');
                }
            }
        });
    };

    // Event listeners
    document.addEventListener('DOMContentLoaded', initialize);
    document.body.addEventListener('htmx:afterSwap', handleHTMXAfterSwap);
    document.body.addEventListener('htmx:beforeRequest', preventHTMXOnActiveProject);
    document.body.addEventListener('htmx:load', (event) => {
        const { elt } = event.detail;
        if (elt.classList.contains('project-item')) {
            handleProjectContent(elt);
        }
    });

})();