"""taskwise - project boards with notes, bookmarks, tags and easy due dates.

A local FastAPI server; the page runs in the browser. The whole board is one
JSON file (board.json) in a folder you choose on first run - pick a synced
folder to have it on several machines. The chosen folder is remembered in
~/.config/taskwise/config.json.
"""

import asyncio
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from contextlib import asynccontextmanager
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).parent / "static"
# the launcher's --port sets TASKWISE_PORT
PORT = int(os.environ.get("TASKWISE_PORT", "8243"))

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "taskwise"
CONFIG_PATH = CONFIG_DIR / "config.json"
# per-user UI settings (theme, text size) live next to config.json, not in the data folder
SETTINGS_PATH = CONFIG_DIR / "settings.json"
DEFAULT_DATA_DIR = "~/taskwise"  # only a suggestion on the first-run page
BOARD_FILE = "board.json"

DEFAULT_TAGS = [
    {"name": "urgent", "color": "#ef4444"},
    {"name": "important", "color": "#f97316"},
    {"name": "waiting", "color": "#eab308"},
    {"name": "idea", "color": "#8b5cf6"},
    {"name": "doing", "color": "#3b82f6"},
    {"name": "done", "color": "#10b981"},
]


def empty_board() -> dict:
    return {"version": 2, "groups": [], "boards": [], "notes": [], "tags": [dict(t) for t in DEFAULT_TAGS]}


def migrate(data: dict) -> dict:
    """Version 1 files had "projects" (columns) and notes with a projectId.
    Version 2 calls them boards, puts every board in a group and lets notes
    sit in a section of their board."""
    if "projects" in data and "boards" not in data:
        group = {"id": "general", "name": "General", "color": "#64748b"}
        data["groups"] = [group]
        data["boards"] = []
        for p in data.pop("projects"):
            p["groupId"] = group["id"]
            p.setdefault("sections", [])
            data["boards"].append(p)
        for n in data.get("notes", []):
            n["boardId"] = n.pop("projectId", None)
            n.setdefault("sectionId", None)
        data["version"] = 2
    data.setdefault("groups", [])
    data.setdefault("boards", [])
    data.setdefault("notes", [])
    data.setdefault("tags", [dict(t) for t in DEFAULT_TAGS])
    return data


# ---------- config ----------

def read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def write_json_atomic(path: Path, data):
    """Write to a temp file in the same folder and rename it over the old
    one, so a crash or a sync client reading mid-write never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        # mkstemp makes the file owner-only; give it the usual permissions instead
        umask = os.umask(0)
        os.umask(umask)
        os.chmod(tmp, 0o666 & ~umask)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def data_dir() -> Path | None:
    d = read_json(CONFIG_PATH, {}).get("data_dir")
    return Path(d) if d else None


def board_path() -> Path | None:
    d = data_dir()
    return d / BOARD_FILE if d else None


def file_rev(path: Path) -> str:
    """Changes whenever the file on disk does (including edits made by a sync
    client or another machine), so the page can tell its copy is stale."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return "none"
    return f"{st.st_mtime_ns}-{st.st_size}"


def load_board() -> dict:
    p = board_path()
    if p is None or not p.exists():
        return empty_board()
    board = read_json(p, None)
    if not isinstance(board, dict):
        raise ValueError(f"{p} is not a valid board file")
    return migrate(board)


# ---------- app ----------

@asynccontextmanager
async def lifespan(app):
    _schedule_stop(STARTUP_GRACE)  # stop if no tab ever connects (see /api/alive)
    threading.Thread(target=_update_watch, daemon=True).start()
    yield


