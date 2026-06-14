#!/usr/bin/env node
/*
 * build.mjs - generates the static portfolio site.
 *
 * Pulls live data from the GitHub REST API (public repositories + commit
 * history) and renders a small set of modern, self-contained HTML pages.
 * Markdown in content/ is rendered too. No external dependencies - Node 18+
 * only (built-in fetch). Falls back to data/seed.json when the API is
 * unavailable.
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
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BUILT_AT = new Date();
const DASH = "—";
const ARROW = "→";
const ARROW_L = "←";
const DOT = "·";

let rateBlocked = false;

const NAV = [
  { href: "index.html", label: "Home" },
  { href: "projects.html", label: "Projects" },
  { href: "timeline.html", label: "Timeline" },
  { href: "about.html", label: "About" },
];

const CONTENT_PAGES = [
  { src: "content/about.md", out: "about.html", title: "About", active: "about.html" },
];

// GitHub-style language accent colours for the language dots.
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
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
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

function tagFor(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// Inline SVG icons (currentColor).
const ICON = {
  arrow: '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>',
  repo: '<svg class="repo-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 .1.8 1.7 2.9 1.4.1-.7.4-1.2.7-1.4-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 5 18.3 5.3 18.3 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-3.5-3.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>',
  sun: '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
};

function langDot(lang) {
  if (!lang) return "";
  const c = LANG_COLOR[lang] || "var(--faint)";
  return `<span class="lang"><span class="swatch" style="background:${c}"></span>${esc(lang)}</span>`;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layout({ title, active, body, depth = 0, desc }) {
  const p = depth > 0 ? "../".repeat(depth) : "";
  const description = desc || "James Perenchio — software developer. Public projects and commit history, kept current straight from GitHub.";
  const nav = NAV.map((n) => {
    const cls = n.href === active ? "navlink active" : "navlink";
    return `<a class="${cls}" href="${p}${n.href}">${n.label}</a>`;
  }).join("\n          ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} ${DOT} James Perenchio</title>
  <meta name="description" content="${esc(description)}">
  <meta name="color-scheme" content="light dark">
  <meta property="og:title" content="${esc(title)} ${DOT} James Perenchio">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="${p}assets/style.css">
  <script>(function(){var d=document.documentElement;d.classList.add('js');try{var t=localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);}catch(e){}})();</script>
</head>
<body>
  <header class="site-nav">
    <div class="wrap">
      <a class="brand" href="${p}index.html"><span class="dot"></span>James Perenchio</a>
      <nav class="nav-links" aria-label="Primary">
          ${nav}
      </nav>
      <button class="theme-toggle" type="button" aria-label="Toggle theme">${ICON.sun}${ICON.moon}</button>
      <button class="nav-burger" type="button" aria-label="Menu" aria-expanded="false">${ICON.menu}</button>
    </div>
  </header>
  <main>
${body}
  </main>
  <footer class="site">
    <div class="wrap">
      <span>© <span data-year>${BUILT_AT.getFullYear()}</span> James Perenchio ${DOT} built from GitHub, last refreshed ${fmtDate(BUILT_AT)}</span>
      <span class="foot-links">
        <a href="${p}index.html">Home</a>
        <a href="${p}projects.html">Projects</a>
        <a href="https://github.com/${USER}">GitHub</a>
      </span>
    </div>
  </footer>
  <script src="${p}assets/app.js" defer></script>
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
function projectCard(r, depth, delay = 0) {
  const p = depth > 0 ? "../".repeat(depth) : "";
  const tags = `|${r.archived ? "archived" : "active"}|${r.language ? tagFor(r.language) : "none"}|`;
  const searchText = `${r.name} ${r.description || ""} ${r.language || ""}`.toLowerCase();
  const commits = r.commitCount != null ? r.commitCount : (r.commits ? `${r.commits.length}+` : "0");
  const meta = [];
  if (r.language) meta.push(`<span class="m">${langDot(r.language)}</span>`);
  meta.push(`<span class="m">${commits} commits</span>`);
  meta.push(`<span class="m">updated ${relTime(r.pushed_at || r.updated_at)}</span>`);
  const arch = r.archived ? ` <span class="badge archived">archived</span>` : "";
  const d = delay ? ` data-delay="${delay}"` : "";
  return `<a class="card reveal"${d} data-card data-tags="${tags}" data-search-text="${esc(searchText)}" href="${p}projects/${slug(r.name)}.html">
        <div class="card-top">
          <h3>${ICON.repo}${esc(r.name)}${arch}</h3>
          ${ICON.arrow}
        </div>
        <p class="desc">${esc(r.description || "No description provided.")}</p>
        <div class="meta">${meta.join("\n          ")}</div>
      </a>`;
}

function buildIndex(repos, totals) {
  const recent = [...repos]
    .filter((r) => r.pushed_at)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 6);

  const focus = [
    { t: "Web apps & storefronts", d: "End-to-end web applications and e-commerce — building, iterating, and shipping real products." },
    { t: "Data tools & trackers", d: "Small focused apps that gather real-world signals and surface them cleanly." },
    { t: "Automation pipelines", d: "Systems that research, generate, and commit their own output on a schedule — including this site." },
  ];

  const body = `    <section class="hero">
      <div class="hero-glow"></div>
      <div class="hero-glow two"></div>
      <div class="wrap">
        <span class="eyebrow reveal"><span class="pulse"></span>Auto-synced with GitHub</span>
        <h1 class="reveal" data-delay="1">Hi, I'm James —<br><span class="grad">I build things on the web.</span></h1>
        <p class="sub reveal" data-delay="2">Software developer working across web apps, data tools, and automation. This site is generated straight from my GitHub, so it's always an honest, current picture of what I'm actually building.</p>
        <div class="hero-actions reveal" data-delay="3">
          <a class="btn btn-primary" href="projects.html">View projects ${ARROW}</a>
          <a class="btn btn-ghost" href="https://github.com/${USER}">${ICON.github} GitHub</a>
        </div>
        <div class="stats">
          <div class="stat reveal" data-delay="1"><div class="num" data-count="${totals.repoCount}">0</div><div class="lbl">public repositories</div></div>
          <div class="stat reveal" data-delay="2"><div class="num" data-count="${totals.commitTotal}" data-suffix="${totals.approx ? "+" : ""}">0</div><div class="lbl">commits tracked</div></div>
          <div class="stat reveal" data-delay="3"><div class="num" data-count="${totals.langCount}">0</div><div class="lbl">languages</div></div>
          <div class="stat reveal" data-delay="4"><div class="num">${totals.activeYearStart}</div><div class="lbl">building since</div></div>
        </div>
      </div>
    </section>

    <section class="wrap section">
      <div class="section-head">
        <div>
          <h2 class="reveal">Recently active</h2>
          <p class="reveal">The repositories I've pushed to most recently.</p>
        </div>
        <a class="section-link reveal" href="projects.html">All ${totals.repoCount} projects ${ARROW}</a>
      </div>
      <div class="cards">
        ${recent.map((r, i) => projectCard(r, 0, (i % 3) + 1)).join("\n        ")}
      </div>
    </section>

    <section class="wrap section">
      <div class="section-head">
        <div>
          <h2 class="reveal">What I focus on</h2>
          <p class="reveal">A few recurring threads run through most of my work.</p>
        </div>
      </div>
      <div class="cards">
        ${focus.map((f, i) => `<div class="card reveal" data-delay="${i + 1}">
          <h3>${esc(f.t)}</h3>
          <p class="desc">${esc(f.d)}</p>
        </div>`).join("\n        ")}
      </div>
    </section>`;
  write("index.html", layout({ title: "Home", active: "index.html", body }));
}

function buildProjects(repos) {
  const sorted = [...repos].sort((a, b) =>
    new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));

  // Filter chips: All, Active, then the languages present (by frequency), Archived.
  const langCount = {};
  for (const r of sorted) if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
  const langs = Object.keys(langCount).sort((a, b) => langCount[b] - langCount[a]);
  const chips = [`<button class="chip active" data-filter="all">All</button>`,
    `<button class="chip" data-filter="active">Active</button>`];
  for (const l of langs) chips.push(`<button class="chip" data-filter="${tagFor(l)}">${esc(l)}</button>`);
  if (sorted.some((r) => r.archived)) chips.push(`<button class="chip" data-filter="archived">Archived</button>`);

  const body = `    <section class="wrap page">
      <h1 class="reveal">Projects</h1>
      <p class="lede reveal">Every public repository on my GitHub, newest activity first. Search or filter, then open any project for its full commit history.</p>
      <div class="toolbar reveal">
        <label class="search">
          ${ICON.search}
          <input type="search" data-search placeholder="Search ${sorted.length} projects…" aria-label="Search projects">
        </label>
        <div class="filters">
          ${chips.join("\n          ")}
        </div>
      </div>
      <div class="cards" data-grid>
        ${sorted.map((r, i) => projectCard(r, 0, (i % 3) + 1)).join("\n        ")}
      </div>
      <p class="empty-state" data-empty>No projects match — try a different search or filter.</p>
    </section>`;
  write("projects.html", layout({ title: "Projects", active: "projects.html", body }));
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
      </li>`).join("\n      ")
    : `<li><span class="msg">Commit history will appear here after the next automated build.</span></li>`;

  const moreNote = commits.length && (r.commitCount == null || commits.length < r.commitCount)
    ? `<p class="note">Showing the ${commits.length} most recent commits${r.commitCount != null ? ` of ${r.commitCount}` : ""}. <a href="${r.html_url}/commits">View the complete history on GitHub ${ARROW}</a></p>`
    : "";

  const arch = r.archived ? ` <span class="badge archived">archived</span>` : "";
  const body = `    <section class="wrap page">
      <a class="back" href="../projects.html">${ICON.back} All projects</a>
      <div class="detail-head reveal">
        <h1>${esc(r.name)}</h1>${arch}
      </div>
      <p class="lede reveal">${esc(r.description || "No description provided.")}</p>
      <a class="btn btn-ghost repo-cta reveal" href="${r.html_url}">${ICON.github} ${esc(r.full_name)} ${ICON.ext}</a>
      <div class="facts reveal">
        ${facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("\n        ")}
      </div>
      <h2 class="reveal">Commit history</h2>
      ${moreNote}
      <ul class="commits">
      ${commitItems}
      </ul>
    </section>`;
  write(`projects/${slug(r.name)}.html`, layout({ title: r.name, active: "projects.html", body, depth: 1, desc: r.description || `${r.name} — a project by James Perenchio.` }));
}

function buildTimeline(repos) {
  const events = [];
  for (const r of repos) {
    for (const c of (r.commits || []).slice(0, 14)) {
      if (c.date) events.push({ repo: r.name, ...c });
    }
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = events.slice(0, 160);

  const groups = new Map();
  for (const e of recent) {
    const day = fmtDate(e.date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }

  let tl = "";
  for (const [day, evs] of groups) {
    const human = new Date(day + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    tl += `\n        <div class="tl-day reveal">${human}</div>`;
    for (const e of evs) {
      tl += `\n        <div class="tl-item reveal">
          <a class="repo" href="projects/${slug(e.repo)}.html">${esc(e.repo)}</a>
          <span class="msg">${esc(e.message)}</span>
          <a class="sha" href="${e.url}">${e.sha}</a>
        </div>`;
    }
  }

  const empty = groups.size === 0
    ? `<p class="note">The timeline is assembled from live commit data and will populate on the next automated build.</p>` : "";

  const body = `    <section class="wrap page">
      <h1 class="reveal">Timeline</h1>
      <p class="lede reveal">A unified, chronological feed of recent commits across every public repository — the day-to-day record of what I've been working on.</p>
      ${empty}
      <div class="tl">${tl}
      </div>
    </section>`;
  write("timeline.html", layout({ title: "Timeline", active: "timeline.html", body }));
}

function buildContentPage({ src, out, title, active }) {
  const path = join(ROOT, src);
  if (!existsSync(path)) { console.warn("skip missing content:", src); return; }
  const md = readFileSync(path, "utf8");
  const cleaned = md.replace(/^\s*#\s+.*\n/, "");
  const body = `    <section class="wrap page">
      <h1 class="reveal">${esc(title)}</h1>
      <div class="prose">
${markdown(cleaned)}
      </div>
    </section>`;
  write(out, layout({ title, active, body }));
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
    // Carry over commit history from the seed when the API gives a repo we know.
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

  const langs = new Set(list.map((r) => r.language).filter(Boolean));
  let commitTotal = 0;
  let approx = false;
  for (const r of list) {
    commitTotal += r.commitCount != null ? r.commitCount : (r.commits ? r.commits.length : 0);
    if (r.commitCount == null) approx = true;
  }
  const years = list.map((r) => new Date(r.created_at).getFullYear()).filter((y) => !Number.isNaN(y));
  const totals = {
    repoCount: list.length,
    commitTotal,
    approx,
    langCount: langs.size,
    activeYearStart: years.length ? Math.min(...years) : new Date().getFullYear(),
  };

  buildIndex(list, totals);
  buildProjects(list);
  for (const r of list) buildProjectPage(r);
  buildTimeline(list);
  for (const c of CONTENT_PAGES) buildContentPage(c);

  console.log(`\nDone. Built site for ${list.length} repositories.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
