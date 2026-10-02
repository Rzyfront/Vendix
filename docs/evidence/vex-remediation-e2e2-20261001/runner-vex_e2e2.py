#!/usr/bin/env python3
"""Vex remediation E2E-1/2/3 live runner — saves inspectable evidence.
Usage:
  python3 vex_e2e2.py login            # refresh tokens
  python3 vex_e2e2.py sse <conv_id> <stream_id> <outfile>   # capture SSE stream
Env: API=http://localhost:3000/api (no TLS, same backend as vhost)
"""
import json, os, sys, urllib.request, urllib.error

API = os.environ.get("API", "http://localhost:3000/api")
W = "/tmp/vex-e2e2"

def _req(method, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"raw_error": str(e)}

def login(email, password, org_slug):
    s, d = _req("POST", "/auth/login", body={"email": email, "password": password, "organization_slug": org_slug})
    assert s == 200 and d.get("success"), f"login failed: {d}"
    return d["data"]["access_token"]

def cmd_login():
    owner = login("owner@roku.vendix.com", os.environ["VEX_E2E_PASSWORD"], "roku")
    admin = login("admin@roku-demo.vendix.local", os.environ["VEX_E2E_PASSWORD"], "roku")
    open(f"{W}/owner.tok", "w").write(owner)
    open(f"{W}/admin.tok", "w").write(admin)
    print(f"owner={len(owner)} admin={len(admin)}")

def cmd_sse(conv_id, stream_id, outfile, token_path=f"{W}/owner.tok"):
    tok = open(token_path).read().strip()
    url = f"{API}/store/ai-chat/conversations/{conv_id}/stream?stream_id={stream_id}"
    r = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "Accept": "text/event-stream"})
    n_frames, n_bytes = 0, 0
    with urllib.request.urlopen(r, timeout=600) as resp, open(outfile, "w") as f:
        print(f"SSE status={resp.status} content-type={resp.headers.get('Content-Type')}")
        for line in resp:
            txt = line.decode("utf-8", "replace")
            f.write(txt)
            n_bytes += len(txt)
            if txt.startswith("data:"):
                n_frames += 1
                if '"type": "done"' in txt or '"type":"done"' in txt or '"type": "error"' in txt:
                    print(f"terminal frame after {n_frames} frames, {n_bytes} bytes")
                    break
    print(f"saved {outfile}: {n_frames} data frames, {n_bytes} bytes")

if __name__ == "__main__":
    if sys.argv[1] == "login":
        cmd_login()
    elif sys.argv[1] == "sse":
        cmd_sse(sys.argv[2], sys.argv[3], sys.argv[4], *(sys.argv[5:] or []))
