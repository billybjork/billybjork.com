(function() {
    function initTinyMCE(selector, additionalOptions = {}) {
        const defaultOptions = {
            selector,
            height: 800,
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
            entity_encoding: 'raw', // Use 'raw' to prevent entity encoding
            valid_elements: '*[*]',
            extended_valid_elements: '*[*]',
            setup: function(editor) {
                // Encode Jinja2 syntax before setting content
                editor.on('BeforeSetContent', function(e) {
                    if (e.content) {
                        e.content = e.content
                            .replace(/\{\{/g, '&lbrace;&lbrace;')
                            .replace(/\}\}/g, '&rbrace;&rbrace;')
                            .replace(/\{%/g, '&lbrace;%')
                            .replace(/%\}/g, '%&rbrace;');
                    }
                });
                // Decode Jinja2 syntax before getting content
                editor.on('GetContent', function(e) {
                    if (e.content) {
                        e.content = e.content
                            .replace(/&lbrace;&lbrace;/g, '{{')
                            .replace(/&rbrace;&rbrace;/g, '}}')
                            .replace(/&lbrace;%/g, '{%')
                            .replace(/%&rbrace;/g, '%}');
                    }
                });
                editor.on('change', function() {
                    tinymce.triggerSave();
                });
            },
        };

        tinymce.init({ ...defaultOptions, ...additionalOptions });
    }

    window.initTinyMCE = initTinyMCE;

})();