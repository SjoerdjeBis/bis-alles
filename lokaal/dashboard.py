#!/usr/bin/env python3
"""Bis Alles lokaal: dashboard voor alles in ~/Desktop/claude.

Start met `Bis Alles.command` (of `python3 dashboard.py`) en open http://localhost:8787.
Alleen standaard-Python, geen installatie nodig.

Per map zoekt hij zelf wat er te starten en te openen is: .command-bestanden,
npm-scripts, Python-scripts, HTML-bestanden en de git-status. Naam, beschrijving,
categorie en live URL komen uit ../projects.json en projecten-lokaal.json (gekoppeld via
`folder` of via de GitHub-repo van de map). De online status haalt de pagina zelf op van GitHub Pages.
"""
import argparse
import json
import os
import secrets
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PORT = 8787
TOKEN = secrets.token_urlsafe(24)

# Mappen waar nooit iets te starten of te openen staat.
SKIP_DIRS = {"node_modules", "build", "dist", ".next", ".git", "gradle", "app", "assets", "archief",
             "Oud", "lib", "src", "kit", "beeld", "icons", "fonts", "logo", "logos", "__pycache__", ".venv", "venv"}
NPM_FIRST = ["dev", "start", "preview", "build"]
MAX_HTML = 12

STATIC = {
    "/lokaal.js": (HERE / "lokaal.js", "text/javascript"),
    "/lokaal.css": (HERE / "lokaal.css", "text/css"),
    "/style.css": (HERE / "style.css", "text/css"),
    "/logo.svg": (HERE / "logo.svg", "image/svg+xml"),
}


def load_config():
    """projects.json (online, op GitHub) aangevuld met projecten-lokaal.json (alleen op deze Mac)."""
    config = json.loads((REPO / "projects.json").read_text("utf-8"))
    local = HERE / "projecten-lokaal.json"
    extra = json.loads(local.read_text("utf-8")) if local.exists() else {}
    by_id = {p["id"]: p for p in config["projects"]}
    for p in extra.get("projects", []):
        if p["id"] in by_id:
            by_id[p["id"]].update(p)  # bijv. alleen een `folder` bij een online project
        else:
            config["projects"].append(p)
    config["negeren"] = extra.get("negeren", [])
    return config