class _FreshStatic(StaticFiles):
    """The app's own scripts and styles: the browser must check they're still
    current (a cheap 304 via the ETag) instead of guessing from their age -
    otherwise after an update it can pair the new index.html with an old
    app.js. Fonts never change, so they may be cached."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if not path.startswith("fonts/"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp


app = FastAPI(lifespan=lifespan)
app.mount("/static", _FreshStatic(directory=STATIC_DIR), name="static")

# Only answer requests made to taskwise itself. Checking Host stops DNS
# rebinding (another site pointing its own domain at 127.0.0.1 to read the
# API as if it were the app); checking Origin on changes stops other sites
# submitting forms to it from the browser.
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}


@app.middleware("http")
async def only_from_taskwise(request, call_next):
    if request.headers.get("host", "") not in ALLOWED_HOSTS:
        return Response("Forbidden host", status_code=403)
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin is not None and origin not in ALLOWED_ORIGINS:
        return Response("Forbidden origin", status_code=403)
    return await call_next(request)


@app.get("/")
def index():
    if data_dir() is None:
        return FileResponse(STATIC_DIR / "setup.html", headers={"Cache-Control": "no-cache"})
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/favicon.ico")
def favicon():
    return FileResponse(STATIC_DIR / "icon.svg", media_type="image/svg+xml")


@app.get("/api/config")
def api_get_config():
    d = data_dir()
    return {"data_dir": str(d) if d else None, "default": DEFAULT_DATA_DIR, "home": str(Path.home()),
            "board_file": str(d / BOARD_FILE) if d else None}


@app.post("/api/config")
async def api_set_config(request: Request):
    """Choose (or switch) the data folder. When switching to a folder without
    a board yet, copy=true copies the current board there; otherwise it
    starts empty. A folder that already has a board.json is simply used."""
    payload = await request.json()
    raw = (payload.get("data_dir") or "").strip()
    if not raw:
        return JSONResponse({"ok": False, "error": "Enter a folder."})
    target = Path(os.path.expanduser(raw)).resolve()
    if target.exists() and not target.is_dir():
        return JSONResponse({"ok": False, "error": f"{target} is a file, not a folder."})
    try:
        target.mkdir(parents=True, exist_ok=True)
        probe = target / ".taskwise-write-test"
        probe.write_text("x")
        probe.unlink()
    except OSError as e:
        return JSONResponse({"ok": False, "error": f"Can't write to {target}: {e.strerror}"})

    new_board = target / BOARD_FILE
    found = new_board.exists()
    if not found:
        old = board_path()
        if payload.get("copy") and old is not None and old.exists():
            shutil.copy2(old, new_board)
        else:
            write_json_atomic(new_board, empty_board())
    write_json_atomic(CONFIG_PATH, {"data_dir": str(target)})
    return {"ok": True, "data_dir": str(target), "found_existing": found}


@app.get("/api/board")
def api_get_board():
    p = board_path()
    if p is None:
        return JSONResponse({"error": "no data folder chosen"}, status_code=409)
    try:
        board = load_board()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return {"board": board, "rev": file_rev(p)}


@app.get("/api/rev")
def api_rev():
    p = board_path()
    return {"rev": file_rev(p) if p else "none"}


@app.put("/api/board")
async def api_put_board(request: Request):
    """Save the whole board. The page sends the rev it last loaded; if the
    file changed on disk since (another machine via a synced folder, another
    tab), refuse with 409 unless force=true, so nothing is silently lost."""
    p = board_path()
    if p is None:
        return JSONResponse({"error": "no data folder chosen"}, status_code=409)
    payload = await request.json()
    board = payload.get("board")
    if not isinstance(board, dict) or not all(isinstance(board.get(k), list) for k in ("groups", "boards", "notes")):
        return JSONResponse({"error": "invalid board"}, status_code=400)
    current = file_rev(p)
    if not payload.get("force") and payload.get("rev") != current:
        return JSONResponse({"error": "changed on disk", "rev": current}, status_code=409)
    # one rolling backup of the previous version, beside the board
    if p.exists():
        try:
            shutil.copy2(p, p.with_suffix(".json.bak"))
        except OSError:
            pass
    board["saved"] = int(time.time())
    write_json_atomic(p, board)
    return {"ok": True, "rev": file_rev(p)}


@app.get("/api/settings")
def api_get_settings():
    return read_json(SETTINGS_PATH, {})


@app.put("/api/settings")
async def api_put_settings(request: Request):
    data = await request.json()
    if not isinstance(data, dict):
        return JSONResponse({"error": "invalid settings"}, status_code=400)
    write_json_atomic(SETTINGS_PATH, data)
    return {"ok": True}


# ---------- update check ----------
# install.sh saves the date of the installed commit (only when run from a git
# clone). At start and then every hour this compares it with the newest commit
# on GitHub, and the page shows a notice. Updating stays in the user's hands:
# git pull and run install.sh again.

UPDATE_URL = "https://api.github.com/repos/davidnsousa/taskwise/commits/main"
INSTALLED_PATH = Path.home() / ".local" / "state" / "taskwise" / "installed"
UPDATE_INTERVAL = 3600
_update = {"available": False}


def _installed_date():
    """The date of the installed commit; None if not installed from a git clone."""
    try:
        return datetime.fromisoformat(INSTALLED_PATH.read_text().strip())
    except (OSError, ValueError):
        return None


def _latest_date():
    """The date of the newest commit on GitHub; None if GitHub can't be asked."""
    try:
        with urllib.request.urlopen(UPDATE_URL, timeout=15) as r:
            date = json.load(r)["commit"]["committer"]["date"]
        return datetime.fromisoformat(date.replace("Z", "+00:00"))
    except Exception:  # offline, rate limited, unexpected reply
        return None


