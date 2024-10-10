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

// Function to initialize HLS video players
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

// Function to adjust the aspect ratio of the video container
function adjustVideoContainerAspectRatio(videoElement) {
    const container = videoElement.closest('.video-container');
    if (!container) return;

    const updateAspectRatio = () => {
        if (videoElement.videoWidth && videoElement.videoHeight) {
            const videoAspectRatio = videoElement.videoWidth / videoElement.videoHeight;
            container.style.aspectRatio = `${videoElement.videoWidth} / ${videoElement.videoHeight}`;

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

// Intersection Observer setup for handling visibility of thumbnails
function handleIntersection(entries, observer) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.dataset.animate = 'true'; // Mark to animate
        } else {
            entry.target.dataset.animate = 'false'; // Mark to stop animation
        }
    });
}

if (typeof observer === 'undefined') {
    var observer = new IntersectionObserver(handleIntersection);
}

// Function to update thumbnails - only animates visible thumbnails
function updateThumbnails() {
    const thumbnails = document.querySelectorAll('.thumbnail');
    thumbnails.forEach(thumbnail => {
        if (thumbnail.dataset.animate === 'true') {
            const totalFrames = parseInt(thumbnail.dataset.frames);
            const frameWidth = parseInt(thumbnail.dataset.frameWidth);
            const frameHeight = parseInt(thumbnail.dataset.frameHeight);
            const columns = parseInt(thumbnail.dataset.columns);
            let frameIndex = Math.floor(animationProgress) % totalFrames;
            const frameX = (frameIndex % columns) * frameWidth;
            const frameY = Math.floor(frameIndex / columns) * frameHeight;
            thumbnail.style.backgroundPosition = `-${frameX}px -${frameY}px`;
        }
    });
}

// Function to handle project content when opened
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

// Function to handle the initial load of a project
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

// Function to copy share URL
function copyShareURL(response) {
    const data = JSON.parse(response);
    copyToClipboard(data.share_url, 'URL copied to clipboard!');
}

// Thumbnail scrolling logic

// Initialize variables (check if already defined)
if (typeof lastScrollTop === 'undefined') {
    var lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
}
if (typeof lastScrollEventTime === 'undefined') {
    var lastScrollEventTime = Date.now();
}
if (typeof animationSpeed === 'undefined') {
    var animationSpeed = 0; // frames per second
}
if (typeof animationProgress === 'undefined') {
    var animationProgress = 0; // in frames
}
if (typeof lastAnimationFrameTime === 'undefined') {
    var lastAnimationFrameTime = Date.now();
}

// Scroll event listener to update scroll velocity and animation speed
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

// Animation loop using requestAnimationFrame
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

// Function to update thumbnails
function updateThumbnails() {
    const thumbnails = document.querySelectorAll('.thumbnail');

    thumbnails.forEach(function(thumbnail) {
        // Get data attributes for each thumbnail
        const totalFrames = parseInt(thumbnail.dataset.frames);
        const frameWidth = parseInt(thumbnail.dataset.frameWidth);
        const frameHeight = parseInt(thumbnail.dataset.frameHeight);
        const columns = parseInt(thumbnail.dataset.columns);

        // Calculate number of rows in the sprite sheet
        const rows = Math.ceil(totalFrames / columns);

        // Set background size based on sprite sheet dimensions
        const spriteSheetWidth = frameWidth * columns;
        const spriteSheetHeight = frameHeight * rows;
        thumbnail.style.backgroundSize = `${spriteSheetWidth}px ${spriteSheetHeight}px`;

        // Calculate current frame based on animationProgress
        let frameIndex = Math.floor(animationProgress) % totalFrames;
        if (frameIndex < 0) frameIndex += totalFrames; // Handle negative values

        // Calculate frame position within the sprite sheet
        const frameX = (frameIndex % columns) * frameWidth;
        const frameY = Math.floor(frameIndex / columns) * frameHeight;

        // Update background position to display the correct frame
        thumbnail.style.backgroundPosition = `-${frameX}px -${frameY}px`;
    });
}

// Function to reset thumbnail position
function resetThumbnailPosition(thumbnail) {
    if (thumbnail) {
        thumbnail.style.backgroundPosition = '0 0';
    }
}

// Function to handle project content when closed
function handleProjectClosed(projectItem) {
    const thumbnail = projectItem.querySelector('.thumbnail');
    if (thumbnail) {
        resetThumbnailPosition(thumbnail);
    }
}

// Event listeners

document.addEventListener('DOMContentLoaded', function() {
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
    handleInitialLoad();

    // Event delegation for elements with class 'copy-text-link'
    document.body.addEventListener('click', function(event) {
        // Use closest to handle clicks on child elements like the <i> tag
        const button = event.target.closest('.copy-text-link');
        if (button) {
            event.preventDefault(); // Prevent default button behavior if any

            const fetchUrl = button.getAttribute('data-fetch-url');
            const textToCopy = button.getAttribute('data-copy-text');
            const notificationMessage = button.getAttribute('data-notification-message') || 'Text copied to clipboard!';

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

    // Function to copy text to clipboard and show notification
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

    // Function to display error notifications
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

    // Initial update of thumbnails on page load
    updateThumbnails();
});

// Handle HTMX content swapping
document.body.addEventListener('htmx:load', function(event) {
    if (event.detail.elt.classList.contains('project-item')) {
        const projectItem = event.detail.elt;
        handleProjectContent(projectItem);
    }
});

// Prevent default action when clicking on an already open project
document.body.addEventListener('htmx:beforeRequest', function(event) {
    const triggerElt = event.detail.elt;
    if (triggerElt.matches('.project-header') && triggerElt.closest('.project-item').classList.contains('active')) {
        // Prevent HTMX request if the project is already open
        event.preventDefault();
    }
});