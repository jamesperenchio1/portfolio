# Project Log

## 2026-06-14: Infrastructure Rebuild

### What Was Done
- Removed dead services (Home Assistant, Frigate, WebSSH, Jellyseerr, Sonarr, Radarr, Jellyfin, Stremio)
- Deployed new media stack: Reiverr, Jackett, qBittorrent, Calibre-Web
- Set up Homepage dashboard for service overview
- Fixed DNS issues with AdGuardHome
- Configured Caddy reverse proxy for all services
- Created documentation and portfolio website

### What Worked
- Reiverr deployment successful
- Jackett reset and API key generation
- Dashboard deployment with proper config
- DNS rewrites for LAN optimization
- GitHub Pages deployment

### What Didn't Work
- Jackett automatic indexer setup (API returned 405 errors, requires manual configuration)
- AdGuardHome config got corrupted during manual edits (required careful YAML cleanup)
- Homepage host validation (required HOMEPAGE_ALLOWED_HOSTS=*)
- Reiverr streaming without indexers ("No source found" error)

### Lessons Learned
- Always backup config files before editing
- Jackett API requires cookie-based session for configuration
- Homepage dashboard needs explicit host allowlist
- DNS cache can cause issues for 5-10 minutes after changes

## 2026-06-14: Documentation

### What Was Done
- Created comprehensive infrastructure documentation
- Removed all "homelab" terminology
- Uploaded to GitHub portfolio repo
- Created project log (this file)

### Technical Details
- Intel N100, 10GB RAM, Ubuntu 25.10
- Docker containers for most services
- LXC containers for Frigate, Immich, Jellyfin, Nextcloud
- Cloudflare tunnel for external access
- AdGuardHome for DNS management
