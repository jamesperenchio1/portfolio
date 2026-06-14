#!/usr/bin/env node
/*
 * build.mjs - generates the static portfolio / work-record site.
 *
 * It pulls live data from the GitHub REST API (public repositories + commit
 * history) and renders a set of plain HTML pages. Markdown files in content/
 * are rendered into styled pages too. No external dependencies - Node 18+ only
 * (uses the built-in fetch).
 *
 * Auth: set GITHUB_TOKEN to raise the rate limit (the CI workflow does this
 * automatically). Without a token it falls back to unauthenticated requests,
 * and to data/seed.json if the API is unavailable.
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
const DASH = "—"; // em dash
const ARROW = "→"; // right arrow
const ARROW_L = "←"; // left arrow
const DOT = "·"; // middle dot

// Set true the first time we hit an unauthenticated rate-limit wall so the rest
// of the build fails fast (and falls back to the seed) instead of hanging.
let rateBlocked = false;

const NAV = [
  { href: "index.html", label: "Home" },
  { href: "projects.html", label: "Projects" },
  { href: "timeline.html", label: "Timeline" },
  { href: "infrastructure.html", label: "Infrastructure" },
  { href: "log.html", label: "Work Log" },
  { href: "about.html", label: "About" },
];

// Markdown source -> output page. These stay editable by hand; the rest is
// regenerated from GitHub on every build.
const CONTENT_PAGES = [
  { src: "content/about.md", out: "about.html", title: "About", active: "about.html" },
  { src: "COMPREHENSIVE.md", out: "infrastructure.html", title: "Infrastructure", active: "infrastructure.html" },
  { src: "PROJECT_LOG.md", out: "log.html", title: "Work Log", active: "log.html" },
];

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
      // With a token (CI), wait for the reset - the limit is generous. Without
      // one (local / shared IP), give up immediately and let the seed take over.
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

// Follow Link rel="next" to collect all pages.
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

// One request per repo: newest 100 commits + whether more exist.
// count is exact when the repo has <=100 commits, otherwise null (display
// "100+"). This keeps the build to a single call per repository.
async function fetchCommits(full, n = 100) {
  try {
    const res = await gh(`/repos/${full}/commits?per_page=${n}`);
    if (res.status === 409) return { commits: [], count: 0 }; // empty repo
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
// Minimal Markdown -> HTML (headings, lists, tables, code, quotes, inline).
// ---------------------------------------------------------------------------
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Inline formatting via a left-to-right tokenizer (no placeholders, so nothing
// can collide with the surrounding text). Handles code spans, links, bold and
// bare URLs; everything else is escaped one character at a time.
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

    // code fence
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // heading (shifted one level down so the page <h1> stays prominent)
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length + 1, 6);
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

    // table: header row followed by a separator row of dashes
    if (line.includes("|") && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = "<table><thead><tr>" + header.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>" + header.map((_, idx) => `<td>${inline(r[idx] || "")}</td>`).join("") + "</tr>";
      }
      t += "</tbody></table>";
      out.push(t);
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push("<ul>" + buf.map((x) => `<li>${inline(x)}</li>`).join("") + "</ul>");
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push("<ol>" + buf.map((x) => `<li>${inline(x)}</li>`).join("") + "</ol>");
      continue;
    }

    // blank
    if (line.trim() === "") { i++; continue; }

    // paragraph
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
// HTML layout
// ---------------------------------------------------------------------------
function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

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

function layout({ title, active, body, depth = 0 }) {
  const p = depth > 0 ? "../".repeat(depth) : "";
  const nav = NAV.map((n) => {
    const cls = n.href === active ? "navlink active" : "navlink";
    return `<a class="${cls}" href="${p}${n.href}">${n.label}</a>`;
  }).join("\n        ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} ${DOT} James Perenchio</title>
  <meta name="description" content="An automatically updated record of James Perenchio's public software projects and self-hosted infrastructure.">
  <link rel="stylesheet" href="${p}assets/style.css">
</head>
<body>
  <nav class="site-nav">
    <div class="wrap">
      <a class="brand" href="${p}index.html">James Perenchio</a>
      ${nav}
    </div>
  </nav>
  <main class="wrap page">
${body}
  </main>
  <footer class="site">
    <div class="wrap">
      <span>Auto-generated from the GitHub API ${DOT} last built ${fmtDate(BUILT_AT)}</span>
      <span><a href="https://github.com/${USER}">github.com/${USER}</a></span>
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

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Page builders
// ---------------------------------------------------------------------------
function projectCard(r, depth) {
  const p = depth > 0 ? "../".repeat(depth) : "";
  const badges = [];
  if (r.language) badges.push(`<span class="badge lang">${esc(r.language)}</span>`);
  if (r.archived) badges.push(`<span class="badge archived">archived</span>`);
  return `<a class="card" href="${p}projects/${slug(r.name)}.html">
      <h3>${esc(r.name)}</h3>
      <div class="desc">${esc(r.description || "No description provided.")}</div>
      <div class="meta">
        ${badges.join(" ")}
        <span>${r.commitCount != null ? r.commitCount : "100+"} commits</span>
        <span>updated ${relTime(r.pushed_at || r.updated_at)}</span>
      </div>
    </a>`;
}

function buildIndex(repos, totals) {
  const recent = [...repos]
    .filter((r) => r.pushed_at)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 6);
  const body = `    <h1>James Perenchio</h1>
    <p class="lede">A living record of what I've been building ${DASH} public software projects and a self-hosted server, documented straight from the source and refreshed automatically.</p>

    <div class="stats">
      <div class="stat"><div class="num">${totals.repoCount}</div><div class="lbl">public repositories</div></div>
      <div class="stat"><div class="num">${totals.commitTotal > 0 ? totals.commitTotal.toLocaleString() + (totals.approx ? "+" : "") : DASH}</div><div class="lbl">commits tracked</div></div>
      <div class="stat"><div class="num">${totals.langCount}</div><div class="lbl">languages</div></div>
      <div class="stat"><div class="num">${totals.activeYearStart}</div><div class="lbl">building since</div></div>
    </div>

    <p>This site is generated directly from my <a href="https://github.com/${USER}">GitHub account</a>. Every repository below is real, with its actual commit history. It rebuilds itself on a schedule, so it stays current without me touching it. Start with <a href="projects.html">Projects</a> for the full catalogue, the <a href="timeline.html">Timeline</a> for a chronological view of recent work, or <a href="infrastructure.html">Infrastructure</a> for the self-hosted server I run.</p>

    <h2>Recently active</h2>
    <div class="cards">
      ${recent.map((r) => projectCard(r, 0)).join("\n      ")}
    </div>
    <p class="section-link"><a href="projects.html">See all ${totals.repoCount} projects ${ARROW}</a></p>`;
  write("index.html", layout({ title: "Home", active: "index.html", body }));
}

function buildProjects(repos) {
  const sorted = [...repos].sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
  const active = sorted.filter((r) => !r.archived);
  const archived = sorted.filter((r) => r.archived);
  const section = (l) => `<div class="cards">\n      ${l.map((r) => projectCard(r, 0)).join("\n      ")}\n    </div>`;
  let body = `    <h1>Projects</h1>
    <p class="lede">Every public repository on my GitHub, newest activity first. Click any project for its description and full commit history.</p>
    <h2>Active (${active.length})</h2>
    ${section(active)}`;
  if (archived.length) {
    body += `\n    <h2>Archived (${archived.length})</h2>\n    ${section(archived)}`;
  }
  write("projects.html", layout({ title: "Projects", active: "projects.html", body }));
}

function buildProjectPage(r) {
  const commits = r.commits || [];
  const rows = [
    ["Repository", `<a href="${r.html_url}">${esc(r.full_name)}</a>`],
    ["Primary language", r.language ? esc(r.language) : DASH],
    ["Status", r.archived ? "Archived" : "Active"],
    ["Visibility", "Public"],
    ["Created", fmtDate(r.created_at) || DASH],
    ["Last commit", fmtDate(r.pushed_at) || DASH],
    ["Commits", r.commitCount != null ? String(r.commitCount) : "100+"],
  ];
  if (r.homepage) rows.push(["Homepage", `<a href="${esc(r.homepage)}">${esc(r.homepage)}</a>`]);

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

  const body = `    <a class="back" href="../projects.html">${ARROW_L} All projects</a>
    <h1>${esc(r.name)}</h1>
    <p class="lede">${esc(r.description || "No description provided.")}</p>
    <table class="prose" style="display:table;max-width:640px">
      ${rows.map(([k, v]) => `<tr><th style="width:11rem">${k}</th><td>${v}</td></tr>`).join("\n      ")}
    </table>
    <h2>Commit history</h2>
    ${moreNote}
    <ul class="commits">
      ${commitItems}
    </ul>`;
  write(`projects/${slug(r.name)}.html`, layout({ title: r.name, active: "projects.html", body, depth: 1 }));
}

function buildTimeline(repos) {
  const events = [];
  for (const r of repos) {
    for (const c of (r.commits || []).slice(0, 12)) {
      if (c.date) events.push({ repo: r.name, ...c });
    }
  }
  events.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = events.slice(0, 150);

  const groups = new Map();
  for (const e of recent) {
    const day = fmtDate(e.date);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  let body = `    <h1>Timeline</h1>
    <p class="lede">A unified, chronological feed of recent commits across all public repositories ${DASH} the day-to-day record of what I've been working on.</p>`;
  if (groups.size === 0) {
    body += `\n    <p class="note">The timeline is assembled from live commit data and will populate on the next automated build.</p>`;
  }
  for (const [day, evs] of groups) {
    body += `\n    <div class="tl-day">${day}</div>\n    <ul class="commits">`;
    for (const e of evs) {
      body += `\n      <li>
        <span class="date tl-repo">${esc(e.repo)}</span>
        <span class="msg">${esc(e.message)}</span>
        <a class="sha" href="${e.url}">${e.sha}</a>
      </li>`;
    }
    body += `\n    </ul>`;
  }
  write("timeline.html", layout({ title: "Timeline", active: "timeline.html", body }));
}

function buildContentPage({ src, out, title, active }) {
  const path = join(ROOT, src);
  if (!existsSync(path)) { console.warn("skip missing content:", src); return; }
  const md = readFileSync(path, "utf8");
  // Drop a leading top-level "# Title" so it isn't duplicated under our <h1>.
  const cleaned = md.replace(/^\s*#\s+.*\n/, "");
  const body = `    <h1>${esc(title)}</h1>\n    <div class="prose">\n${markdown(cleaned)}\n    </div>`;
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
    // Keep public, non-fork repos (this portfolio repo documents itself too).
    list = raw.filter((r) => !r.private && !r.fork);
  } catch (e) {
    console.warn(`Repo list unavailable (${e.message}). Falling back to data/seed.json.`);
    list = loadSeed();
    if (!list) throw new Error("No API access and no seed file - cannot build.");
  }

  console.log(`Found ${list.length} public repositories. Fetching commit history...`);
  for (const r of list) {
    const { commits, count } = await fetchCommits(r.full_name, 100);
    // Keep anything already on the seed object if the API gave us nothing.
    r.commits = commits.length ? commits : (r.commits || []);
    r.commitCount = commits.length ? count : (r.commitCount ?? null);
    const label = r.commitCount != null ? r.commitCount : (r.commits.length ? `${r.commits.length}+` : "?");
    console.log(`  ${r.name}: ${label} commits`);
  }

  const langs = new Set(list.map((r) => r.language).filter(Boolean));
  let commitTotal = 0;
  let approx = false;
  for (const r of list) {
    commitTotal += r.commitCount != null ? r.commitCount : r.commits.length;
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
