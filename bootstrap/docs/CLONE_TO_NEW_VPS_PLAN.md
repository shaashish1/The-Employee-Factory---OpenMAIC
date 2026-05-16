# TEF — Clone to New VPS (Migration Plan)

**Goal:** Stand up an identical copy of learn.theemployeefactory.com on a new VPS using GitHub as the source transport.

**Transport architecture:**
- Source code → private GitHub repo (no secrets, no data committed)
- Data volume + env/secrets → one-shot SCP from current VPS to new VPS (so secrets never touch GitHub)

---

## Phase A — Push source to GitHub (this VPS)

1. Init git in `/home/learn.theemployeefactory.com/openmaic_src/` (or wherever the local-only customizations also live).
2. `.gitignore` for: `.env`, `.env.local`, `server-providers.yml`, `node_modules/`, `.next/`, `data/`, `pnpm-store/`.
3. Create private GitHub repo (e.g., `tef-openmaic-fork`).
4. Initial commit → push to `origin/main`.

**Inputs needed:** GitHub username, PAT or SSH key, repo name, visibility (private recommended).

## Phase B — Snapshot data + secrets (this VPS)

1. Stop container briefly OR rely on existing nightly tar at `/home/rony/backups/openmaic/`.
2. Create one bootstrap archive: `tef-bootstrap-YYYYMMDD.tar.gz` containing:
   - The Docker volume (`/var/lib/docker/volumes/openmaic_src_openmaic-data/_data/`)
   - `.env.local`
   - `server-providers.yml`
   - The OLS vhost config (`/usr/local/lsws/conf/vhosts/learn.theemployeefactory.com/vhost.conf`)
3. Park it at `/root/tef-bootstrap-YYYYMMDD.tar.gz` (mode 600).

**Inputs needed:** none — purely local.

## Phase C — Provision new VPS

1. Confirm OS (Ubuntu 22.04 recommended for parity), RAM ≥ 2 GB, disk ≥ 10 GB free.
2. Install: `docker`, `docker compose plugin`, `git`, and either `nginx` or OLS.
3. Create `/home/learn.theemployeefactory.com/` (root owned to match current VPS).

**Inputs needed:** new VPS IP, SSH access (key preferred), sudo confirmation.

## Phase D — Deploy on new VPS

1. SCP the bootstrap archive from this VPS to new VPS.
2. `git clone <github-url> /home/learn.theemployeefactory.com/openmaic_src`.
3. Extract bootstrap archive:
   - Volume `_data` → `/var/lib/docker/volumes/openmaic_src_openmaic-data/_data/`, `chown -R 1001:1001`.
   - `.env.local` + `server-providers.yml` → into `openmaic_src/`.
   - OLS vhost (or rewritten nginx vhost) installed.
4. `cd openmaic_src && sudo DOCKER_BUILDKIT=0 docker build --network=host -t openmaic_src-openmaic:latest .`
5. `sudo docker compose up -d`.

**Inputs needed:** decision on whether to reuse provider keys as-is or rotate; nginx vs OLS preference.

## Phase E — Network cutover

1. Provision TLS cert on new VPS (Let's Encrypt, or Cloudflare-origin cert if behind Cloudflare).
2. Update DNS for `learn.theemployeefactory.com` to new VPS IP.
3. If Cloudflare orange-cloud is on, cutover is near zero-downtime.

**Inputs needed:** DNS provider access (or you do the change yourself once IP is confirmed).

## Phase F — Post-cutover validation + ongoing backups

1. Health checks: HTTP 200 on `/`, `/api/server-providers` returns 4 providers, classroom list returns 3.
2. Install nightly tar cron on new VPS, same retention (14 days), targeting `/home/rony/backups/openmaic/`.
3. Old VPS: stop the container, keep data for ~30 days as fallback before decommissioning.

**Inputs needed:** confirmation when ready to decommission old VPS.

---

## What stays the same vs what changes

| Item | Old VPS | New VPS |
|---|---|---|
| Source tree | local edits | git clone from origin |
| Docker image | built locally | built locally (from same source) |
| Data volume | 596K, 3 classrooms | same data, restored from tar |
| Provider keys | in .env.local | same (unless rotated) |
| Domain | learn.theemployeefactory.com | same (DNS cutover) |
| Web server | OpenLiteSpeed | OLS or nginx (your choice) |
| Backup cron | `/home/rony/backups/openmaic/` | same path/cron |

## Rollback

If new VPS deployment is broken, just revert the DNS record back to old VPS IP. Old VPS stays running as the source of truth until decommission.