def git_info(path):
    def git(*args):
        r = subprocess.run(["git", "-C", str(path), *args], capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else None

    remote = git("remote", "get-url", "origin") or ""
    repo = remote.rstrip("/").removesuffix(".git").rsplit("/", 1)[-1] if "github.com" in remote else None
    status = git("status", "--porcelain")
    ahead = git("rev-list", "--count", "@{u}..HEAD")
    return {
        "repo": repo,
        "branch": git("branch", "--show-current"),
        "changes": len(status.splitlines()) if status else 0,
        "ahead": int(ahead) if ahead and ahead.isdigit() else 0,
        "lastCommit": git("log", "-1", "--format=%cI"),
    }


def scan(folder):
    """Alles wat in een projectmap te starten of te openen is (map zelf + één niveau dieper)."""
    places = [folder] + sorted(d for d in folder.iterdir()
                               if d.is_dir() and not d.name.startswith(".") and d.name not in SKIP_DIRS)
    actions, html, gits = [], [], []

    def rel(p):
        return str(p.relative_to(folder))

    for i, place in enumerate(places):
        try:
            files = sorted(f for f in place.iterdir() if f.is_file())
        except OSError:
            continue
        if (place / ".git").exists():
            gits.append((place, git_info(place)))
        for f in files:
            if f.suffix == ".command":
                actions.append({"kind": "command", "target": rel(f), "label": f.stem})
            elif f.suffix == ".py" and i == 0:
                actions.append({"kind": "python", "target": rel(f), "label": f"python3 {f.name}"})
            elif f.suffix == ".html":
                html.append({"kind": "html", "target": rel(f), "label": rel(f)})
        pkg = place / "package.json"
        if pkg.exists():
            try:
                scripts = list((json.loads(pkg.read_text("utf-8")).get("scripts") or {}))
            except (OSError, ValueError):
                scripts = []
            scripts.sort(key=lambda s: NPM_FIRST.index(s) if s in NPM_FIRST else len(NPM_FIRST))
            where = "" if place == folder else f"{place.name}: "
            for s in scripts:
                actions.append({"kind": "npm", "target": f"{rel(place)}::{s}", "label": f"{where}npm run {s}"})

    # index.html eerst, dan de map zelf voor submappen.
    html.sort(key=lambda h: (Path(h["target"]).name != "index.html", "/" in h["target"], h["target"].lower()))
    return actions, html[:MAX_HTML], gits


def primary(p, folder, actions, html):
    """De ene actie om mee aan de slag te gaan: `start` uit de config, anders een gok."""
    start = p.get("start")
    if start and start.startswith("https://"):
        return {"kind": "live", "target": start, "label": "Openen"}
    if start == "live" or (not start and p.get("live")) or folder is None:
        return {"kind": "live", "target": p.get("live"), "label": "Online openen"} if p.get("live") else None
    if start and start.startswith("npm:"):
        return next((dict(a, label="Starten") for a in actions
                     if a["kind"] == "npm" and a["target"].endswith("::" + start[4:])), None)
    if start:
        file = (folder / start).resolve()
        if not (file.is_file() and file.is_relative_to(folder.resolve())):
            return None
        kind = {".command": "command", ".py": "python", ".html": "html"}.get(file.suffix, "file")
        label = {"command": file.stem, "python": "Starten"}.get(kind, "Openen")
        return {"kind": kind, "target": start, "label": label}
    commands = [a for a in actions if a["kind"] == "command"]
    if len(commands) == 1:
        return commands[0]
    top = [h for h in html if "/" not in h["target"]]
    index = [h for h in top if h["target"] == "index.html"]
    if index or len(top) == 1:
        return dict((index or top)[0], label="Openen")
    npm = [a for a in actions if a["kind"] == "npm"]
    if npm and npm[0]["target"].split("::")[1] in ("dev", "start"):
        return dict(npm[0], label="Starten")
    return None


def projects(root):
    config = load_config()
    skip = set(config["negeren"])
    entries = config["projects"]
    by_folder = {p["folder"]: p for p in entries if p.get("folder")}
    by_repo = {p["repo"]: p for p in entries if p.get("repo")}
    out, used = [], set()

    folders = sorted((d for d in root.iterdir() if d.is_dir() and not d.name.startswith(".") and d.name not in skip),
                     key=lambda d: d.name.lower()) if root.is_dir() else []
    for folder in folders:
        actions, html, gits = scan(folder)
        meta = by_folder.get(folder.name)
        for _, g in gits:
            if not meta and g["repo"] in by_repo:
                meta = by_repo[g["repo"]]
        if meta and meta["id"] in used:
            meta = None  # tweede map voor hetzelfde project: los tonen
        p = dict(meta or {"id": f"map:{folder.name}", "name": folder.name, "category": "Overig"})
        if meta:
            used.add(meta["id"])
        p.update(folder=folder.name, actions=actions, html=html, primary=primary(p, folder, actions, html),
                 git=[{"path": str(path.relative_to(folder)), **g} for path, g in gits])
        out.append(p)

    # Projecten die alleen online staan (geen map op het bureaublad).
    for p in entries:
        if p["id"] not in used and (p.get("repo") or p.get("live")) and not p.get("archived"):
            out.append({**p, "folder": None, "actions": [], "html": [], "git": [], "primary": primary(p, None, [], [])})

    order = {p["id"]: i for i, p in enumerate(entries)}
    out.sort(key=lambda p: (order.get(p["id"], len(order)), p["name"].lower()))
    return out


def opener(*args):
    cmd = ["open", *args] if sys.platform == "darwin" else ["xdg-open", *args[-1:]]
    if os.environ.get("BIS_DRY_RUN"):
        print("[dry-run]", shlex.join(cmd), flush=True)
        return
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def in_terminal(cwd, command):
    """Draai een opdracht in een nieuw Terminal-venster, zodat je de uitvoer ziet."""
    fd, path = tempfile.mkstemp(prefix="bis-", suffix=".command")
    with os.fdopen(fd, "w") as f:
        f.write(f"#!/bin/bash\ncd {shlex.quote(str(cwd))} || exit 1\necho \"$ {command}\"\n{command}\n")
    os.chmod(path, 0o755)
    opener(path)


def run(root, folder_name, kind, target):
    folder = (root / folder_name).resolve()
    if folder.parent != root.resolve() or not folder.is_dir():
        raise ValueError("onbekende map")
    if kind == "finder":
        return opener(str(folder))
    if kind == "terminal":
        return opener("-a", "Terminal", str(folder))
    p = next((p for p in projects(root) if p["folder"] == folder.name), None)
    if not p:
        raise ValueError("onbekende map")
    allowed = {(a["kind"], a["target"]) for a in p["actions"] + p["html"] + [p["primary"] or {}] if a}
    if (kind, target) not in allowed or kind == "live":
        raise ValueError("onbekende actie")
    if kind in ("command", "html", "file"):
        return opener(str(folder / target))
    if kind == "python":
        return in_terminal(folder, f"python3 {shlex.quote(target)}")
    if kind == "npm":
        place, script = target.split("::", 1)
        cwd = folder / place
        install = "" if (cwd / "node_modules").exists() else "npm install && "
        return in_terminal(cwd, f"{install}npm run {shlex.quote(script)}")
    raise ValueError("onbekende actie")


class Handler(BaseHTTPRequestHandler):
    root: Path

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def local_host(self):
        # Tegen DNS-rebinding: alleen verzoeken aan localhost zelf.
        return self.headers.get("Host", "") in (f"localhost:{PORT}", f"127.0.0.1:{PORT}")

    def do_GET(self):
        if not self.local_host():
            return self.send(403, {"error": "alleen via localhost"})
        path = self.path.split("?")[0]
        if path == "/":
            html = (HERE / "index.html").read_text("utf-8").replace("__TOKEN__", TOKEN)
            return self.send(200, html.encode(), "text/html")
        if path == "/api/projects":
            return self.send(200, {"root": str(self.root), "projects": projects(self.root)})
        if path in STATIC:
            file, ctype = STATIC[path]
            return self.send(200, file.read_bytes(), ctype)
        if path.startswith("/logos/"):
            file = (HERE / path.lstrip("/")).resolve()
            if file.is_file() and file.is_relative_to(HERE / "logos"):
                return self.send(200, file.read_bytes(), "image/svg+xml" if file.suffix == ".svg" else "image/png")
        self.send(404, {"error": "niet gevonden"})

    def do_POST(self):
        # Het token staat alleen in de pagina die deze server zelf uitlevert; andere sites
        # kunnen het niet lezen en geen eigen headers meesturen.
        if not self.local_host() or self.headers.get("X-Token") != TOKEN or self.path != "/api/run":
            return self.send(403, {"error": "niet toegestaan"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            run(self.root, body["folder"], body["kind"], body.get("target"))
            self.send(200, {"ok": True})
        except (KeyError, ValueError) as e:
            self.send(400, {"error": str(e)})


def main():
    global PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.environ.get("BIS_ROOT", "~/Desktop/claude"))
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    PORT = args.port
    url = f"http://localhost:{PORT}/"

    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            print(f"Draait al: {url}")
            if not args.no_browser:
                webbrowser.open(url)
            return

    Handler.root = Path(args.root).expanduser()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Bis Alles draait op {url}  (map: {Handler.root})\nSluit dit venster of druk Ctrl+C om te stoppen.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
