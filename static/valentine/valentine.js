// Valentine's Day 2D Collage

console.log("Valentine.js loaded");

// Segment image filenames
const segments = [
    // Original segments (minus IMG_7427)
    "IMG_0285_segment.png",
    "IMG_4789_segment.png",
    "IMG_5062_segment.png",
    "IMG_6274_segment.png",
    "IMG_6511_segment.png",
    "IMG_7381_segment.png",
    "Nick&George-334_segment.png",
    // New segments
    "DSCF2973_segment.png",
    "IMG_3595_segment.png",
    "IMG_4015_segment.png",
    "IMG_4029_segment.png",
    "IMG_4763_segment.png",
    "IMG_4814_segment.png",
    "IMG_5077_segment.png",
    "IMG_5135_segment.png",
    "IMG_5141_segment.png",
    "IMG_5251_segment.png",
];

/**
 * Create a collage of person segment images.
 * Uses a simple offset grid layout that stays in viewport.
 */
function createCollage() {
    const container = document.getElementById("collage");
    if (!container) {
        console.error("Collage container not found");
        return;
    }

    // 2-column grid with offset alternating rows
    // 17 images at ~50vw each = 9 rows (2, 2, 2, 2, 2, 2, 2, 2, 1)
    // Images are 50vw wide, so positions: left column ~0-5%, right column ~50-55%
    const layout = [
        // Row 1: 2 images
        { x: 2, y: 3, rotation: -6, scale: 0.9, zIndex: 3 },
        { x: 52, y: 3, rotation: 5, scale: 0.85, zIndex: 5 },

        // Row 2: 2 images, offset
        { x: 15, y: 14, rotation: 7, scale: 0.9, zIndex: 4 },
        { x: 65, y: 14, rotation: -8, scale: 0.85, zIndex: 6 },

        // Row 3: 2 images
        { x: 2, y: 25, rotation: -5, scale: 0.85, zIndex: 7 },
        { x: 52, y: 25, rotation: 6, scale: 0.9, zIndex: 2 },

        // Row 4: 2 images, offset
        { x: 15, y: 36, rotation: 8, scale: 0.85, zIndex: 1 },
        { x: 65, y: 36, rotation: -7, scale: 0.9, zIndex: 8 },

        // Row 5: 2 images
        { x: 2, y: 47, rotation: -8, scale: 0.9, zIndex: 5 },
        { x: 52, y: 47, rotation: 5, scale: 0.85, zIndex: 3 },

        // Row 6: 2 images, offset
        { x: 15, y: 58, rotation: 6, scale: 0.9, zIndex: 10 },
        { x: 65, y: 58, rotation: -6, scale: 0.85, zIndex: 7 },

        // Row 7: 2 images
        { x: 2, y: 69, rotation: -7, scale: 0.85, zIndex: 2 },
        { x: 52, y: 69, rotation: 8, scale: 0.9, zIndex: 6 },

        // Row 8: 2 images, offset
        { x: 15, y: 80, rotation: 5, scale: 0.85, zIndex: 1 },
        { x: 65, y: 80, rotation: -5, scale: 0.9, zIndex: 8 },

        // Row 9: 1 image, centered
        { x: 25, y: 91, rotation: -6, scale: 0.9, zIndex: 5 },
    ];

    segments.forEach((filename, index) => {
        const img = document.createElement("img");
        img.src = `/static/valentine/segments/${filename}`;
        img.className = "segment-image";
        img.alt = "Memory";

        // Apply position from layout
        const { x, y, rotation, scale, zIndex } = layout[index];
        img.style.left = `${x}%`;
        img.style.top = `${y}%`;
        img.style.zIndex = zIndex;

        // Set CSS custom properties for animation
        img.style.setProperty('--rotation', `${rotation}deg`);
        img.style.setProperty('--scale', scale);

        // Initial transform (will be animated)
        img.style.transform = `rotate(${rotation}deg) scale(${scale})`;

        container.appendChild(img);
    });

    // Setup intersection observer for bounce animations
    setupBounceAnimations();
}

