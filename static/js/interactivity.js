/**
 * Initializes TinyMCE for a given selector
 * @param {string} selector - The selector for the textarea to initialize TinyMCE on
 * @param {Object} additionalOptions - Additional options to merge with the default TinyMCE config
 */
function initTinyMCE(selector, additionalOptions = {}) {
    const defaultOptions = {
        plugins: 'anchor autolink charmap codesample code emoticons image link lists media searchreplace table visualblocks wordcount linkchecker',
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

/**
 * Function to copy text to clipboard and show notification
 * @param {string} text - The text to copy
 * @param {string} notificationMessage - The message to display after copying
 */
function copyToClipboard(text, notificationMessage) {
    navigator.clipboard.writeText(text).then(() => {
        // Display a temporary message
        const message = document.createElement('div');
        message.className = 'copy-notification';
        message.textContent = notificationMessage;
        document.body.appendChild(message);
        setTimeout(() => {
            if (message.parentNode) { // Check if the element still exists
                document.body.removeChild(message);
            }
        }, 4000); // Remove after 4 seconds to match the animation
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showErrorNotification('Failed to copy the URL.');
    });
}

/**
 * Function to display error notifications
 * @param {string} errorMessage - The error message to display
 */
function showErrorNotification(errorMessage) {
    const message = document.createElement('div');
    message.className = 'copy-notification error';
    message.textContent = errorMessage;
    document.body.appendChild(message);
    setTimeout(() => {
        if (message.parentNode) { // Check if the element still exists
            document.body.removeChild(message);
        }
    }, 4000);
}

/**
 * Function to setup HLS video players
 * @param {HTMLVideoElement} videoElement - The video element to initialize
 * @param {boolean} autoplay - Whether to autoplay the video
 * @returns {Promise}
 */
function setupHLSPlayer(videoElement, autoplay = false) {
    return new Promise((resolve, reject) => {
        const streamUrl = videoElement.dataset.hlsUrl;
        if (!streamUrl) {
            console.error('No HLS URL provided for video element');
            reject('No HLS URL provided');
            return;
        }

        const setupVideo = () => {
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
            hls.on(Hls.Events.MANIFEST_PARSED, setupVideo);
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = streamUrl;
            videoElement.addEventListener('loadedmetadata', setupVideo);
        } else {
            console.error('HLS is not supported in this browser');
            reject('HLS is not supported');
        }
    });
}

/**
 * Function to adjust the aspect ratio of the video container
 * @param {HTMLVideoElement} videoElement - The video element whose container to adjust
 */
function adjustVideoContainerAspectRatio(videoElement) {
    const container = videoElement.closest('.video-container');
    if (!container) return;

    const updateAspectRatio = () => {
        if (videoElement.videoWidth && videoElement.videoHeight) {
            const videoAspectRatio = videoElement.videoWidth / videoElement.videoHeight;
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
    window.addEventListener('resize', updateAspectRatio);
}

/**
 * Function to reset thumbnail background position
 * @param {HTMLElement} thumbnail - The thumbnail element to reset
 */
function resetThumbnailPosition(thumbnail) {
    if (thumbnail) {
        thumbnail.style.backgroundPosition = '0 0';
    }
}

/**
 * Intersection Observer callback to handle visibility of thumbnails
 * @param {IntersectionObserverEntry[]} entries 
 * @param {IntersectionObserver} observer 
 */
function handleIntersection(entries, observer) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.dataset.animate = 'true'; // Mark to animate
        } else {
            entry.target.dataset.animate = 'false'; // Mark to stop animation
        }
    });
}

// Initialize IntersectionObserver
const observer = new IntersectionObserver(handleIntersection);

/**
 * Function to update thumbnails based on animation progress
 */
