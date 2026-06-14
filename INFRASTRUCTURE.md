# Infrastructure Documentation

## Overview
Self-hosted services running on Intel N100 (4 cores, 10GB RAM, 238GB NVMe + 477GB HDD).

## Architecture

```
Internet → Cloudflare (TLS) → cloudflared tunnel → Caddy (port 80) → backend services
```

- **DNS:** AdGuardHome with split-horizon DNS (LAN traffic bypasses Cloudflare)
- **Auth:** Authentik SSO (OIDC + forward auth)
- **Storage:** NVMe for system/containers, HDD for media
- **Network:** Tailscale for remote access, Cloudflare tunnel for public services

## Services

### Media Stack
| Service | Description | Status |
|---------|-------------|--------|
| Reiverr | Movie/TV discovery & streaming | Active |
| Jackett | Torrent indexer aggregation | Active |
| qBittorrent | Download client | Active |
| Calibre-Web | Book library & management | Active |

### Infrastructure
| Service | Description | Status |
|---------|-------------|--------|
| Authentik | SSO & Identity provider | Active |
| Nextcloud | File storage, sync, collaboration | Active |
| Immich | Photo management & backup | Active |
| AdGuard Home | DNS & ad blocking | Active |

### Tools
| Service | Description | Status |
|---------|-------------|--------|
| SearXNG | Privacy meta-search engine | Not deployed |
| Collabora | Online document editing | Active (Nextcloud integration) |
| Dashboard | Service overview | Active |

## What Each Service Does

**Reiverr** - Media discovery platform with torrent streaming capabilities. Search, watch, or download movies/TV directly from the browser.

**Jackett** - Torrent indexer aggregation supporting 500+ public and private trackers. Provides unified API for search.

**qBittorrent** - Web-based download client with full torrent management capabilities.

**Calibre-Web** - Book library management with OPDS support for e-reader syncing.

**Authentik** - Single sign-on for all services. OIDC provider for Nextcloud, Immich, and others.

**Nextcloud** - File storage, sync, and collaboration with document editing integration.

**Immich** - Self-hosted photo management with facial recognition and automatic backup.

**AdGuard Home** - Network-wide DNS ad blocking with split-horizon DNS for LAN optimization.

**SearXNG** - Privacy meta-search engine. Aggregates results from 70+ search engines without tracking. Currently not deployed.

**Collabora** - LibreOffice-based online document editor. Integrates with Nextcloud.

**Caddy** - Reverse proxy with automatic HTTPS. No web UI, configured via Caddyfile.

## Setup Notes

### Reiverr Configuration
1. Create account (first login = admin)
2. Settings → Media Sources → Add "torrent" plugin
3. Configure with Jackett URL and API key
4. Add indexers in Jackett (1337x, YTS, EZTV, etc.)

### Jackett Setup
- Reset required after initial deployment (API auth issues)
- API key: `usk4hge3c7wlpc9ned95qwgv4ydw5iw3`
- Requires manual indexer addition via web UI

### DNS Configuration
- AdGuardHome rewrites `.gingerbrosshop.com` domains to `192.168.1.102`
- Cloudflare proxy handles external traffic
- Split-horizon DNS optimizes LAN performance

## Issues Encountered

1. **Jackett API Authentication** - Cookie-based auth required for API access. Initial attempts returned 405 errors. Fixed by establishing session cookies first.

2. **AdGuardHome Config Corruption** - Manual edits broke YAML structure. Required careful line-by-line cleanup to restore functionality.

3. **Homepage Dashboard** - Required `HOMEPAGE_ALLOWED_HOSTS=*` environment variable to bypass host validation errors.

4. **Reiverr "No Source Found"** - Torrent plugin needs Jackett indexers configured before streaming works.

5. **DNS Cache Issues** - Browser/OS DNS cache caused intermittent resolution failures. Required cache flushes and waiting for propagation.

## Hardware
- **CPU:** Intel N100 (4 cores)
- **RAM:** 10GB
- **Storage:** 238GB NVMe + 477GB HDD
- **OS:** Ubuntu 25.10

## Management Commands

```bash
# Service management
sudo systemctl reload caddy              # Apply Caddyfile changes
sudo systemctl restart AdGuardHome       # Restart DNS
sudo docker restart <container>          # Restart container

# Logs
sudo docker logs <container> --tail=50 -f
journalctl -u caddy -f

# LXC containers
lxc list                               # List containers
lxc exec <name> -- bash                # Shell into LXC
```

## Removed Services
- Home Assistant
- Frigate NVR
- WebSSH
- Jellyseerr
- Sonarr
- Radarr
- Jellyfin
- Stremio

## Credentials
All credentials stored in `~/authentik-user-credentials.txt` (chmod 600).

| Service | Username | Password/Key |
|---------|----------|--------------|
| Reiverr | (first login) | Set on first login |
| Jackett | (none) | API: usk4hge3c7wlpc9ned95qwgv4ydw5iw3 |
| qBittorrent | admin | adminadmin |
| Calibre-Web | admin | admin123 |
| Authentik | gingerbros.brew@gmail.com | (in credentials file) |

## GitHub
https://github.com/jamesperenchio1
