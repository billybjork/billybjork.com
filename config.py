from fastapi.templating import Jinja2Templates

from filters import escape_jinja2_in_code_snippets
from utils.static_assets import static_url

templates = Jinja2Templates(directory="templates")
templates.env.filters["escape_jinja2_in_code_snippets"] = escape_jinja2_in_code_snippets
templates.env.globals["static_url"] = static_url
