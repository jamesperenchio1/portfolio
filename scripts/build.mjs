#!/usr/bin/env node
/*
 * build.mjs - generates the static portfolio / CV site.
 *
 * Pulls live data from the GitHub REST API (public repositories + commit
 * history) and renders a simple, document-style site: a CV landing page that
 * lists every project as a clickable block, a detail page per project (with a
 * GitHub preview image and full commit history), and a redacted Infrastructure
 * page rendered from COMPREHENSIVE.md.
 *
 * No external dependencies - Node 18+ only (built-in fetch). Falls back to
 * data/seed.json when the API is unavailable.
 *
 * Auth: set GITHUB_TOKEN to raise the rate limit (CI does this automatically).
 *
 * Usage: node scripts/build.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const USER = process.env.GH_USER || "jamesperenchio1";
const NAME = "James Perenchio";
const TITLE = "Software Developer";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BUILT_AT = new Date();
const DASH = "—";
const ARROW = "→";

let rateBlocked = false;

// Hand-written Markdown pages folded into the site.
const CONTENT_PAGES = [
  { src: "COMPREHENSIVE.md", out: "infrastructure.html", title: "Infrastructure" },
];

const LANG_COLOR = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5",
  Shell: "#89e051", HTML: "#e34c26", CSS: "#563d7c", Go: "#00ADD8",
  Rust: "#dea584", Java: "#b07219", "C++": "#f34b7d", C: "#555555",
  Ruby: "#701516", PHP: "#4F5D95", Swift: "#F05138", Kotlin: "#A97BFF",
  Vue: "#41b883", Svelte: "#ff3e00", Dockerfile: "#384d54", Makefile: "#427819",
};

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------
const API = "https://api.github.com";

async function gh(path) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": `${USER}-portfolio-builder`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  if (rateBlocked) return new Response("", { status: 403 });

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { headers });
    if ((res.status === 403 || res.status === 429) &&
        Number(res.headers.get("x-ratelimit-remaining")) === 0) {
      if (!TOKEN) { rateBlocked = true; return res; }
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      const wait = Math.min(Math.max(reset - Date.now(), 2000), 60000);
      console.error(`Rate limited on ${path}. Waiting ${Math.round(wait / 1000)}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error(`Repeatedly rate limited fetching ${path}`);
}

async function ghJSON(path) {
  const res = await gh(path);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`GitHub ${res.status} for ${path}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return { data: await res.json(), res };
}

async function ghPaged(path) {
  let url = path + (path.includes("?") ? "&" : "?") + "per_page=100";
  const out = [];
  while (url) {
    const { data, res } = await ghJSON(url);
    out.push(...data);
    const link = res.headers.get("link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1].replace(API, "") : null;
  }
  return out;
}

async function fetchCommits(full, n = 100) {
  try {
    const res = await gh(`/repos/${full}/commits?per_page=${n}`);
    if (res.status === 409) return { commits: [], count: 0 };
    if (!res.ok) return { commits: [], count: null };
    const data = await res.json();
    const hasMore = /rel="next"/.test(res.headers.get("link") || "");
    const commits = data.map((c) => ({
      sha: c.sha.slice(0, 7),
      date: c.commit.author?.date || c.commit.committer?.date || null,
      message: (c.commit.message || "").split("\n")[0],
      url: c.html_url,
    }));
    return { commits, count: hasMore ? null : commits.length };
  } catch {
    return { commits: [], count: null };
  }
}

// ---------------------------------------------------------------------------
// Minimal Markdown -> HTML
// ---------------------------------------------------------------------------
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  const rules = [
    [/^`([^`]+)`/, (m) => `<code>${esc(m[1])}</code>`],
    [/^\[([^\]]+)\]\(([^)\s]+)\)/, (m) => `<a href="${esc(m[2])}">${esc(m[1])}</a>`],
    [/^\*\*([^*]+)\*\*/, (m) => `<strong>${esc(m[1])}</strong>`],
    [/^(https?:\/\/[^\s<)]+[^\s<).,])/, (m) => `<a href="${m[1]}">${m[1]}</a>`],
  ];
  let out = "";
  let rest = s;
  while (rest.length) {
    let matched = false;
    for (const [re, fn] of rules) {
      const m = rest.match(re);
      if (m) { out += fn(m); rest = rest.slice(m[0].length); matched = true; break; }
    }
    if (!matched) { out += esc(rest[0]); rest = rest.slice(1); }
  }
  return out;
}

function splitRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split("|").map((c) => c.trim());
}

function markdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 6);
      const raw = h[2].trim();
      const id = raw.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
      out.push(`<h${level} id="${id}">${inline(raw)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i])); i++;
      }
      let t = "<table><thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>" + header.map((_, idx) => `<td>${inline(r[idx] || "")}</td>`).join("") + "</tr>";
      }
      t += "</tbody></table>";
      out.push(t);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push("<ul>" + buf.map((x) => `<li>${inline(x)}</li>`).join("") + "</ul>");
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push("<ol>" + buf.map((x) => `<li>${inline(x)}</li>`).join("") + "</ol>");
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() !== "" &&
           !/^(#{1,6})\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) &&
           !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
           !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i]) &&
           !/^\s*>\s?/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d) { return d ? new Date(d).toISOString().slice(0, 10) : ""; }

function relTime(d) {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const day = 86400000;
  if (diff < day) return "today";
  const days = Math.round(diff / day);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// GitHub's auto-generated social-preview card for a repo. The first path
// segment is a cache key; using pushed_at refreshes the image when the repo
// changes. Always available, even for repos without a custom preview.
function previewImg(r) {
  const key = encodeURIComponent(r.pushed_at || r.updated_at || "v1");
  return `https://opengraph.githubassets.com/${key}/${r.full_name}`;
}

const ICON = {
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.9 1.4.1-.7.4-1.2.7-1.4-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 5 18.3 5.3 18.3 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
};