function updateThumbnails() {
    const thumbnails = document.querySelectorAll('.thumbnail');

    thumbnails.forEach(function(thumbnail) {
        const totalFrames = parseInt(thumbnail.dataset.frames);
        const frameWidth = parseInt(thumbnail.dataset.frameWidth);
        const frameHeight = parseInt(thumbnail.dataset.frameHeight);
        const columns = parseInt(thumbnail.dataset.columns);

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
}

/**
 * Function to handle project content when opened or closed
 * @param {HTMLElement} projectItem - The project item element
 */
async function handleProjectContent(projectItem) {
    try {
        const video = projectItem.querySelector('video.project-video');
        const videoContainer = projectItem.querySelector('.video-container');
        const projectContent = projectItem.querySelector('.project-content');
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
}

/**
 * Function to handle the initial load of a project
 */
async function handleInitialLoad() {
    const openProjectItem = document.querySelector('.project-item.active');
    if (openProjectItem) {
        await handleProjectContent(openProjectItem);
        const projectHeader = openProjectItem.querySelector('.project-header');
        if (projectHeader) {
            projectHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

/**
 * Function to handle project content when closed
 * @param {HTMLElement} projectItem - The project item element
 */
function handleProjectClosed(projectItem) {
    const thumbnail = projectItem.querySelector('.thumbnail');
    if (thumbnail) {
        resetThumbnailPosition(thumbnail);
    }
}

/**
 * Function to toggle the 'active' class based on content
 * @param {HTMLElement} projectItem - The project item element
 * @param {boolean} isActive - Whether to activate or deactivate the project item
 */
function toggleActiveClass(projectItem, isActive) {
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
}

/**
 * Scroll event listener to update scroll velocity and animation speed
 */
let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
let lastScrollEventTime = Date.now();
let animationSpeed = 0; // frames per second
let animationProgress = 0; // in frames
let lastAnimationFrameTime = Date.now();

window.addEventListener('scroll', function() {
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
});

/**
 * Animation loop using requestAnimationFrame to update thumbnails
 */
function animationLoop() {
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

    // Ensure animationProgress wraps around within totalFrames
    // (Assuming all thumbnails have the same totalFrames; if not, handle individually)
    animationProgress = animationProgress % 60; // 60 total frames
    if (animationProgress < 0) {
        animationProgress += 60;
    }

    // Update the thumbnails
    updateThumbnails();

    // Continue the animation loop
    requestAnimationFrame(animationLoop);
}

// Start the animation loop
lastAnimationFrameTime = Date.now();
requestAnimationFrame(animationLoop);

/**
 * Function to handle HTMX content swapping and initialize new elements
 * @param {Event} event - The HTMX event
 */
function handleHTMXSwap(event) {
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
                }
            }
            // Reset thumbnail position if needed
            const thumbnail = target.querySelector('.thumbnail');
            if (thumbnail) {
                resetThumbnailPosition(thumbnail);
            }
        }
    }
}

/**
 * Function to handle HTMX:afterSwap event for initializing newly loaded content
 * @param {Event} event - The HTMX event
 */
function handleHTMXAfterSwap(event) {
    if (event.detail.elt.classList.contains('project-item')) {
        const projectItem = event.detail.elt;
        handleProjectContent(projectItem);
    } else if (event.detail.elt.classList.contains('project-details')) {
        handleHTMXSwap(event);
    }
}

/**
 * Function to prevent HTMX requests when clicking on an already open project
 * @param {Event} event - The HTMX event
 */
function preventHTMXOnActiveProject(event) {
    const triggerElt = event.detail.elt;
    if (triggerElt.matches('.project-header') && triggerElt.closest('.project-item').classList.contains('active')) {
        // Prevent HTMX request if the project is already open
        event.preventDefault();
    }
}

/**
 * Function to handle the initial load of the page
 */
async function handleInitialPageLoad() {
    await handleInitialLoad();
}

/**
 * Function to initialize all necessary elements and event listeners
 */
function initialize() {
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
    document.body.addEventListener('click', function(event) {
        // Use closest to handle clicks on child elements like the <i> tag
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
                            showErrorNotification('Failed to retrieve the share URL.');
                        }
                    })
                    .catch(err => {
                        console.error('Failed to fetch share URL:', err);
                        showErrorNotification('An error occurred while copying the URL.');
                    });
            } else if (textToCopy) {
                // Directly copy the provided text
                copyToClipboard(textToCopy, notificationMessage);
            } else {
                console.warn('No text or fetch URL provided for copying.');
            }
        }
    });
}

// Event listeners

document.addEventListener('DOMContentLoaded', initialize);

// Handle HTMX content swapping and initialization
document.body.addEventListener('htmx:afterSwap', handleHTMXAfterSwap);

// Prevent HTMX requests when clicking on an already open project
document.body.addEventListener('htmx:beforeRequest', preventHTMXOnActiveProject);

// Handle HTMX load events for newly added content
document.body.addEventListener('htmx:load', function(event) {
    if (event.detail.elt.classList.contains('project-item')) {
        const projectItem = event.detail.elt;
        handleProjectContent(projectItem);
    }
});