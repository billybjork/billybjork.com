import re

from jinja2 import pass_context
from markupsafe import Markup


@pass_context
def escape_jinja2_in_code_snippets(context, content):
    """Escape Jinja2 syntax within code snippets to prevent template errors."""
    if not content:
        return Markup("")

    pattern = r"(<pre.*?>.*?</pre>)"

    def replace_jinja2_in_snippet(match):
        snippet = match.group(1)
        snippet_escaped = snippet.replace("{", "&#123;").replace("}", "&#125;")
        return snippet_escaped

    content = re.sub(pattern, replace_jinja2_in_snippet, content, flags=re.DOTALL)
    return Markup(content)
