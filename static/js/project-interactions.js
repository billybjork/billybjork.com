function closeProject(projectItem) {
    const projectDetail = projectItem.querySelector('.project-detail');
    const closeButton = projectItem.querySelector('.close-project');
    projectDetail.innerHTML = '';
    closeButton.style.display = 'none';
}

function fadeInVideo(video) {
    video.style.opacity = '1';
}

document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        const projectItem = event.detail.target.closest('.project-item');
        if (projectItem) {
            const projectHeader = projectItem.querySelector('.project-header');
            const closeButton = projectHeader.querySelector('.close-project');
            if (closeButton) {
                closeButton.style.display = 'inline-block';
            }
            
            // Handle video loading
            const video = projectItem.querySelector('video');
            if (video) {
                video.addEventListener('loadedmetadata', function() {
                    fadeInVideo(video);
                });
                video.addEventListener('error', function() {
                    console.error('Error loading video');
                });
            }

            // Smooth scroll after a short delay to allow content to render
            setTimeout(() => {
                projectHeader.scrollIntoView({behavior: 'smooth', block: 'start'});
            }, 100);
        }
    }
});

document.body.addEventListener('htmx:beforeRequest', function(event) {
    if (event.detail.elt.classList.contains('project-header')) {
        const projectItem = event.detail.elt.closest('.project-item');
        const projectDetail = projectItem.querySelector('.project-detail');
        if (projectDetail.innerHTML.trim() !== '') {
            closeProject(projectItem);
            event.preventDefault();
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('close-project')) {
        event.preventDefault();
        const projectItem = event.target.closest('.project-item');
        closeProject(projectItem);
    }
});

// Lazy load videos
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

// Call lazyLoadVideos when the page loads and after each HTMX swap
document.addEventListener('DOMContentLoaded', lazyLoadVideos);
document.body.addEventListener('htmx:afterSwap', lazyLoadVideos);