def _update_watch():
    latest = None
    while True:
        latest = _latest_date() or latest
        # read every pass, so the notice goes away right after a reinstall
        installed = _installed_date()
        _update["available"] = bool(latest and installed and latest > installed)
        time.sleep(UPDATE_INTERVAL)


@app.get("/api/update")
def api_update():
    return _update


# ---------- favicons for bookmarks ----------
# The page asks /api/favicon?url=<bookmark>. Links into Google Workspace and
# Microsoft 365 need a sign-in, so fetching them would only find the sign-in
# page's icon: those get the product's own icon (Sheets, Docs, Excel…) by
# rule. Any other site is asked for its icon (<link rel=icon>, else
# /favicon.ico). Icons are cached on disk, per site, in ~/.cache/taskwise.

FAVICON_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "taskwise" / "favicons"
FAVICON_RETRY = 7 * 86400          # retry sites that had no icon after a week
FETCH_TIMEOUT = 6
MAX_PAGE = 512 * 1024
MAX_ICON = 300 * 1024
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) taskwise-favicon/1.0"

_G = "https://ssl.gstatic.com/images/branding/product/1x/"
_MS = "https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/"
# (host pattern, path pattern or None, icon url) - first match wins
FAVICON_RULES = [
    (r"docs\.google\.com", r"^/spreadsheets", _G + "sheets_2020q4_32dp.png"),
    (r"docs\.google\.com", r"^/document", _G + "docs_2020q4_32dp.png"),
    (r"docs\.google\.com", r"^/presentation", _G + "slides_2020q4_32dp.png"),
    (r"docs\.google\.com", r"^/forms", _G + "forms_2020q4_32dp.png"),
    (r"forms\.gle", None, _G + "forms_2020q4_32dp.png"),
    (r"drive\.google\.com", None, _G + "drive_2020q4_32dp.png"),
    (r"photos\.google\.com|photos\.app\.goo\.gl", None, _G + "photos_32dp.png"),
    (r"calendar\.google\.com", None, _G + "calendar_2020q4_32dp.png"),
    (r"mail\.google\.com", None, _G + "gmail_2020q4_32dp.png"),
    (r"meet\.google\.com", None, _G + "meet_2020q4_32dp.png"),
    (r"keep\.google\.com", None, _G + "keep_2020q4_32dp.png"),
    (r"sites\.google\.com", None, _G + "sites_2020q4_32dp.png"),
    # SharePoint / OneDrive sharing links carry the file type: /:x:/ Excel, /:w:/ Word, ...
    (r".*\.sharepoint\.com", r"^/:x:/|\.xlsx?(\?|$)", _MS + "item-types/32/xlsx.svg"),
    (r".*\.sharepoint\.com", r"^/:w:/|\.docx?(\?|$)", _MS + "item-types/32/docx.svg"),
    (r".*\.sharepoint\.com", r"^/:p:/|\.pptx?(\?|$)", _MS + "item-types/32/pptx.svg"),
    (r".*\.sharepoint\.com", r"^/:b:/|\.pdf(\?|$)", _MS + "item-types/32/pdf.svg"),
    (r".*\.sharepoint\.com", r"^/:f:/", _MS + "item-types/32/folder.svg"),
    (r".*\.sharepoint\.com", None, _MS + "brand-icons/product/svg/sharepoint_32x1.svg"),
    (r"onedrive\.live\.com|1drv\.ms", None, _MS + "brand-icons/product/svg/onedrive_32x1.svg"),
    (r"teams\.microsoft\.com|teams\.live\.com", None, _MS + "brand-icons/product/svg/teams_32x1.svg"),
    (r"outlook\.(office|office365|live)\.com", None, _MS + "brand-icons/product/svg/outlook_32x1.svg"),
]