function langDot(lang) {
  if (!lang) return "";
  const c = LANG_COLOR[lang] || "var(--faint)";
  return `<span class="lang"><span class="swatch" style="background:${c}"></span>${esc(lang)}</span>`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layout({ title, body, depth = 0, desc }) {
  const p = depth > 0 ? "../".repeat(depth) : "";
  const description = desc || `${NAME} — ${TITLE}. Public projects and their commit history, generated from GitHub.`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <link rel="stylesheet" href="${p}assets/style.css">
</head>
<body>
  <main>
${body}
  </main>
  <footer class="site">
    <div class="wrap">
      <span>© ${BUILT_AT.getFullYear()} ${esc(NAME)}</span>
      <span class="foot-links">
        <a href="${p}index.html">Projects</a>
        <a href="${p}infrastructure.html">Infrastructure</a>
        <a href="https://github.com/${USER}">GitHub</a>
      </span>
    </div>
  </footer>
</body>
</html>`;
}

function write(rel, html) {
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
  console.log("wrote", rel);
}

// ---------------------------------------------------------------------------
// Page builders
// ---------------------------------------------------------------------------
function projectBlock(r) {
  const meta = [];
  if (r.language) meta.push(langDot(r.language));
  const commits = r.commitCount != null ? r.commitCount : (r.commits ? `${r.commits.length}+` : "0");
  meta.push(`<span>${commits} commits</span>`);
  meta.push(`<span>updated ${relTime(r.pushed_at || r.updated_at)}</span>`);
  const arch = r.archived ? ` <span class="badge">archived</span>` : "";
  return `<a class="block" href="projects/${slug(r.name)}.html">
        <img class="thumb" src="${previewImg(r)}" alt="${esc(r.name)} preview" loading="lazy" width="640" height="320">
        <div class="body">
          <div class="name">${esc(r.name)}${arch}</div>
          <p class="desc">${esc(r.description || "No description provided.")}</p>
          <div class="meta">${meta.join("\n            ")}</div>
        </div>
      </a>`;
}

function buildIndex(repos) {
  const sorted = [...repos].sort((a, b) =>
    new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
  const active = sorted.filter((r) => !r.archived);
  const archived = sorted.filter((r) => r.archived);

  let body = `    <header class="masthead">
      <div class="wrap">
        <h1 class="name"><a href="index.html">${esc(NAME)}</a></h1>
        <p class="title">${esc(TITLE)}</p>
        <div class="links">
          <a href="https://github.com/${USER}">${ICON.github} github.com/${USER}</a>
        </div>
      </div>
    </header>
    <section class="section">
      <div class="wrap">
        <h2>Projects</h2>
        <div class="grid">
          ${active.map(projectBlock).join("\n          ")}
        </div>`;
  if (archived.length) {
    body += `\n        <h2>Archived</h2>
        <div class="grid">
          ${archived.map(projectBlock).join("\n          ")}
        </div>`;
  }
  body += `\n      </div>
    </section>`;
  write("index.html", layout({ title: `${NAME} ${DASH} ${TITLE}`, body }));
}

function buildProjectPage(r) {
  const commits = r.commits || [];
  const facts = [
    ["Language", r.language ? langDot(r.language) : DASH],
    ["Status", r.archived ? "Archived" : "Active"],
    ["Created", fmtDate(r.created_at) || DASH],
    ["Last commit", fmtDate(r.pushed_at) || DASH],
    ["Commits", r.commitCount != null ? String(r.commitCount) : (commits.length ? `${commits.length}+` : DASH)],
  ];

  const commitItems = commits.length
    ? commits.map((c) => `<li>
          <span class="date">${fmtDate(c.date)}</span>
          <span class="msg">${esc(c.message)}</span>
          <a class="sha" href="${c.url}">${c.sha}</a>
        </li>`).join("\n        ")
    : `<li><span class="msg">Commit history will appear here after the next automated build.</span></li>`;

  const moreNote = commits.length && (r.commitCount == null || commits.length < r.commitCount)
    ? `<p class="note">Showing the ${commits.length} most recent commits${r.commitCount != null ? ` of ${r.commitCount}` : ""}. <a href="${r.html_url}/commits">Full history on GitHub ${ARROW}</a></p>`
    : "";

  const arch = r.archived ? ` <span class="badge">archived</span>` : "";
  const body = `    <section class="section detail">
      <div class="wrap">
        <a class="back" href="../index.html">${ICON.back} All projects</a>
        <h1>${esc(r.name)}${arch}</h1>
        <p class="lede">${esc(r.description || "No description provided.")}</p>
        <img class="hero-shot" src="${previewImg(r)}" alt="${esc(r.name)} preview" width="1200" height="600">
        <ul class="facts">
          ${facts.map(([k, v]) => `<li><span class="k">${k}</span><span class="v">${v}</span></li>`).join("\n          ")}
        </ul>
        <a class="repo-link" href="${r.html_url}">${ICON.github} View ${esc(r.full_name)} on GitHub</a>
        <h3>Commit history</h3>
        ${moreNote}
        <ul class="commits">
        ${commitItems}
        </ul>
      </div>
    </section>`;
  write(`projects/${slug(r.name)}.html`, layout({ title: `${r.name} ${DASH} ${NAME}`, body, depth: 1, desc: r.description || `${r.name} — a project by ${NAME}.` }));
}

function buildContentPage({ src, out, title }) {
  const path = join(ROOT, src);
  if (!existsSync(path)) { console.warn("skip missing content:", src); return; }
  const md = readFileSync(path, "utf8");
  const cleaned = md.replace(/^\s*#\s+.*\n/, "");
  const body = `    <section class="section">
      <div class="wrap">
        <a class="back" href="index.html">${ICON.back} Back to projects</a>
        <h1>${esc(title)}</h1>
        <div class="prose">
${markdown(cleaned)}
        </div>
      </div>
    </section>`;
  write(out, layout({ title: `${title} ${DASH} ${NAME}`, body }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function loadSeed() {
  const p = join(ROOT, "data/seed.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

async function main() {
  console.log(`Fetching repositories for ${USER}${TOKEN ? " (authenticated)" : " (unauthenticated)"}...`);
  let list;
  try {
    const raw = await ghPaged(`/users/${USER}/repos?type=owner&sort=pushed`);
    list = raw.filter((r) => !r.private && !r.fork);
    const seed = loadSeed() || [];
    const byName = new Map(seed.map((s) => [s.name, s]));
    for (const r of list) {
      const s = byName.get(r.name);
      if (s) { r.commits = s.commits; r.commitCount = s.commitCount; }
    }
  } catch (e) {
    console.warn(`Repo list unavailable (${e.message}). Falling back to data/seed.json.`);
    list = loadSeed();
    if (!list) throw new Error("No API access and no seed file - cannot build.");
  }

  console.log(`Found ${list.length} public repositories. Fetching commit history...`);
  for (const r of list) {
    const { commits, count } = await fetchCommits(r.full_name, 100);
    r.commits = commits.length ? commits : (r.commits || []);
    r.commitCount = commits.length ? count : (r.commitCount ?? null);
    const label = r.commitCount != null ? r.commitCount : (r.commits.length ? `${r.commits.length}+` : "?");
    console.log(`  ${r.name}: ${label} commits`);
  }

  buildIndex(list);
  for (const r of list) buildProjectPage(r);
  for (const c of CONTENT_PAGES) buildContentPage(c);

  console.log(`\nDone. Built site for ${list.length} repositories.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
