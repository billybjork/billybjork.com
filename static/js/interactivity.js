// URL Routing Functions

/**
 * Updates the URL in the browser's address bar without reloading the page.
 * @param {string} projectSlug - The slug of the project to be reflected in the URL.
 */
function updateURL(projectSlug) {
    history.pushState(null, '', projectSlug ? `/${projectSlug}` : '/');
}

/**
 * Handles the browser's back/forward navigation.
 */
function handlePopState() {
    const path = window.location.pathname;
    if (path === '/') {
        document.querySelectorAll('.project-item').forEach(closeProject);
    } else {
        const projectSlug = path.slice(1);
        const projectHeader = document.querySelector(`.project-item[data-slug="${projectSlug}"] .project-header`);
        if (projectHeader) {
            projectHeader.click();
        }
    }
}

// Project Interaction Functions

/**
 * Closes a project by clearing its content and hiding the close button.
 * @param {HTMLElement} projectItem - The project item element to be closed.
 */
function closeProject(projectItem) {
    const projectDetail = projectItem.querySelector('.project-detail');
    if (projectDetail) projectDetail.innerHTML = '';

    // Remove the 'active' class
    projectItem.classList.remove('active');
}

/**
 * Sets up the HLS video player or falls back to regular video playback.
 * Returns a promise that resolves when the video is ready.
 * @param {HTMLVideoElement} videoElement - The video element to set up.
 * @param {boolean} autoplay - Whether to autoplay the video.
 * @returns {Promise} A promise that resolves when the video is ready.
 */