_fav_locks: dict = {}
_fav_locks_guard = threading.Lock()


def _key_lock(key: str) -> threading.Lock:
    with _fav_locks_guard:
        return _fav_locks.setdefault(key, threading.Lock())


def _http_get(url: str, limit: int):
    """GET over http(s) only; returns (final url, content type, bytes) or None."""
    if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        return None
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
            if urllib.parse.urlsplit(r.geturl()).scheme not in ("http", "https"):
                return None
            return r.geturl(), r.headers.get_content_type(), r.read(limit + 1)
    except Exception:
        return None


def _image_type(data: bytes, declared: str):
    """The image's media type, judged by its first bytes - never trust the
    server's word alone (an error page is not an icon)."""
    if len(data) < 4 or len(data) > MAX_ICON:
        return None
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"\x00\x00\x01\x00":
        return "image/x-icon"
    if data.startswith(b"GIF8"):
        return "image/gif"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:512].lstrip().lower()
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in data[:2048].lower()):
        return "image/svg+xml"
    return None


class _IconLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = {k.lower(): (v or "") for k, v in attrs}
        rel = a.get("rel", "").lower().split()
        if a.get("href") and ("icon" in rel or "apple-touch-icon" in rel):
            size = 0
            m = re.match(r"(\d+)x\d+", a.get("sizes", ""))
            if m:
                size = int(m.group(1))
            self.icons.append((a["href"], size, "apple-touch-icon" in rel, a.get("type", "")))


def _site_icon_candidates(page_url: str):
    """Icon URLs to try for a site, best first."""
    out = []
    got = _http_get(page_url, MAX_PAGE)
    if got and got[1] in ("text/html", "application/xhtml+xml"):
        final, _, body = got
        p = _IconLinks()
        try:
            p.feed(body[:MAX_PAGE].decode("utf-8", "replace"))
        except Exception:
            pass
        # prefer a crisp size near 32px; apple touch icons (180px) are a fine fallback
        def score(i):
            href, size, apple, typ = i
            if "svg" in typ or href.lower().split("?")[0].endswith(".svg"):
                return 0
            if size:
                return abs(size - 32) + (20 if apple else 0)
            return 15 + (40 if apple else 0)
        for href, *_ in sorted(p.icons, key=score):
            out.append(urllib.parse.urljoin(final, href))
        base = final
    else:
        base = page_url
    parts = urllib.parse.urlsplit(base)
    out.append(f"{parts.scheme}://{parts.netloc}/favicon.ico")
    return out


def _favicon_source(url: str):
    """(cache key, list of icon urls to try) for a bookmark url."""
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    for host_re, path_re, icon in FAVICON_RULES:
        if re.fullmatch(host_re, host) and (path_re is None or re.search(path_re, parts.path + ("?" + parts.query if parts.query else ""))):
            return icon, [icon]
    origin = f"{parts.scheme}://{parts.netloc}"
    return origin, None   # candidates are worked out (by fetching the page) only on a cache miss


def get_favicon(url: str):
    """(bytes, media type) or None."""
    if urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        return None
    key, candidates = _favicon_source(url)
    h = hashlib.sha256(key.encode()).hexdigest()[:32]
    data_f, type_f, none_f = FAVICON_DIR / f"{h}.img", FAVICON_DIR / f"{h}.type", FAVICON_DIR / f"{h}.none"
    with _key_lock(h):
        if data_f.exists() and type_f.exists():
            return data_f.read_bytes(), type_f.read_text().strip()
        if none_f.exists() and time.time() - none_f.stat().st_mtime < FAVICON_RETRY:
            return None
        if candidates is None:
            # ask the bookmarked page itself; its site's icon serves every page of it
            candidates = _site_icon_candidates(url)
        for c in candidates:
            got = _http_get(c, MAX_ICON)
            if not got:
                continue
            typ = _image_type(got[2], got[1])
            if typ:
                FAVICON_DIR.mkdir(parents=True, exist_ok=True)
                data_f.write_bytes(got[2])
                type_f.write_text(typ)
                none_f.unlink(missing_ok=True)
                return got[2], typ
        FAVICON_DIR.mkdir(parents=True, exist_ok=True)
        none_f.write_text(key)
        return None


