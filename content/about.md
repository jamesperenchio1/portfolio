# About

This site is a record of what I've been building. It exists so that everything
scattered across my GitHub account and my self-hosted server is gathered in one
place — described plainly, kept honest, and updated on its own.

## What this is

Rather than a hand-written résumé, this is a documentation site that reads my
work directly from the source:

- **Projects** lists every public repository on my GitHub, with its real
  description, primary language, and full commit history pulled live from the
  GitHub API.
- **Timeline** is a chronological feed of recent commits across all of those
  repositories — a day-by-day log of what I've actually been doing.
- **Infrastructure** documents the self-hosted server I run: the hardware, the
  network, and every service on it, along with the problems I hit and how I
  solved them.
- **Work Log** captures notable build sessions and the lessons that came out of
  them.

## How I work

Most of what I do falls into a few recurring threads, all visible in the project
list:

- **E-commerce and storefronts** — building and iterating on online shops.
- **Trackers and data tools** — small applications that collect and surface
  real-world data (energy prices, spending, neighborhood signals, and more).
- **Idea and product automation** — pipelines that research and generate
  product ideas automatically and commit the results.
- **Self-hosting and infrastructure** — running my own services on a small
  home server instead of renting everything from the cloud.

I lean heavily on automation. Several of these repositories run themselves on a
schedule and commit their own output — and this very website is built the same
way.

## Keeping it current

I don't want a portfolio that goes stale the moment I stop maintaining it. So
this site has no manual update step: a scheduled job re-reads my GitHub account,
regenerates every page from the latest data, and republishes. The commit
histories, the project list, and the timeline you see are always close to live.

The source for this site, including the generator and the automation that keeps
it fresh, is itself one of the public repositories listed under Projects.
