import json, os, subprocess, sys, ssl, base64, time, urllib.request, urllib.error
CTX = ssl._create_unverified_context()

def find_from_process():
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" "
          "| Select-Object -ExpandProperty CommandLine")
    try:
        out = subprocess.run(["powershell","-NoProfile","-Command",ps],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception as e:
        return None, f"proc query failed: {e}"
    if not out.strip():
        return None, "LeagueClientUx.exe not running"
    port = tok = None
    for part in out.split():
        if part.startswith("--app-port="): port = part.split("=",1)[1].strip('"')
        if part.startswith("--remoting-auth-token="): tok = part.split("=",1)[1].strip('"')
    return (port, tok), "ok"

def find_from_lockfile():
    cands = []
    for env in ("ProgramFiles","ProgramFiles(x86)","ProgramW6432"):
        base = os.environ.get(env)
        if base:
            cands += [os.path.join(base, "Tencent", "英雄联盟", "LeagueClient", "lockfile"),
                      os.path.join(base, "WeGameApps", "英雄联盟", "LeagueClient", "lockfile"),
                      os.path.join(base, "Riot Games", "League of Legends", "lockfile")]
    cands += [r"C:\WeGameApps\英雄联盟\LeagueClient\lockfile",
              r"D:\WeGameApps\英雄联盟\LeagueClient\lockfile",
              r"D:\腾讯游戏\英雄联盟\LeagueClient\lockfile"]
    for p in cands:
        if os.path.isfile(p):
            return p
    return None

info, why = find_from_process()
if info and info[0]:
    port, tok = info
    src = "process-cmdline"
else:
    lf = find_from_lockfile()
    if not lf:
        print("NO_CLIENT:", why, "| lockfile not found either"); sys.exit(2)
    content = open(lf, encoding="utf-8", errors="ignore").read().strip()
    raw = content.split(":")
    if len(raw) < 5:
        print("CLIENT_NOT_RUNNING: lockfile is empty/stale ->", lf)
        print("启动英雄联盟客户端（登录到大厅）后重新运行本脚本。")
        sys.exit(3)
    port, tok = raw[2], raw[3]
    src = f"lockfile:{lf}"
print("source:", src, "port:", port)

def call(path, timeout=15):
    url = f"https://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Basic " + base64.b64encode(f"riot:{tok}".encode()).decode())
    req.add_header("Accept", "application/json")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            body = r.read()
            return r.status, body, round((time.time()-t0)*1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300], round((time.time()-t0)*1000)
    except Exception as e:
        return -1, str(e).encode(), round((time.time()-t0)*1000)

def jload(b):
    try: return json.loads(b)
    except Exception: return None

st, b, ms = call("/lol-summoner/v1/current-summoner")
me = jload(b) or {}
sid = me.get("summonerId")
print("summoner:", me.get("gameName"), me.get("tagLine"), "summonerId:", sid, f"[{st}]")

probes = []
def probe(path, label, summarize=None):
    st, b, ms = call(path)
    d = jload(b)
    summary = summarize(d) if (d is not None and summarize) else (f"json {type(d).__name__}" if d is not None else b[:120].decode("utf-8","ignore"))
    probes.append({"path": path, "label": label, "status": st, "ms": ms, "summary": summary})
    print(f"[{st:>4}] {label:<34} {path[:78]}  -> {summary}")

if sid:
    def sum_champs(d):
        owned = [c for c in d if (c.get("ownership") or {}).get("owned")]
        skins = sum(len([s for s in c.get("skins",[]) if not s.get("isBase")]) for c in owned)
        oskins = sum(len([s for s in c.get("skins",[]) if not s.get("isBase") and (s.get("ownership") or {}).get("owned")]) for c in owned)
        return f"champions {len(d)}, owned {len(owned)}, skins(non-base) {skins}, owned skins {oskins}"
    probe(f"/lol-champions/v1/inventories/{sid}/champions", "champion+skin inventory", sum_champs)
    probe(f"/lol-champions/v1/inventories/{sid}/skins-minimal", "skin inventory (minimal)",
          lambda d: f"items {len(d)}")

probe("/lol-inventory/v1/wallet", "wallet", lambda d: f"rp={d.get('rp')} ip={d.get('ip')}")
probe("/lol-store/v1/getStoreUrl", "store url", lambda d: str(d)[:100])
probe("/lol-store/v1/catalog/sales", "SALES (limited-time discount)",
      lambda d: f"sales={len(d)}" + (f", sample={{item:{d[0].get('item')}, sale:{d[0].get('sale')}}}" if d else ""))
def sum_catalog(d):
    items = d.get("catalog") if isinstance(d, dict) else d
    if not isinstance(items, list): return str(d)[:100]
    p = next((i for i in items if i.get("prices")), None)
    return f"items={len(items)}, sample_prices={p.get('prices') if p else None}, sample_sale={p.get('sale') if p else None}"
probe("/lol-store/v1/catalog/CHAMPION_SKIN", "catalog CHAMPION_SKIN", sum_catalog)
probe("/lol-catalog/v1/items/CHAMPION_SKIN", "lol-catalog items CHAMPION_SKIN", sum_catalog)
probe("/lol-purchase-widget/v1/purchasable-items/CHAMPION_SKIN", "purchase widget skin", lambda d: f"n={len(d) if isinstance(d,list) else d}")
probe("/lol-loot/v1/player-loot", "loot (skin shards)", lambda d: f"n={len(d)}")
probe("/lol-game-data/assets/v1/skins.json", "local skins.json (rarity/name)",
      lambda d: f"n={len(d)}, sample={list(d.values())[0].get('name') if isinstance(d,dict) else d}")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "probe-report.json")
json.dump({"source": src, "port": port, "summoner": {k: me.get(k) for k in ("gameName","tagLine","summonerId")},
           "probes": probes}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
print("report ->", out)
