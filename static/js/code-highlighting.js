// Dynamically load a JavaScript file
function loadScript(url, callback) {
    var script = document.createElement("script");
    script.type = "text/javascript";

    script.onload = function() {
        if (callback) callback();
    };

    script.src = url;
    document.head.appendChild(script);
}

// Dynamically load a CSS file
function loadCSS(url, callback) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;

    link.onload = function() {
        if (callback) callback();
    };

    document.head.appendChild(link);
}

// Load Prism.js and its CSS
function loadPrism(callback) {
    loadCSS("https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css", function() {
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js", function() {
            // Load the necessary language components
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js", function() {
                if (callback) callback();
            });
        });
    });
}

// Check for code snippets and highlight them
function checkAndHighlightCode(targetElement) {
    if (targetElement.querySelector("pre code")) {
        if (typeof Prism === 'undefined') {
            loadPrism(function() {
                Prism.highlightAllUnder(targetElement);
            });
        } else {
            Prism.highlightAllUnder(targetElement);
        }
    }
}

// Listen for the htmx:afterSwap event
document.addEventListener("htmx:afterSwap", function(evt) {
    checkAndHighlightCode(evt.detail.target);
});

// Check on initial page load
document.addEventListener("DOMContentLoaded", function() {
    checkAndHighlightCode(document.body);
});