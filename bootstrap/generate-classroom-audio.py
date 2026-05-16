#!/usr/bin/env python3
"""
Batch-generate server-side TTS audio for all speech actions in a classroom.
Writes mp3 to <volume>/classrooms/<id>/audio/<audioId>.mp3
Updates classroom JSON with audioUrl pointing at /api/classroom-media/<id>/audio/<file>
"""
import json, base64, sys, os, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

VOLUME = Path("/var/lib/docker/volumes/openmaic_src_openmaic-data/_data/classrooms")
API   = "http://127.0.0.1:3004/api/generate/tts"
VOICE = "en-US-JennyNeural"
PROVIDER = "azure-tts"
WORKERS = 5

def tts(text, audio_id):
    body = json.dumps({
        "text": text,
        "audioId": audio_id,
        "ttsProviderId": PROVIDER,
        "ttsVoice": VOICE,
    }).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        if not data.get("success"):
            return None
        return base64.b64decode(data["base64"]), (data.get("format") or "mp3")
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"  HTTP {e.code} for {audio_id}: {e.read()[:200]!r}\n")
        return None
    except Exception as e:
        sys.stderr.write(f"  EXC for {audio_id}: {e}\n")
        return None

def process_classroom(cid: str):
    jpath = VOLUME / f"{cid}.json"
    audio_dir = VOLUME / cid / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    data = json.loads(jpath.read_text())
    actions_needing = []
    for scene in data.get("scenes", []):
        for a in scene.get("actions", []):
            if a.get("type") != "speech": continue
            if not a.get("text"): continue
            aid = a.get("audioId")
            if not aid: continue
            target = audio_dir / f"{aid}.mp3"
            if target.exists() and target.stat().st_size > 0 and a.get("audioUrl"):
                continue  # already done
            actions_needing.append((a, target))

    if not actions_needing:
        print(f"[{cid}] all speech actions already have audio")
        return

    print(f"[{cid}] {len(actions_needing)} actions need audio, generating with {WORKERS} workers...")

    done = 0; failed = 0
    t0 = time.time()
    def one(action_target):
        action, target = action_target
        res = tts(action["text"], action["audioId"])
        if res is None:
            return (action, target, False)
        audio_bytes, fmt = res
        out = target.with_suffix(f".{fmt}")
        out.write_bytes(audio_bytes)
        action["audioUrl"] = f"/api/classroom-media/{cid}/audio/{out.name}"
        return (action, out, True)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for fut in as_completed([ex.submit(one, at) for at in actions_needing]):
            action, target, ok = fut.result()
            done += 1
            if not ok: failed += 1
            if done % 20 == 0 or done == len(actions_needing):
                print(f"  [{cid}] {done}/{len(actions_needing)} ({failed} failed, {time.time()-t0:.0f}s)")

    # Persist JSON updates
    jpath.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"[{cid}] wrote updated JSON ({jpath})")
    # chown so container (uid 1001) can read
    os.system(f"chown -R 1001:1001 {VOLUME / cid}")
    os.system(f"chown 1001:1001 {jpath}")
    print(f"[{cid}] done. failed={failed}")

if __name__ == "__main__":
    targets = sys.argv[1:] or ["_s_GTYVeww", "x3D2FYGHSK"]
    for cid in targets:
        process_classroom(cid)
