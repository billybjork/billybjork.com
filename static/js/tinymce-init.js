(function() {
    function initTinyMCE(selector, additionalOptions = {}) {
        const defaultOptions = {
            selector,
            plugins: 'anchor autolink charmap codesample code emoticons image link lists media searchreplace table visualblocks wordcount linkchecker',
            toolbar: 'undo redo | codesample code | blocks fontfamily fontsize | bold italic underline strikethrough | link image media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
            codesample_languages: [
                { text: 'HTML/XML', value: 'markup' },
                { text: 'JavaScript', value: 'javascript' },
                { text: 'Python', value: 'python' },
                { text: 'CSS', value: 'css' },
            ],
            codesample_global_prismjs: true,
            codesample_content_css: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css',
            codesample_content_js: 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js',
            entity_encoding: 'named',
            protect: [
                /\{\{.*?\}\}/g,
                /\{%.*?%\}/g,
            ],
            content_style: 'body { font-family:Helvetica,Arial,sans-serif; font-size:14px }',
            height: 800,
            setup: function(editor) {
                editor.on('change', function() {
                    tinymce.triggerSave();
                });
            },
        };

        tinymce.init({ ...defaultOptions, ...additionalOptions });
    }

    window.initTinyMCE = initTinyMCE;

})();