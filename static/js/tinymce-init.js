(function() {
    /**
     * Initializes TinyMCE for a given selector
     * @param {string} selector - The selector for the textarea to initialize TinyMCE on
     * @param {Object} additionalOptions - Additional options to merge with the default TinyMCE config
     */
    function initTinyMCE(selector, additionalOptions = {}) {
        const defaultOptions = {
            plugins: 'anchor autolink charmap codesample emoticons image link lists media searchreplace table visualblocks wordcount linkchecker',
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

    // Expose initTinyMCE to the global scope if needed
    window.initTinyMCE = initTinyMCE;

    // Initialize TinyMCE on DOMContentLoaded if required
    document.addEventListener('DOMContentLoaded', () => {
        // Example initialization (adjust selector as needed)
        // initTinyMCE('.my-textarea');
    });
})();