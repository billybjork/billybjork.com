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
                });
            }
            resolve();
        };

        if (Hls.isSupported()) {
            const hls = new Hls();
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

            // Limit container height to max-height (80vh)
            const maxContainerHeight = window.innerHeight * 0.8; // 80vh
            const containerWidth = container.offsetWidth;
            const containerHeight = containerWidth / videoAspectRatio;

            if (containerHeight > maxContainerHeight) {
                // Adjust container width to maintain aspect ratio within max-height
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

// Function to handle project content when opened
async function handleProjectContent(projectItem) {
    try {
        const video = projectItem.querySelector('video.project-video');
        const videoContainer = projectItem.querySelector('.video-container');
        const projectContent = projectItem.querySelector('.project-content');

        // Add the 'active' class to the project item
        projectItem.classList.add('active');

        if (video && videoContainer) {
            await setupHLSPlayer(video, true);
        }

        // Smooth scroll to the project header
        const projectHeader = projectItem.querySelector('.project-header');
        if (projectHeader) {
            projectHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
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

// Function to copy text to clipboard and show notification
function copyToClipboard(text, notificationMessage) {
    navigator.clipboard.writeText(text).then(() => {
        // Display a temporary message
        const message = document.createElement('div');
        message.className = 'copy-notification';
        message.textContent = notificationMessage;
        document.body.appendChild(message);
        setTimeout(() => {
            document.body.removeChild(message);
        }, 4000); // Remove after 4 seconds to match the animation
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

// Function to copy share URL
function copyShareURL(response) {
    const data = JSON.parse(response);
    copyToClipboard(data.share_url, 'URL copied to clipboard!');
}

// Thumbnail scrolling logic
function updateThumbnails() {
    const thumbnails = document.querySelectorAll('.thumbnail');
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const documentHeight = document.documentElement.scrollHeight - window.innerHeight;

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

        // Calculate current frame based on scroll position
        const scrollFraction = scrollTop / documentHeight;
        const adjustedScrollFraction = scrollFraction * 30;  // Increase the multiplier to speed up
        const frameIndex = Math.floor(adjustedScrollFraction * totalFrames) % totalFrames;

        // Calculate frame position within the sprite sheet
        const frameX = (frameIndex % columns) * frameWidth;
        const frameY = Math.floor(frameIndex / columns) * frameHeight;

        // Update background position to display the correct frame
        thumbnail.style.backgroundPosition = `-${frameX}px -${frameY}px`;
    });
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize HLS player if the reel video is present
    const reelVideo = document.getElementById('reel-video-player');
    if (reelVideo) {
        setupHLSPlayer(reelVideo, false);
    }

    // Handle initial load (e.g., when navigating directly to an open project)
    handleInitialLoad();

    // Event listener for elements with class 'copy-text-link'
    document.querySelectorAll('.copy-text-link').forEach((element) => {
        element.addEventListener('click', function(event) {
            event.preventDefault(); // Prevent default link behavior
            const textToCopy = this.getAttribute('data-copy-text');
            const notificationMessage = this.getAttribute('data-notification-message') || 'Text copied to clipboard!';
            copyToClipboard(textToCopy, notificationMessage);
        });
    });

    // Update thumbnails on scroll
    window.addEventListener('scroll', updateThumbnails);

    // Initial update of thumbnails on page load
    updateThumbnails();
});

// Handle HTMX content swapping
document.body.addEventListener('htmx:load', function(event) {
    if (event.target.classList.contains('project-item')) {
        const projectItem = event.target;

        // Check if the project is open
        if (projectItem.classList.contains('active')) {
            handleProjectContent(projectItem);
        } else {
            // Pause and remove the video if it exists
            const video = projectItem.querySelector('video.project-video');
            if (video) {
                video.pause();
                video.src = '';
            }
            projectItem.classList.remove('active');
        }
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