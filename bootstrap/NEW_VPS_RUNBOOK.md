# TEF — New VPS Bootstrap Runbook

Run these on the **new VPS** as a sudo-capable user.

---

## Step 1 — Prereqs (install once)

```bash
sudo apt update
sudo apt install -y git curl ca-certificates

# Docker + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo apt install -y docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
```

## Step 2 — Clone the repo

```bash
sudo mkdir -p /home/learn.theemployeefactory.com
sudo chown $USER:$USER /home/learn.theemployeefactory.com
cd /home/learn.theemployeefactory.com

# Repo is private — use a PAT or deploy key. For one-shot clone:
git clone https://<PAT>@github.com/shaashish1/The-Employee-Factory---OpenMAIC.git openmaic_src
cd openmaic_src
```

If you went with **Option A** (secrets pushed to git): secrets are already at `bootstrap/secrets/`. Skip to Step 4.

## Step 3 — Drop in secrets manually (only if Option B)

```bash
cd /home/learn.theemployeefactory.com/openmaic_src
mkdir -p bootstrap/secrets
# Paste each file's content from chat into:
#   bootstrap/secrets/openmaic_src.env.local
#   bootstrap/secrets/server-providers.yml
#   bootstrap/secrets/parent.env
#   bootstrap/secrets/parent.envelope
chmod 600 bootstrap/secrets/*
```

## Step 4 — Place secrets where the app expects them

```bash
cd /home/learn.theemployeefactory.com/openmaic_src
sudo cp bootstrap/secrets/openmaic_src.env.local .env.local
sudo cp bootstrap/secrets/server-providers.yml   server-providers.yml
sudo cp bootstrap/secrets/parent.env             ../.env
sudo cp bootstrap/secrets/parent.envelope        ../.envelope
sudo chmod 600 .env.local server-providers.yml ../.env ../.envelope
```

## Step 5 — Build the Docker image

```bash
cd /home/learn.theemployeefactory.com/openmaic_src
sudo DOCKER_BUILDKIT=0 docker build --network=host -t openmaic_src-openmaic:latest .
```
(~5–9 min)

## Step 6 — Restore the data volume (classrooms + audio)

Transfer the latest complete backup tar from the old VPS first:

```bash
# ON OLD VPS: pick the most recent complete archive
ls -lah /home/rony/backups/openmaic/openmaic-complete-*.tar.gz | tail -1

# ON NEW VPS: scp it over (run from new VPS)
scp <user>@<old-vps-ip>:/home/rony/backups/openmaic/openmaic-complete-<DATE>.tar.gz /tmp/
```

The complete tar contains: data volume (with audio mp3s), `.env.local`, `server-providers.yml`, parent `.env`, `.envelope`. Roughly 60 MB.

```bash
sudo docker volume create openmaic_src_openmaic-data
VOLPATH=$(sudo docker volume inspect openmaic_src_openmaic-data -f '{{.Mountpoint}}')

# Extract volume contents (everything except the top-level secret files)
sudo tar -xzf /tmp/openmaic-complete-<DATE>.tar.gz -C "$VOLPATH" \
  --exclude='.env.local' --exclude='server-providers.yml' \
  --exclude='.env' --exclude='.envelope'
sudo chown -R 1001:1001 "$VOLPATH"

# Extract secrets to the app dir (overrides bootstrap/secrets copy if used)
cd /home/learn.theemployeefactory.com/openmaic_src
sudo tar -xzf /tmp/openmaic-complete-<DATE>.tar.gz .env.local server-providers.yml
sudo tar -xzf /tmp/openmaic-complete-<DATE>.tar.gz -C /home/learn.theemployeefactory.com .env .envelope
sudo chmod 600 .env.local server-providers.yml ../.env ../.envelope

# Sanity check
sudo ls "$VOLPATH/classrooms/" | head
sudo find "$VOLPATH/classrooms/" -name '*.mp3' | wc -l   # expect dozens
```

> If the runbook's old `bootstrap/volume/` path is the only thing available (e.g. tar transfer failed), you can still restore the classroom JSONs from there — but audio mp3s will be missing and trainings will play silently until regenerated via `python3 bootstrap/generate-classroom-audio.py <id>`.

## Step 7 — Start the container

```bash
cd /home/learn.theemployeefactory.com/openmaic_src
sudo docker compose up -d
```

## Step 8 — Local health check

```bash
sudo docker ps | grep openmaic
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3004/
curl -s http://127.0.0.1:3004/api/server-providers | head -c 200
curl -s http://127.0.0.1:3004/api/classroom | python3 -c 'import sys,json; print(len(json.load(sys.stdin)),"classrooms")'
```

Expected: HTTP 200, 4 providers, 3 classrooms.

## Step 9 — Web server

### Option A: nginx (recommended for new VPS — lighter, simpler)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/learn.theemployeefactory.com > /dev/null <<'NGINX'
server {
    listen 80;
    server_name learn.theemployeefactory.com;
    client_max_body_size 100M;
    location / {
        proxy_pass http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/learn.theemployeefactory.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d learn.theemployeefactory.com --non-interactive --agree-tos -m ashish.sharma1@syngeneintl.com
```

### Option B: OpenLiteSpeed (parity)

Drop `bootstrap/vhost/learn.theemployeefactory.com.vhost.conf` into `/usr/local/lsws/conf/vhosts/learn.theemployeefactory.com/vhost.conf`, configure listener for :443, restart OLS.

## Step 10 — DNS cutover

1. Cloudflare → update `learn.theemployeefactory.com` A record to **new VPS IP**.
2. With orange-cloud on, cutover is near-zero-downtime.
3. Verify:
   ```bash
   curl -sL -o /dev/null -w "HTTP %{http_code}\n" https://learn.theemployeefactory.com/
   ```

## Step 11 — Nightly backup cron

```bash
sudo mkdir -p /root/backups/openmaic
sudo tee /usr/local/bin/openmaic-backup.sh > /dev/null <<'SH'
#!/bin/bash
set -e
DATE=$(date +%Y-%m-%d-%H%M)
OUT=/root/backups/openmaic/openmaic-${DATE}.tar.gz
VOLPATH=$(docker volume inspect openmaic_src_openmaic-data -f '{{.Mountpoint}}')
tar -czf "$OUT" -C "$VOLPATH" . \
  -C /home/learn.theemployeefactory.com/openmaic_src .env.local server-providers.yml 2>/dev/null || true
find /root/backups/openmaic -name 'openmaic-*.tar.gz' -mtime +14 -delete
echo "$(date) - $OUT $(du -h $OUT | cut -f1)" >> /root/backups/openmaic/backup.log
SH
sudo chmod +x /usr/local/bin/openmaic-backup.sh
echo "0 2 * * * root /usr/local/bin/openmaic-backup.sh" | sudo tee /etc/cron.d/openmaic-backup
```

## Step 12 — ROTATE PROVIDER KEYS (mandatory if Option A was used)

Within 24h of cutover:
- Groq:     https://console.groq.com/keys
- Anthropic: https://console.anthropic.com/settings/keys
- Google:    https://aistudio.google.com/apikey
- Azure AI Foundry: portal.azure.com → AI resource → Keys and Endpoint → Regenerate

Update `.env.local` + `server-providers.yml`, restart:
```bash
cd /home/learn.theemployeefactory.com/openmaic_src && sudo docker compose restart
```

## Step 13 — Decommission old VPS (after ~30 days)

```bash
# On OLD VPS
cd /home/learn.theemployeefactory.com/openmaic_src && sudo docker compose down
```
Keep data + bootstrap archive 30 days as fallback before deleting.
