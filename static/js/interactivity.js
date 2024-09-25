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
    const closeButton = projectItem.querySelector('.close-project');
    if (projectDetail) projectDetail.innerHTML = '';
    if (closeButton) closeButton.style.display = 'none';
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
            const mp4Source = videoElement.querySelector('source[type="video/mp4"]');
            if (mp4Source) {
                videoElement.src = mp4Source.src;
                videoElement.addEventListener('loadedmetadata', setupVideo);
            } else {
                reject(new Error('No supported video format available'));
            }
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
        projectDetails: projectItem.querySelector('.project-details'),
        video: projectItem.querySelector('video'),
        projectDetail: projectItem.querySelector('.project-detail')
    };
    
    Object.values(elements).forEach(el => el?.classList.remove('fade-in'));
    
    const fadeInDelay = 25; // Delay before fade-in (in milliseconds)

    if (elements.video && elements.videoContainer) {
        await setupHLSPlayer(elements.video, true);
        await new Promise(resolve => setTimeout(resolve, fadeInDelay));
        elements.videoContainer.classList.add('fade-in');
    }

    await new Promise(resolve => setTimeout(resolve, fadeInDelay));
    elements.projectDetails?.classList.add('fade-in');
    elements.projectDetail?.classList.add('fade-in');
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
            const aspectRatio = videoElement.videoHeight / videoElement.videoWidth;
            const containerWidth = container.offsetWidth;
            let containerHeight = containerWidth * aspectRatio;

            // Check if the calculated height exceeds the max-height
            const maxHeight = parseInt(getComputedStyle(container).maxHeight);
            if (containerHeight > maxHeight) {
                containerHeight = maxHeight;
                container.style.width = `${containerHeight / aspectRatio}px`;
            } else {
                container.style.width = '100%';
            }

            container.style.height = `${containerHeight}px`;
        }
    };

    if (videoElement.readyState >= 1) {
        updateAspectRatio();
    } else {
        videoElement.addEventListener('loadedmetadata', updateAspectRatio);
    }
    videoElement.addEventListener('loadeddata', updateAspectRatio);
    
    // Add resize event listener to handle viewport changes
    window.addEventListener('resize', updateAspectRatio);
}

/**
 * Updates the visibility of close buttons for all projects.
 */
function updateCloseButtonVisibility() {
    document.querySelectorAll('.project-item').forEach(item => {
        const closeButton = item.querySelector('.close-project');
        const projectDetail = item.querySelector('.project-detail');
        if (closeButton && projectDetail) {
            closeButton.style.display = projectDetail.innerHTML.trim() ? 'inline-block' : 'none';
        }
    });
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

// Event Listeners
document.addEventListener('DOMContentLoaded', function() {
    lazyLoadVideos();
    updateCloseButtonVisibility();
    handleInitialLoad();

    const reelVideo = document.getElementById('reel-video-player');
    if (reelVideo) {
        setupHLSPlayer(reelVideo, false);
    }

    setupFormListeners('edit-form');
    setupFormListeners('create-form');
});

window.addEventListener('popstate', handlePopState);

document.body.addEventListener('htmx:afterSwap', async function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        const projectItem = event.detail.target.closest('.project-item');
        if (projectItem) {
            const projectSlug = projectItem.getAttribute('data-slug');
            updateURL(projectSlug);
            updateCloseButtonVisibility();
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