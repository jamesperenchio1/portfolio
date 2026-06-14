# Complete Infrastructure Documentation

## Table of Contents
1. [Hardware Specifications](#hardware-specifications)
2. [Network Architecture](#network-architecture)
3. [DNS Configuration](#dns-configuration)
4. [Reverse Proxy Setup](#reverse-proxy-setup)
5. [Authentication System](#authentication-system)
6. [Service Catalog](#service-catalog)
7. [Docker Configuration](#docker-configuration)
8. [LXC Containers](#lxc-containers)
9. [Storage Management](#storage-management)
10. [SSL/TLS Certificates](#ssltls-certificates)
11. [Firewall Rules](#firewall-rules)
12. [Backup Strategy](#backup-strategy)
13. [Monitoring](#monitoring)
14. [Troubleshooting Log](#troubleshooting-log)
15. [Deployment History](#deployment-history)
16. [Credentials](#credentials)
17. [Maintenance Procedures](#maintenance-procedures)

---

## Hardware Specifications

### Server
- **Model:** Intel N100 Mini-PC
- **CPU:** Intel N100 (4 cores, 4 threads, 1.1GHz base, 3.4GHz boost)
- **RAM:** 10GB DDR4
- **Storage:**
  - 238GB NVMe SSD (system, containers, databases)
  - 477GB HDD (media storage)
- **Network:** Gigabit Ethernet
- **OS:** Ubuntu 25.10 Server
- **Location:** 192.168.1.102

### Peripherals
- External USB drive for additional storage
- HDMI output (headless operation)
- USB 3.0 ports for expansion

---

## Network Architecture

### Traffic Flow
```
Internet
  ↓
Cloudflare (TLS termination, DDoS protection)
  ↓
cloudflared tunnel (connects to local network)
  ↓
Caddy reverse proxy (port 80)
  ↓
Backend services (various ports)
```

### LAN Optimization (Split-Horizon DNS)
On-LAN devices bypass Cloudflare entirely:
```
LAN Device → AdGuardHome DNS → 192.168.1.102 (direct)
```
This reduces latency from ~150ms to ~25ms per request.

### DNS Resolution Chain
1. Device queries DNS (usually AdGuardHome at 192.168.1.102)
2. AdGuardHome checks rewrites first
3. If `.example.com` domain → returns 192.168.1.102
4. Other domains → forwarded to upstream (Cloudflare/Quad9)

### Network Segments
- **Host:** 192.168.1.102 (Docker, system services)
- **LXC containers:** 10.55.205.x subnet
- **Tailscale:** 100.x.x.x (VPN mesh network)

---

## DNS Configuration

### AdGuardHome Setup
- **Port:** 53 (DNS), 80 (HTTP admin), 3000 (initial setup)
- **Config:** `/opt/adguardhome/conf/AdGuardHome.yaml`
- **Work dir:** `/opt/adguardhome/work/`

### DNS Rewrites (Split-Horizon)
These domains resolve to 192.168.1.102 on LAN:
- `cloud.example.com`
- `office.example.com`
- `auth.example.com`
- `immich.example.com`
- `watch.example.com`
- `indexer.example.com`
- `dash.example.com`
- `books.example.com`
- `qbittorrent.example.com`
- `search.example.com`
- `adguardhome.example.com`

### Upstream DNS Servers
- Cloudflare (1.1.1.1, 1.0.0.1)
- Quad9 (9.9.9.9) - malware blocking

### DNS Cache Settings
- Cache size: 4194304 bytes
- Cache TTL min: 60 seconds
- Cache TTL max: 86400 seconds

---

## Reverse Proxy Setup

### Caddy Configuration
- **Binary:** `/usr/bin/caddy`
- **Config:** `/etc/caddy/Caddyfile`
- **Service:** `systemctl status caddy`
- **Reload:** `sudo systemctl reload caddy`

### Caddyfile Structure
```
# Global options
{
    auto_https disable_redirects
    email ssl@example.com
}

# Common snippets
(compression) {
    encode gzip zstd
}

# Service blocks
watch.example.com {
    import compression
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto https
    }
}
```

### Critical Configuration Notes
- `header_up X-Forwarded-Proto https` is REQUIRED for all backends
- Using `{http.request.scheme}` produces `http` and breaks Authentik (mixed content errors)
- `auto_https disable_redirects` allows both HTTP (tunnel) and HTTPS (LAN) to work

### SSL/TLS on LAN
- Caddy serves HTTPS on port 443 for LAN clients
- Uses auto-renewed Let's Encrypt certificates
- HTTP-01 challenge succeeds through Cloudflare tunnel

---

## Authentication System

### Authentik SSO
- **URL:** https://auth.example.com
- **Port:** 9000 (internal)
- **Compose:** `/opt/authentik/docker-compose.yml`
- **Env:** `/opt/authentik/.env`

### Authentication Methods
1. **Forward Auth (Caddy + Authentik):**
   - Frigate, File Share, Immich, Jellyfin
   - Caddy enforces Authentik login before proxying

2. **Native OIDC with Authentik:**
   - Nextcloud, Immich, Jellyfin, Home Assistant
   - Direct OIDC integration

3. **Internal Auth Only:**
   - WebSSH (ssh.example.com)

### Users
- [redacted email] (admin)
- dang (admin)
- pang (limited)

### Groups
- authentik Admins
- authentik Users

### Applications Configured
- Nextcloud (OIDC)
- Immich (OIDC)
- Jellyfin (OIDC)
- Home Assistant (OIDC via hass-oidc-auth)
- Various forward-auth protected services

### API Access
```bash
curl -s http://192.168.1.102:9000/api/v3/core/applications/   -H "Authorization: Bearer <AUTHENTIK_API_TOKEN>"
```

---

## Service Catalog

### Active Services

#### 1. Reiverr (Media Discovery)
- **Image:** `ghcr.io/aleksilassila/reiverr:latest`
- **Port:** 3000
- **Status:** Active
- **Purpose:** Movie/TV discovery with torrent streaming
- **Features:**
  - TMDB integration for metadata
  - Torrent streaming via WebTorrent
  - Jackett integration for indexer search
  - Watchlist management
- **Configuration:**
  - Requires Jackett API key
  - Needs indexers configured in Jackett first
  - First login creates admin account
- **Issues:**
  - "No source found" error without Jackett indexers
  - Timeout of 5000ms exceeded during initial setup

#### 2. Jackett (Torrent Indexer)
- **Image:** `lscr.io/linuxserver/jackett:latest`
- **Port:** 9117
- **Status:** Active (reset once)
- **Purpose:** Aggregate torrent indexers
- **Features:**
  - 500+ supported indexers
  - Torznab API output
  - RSS feed generation
  - Manual search capability
- **Configuration:**
  - API key: `[redacted]`
  - No admin password set (API-only access)
  - Requires manual indexer addition via web UI
- **Issues:**
  - API returns 405 without cookie session
  - "Unable to cast object" error with JSON config
  - Cannot add indexers programmatically

#### 3. qBittorrent (Download Client)
- **Image:** `linuxserver/qbittorrent:latest`
- **Port:** 8082 (mapped to container 8080)
- **Status:** Active
- **Purpose:** Torrent download management
- **Features:**
  - Web UI for remote management
  - RSS auto-downloading
  - Category/label management
  - Speed limiting
- **Credentials:** admin / [redacted]
- **API Notes:**
  - v5+ requires `Host: localhost:8080` header
  - Login returns 204 (cookie-based auth)
  - Use container-internal paths for savepath (`/movies/` not host paths)

#### 4. Calibre-Web (Book Library)
- **Image:** `linuxserver/calibre-web:latest`
- **Port:** 8083
- **Status:** Active
- **Purpose:** E-book library management
- **Features:**
  - Web-based e-reader
  - OPDS support for e-reader apps
  - Metadata editing
  - Conversion (requires Calibre binaries)
- **Credentials:** admin / [redacted]
- **Volumes:**
  - `/opt/calibre-web/config:/config`
  - `/mnt/nvme-usb/media/books:/books`

#### 5. Authentik (SSO)
- **Image:** `ghcr.io/goauthentik/server:latest`
- **Port:** 9000
- **Status:** Active
- **Purpose:** Single sign-on and identity management
- **Components:**
  - Server (API, web UI)
  - Worker (background tasks)
  - Redis (caching)
  - PostgreSQL (database)
- **Configuration:**
  - Compose: `/opt/authentik/docker-compose.yml`
  - Env: `/opt/authentik/.env`
- **Restart:** `cd /opt/authentik && sudo docker compose restart server`

#### 6. Nextcloud (File Storage)
- **Location:** LXC container `sharing-services` (10.55.205.31:80)
- **Status:** Active
- **Purpose:** File storage, sync, collaboration
- **Features:**
  - WebDAV file access
  - Collabora document editing
  - Calendar, contacts, tasks
  - End-to-end encryption option
- **Storage:** External mount at `/mnt/external/nextcloud-data/`
- **Collabora Integration:**
  - `wopi_url`: `http://192.168.1.102:9980` (internal)
  - `public_wopi_url`: `https://office.example.com` (external)
- **Preview Settings:**
  - `preview_max_x`: 8192
  - `preview_max_y`: 8192
  - `preview_max_scale_factor`: 1

#### 7. Immich (Photo Management)
- **Location:** LXC container (10.55.205.104:2283)
- **Status:** Active
- **Purpose:** Photo backup and management
- **Features:**
  - Automatic mobile backup
  - Facial recognition
  - Map view (GPS)
  - Shared albums
- **Storage:**
  - Thumbnails on NVMe via Docker bind mount
  - Originals on HDD
- **Auth:** Authentik OIDC

#### 8. AdGuard Home (DNS)
- **Status:** Active
- **Purpose:** DNS ad-blocking and LAN DNS management
- **Features:**
  - Network-wide ad blocking
  - Custom DNS rewrites
  - Parental controls
  - Query logging
- **Config:** `/opt/adguardhome/conf/AdGuardHome.yaml`
- **Service:** `sudo systemctl restart AdGuardHome`
- **Issues:**
  - Config corruption during manual edits
  - YAML structure must be maintained carefully

#### 9. Collabora Online (Document Editor)
- **Image:** `collabora/code:latest`
- **Port:** 9980
- **Status:** Active
- **Purpose:** Online document editing
- **Features:**
  - LibreOffice-based editing
  - Supports DOCX, XLSX, PPTX, ODF
  - Real-time collaboration
- **Configuration:**
  - Started with `docker run` (no compose file)
  - `/opt/collabora/systemplate` bind mount required
  - Allowed host: `https://cloud.example.com:443`
- **Admin Interface:**
  - Available at `/browser/dist/admin/admin.html`
  - Disabled by default
  - Requires `username`/`password` env vars to enable

#### 10. Homepage (Dashboard)
- **Image:** `ghcr.io/gethomepage/homepage:latest`
- **Port:** 3001
- **Status:** Active
- **Purpose:** Service overview and quick links
- **Features:**
  - Service status display
  - Resource widgets (CPU, memory, disk)
  - Search integration
  - Docker integration
- **Configuration:**
  - `/opt/homepage/config/services.yaml`
  - `/opt/homepage/config/settings.yaml`
  - `/opt/homepage/config/widgets.yaml`
  - `/opt/homepage/config/bookmarks.yaml`
- **Required Env:** `HOMEPAGE_ALLOWED_HOSTS=*`
- **Issues:**
  - Host validation failed without env var
  - Default config shows example services

#### 11. SearXNG (Search)
- **Status:** Not deployed
- **Purpose:** Privacy meta-search engine
- **Features:**
  - Aggregates 70+ search engines
  - No tracking or profiling
  - Tor support
- **Note:** Returns 000 (not deployed)

#### 12. Cloudflared (Tunnel)
- **Status:** Active
- **Purpose:** Secure tunnel to Cloudflare edge
- **Service:** `/etc/systemd/system/cloudflared.service`
- **Token:** Stored in service file
- **Function:** Routes external traffic to local Caddy

#### 13. Tailscale (VPN)
- **Status:** Active
- **Purpose:** Mesh VPN for remote access
- **Function:** Direct access to services without going through Cloudflare

### Removed Services
- Home Assistant (home automation)
- Frigate NVR (video surveillance)
- WebSSH (browser-based SSH)
- Jellyseerr (media request manager)
- Sonarr (TV automation)
- Radarr (movie automation)
- Jellyfin (media server)
- Stremio (streaming aggregator)

---

## Docker Configuration

### Docker Compose Files
- `/opt/authentik/docker-compose.yml` - Authentik stack
- `/opt/homeassistant/docker-compose.yml` - Home Assistant (removed)
- `/opt/media-stack/docker-compose.yml` - Media services
- `~/docker-compose.yml` - WebSSH (removed)

### Docker Networks
- Default bridge network
- Custom networks for isolated stacks

### Container Management
```bash
# List all containers
sudo docker ps -a

# Restart container
sudo docker restart <name>

# View logs
sudo docker logs <name> --tail=50 -f

# Resource usage
sudo docker stats
```

### Important Notes
- `docker restart docker` restarts ALL containers (avoid)
- Use individual `docker compose restart` or `docker restart <name>`
- Container RAM should be capped (qBittorrent 512MB, etc.)

---

## LXC Containers

### Container List
| Name | IP | Purpose | Status |
|------|-----|---------|--------|
| frigate | 10.55.205.63 | NVR (removed) | Stopped |
| immich | 10.55.205.104 | Photo management | Running |
| dashboard | 10.55.205.109 | Jellyfin (removed) | Stopped |
| sharing-services | 10.55.205.31 | Nextcloud | Running |

### Management Commands
```bash
lxc list                          # All containers + IPs
lxc exec <name> -- bash          # Shell into LXC
lxc start <name>                 # Start container
lxc stop <name>                  # Stop container
```

### Networking
- LXD managed bridge
- NAT rules for external access
- `lxd-nat-rules.sh` fixes networking issues

---

## Storage Management

### Mount Points
| Mount | Size | Usage |
|-------|------|-------|
| `/` (NVMe) | 238GB | System, containers, databases |
| `/mnt/hdd` | 477GB | Media (frigate, immich, SHARE) |
| `/mnt/external` | varies | External USB |

### Nextcloud Data
- External mount at `/mnt/external/nextcloud-data/`
- User data: `ncadmin` (display name: "Ginger Bros")
- Actual files in local storage mount at `/mnt/external/files/`

### Immich Storage
- Thumbnails on NVMe via Docker bind mount
- Originals on HDD
- Do NOT use symlinks for thumbnail storage

### Media Organization
```
/mnt/hdd/
├── frigate/          # NVR recordings (removed)
├── immich/           # Photo originals
└── SHARE/            # Shared files
```

### Storage Optimization
- Nextcloud data moved to NVMe LXC rootfs
- PHP OPcache tuned (max_accelerated_files=50000, interned_strings_buffer=32)
- Systemd journals vacuumed to 500MB limit
- Developer caches can consume 12GB+ and should be purged

---

## SSL/TLS Certificates

### Certificate Sources
1. **Cloudflare:** TLS termination at edge (external traffic)
2. **Let's Encrypt:** Caddy auto-renews via HTTP-01 challenge
3. **Tailscale:** Built-in certificates for mesh connections

### Certificate Renewal
- Caddy handles auto-renewal
- HTTP-01 challenge succeeds through Cloudflare tunnel
- LAN certificates on port 443

---

## Firewall Rules

### UFW Status
```bash
sudo ufw status
```

### Required Ports
| Port | Service | Direction |
|------|---------|-----------|
| 22 | SSH | Inbound |
| 53 | DNS | Inbound |
| 80 | HTTP (Caddy) | Inbound |
| 443 | HTTPS (Caddy LAN) | Inbound |
| 3000 | Reiverr | Localhost |
| 3001 | Homepage | Localhost |
| 8082 | qBittorrent | Localhost |
| 9117 | Jackett | Localhost |
| 9000 | Authentik | Localhost |
| 9980 | Collabora | Localhost |

### LXD NAT Rules
- Managed by `lxd-nat-rules.sh`
- IPv4 forwarding for LXC containers
- Tailscale bypass rules

---

## Backup Strategy

### Current Backups
- Nextcloud data on external storage
- Immich photos on HDD
- Git repositories on GitHub

### Backup Gaps
- No automated container backup
- No database dumps scheduled
- No off-site backup strategy

### Recommended Additions
1. Restic or BorgBackup for automated backups
2. External backup destination (rsync.net, B2, etc.)
3. Database dump scripts (PostgreSQL, MySQL)
4. Configuration backup (docker-compose files, Caddyfile)

---

## Monitoring

### Current Monitoring
- Homepage dashboard (basic resource widgets)
- Docker stats (container resource usage)
- AdGuardHome query log

### Monitoring Gaps
- No alerting system
- No historical metrics
- No uptime monitoring
- No log aggregation

### Recommended Additions
1. Uptime Kuma (uptime monitoring)
2. Prometheus + Grafana (metrics)
3. Loki (log aggregation)
4. Alertmanager (notifications)

---

## Troubleshooting Log

### 2026-06-14: Jackett API Issues
**Problem:** Cannot add indexers via API
**Error:** 405 errors, "Unable to cast object of type 'Newtonsoft.Json.Linq.JValue' to type 'Newtonsoft.Json.Linq.JArray'"
**Cause:** Jackett requires cookie-based session for API configuration
**Solution:** Manual indexer addition via web UI required
**Status:** Unresolved (manual workaround)

### 2026-06-14: AdGuardHome Config Corruption
**Problem:** DNS rewrites not working, config file corrupted
**Cause:** Manual appending broke YAML structure
**Solution:** Careful line-by-line cleanup, proper indentation
**Status:** Resolved

### 2026-06-14: Homepage Host Validation
**Problem:** Dashboard returns "Host validation failed"
**Cause:** Homepage requires explicit host allowlist
**Solution:** Set `HOMEPAGE_ALLOWED_HOSTS=*` environment variable
**Status:** Resolved

### 2026-06-14: DNS Cache Issues
**Problem:** Intermittent resolution failures for new domains
**Cause:** Browser and OS DNS cache
**Solution:** Cache flushes, incognito mode, waiting for propagation
**Status:** Resolved with time

### 2026-06-14: Reiverr "No Source Found"
**Problem:** Cannot stream movies
**Cause:** No indexers configured in Jackett
**Solution:** Add indexers manually (1337x, YTS, EZTV, etc.)
**Status:** Requires user action

### 2026-06-14: Collabora Systemplate
**Problem:** Collabora document loads laggy
**Cause:** Missing writable systemplate mount
**Solution:** Bind mount `/opt/collabora/systemplate` to container
**Status:** Resolved

### 2026-06-14: Nextcloud HEIC Preview
**Problem:** HEIC images blurry when zoomed
**Cause:** Preview generator not working for HEIC files
**Solution:** Convert HEIC to JPG with ImageMagick, run `occ files:scan`
**Status:** Workaround implemented

---

## Deployment History

### Initial Setup (Date Unknown)
- Ubuntu 25.10 installation
- Docker and LXD setup
- Caddy reverse proxy configuration
- Cloudflare tunnel establishment
- Tailscale VPN setup

### 2026-06-14: Service Cleanup
- Removed: Home Assistant, Frigate, WebSSH, Jellyseerr, Sonarr, Radarr, Jellyfin, Stremio
- Kept: qBittorrent
- Reason: User requested removal of dead services

### 2026-06-14: Media Stack Deployment
- Deployed: Reiverr, Jackett, Calibre-Web
- Configured: Homepage dashboard
- Fixed: DNS rewrites for new domains
- Issue: Jackett requires manual indexer setup

### 2026-06-14: Documentation Creation
- Created: INFRASTRUCTURE.md, PROJECT_LOG.md
- Uploaded: portfolio website to GitHub Pages
- Status: Live at jamesperenchio1.github.io/portfolio

---

## Credentials

### Stored Credentials
File: `~/authentik-user-credentials.txt` (chmod 600)

### Service Credentials
| Service | Username | Password/Key | Notes |
|---------|----------|--------------|-------|
| Reiverr | First login | User-defined | First login creates admin |
| Jackett | None | API: [redacted] | No password required |
| qBittorrent | admin | [redacted] | Web UI access |
| Calibre-Web | admin | [redacted] | Initial setup |
| Authentik | [redacted email] | See credentials file | Admin account |
| Authentik | dang | See credentials file | Admin account |
| Authentik | pang | See credentials file | Limited account |
| Nextcloud | Authentik SSO | - | OIDC login |
| Immich | Authentik SSO | - | OIDC login |

### API Keys
- Jackett API: `[redacted]`
- Authentik API: See `~/AUTHENTIK_SSO_SETUP_GUIDE.md`

---

## Maintenance Procedures

### Daily
- Check dashboard for service status
- Review AdGuardHome query log

### Weekly
- Review Docker container logs
- Check disk space usage
- Update containers if needed

### Monthly
- Review and clean up unused containers/images
- Check SSL certificate expiration
- Backup critical data
- Update system packages

### As Needed
- Add/remove services based on requirements
- Update Caddyfile for new domains
- Configure new Authentik applications
- Adjust resource limits based on usage

### Emergency Procedures
- **Service down:** `sudo docker restart <container>`
- **Caddy issues:** `sudo systemctl reload caddy`
- **DNS issues:** `sudo systemctl restart AdGuardHome`
- **Full disk:** Check `/mnt/hdd` and `/mnt/external`, clean up
- **Memory pressure:** Check `docker stats`, restart heavy containers

---

## Custom Utilities

### Desktop Management
```bash
desktop start    # Launch GUI (lightdm)
desktop stop     # Stop GUI and free RAM (~27MB saved)
desktop status   # Check GUI state
```

### User Management
```bash
user-remove <username>     # Delete Authentik user
user-remove list           # List all Authentik users
```

### Network Fix
```bash
lxd-nat-rules.sh           # Fix LXD networking (NAT/forward/Tailscale)
```

---

## File Locations

### Critical Config Files
| File | Purpose |
|------|---------|
| `/etc/caddy/Caddyfile` | Reverse proxy routing |
| `/opt/authentik/.env` | Authentik secrets |
| `/opt/authentik/docker-compose.yml` | Authentik containers |
| `/opt/homeassistant/config/configuration.yaml` | HA config (removed) |
| `/etc/systemd/system/cloudflared.service` | Tunnel token |
| `/opt/adguardhome/conf/AdGuardHome.yaml` | DNS config |
| `~/authentik-user-credentials.txt` | Service credentials |
| `~/AUTHENTIK_SSO_SETUP_GUIDE.md` | OIDC credentials |
| `~/SERVER_ARCHITECTURE_MANUAL.md` | Full service inventory |

### Documentation Files
| File | Purpose |
|------|---------|
| `~/authentik-user-credentials.txt` | Service credentials |
| `~/AUTHENTIK_SSO_SETUP_GUIDE.md` | OIDC setup details |
| `~/SERVER_ARCHITECTURE_MANUAL.md` | Full architecture |
| `~/CLAUDE.md` | Claude Code guidance |

---

## Performance Notes

### Resource Usage
- CPU: Typically 10-30% idle
- Memory: 4-6GB used, 4GB free
- Disk: 76GB free on NVMe

### Optimizations Applied
- Docker container RAM caps
- PHP OPcache tuning
- Systemd journal vacuuming
- Nextcloud preview limits (8192x8192)
- Immich thumbnails on NVMe

### Bottlenecks
- HDD speed for media access
- Network latency for external traffic (mitigated by split-horizon DNS)
- Memory pressure when running GUI (desktop stop saves ~27MB)

---

## Future Improvements

### High Priority
1. Automated backup system (Restic/Borg)
2. Uptime monitoring (Uptime Kuma)
3. Centralized logging (Loki)
4. Resource monitoring (Prometheus/Grafana)

### Medium Priority
1. SearXNG deployment
2. VPN server (WireGuard)
3. Automated container updates
4. Database backup scripts

### Low Priority
1. Additional media indexers
2. Book automation (Readarr)
3. Music server (Navidrome)
4. Podcast manager (Podgrab/Audiobookshelf)

---

## Contact & Access

### GitHub
https://github.com/jamesperenchio1

### Services
All services accessible via `.example.com` domains.

### Server Access
- SSH: 192.168.1.102 (LAN)
- Tailscale: 100.x.x.x (VPN)

---

*Last updated: 2026-06-14*
*Documentation version: 1.0*