function setupHLSPlayer(videoElement, autoplay = false) {
    return new Promise((resolve, reject) => {
        const streamUrl = videoElement.dataset.hlsUrl;
        if (!streamUrl) {
            console.error('No HLS URL provided for video element');
            reject(new Error('No HLS URL provided'));
            return;
        }

        const setupVideo = () => {
            adjustVideoContainerAspectRatio(videoElement);
            if (autoplay) {
                videoElement.play().then(() => {
                    console.log("Autoplay started successfully");
                }).catch(e => {
                    console.error("Autoplay failed:", e);
                    // Fallback: show play button or inform user to interact
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
            reject(new Error('HLS is not supported in this browser'));
        }
    });
}

/**
 * Handles the content of a project, including video setup and fade-in effects.
 * @param {HTMLElement} projectItem - The project item element to handle.
 */
async function handleProjectContent(projectItem) {
    const elements = {
        videoContainer: projectItem.querySelector('.video-container'),
        projectContent: projectItem.querySelector('.project-content'),
        video: projectItem.querySelector('video'),
    };
    
    // Remove 'fade-in' class from elements (if any)
    Object.values(elements).forEach(el => el?.classList.remove('fade-in'));
    
    // Add the 'active' class to the project item
    projectItem.classList.add('active');

    if (elements.video && elements.videoContainer) {
        await setupHLSPlayer(elements.video, true);
        requestAnimationFrame(() => {
            elements.videoContainer.classList.add('fade-in');
        });
    }
    
    if (elements.projectContent) {
        requestAnimationFrame(() => {
            elements.projectContent.classList.add('fade-in');
        });
    }    
}

/**
 * Handles the initial load of a project when navigating directly to its URL.
 */
async function handleInitialLoad() {
    const initialOpenProject = document.querySelector('.project-detail[data-initial-open="true"]');
    if (initialOpenProject) {
        const projectItem = initialOpenProject.closest('.project-item');
        if (projectItem) {
            await handleProjectContent(projectItem);
            // We can remove the setTimeout here since handleProjectContent already includes necessary delays
            projectItem.querySelector('.project-header')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
}

/**
 * Adjusts the aspect ratio of the video container based on the video's dimensions.
 * @param {HTMLVideoElement} videoElement - The video element to adjust for.
 */
function adjustVideoContainerAspectRatio(videoElement) {
    const container = videoElement.closest('.video-container');
    if (!container) return;

    const updateAspectRatio = () => {
        if (videoElement.videoWidth && videoElement.videoHeight) {
            const videoAspectRatio = videoElement.videoWidth / videoElement.videoHeight;

            // Set the aspect-ratio property
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

/**
 * Implements lazy loading for videos using Intersection Observer.
 */
function lazyLoadVideos() {
    const options = { root: null, rootMargin: '0px', threshold: 0.1 };
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const video = entry.target;
                video.src = video.dataset.src;
                video.removeAttribute('data-src');
                observer.unobserve(video);
            }
        });
    }, options);

    document.querySelectorAll('video[data-src]').forEach(video => observer.observe(video));
}

/**
 * Initializes TinyMCE for a given selector
 * @param {string} selector - The selector for the textarea to initialize TinyMCE on
 * @param {Object} additionalOptions - Additional options to merge with the default TinyMCE config
 */
function initTinyMCE(selector, additionalOptions = {}) {
    const defaultOptions = {
        plugins: 'anchor autolink charmap codesample emoticons image link lists media searchreplace table visualblocks wordcount checklist mediaembed casechange export formatpainter pageembed linkchecker a11ychecker tinymcespellchecker permanentpen powerpaste advtable advcode editimage advtemplate mentions tableofcontents footnotes mergetags autocorrect typography inlinecss',
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
 * Sets up event listeners for form submission and redirection
 * @param {string} formId - The ID of the form to set up listeners for
 */
function setupFormListeners(formId) {
    const form = document.getElementById(formId);
    if (form) {
        form.addEventListener('htmx:beforeRequest', () => tinymce.triggerSave());
        form.addEventListener('htmx:beforeSwap', event => {
            if (event.detail.xhr.status === 303) {
                window.location.href = event.detail.xhr.getResponseHeader('HX-Redirect');
                event.preventDefault();
            }
        });
    } else {
        console.warn(`Form with id '${formId}' not found`);
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

// Existing function for copying share URL
function copyShareURL(response) {
    const data = JSON.parse(response);
    copyToClipboard(data.share_url, 'URL copied to clipboard!');
}

// Combined Event Listener
document.addEventListener('DOMContentLoaded', function() {
    // Initialize lazy loading of videos
    lazyLoadVideos();

    // Handle initial page load animations or events
    handleInitialLoad();

    // Set up HLS player if the reel video is present
    const reelVideo = document.getElementById('reel-video-player');
    if (reelVideo) {
        setupHLSPlayer(reelVideo, false);
    }

    // Set up form listeners for 'edit' and 'create' forms
    setupFormListeners('edit-form');
    setupFormListeners('create-form');

    // Event listener for elements with class 'copy-text-link'
    document.querySelectorAll('.copy-text-link').forEach((element) => {
        element.addEventListener('click', function(event) {
            event.preventDefault(); // Prevent default link behavior
            const textToCopy = this.getAttribute('data-copy-text');
            const notificationMessage = this.getAttribute('data-notification-message') || 'Text copied to clipboard!';
            copyToClipboard(textToCopy, notificationMessage);
        });
    });

    // Thumbnail scrolling logic
    const thumbnails = document.querySelectorAll('.thumbnail');

    function updateThumbnails() {
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

    // Update thumbnails on scroll
    window.addEventListener('scroll', updateThumbnails);

    // Initial update of thumbnails on page load
    updateThumbnails();
});

window.addEventListener('popstate', handlePopState);

document.body.addEventListener('htmx:afterSwap', async function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        const projectItem = event.detail.target.closest('.project-item');
        if (projectItem) {
            const projectSlug = projectItem.getAttribute('data-slug');
            updateURL(projectSlug);
            await handleProjectContent(projectItem);
            projectItem.querySelector('.project-header')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
    lazyLoadVideos();
});

document.body.addEventListener('htmx:beforeRequest', function(event) {
    if (event.detail.elt.classList.contains('project-header')) {
        const projectItem = event.detail.elt.closest('.project-item');
        const projectDetail = projectItem.querySelector('.project-detail');
        if (projectDetail.innerHTML.trim() !== '') {
            closeProject(projectItem);
            updateURL('');
            event.preventDefault();
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('close-project')) {
        event.preventDefault();
        const projectItem = event.target.closest('.project-item');
        closeProject(projectItem);
        updateURL('');
    }
});