---
name: How I built this website - pt. 2
slug: how-i-built-this-pt-2
date: '2024-10-31'
pinned: false
draft: true
---

On the surface, this was pretty easy to achieve. Just added some new API endpoints:

- `@app.get("/{project_slug}/edit", response_class=HTMLResponse)`
  - Render [project_edit.html](https://github.com/billybjork/billybjork.com/blob/main/templates/edit/project_edit.html), which includes a form to input fields needed for new projects
- `@app.post("/{project_slug}/edit", response_class=Response)`
  - Accept responses ..., write to db
- `@app.get("/create-project", response_class=HTMLResponse)`
  - Render [project_create.html](https://github.com/billybjork/billybjork.com/blob/main/templates/edit/project_create.html), which includes a form to input fields needed for new projects
- `@app.post("/create-project", response_class=Response)`
  - Accept responses ..., write to db
- `@app.get("/about/edit", response_class=HTMLResponse)`
  - Render [about_edit.html](https://github.com/billybjork/billybjork.com/blob/main/templates/edit/about_edit.html), which includes a form to allow user to make edits to my About page
- `@app.post("/about/edit", response_class=Response)`
  - Accept responses ..., write to db

Also added some basic authentication to require a login for any user accessing those `/edit` endpoints:

<!-- block -->

```python
def check_credentials(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, os.getenv("ADMIN_USERNAME"))
    correct_password = secrets.compare_digest(credentials.password, os.getenv("ADMIN_PASSWORD"))
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username
```

<!-- block -->

With those API endpoints and HTML templates, my website is now suddenly also my CMS!

One slight problem - these projects contain their own content. They vary from each other enough that I can't do a complete project template and just pass values - some of them have multiple videos, some have long text/essays, and starting now, some have code snippets.

This content, like the rest of my web app, is written and delivered in HTML. But while writing the raw HTML for each project could be good practice (and it was for me when I first added them), I don't want to have to edit the raw HTML every time. For this purpose I brought in [TinyMCE](https://www.tiny.cloud/) - a small text editor. This allows me to edit the text with all the conveniences of other modern text editors.

[toolbar screenshot]

Another thing I realized I needed (when working on this post) - code highlighting. Like the videos, I want to present code content in best way possible, which means using highlighting. I used [Prism.js](https://prismjs.com/) to handle code highlighting.

Something that tripped me up initially was the Jinja2 code - not regular vanilla HTML, so it confused the browser and caused issues. Fixed this by adding a custom filter to escape Jinja2 code:

<!-- block -->

```python
@pass_context
def escape_jinja2_in_code_snippets(context, content):
    # Find code snippets
    pattern = r'<pre class="language-.*?"><code>(.*?)</code></pre>'

    def replace_jinja2_in_snippet(match):
        snippet = match.group(1)
        # Escape { and } characters
        snippet_escaped = snippet.replace('{', '&#123;').replace('}', '&#125;')
        return snippet_escaped

    content = re.sub(pattern, replace_jinja2_in_snippet, content, flags=re.DOTALL)
    return Markup(content)
```

<!-- block -->

There we go - this website is now a CMS, allowing me to make edits/transactions with my database, present video content alongside code snippets.
