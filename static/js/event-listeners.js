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
            history.pushState(null, '', '/');
            event.preventDefault();
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('close-project')) {
        event.preventDefault();
        const projectItem = event.target.closest('.project-item');
        closeProject(projectItem);
        history.pushState(null, '', '/');
    }
});