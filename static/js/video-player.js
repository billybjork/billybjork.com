function initializeVideoPlayer() {
    const videoSrc = document.getElementById('video-player').dataset.src;
    const videoContainer = document.getElementById('video-container');
    const video = document.getElementById('video-player');

    if (!videoSrc) {
        videoContainer.classList.add('hidden');
        return;
    }

    const handleError = (error) => {
        console.error("Error loading video:", error);
        videoContainer.classList.add('hidden');
    };

    if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            // Video ready to play
        });
        hls.on(Hls.Events.ERROR, (_, data) => handleError(data));
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = videoSrc;
        video.addEventListener('loadedmetadata', () => {
            // Video ready to play
        });
        video.addEventListener('error', handleError);
    } else {
        handleError("HLS is not supported on this browser");
    }
}

document.body.addEventListener('htmx:afterSwap', function(event) {
    if (event.detail.target.id === 'project-detail') {
        initializeVideoPlayer();
    }
});