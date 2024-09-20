// Store HLS instances
const hlsInstances = new Map();

function initializeVideoPlayer() {
    const videoPlayer = document.getElementById('video-player');
    if (!videoPlayer) return;

    const videoSrc = videoPlayer.dataset.src;
    const videoContainer = document.getElementById('video-container');

    if (!videoSrc) {
        videoContainer.classList.add('hidden');
        return;
    }

    const handleError = (error) => {
        console.error("Error loading video:", error);
        videoContainer.classList.add('hidden');
    };

    // Destroy existing HLS instance if it exists
    if (hlsInstances.has(videoPlayer)) {
        hlsInstances.get(videoPlayer).destroy();
        hlsInstances.delete(videoPlayer);
    }

    if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(videoSrc);
        hls.attachMedia(videoPlayer);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            // Video ready to play
        });
        hls.on(Hls.Events.ERROR, (_, data) => handleError(data));
        
        // Store the HLS instance
        hlsInstances.set(videoPlayer, hls);
    } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
        videoPlayer.src = videoSrc;
        videoPlayer.addEventListener('loadedmetadata', () => {
            // Video ready to play
        });
        videoPlayer.addEventListener('error', handleError);
    } else {
        handleError("HLS is not supported on this browser");
    }
}

// Function to stop all videos
function stopAllVideos() {
    document.querySelectorAll('video').forEach(video => {
        video.pause();
        video.currentTime = 0;
    });
}

// Event listener for project header clicks
document.addEventListener('click', function(event) {
    if (event.target.closest('.project-header')) {
        const projectItem = event.target.closest('.project-item');
        const projectDetail = projectItem.querySelector('.project-detail');
        
        // Stop all videos before loading new content
        stopAllVideos();

        // Close all other open project details
        document.querySelectorAll('.project-detail:not(:empty)').forEach(detail => {
            if (detail !== projectDetail) {
                // Destroy HLS instance if it exists
                const video = detail.querySelector('#video-player');
                if (video && hlsInstances.has(video)) {
                    hlsInstances.get(video).destroy();
                    hlsInstances.delete(video);
                }
                detail.innerHTML = '';
            }
        });

        // If the clicked project is already open, close it
        if (projectDetail.innerHTML.trim() !== '') {
            // Destroy HLS instance if it exists
            const video = projectDetail.querySelector('#video-player');
            if (video && hlsInstances.has(video)) {
                hlsInstances.get(video).destroy();
                hlsInstances.delete(video);
            }
            projectDetail.innerHTML = '';
            event.preventDefault(); // Prevent HTMX from making a request
        }
    }
});

// Event listener for HTMX content swap
document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.classList.contains('project-detail')) {
        event.detail.target.scrollIntoView({behavior: 'smooth'});
        initializeVideoPlayer(); // Initialize the video player after content is loaded
    }
});