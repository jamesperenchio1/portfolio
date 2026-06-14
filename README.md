# James Perenchio — portfolio / CV

A simple, self-updating CV-style site generated from GitHub. The landing page
lists every public project as a clickable block; each opens a detail page with a
GitHub preview image, key facts, and the full commit history.

**Live site:** https://jamesperenchio1.github.io/portfolio

## How it works

Plain static HTML/CSS — no framework, no JS, no build step beyond a single Node
script that reads live data from the GitHub API:

```
node scripts/build.mjs
```

It produces:

| Page | Source |
|------|--------|
| `index.html` | every public repo as a project block |
| `projects/*.html` | per-project detail: preview image, facts, full commit history |
| `infrastructure.html` | rendered from `COMPREHENSIVE.md` (credentials/personal details redacted) |

Project preview images come from GitHub's social-preview cards
(`opengraph.githubassets.com`), so they require no manual screenshots.

## Staying up to date automatically

`.github/workflows/update-site.yml` runs the generator on a schedule (and on any
source change), regenerates all pages from the latest GitHub data, commits the
result, and publishes to GitHub Pages. There is no manual update step.

## Local build

```
node scripts/build.mjs                         # unauthenticated (low API rate limit)
GITHUB_TOKEN=ghp_xxx node scripts/build.mjs    # authenticated (recommended)
```

When the API is unavailable or rate-limited, the build falls back to
`data/seed.json`, which carries the last-known repo list and commit history so
offline builds stay complete. Requires Node 18+ (uses the built-in `fetch`); no
dependencies to install.