@app.get("/api/favicon")
def api_favicon(url: str):
    # a plain def: FastAPI runs it in a worker thread, so slow sites don't hold up the app
    got = get_favicon(url)
    if not got:
        return Response(status_code=404, headers={"Cache-Control": "max-age=3600"})
    data, typ = got
    return Response(data, media_type=typ, headers={
        "Cache-Control": "max-age=86400",
        "X-Content-Type-Options": "nosniff",
        # an SVG opened on its own must not run anything
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    })


# ---------- local files and folders as bookmarks ----------
# A browser page can't open file:// links, nor learn the full path of a file
# picked with <input type=file>. So the server, which runs on your desktop as
# you, shows the native file dialog (zenity, or kdialog on KDE) and opens
# bookmarked files with your default app (xdg-open).
#
# Both are POST-only and need the request's Origin to be taskwise itself, so no
# other website can trigger them. /api/open also only opens paths that are
# saved as bookmarks, and never programs or scripts.

RISKY_SUFFIXES = {
    ".sh", ".bash", ".zsh", ".fish", ".desktop", ".appimage", ".run", ".bin", ".exe", ".msi", ".bat", ".cmd",
    ".com", ".command", ".jar", ".py", ".pl", ".rb", ".deb", ".rpm", ".pkg", ".apk", ".scr", ".ps1", ".vbs",
}
_last_pick_dir = str(Path.home())


def _from_app(request: Request) -> bool:
    return request.headers.get("origin") in ALLOWED_ORIGINS


def _dialog_command(kind: str, multiple: bool):
    title = "Taskwise — choose a folder" if kind == "folder" else "Taskwise — choose files" if multiple else "Taskwise — choose a file"
    start = _last_pick_dir.rstrip("/") + "/"
    if shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", f"--title={title}", f"--filename={start}"]
        if kind == "folder":
            cmd.append("--directory")
        if multiple:
            cmd += ["--multiple", "--separator=\n"]
        return cmd
    if shutil.which("kdialog"):
        if kind == "folder":
            return ["kdialog", "--title", title, "--getexistingdirectory", start]
        cmd = ["kdialog", "--title", title, "--getopenfilename", start]
        if multiple:
            cmd += ["--multiple", "--separate-output"]
        return cmd
    return None


