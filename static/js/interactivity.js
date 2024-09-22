// URL Routing Functions

/**
 * Updates the URL in the browser's address bar without reloading the page.
 * @param {string} projectSlug - The slug of the project to be reflected in the URL.
 */
function updateURL(projectSlug) {
    history.pushState(null, '', '/' + projectSlug);
}

/**
 * Handles the browser's back/forward navigation.
 * Closes all projects if navigating to home, or opens the corresponding project.
 */
function handlePopState() {
    const path = window.location.pathname;
    if (path === '/') {
        // Close all open projects
        document.querySelectorAll('.project-item').forEach(closeProject);
    } else {
        // Open the project corresponding to the current URL
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
    projectDetail.innerHTML = '';
    closeButton.style.display = 'none';
}

/**
 * Fades in a video element by setting its opacity to 1.
 * @param {HTMLVideoElement} video - The video element to fade in.
 */
function fadeInVideo(video) {
    // Add a small delay to ensure the browser has time to apply the initial style
    setTimeout(() => {
        video.style.opacity = '1';
    }, 50);
}

/**
 * Handles the fade-in effect for a video, whether it's already loaded or not.
 * @param {HTMLVideoElement} video - The video element to handle.
 */
function handleVideoFadeIn(video) {
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA or higher
        fadeInVideo(video);
    } else {
        video.addEventListener('loadeddata', () => fadeInVideo(video));
    }
    video.addEventListener('error', () => {
        console.error('Error loading video');
    });
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

// Lazy Load Videos

/**
 * Implements lazy loading for videos using Intersection Observer.
 */
function lazyLoadVideos() {
    const videos = document.querySelectorAll('video[data-src]');
    const options = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

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

    videos.forEach(video => observer.observe(video));
}

// Event Listeners

/**
 * Initializes the page and handles direct navigation to project URLs.
 */
document.addEventListener('DOMContentLoaded', function() {
    lazyLoadVideos();
    updateCloseButtonVisibility();

    const path = window.location.pathname;
    if (path !== '/') {
        const projectSlug = path.slice(1);
        const projectItem = document.querySelector(`.project-item[data-slug="${projectSlug}"]`);
        if (projectItem) {
            const projectHeader = projectItem.querySelector('.project-header');
            const video = projectItem.querySelector('video');
            if (video) {
                handleVideoFadeIn(video);
            }
            projectHeader.scrollIntoView({ behavior: 'smooth' });
        }
    }
});

/**
 * Handles browser back/forward navigation.
 */
window.addEventListener('popstate', handlePopState);

/**
 * Handles project opening via HTMX.
 */
document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        const projectItem = event.detail.target.closest('.project-item');
        if (projectItem) {
            const projectHeader = projectItem.querySelector('.project-header');
            const projectSlug = projectItem.getAttribute('data-slug');
            
            updateURL(projectSlug);
            updateCloseButtonVisibility();

            // Handle video loading
            const video = projectItem.querySelector('video');
            if (video) {
                handleVideoFadeIn(video);
            }

            // Smooth scroll after a short delay to allow content to render
            requestAnimationFrame(() => {
                const headerRect = projectHeader.getBoundingClientRect();
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const targetScrollPosition = headerRect.top + scrollTop - 20; // 20px offset for some breathing room

                window.scrollTo({
                    top: targetScrollPosition,
                    behavior: 'smooth'
                });
            });
        }
    }
    lazyLoadVideos();
});

/**
 * Handles project toggling (closing an open project when clicked again).
 */
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

/**
 * Handles closing a project via the close button.
 */
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('close-project')) {
        event.preventDefault();
        const projectItem = event.target.closest('.project-item');
        closeProject(projectItem);
        updateURL('');
    }
});

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

    const options = { ...defaultOptions, ...additionalOptions, selector };
    tinymce.init(options);
}

/**
 * Sets up event listeners for form submission and redirection
 * @param {string} formId - The ID of the form to set up listeners for
 */
function setupFormListeners(formId) {
    const form = document.getElementById(formId);
    if (form) {
        form.addEventListener('htmx:beforeRequest', function(event) {
            tinymce.triggerSave();
        });

        // This listener is now attached to the form instead of document.body
        form.addEventListener('htmx:beforeSwap', function(event) {
            if (event.detail.xhr.status === 303) {
                window.location.href = event.detail.xhr.getResponseHeader('HX-Redirect');
                event.preventDefault();
            }
        });
    } else {
        console.warn(`Form with id '${formId}' not found`);
    }
}

// Call this function for both edit and create forms
document.addEventListener('DOMContentLoaded', function() {
    setupFormListeners('edit-form');
    setupFormListeners('create-form');
});