/**
 * Setup IntersectionObserver to trigger bounce animations when images enter viewport.
 */
function setupBounceAnimations() {
    const images = document.querySelectorAll('.segment-image');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('bounce-in');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.3,
        rootMargin: '0px'
    });

    images.forEach((img) => {
        observer.observe(img);
    });
}

/**
 * Setup interactive Yes/No buttons.
 */
function setupButtons() {
    const yesBtn = document.getElementById("yesBtn");
    const noBtn = document.getElementById("noBtn");
    const response = document.getElementById("response");

    if (yesBtn) {
        yesBtn.addEventListener("click", () => {
            response.textContent = "I love you too! Happy Valentine's Day!";
            createHearts();
            // Make the yes button glow
            yesBtn.style.animation = "pulse 0.5s ease-in-out infinite";
        });
    }

    if (noBtn) {
        let dodgeCount = 0;
        const noMessages = [
            "Are you sure?",
            "Really?",
            "Think again...",
            "Come on!",
            "Pretty please?",
            "Just say yes!"
        ];

        noBtn.addEventListener("click", () => {
            // Make the button dodge the cursor
            noBtn.style.position = "relative";
            const randomX = (Math.random() - 0.5) * 300;
            const randomY = (Math.random() - 0.5) * 150;
            noBtn.style.transform = `translate(${randomX}px, ${randomY}px)`;
            noBtn.textContent = noMessages[Math.min(dodgeCount, noMessages.length - 1)];
            dodgeCount++;

            // Make it smaller each time
            const scale = Math.max(0.5, 1 - dodgeCount * 0.1);
            noBtn.style.transform += ` scale(${scale})`;
        });
    }
}

/**
 * Create floating hearts animation.
 */
function createHearts() {
    const hearts = ["❤️", "💕", "💖", "💗", "💓", "💝", "💘", "💞"];
    for (let i = 0; i < 30; i++) {
        setTimeout(() => {
            const heart = document.createElement("div");
            heart.className = "floating-heart";
            heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
            heart.style.left = `${Math.random() * 100}vw`;
            heart.style.bottom = "0";
            heart.style.fontSize = `${1.5 + Math.random() * 2}rem`;
            document.body.appendChild(heart);

            // Remove after animation
            setTimeout(() => heart.remove(), 3000);
        }, i * 100);
    }
}

/**
 * Create floating hearts that rise up as you scroll.
 */
function createScrollingHearts() {
    const container = document.getElementById("floatingHearts");
    if (!container) return;

    const hearts = ["💕", "💖", "💗", "💓", "💝", "💘", "💞", "❤️"];

    // Create initial hearts
    for (let i = 0; i < 20; i++) {
        createSingleHeart(container, hearts);
    }

    // Add more hearts periodically as user scrolls
    let lastScroll = 0;
    window.addEventListener("scroll", () => {
        const currentScroll = window.scrollY;

        // Only create hearts when scrolling down
        if (currentScroll > lastScroll && Math.random() > 0.7) {
            createSingleHeart(container, hearts);
        }

        lastScroll = currentScroll;
    });
}

/**
 * Create a single floating heart element.
 */
function createSingleHeart(container, hearts) {
    const heart = document.createElement("div");
    heart.className = "scroll-heart";
    heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];

    // Random horizontal position
    heart.style.left = `${Math.random() * 100}vw`;

    // Random animation delay and duration
    const duration = 15 + Math.random() * 10; // 15-25 seconds
    const delay = Math.random() * -10; // Start at different points
    heart.style.animationDuration = `${duration}s`;
    heart.style.animationDelay = `${delay}s`;

    container.appendChild(heart);

    // Remove after animation completes
    setTimeout(() => {
        heart.remove();
    }, (duration + Math.abs(delay)) * 1000);
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
    console.log("Initializing Valentine's page...");
    createCollage();
    setupButtons();
    createScrollingHearts();
});