@app.post("/api/pick")
def api_pick(request: Request, kind: str = "file", multiple: bool = False):
    """Show the desktop's file dialog; returns {"paths": [...]} (empty if cancelled)."""
    global _last_pick_dir
    if not _from_app(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    cmd = _dialog_command("folder" if kind == "folder" else "file", multiple and kind != "folder")
    if cmd is None:
        return JSONResponse({"error": "No file dialog found - install zenity (sudo pacman -S zenity) or kdialog."}, status_code=501)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    except OSError as e:
        return JSONResponse({"error": f"Couldn't show the file dialog: {e}"}, status_code=500)
    paths = [p for p in r.stdout.split("\n") if p.strip()] if r.returncode == 0 else []
    paths = [str(Path(p).resolve()) for p in paths if os.path.isabs(p)]
    if paths:
        first = Path(paths[0])
        _last_pick_dir = str(first if kind == "folder" else first.parent)
    return {"paths": paths, "folder": kind == "folder"}


def _path_of(url: str):
    """The local path a file:// bookmark points at, or None."""
    parts = urllib.parse.urlsplit(url or "")
    if parts.scheme != "file" or parts.netloc not in ("", "localhost"):
        return None
    path = urllib.parse.unquote(parts.path)
    if not os.path.isabs(path):
        return None
    return path.rstrip("/") or "/"


def _is_risky(p: Path) -> bool:
    if p.is_dir():
        return False
    if p.suffix.lower() in RISKY_SUFFIXES:
        return True
    if os.access(p, os.X_OK):
        try:
            with open(p, "rb") as f:
                head = f.read(4)
        except OSError:
            return True
        return head.startswith(b"#!") or head == b"\x7fELF"
    return False


@app.post("/api/open")
async def api_open(request: Request):
    """Open a bookmarked local file or folder with the default app."""
    if not _from_app(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    payload = await request.json()
    path = _path_of(payload.get("url", ""))
    if path is None:
        return JSONResponse({"error": "Not a local file link."}, status_code=400)
    try:
        board = load_board()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    saved = {_path_of(b.get("url", "")) for bd in board.get("boards", []) for b in bd.get("bookmarks", [])}
    if path not in saved:
        return JSONResponse({"error": "Only files saved as bookmarks can be opened."}, status_code=403)
    p = Path(path)
    if not p.exists():
        return JSONResponse({"error": f"Not found (moved or deleted?): {path}"}, status_code=404)
    if _is_risky(p):
        return JSONResponse({"error": f"Taskwise doesn't open programs or scripts: {p.name}"}, status_code=403)
    opener = shutil.which("xdg-open") or shutil.which("gio")
    if not opener:
        return JSONResponse({"error": "xdg-open not found (install xdg-utils)."}, status_code=501)
    cmd = [opener, str(p)] if opener.endswith("xdg-open") else [opener, "open", str(p)]
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"ok": True}


# ---------- stop when the last tab closes (only when started from the app menu) ----------
# Every open taskwise page holds a /api/alive connection. When taskwise --open
# starts the server it sets TASKWISE_AUTO_STOP=1, and the server then shuts
# itself down once no page has been connected for STOP_GRACE seconds (long
# enough to survive a reload), or if no page connects at all after startup.

# systemd socket activation: systemd listens on the port while taskwise isn't
# running and starts it on the first connection, handing over the listening
# socket as fd 3 (LISTEN_FDS/LISTEN_PID, see sd_listen_fds(3)). Started that
# way it always stops itself when idle - the next visit starts it again.
SD_LISTEN_FD = 3
SOCKET_ACTIVATED = (os.environ.get("LISTEN_PID") == str(os.getpid())
                    and int(os.environ.get("LISTEN_FDS", "0") or 0) >= 1)

AUTO_STOP = os.environ.get("TASKWISE_AUTO_STOP") == "1" or SOCKET_ACTIVATED
STOP_GRACE = 10
STARTUP_GRACE = 60
_open_pages = 0
_stop_task = None

# Changes whenever the app's code does. Sent down /api/alive, so a page left
# open across an update reloads itself instead of running the old code
# against the new server.
APP_VERSION = hashlib.sha256(b"".join(
    p.read_bytes() for p in sorted([Path(__file__), *STATIC_DIR.rglob("*")]) if p.is_file()
)).hexdigest()[:16]


def _schedule_stop(delay: float):
    global _stop_task
    if not AUTO_STOP:
        return
    if _stop_task is not None:
        _stop_task.cancel()

    async def stop_later():
        await asyncio.sleep(delay)
        if _open_pages == 0:
            print("No taskwise tab open - stopping.", flush=True)
            os.kill(os.getpid(), signal.SIGINT)  # uvicorn's normal, graceful shutdown

    _stop_task = asyncio.get_running_loop().create_task(stop_later())


@app.get("/api/alive")
async def api_alive():
    async def stream():
        global _open_pages
        _open_pages += 1
        if _stop_task is not None:
            _stop_task.cancel()
        try:
            yield f"retry: 2000\nevent: version\ndata: {APP_VERSION}\n\n"
            while True:
                await asyncio.sleep(15)
                yield ": keepalive\n\n"
        finally:
            _open_pages -= 1
            if _open_pages == 0:
                _schedule_stop(STOP_GRACE)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    if AUTO_STOP:
        print("Stops automatically once no taskwise tab is open.", flush=True)
    # Open pages hold a never-ending /api/alive stream, so don't wait for
    # connections to finish on shutdown (Ctrl-C) - just close them.
    if SOCKET_ACTIVATED:
        # serve on the socket systemd is already listening on; the waiting
        # first request (the one that started us) is answered from it
        sock = socket.socket(fileno=SD_LISTEN_FD)
        for k in ("LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"):
            os.environ.pop(k, None)  # not meant for child processes
        print(f"Started on demand by systemd at http://127.0.0.1:{PORT}", flush=True)
        try:
            uvicorn.Server(uvicorn.Config(app, timeout_graceful_shutdown=3)).run(sockets=[sock])
        except KeyboardInterrupt:  # the auto-stop's SIGINT, re-raised after a clean shutdown
            pass
    else:
        uvicorn.run(app, host="127.0.0.1", port=PORT, timeout_graceful_shutdown=3)
