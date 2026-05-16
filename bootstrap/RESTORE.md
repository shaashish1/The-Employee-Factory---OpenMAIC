# TEF Bootstrap Archive — Restore Instructions

Contents:
- `volume/`       → Docker volume `_data` (classrooms JSON)
- `secrets/`      → `.env.local`, `server-providers.yml`, parent `.env` + `.envelope`
- `vhost/`        → OpenLiteSpeed vhost config
- `docs/`         → Project docs (CLAUDE.md, plans)
- `RESTORE.md`    → This file

## On new VPS, after `git clone` of the TEF repo:

```bash
# 1. Extract this archive somewhere safe
sudo mkdir -p /root/tef-restore
sudo tar -xzf /root/tef-bootstrap-*.tar.gz -C /root/tef-restore --strip-components=1

# 2. Drop secrets into source tree
sudo cp /root/tef-restore/secrets/openmaic_src.env.local /home/learn.theemployeefactory.com/openmaic_src/.env.local
sudo cp /root/tef-restore/secrets/server-providers.yml   /home/learn.theemployeefactory.com/openmaic_src/server-providers.yml
sudo cp /root/tef-restore/secrets/parent.env             /home/learn.theemployeefactory.com/.env
sudo cp /root/tef-restore/secrets/parent.envelope        /home/learn.theemployeefactory.com/.envelope
sudo chmod 600 /home/learn.theemployeefactory.com/openmaic_src/.env.local \
               /home/learn.theemployeefactory.com/openmaic_src/server-providers.yml \
               /home/learn.theemployeefactory.com/.env \
               /home/learn.theemployeefactory.com/.envelope

# 3. Build Docker image
cd /home/learn.theemployeefactory.com/openmaic_src
sudo DOCKER_BUILDKIT=0 docker build --network=host -t openmaic_src-openmaic:latest .

# 4. Create the named volume + restore data
sudo docker volume create openmaic_src_openmaic-data
VOLPATH=$(sudo docker volume inspect openmaic_src_openmaic-data -f '{{.Mountpoint}}')
sudo cp -a /root/tef-restore/volume/. "$VOLPATH/"
sudo chown -R 1001:1001 "$VOLPATH"

# 5. Start container
sudo docker compose up -d

# 6. Web server vhost
# (option a) Drop OLS vhost into /usr/local/lsws/conf/vhosts/learn.theemployeefactory.com/
#            sudo cp /root/tef-restore/vhost/learn.theemployeefactory.com.vhost.conf \
#                    /usr/local/lsws/conf/vhosts/learn.theemployeefactory.com/vhost.conf
#            sudo /usr/local/lsws/bin/lswsctrl restart
# (option b) Translate to nginx if new VPS uses nginx (see docs).

# 7. Health checks
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3004/                      # 200
curl -s http://127.0.0.1:3004/api/server-providers | head -c 200                     # 4 providers
curl -s http://127.0.0.1:3004/api/classroom                                           # 3 classrooms
```

## Reverse (decommission old VPS) — only after new VPS is verified

1. Stop old container: `cd /home/learn.theemployeefactory.com/openmaic_src && sudo docker compose down`
2. Keep old `_data` volume + this archive for ~30 days as fallback.

---

## Audio (TTS) — IMPORTANT

The bootstrap JSON files reference audio (one .mp3 per speech action). The actual mp3 files are NOT committed to git (they're 81 MB and regenerable). After completing the basic restore, run the audio-gen script to recreate them server-side:

```bash
# Once the container is running and TTS is configured in server-providers.yml:
sudo python3 /home/learn.theemployeefactory.com/openmaic_src/bootstrap/generate-classroom-audio.py
```

The script reads each classroom JSON, calls `/api/generate/tts` for every speech action,
writes mp3 to the volume at `classrooms/<id>/audio/<audioId>.mp3`, and updates `audioUrl`.
Takes ~2 minutes for the seed classrooms (390 actions), ~$0.10–0.30 of Azure TTS.

Alternatively: if you have a fresh nightly tar from the OLD VPS (`/home/rony/backups/openmaic/openmaic-*.tar.gz`),
extract it instead — that tar already includes audio mp3s (60 MB compressed).

## Backup completeness

The nightly cron at `/home/rony/scripts/backup-openmaic.sh` (cron `0 2 * * *`) tars the full
volume `_data/` directory — that means JSON classrooms AND `<id>/audio/*.mp3` AND
`<id>/media/*` (images/videos) are all captured. Restoring a nightly tar gives complete state.
