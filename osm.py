from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from prompt_toolkit.application import Application
from prompt_toolkit.application.current import get_app_or_none
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout, Window
from prompt_toolkit.layout.controls import FormattedTextControl


SUBAGENT_TITLE_RE = re.compile(r"\s*\([^)]*subagent[^)]*\)\s*$", re.IGNORECASE)


@dataclass
class Session:
    sid: str
    title: str
    directory: str
    created_at: int | None
    updated_at: int | None
    workspace_id: str | None = None
    is_pinned: bool = False
    note: str | None = None
    labels: list[str] = field(default_factory=list)

    @property
    def display_title(self) -> str:
        cleaned = SUBAGENT_TITLE_RE.sub("", self.title.strip())
        return cleaned or "(untitled)"

@dataclass
class WorkspaceMeta:
    workspace_id: str | None
    directory: str
    is_pinned: bool = False
    note: str | None = None
    labels: list[str] = field(default_factory=list)


def get_env_path(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def resolve_home() -> Path:
    home = get_env_path("OPENCODE_TEST_HOME", "KILO_TEST_HOME", "HOME", "USERPROFILE")
    if home:
        return Path(home).expanduser()
    return Path.home()


def resolve_data_home() -> Path:
    data_home = get_env_path("XDG_DATA_HOME")
    if data_home:
        return Path(data_home).expanduser()
    home = resolve_home()
    return home / ".local" / "share"


def resolve_db_path(app: str) -> Path:
    app = app.lower().strip()
    data_home = resolve_data_home()
    if app == "kilo":
        return data_home / "kilo" / "kilo.db"
    return data_home / "opencode" / "opencode.db"


def resolve_meta_db_path(app: str) -> Path:
    app = app.lower().strip()
    data_home = resolve_data_home()
    if app == "kilo":
        return data_home / "kilo" / "osm_meta.db"
    return data_home / "opencode" / "osm_meta.db"


def init_meta_db(meta_db_path: Path) -> None:
    meta_db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(meta_db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS session_workspaces (
                session_id TEXT PRIMARY KEY,
                workspace_id TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspaces (
                workspace_id TEXT PRIMARY KEY,
                last_known_directory TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pins (
                session_id TEXT PRIMARY KEY,
                pinned_at INTEGER
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                session_id TEXT PRIMARY KEY,
                note TEXT,
                updated_at INTEGER
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS labels (
                session_id TEXT,
                label TEXT,
                PRIMARY KEY (session_id, label)
            )
        """)
        # Schema migration: Add 'type' column
        try:
            conn.execute("ALTER TABLE pins ADD COLUMN type TEXT DEFAULT 'session'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE notes ADD COLUMN type TEXT DEFAULT 'session'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE labels ADD COLUMN type TEXT DEFAULT 'session'")
        except sqlite3.OperationalError:
            pass

        # Data migration: Convert type='folder' to type='workspace'
        try:
            # find all 'folder' types, check if they exist as a directory, and convert them
            cursor = conn.execute("""
                SELECT DISTINCT session_id FROM (
                    SELECT session_id FROM pins WHERE type='folder'
                    UNION SELECT session_id FROM notes WHERE type='folder'
                    UNION SELECT session_id FROM labels WHERE type='folder'
                )
            """)
            folder_dirs = [row[0] for row in cursor.fetchall()]

            for d in folder_dirs:
                if d and Path(d).exists():
                    wid = resolve_workspace_id(d)
                    if wid:
                        conn.execute("UPDATE pins SET session_id = ?, type = 'workspace' WHERE session_id = ? AND type = 'folder'", (wid, d))
                        conn.execute("UPDATE notes SET session_id = ?, type = 'workspace' WHERE session_id = ? AND type = 'folder'", (wid, d))
                        conn.execute("UPDATE labels SET session_id = ?, type = 'workspace' WHERE session_id = ? AND type = 'folder'", (wid, d))
                        conn.execute("INSERT OR REPLACE INTO workspaces (workspace_id, last_known_directory) VALUES (?, ?)", (wid, d))
        except sqlite3.Error:
            pass


def resolve_workspace_id(directory: str) -> str | None:
    if not directory:
        return None
    p = Path(directory).expanduser().resolve()

    # Check if path still exists
    if not p.exists():
        return None

    current = p
    # Search upwards for .osm_workspace_id
    while current.parent != current: # Stop at root
        id_file = current / ".osm_workspace_id"
        if id_file.exists() and id_file.is_file():
            try:
                with open(id_file, "r") as f:
                    wid = f.read().strip()
                    if wid:
                        return wid
            except Exception:
                pass

        # Check for project roots if we want to stop early, e.g. .git or .claude
        if (current / ".git").exists() or (current / ".claude").exists():
            break

        current = current.parent

    # Not found, generate one in the original directory requested
    id_file = p / ".osm_workspace_id"
    new_id = uuid.uuid4().hex
    try:
        id_file.parent.mkdir(parents=True, exist_ok=True)
        with open(id_file, "w") as f:
            f.write(new_id)
        # Also try to hide it on Windows
        if os.name == 'nt':
            try:
                import ctypes
                FILE_ATTRIBUTE_HIDDEN = 0x02
                ret = ctypes.windll.kernel32.SetFileAttributesW(str(id_file), FILE_ATTRIBUTE_HIDDEN)
            except Exception:
                pass
        return new_id
    except Exception:
        return None


def detect_backend(preferred: str | None = None) -> tuple[str, Path, Path]:
    preferred = (preferred or os.environ.get("OSM_APP") or "").lower().strip()
    if preferred in {"opencode", "kilo"}:
        return preferred, resolve_db_path(preferred), resolve_meta_db_path(preferred)

    candidates = [(name, resolve_db_path(name), resolve_meta_db_path(name)) for name in ("opencode", "kilo")]
    existing = [(name, db, meta) for name, db, meta in candidates if db.exists()]
    if len(existing) == 1:
        return existing[0]
    if len(existing) > 1:
        if "kilo" in preferred:
            return "kilo", resolve_db_path("kilo"), resolve_meta_db_path("kilo")
        if "opencode" in preferred or preferred in {"oc", "open"}:
            return "opencode", resolve_db_path("opencode"), resolve_meta_db_path("opencode")
        return existing[0]
    return "opencode", resolve_db_path("opencode"), resolve_meta_db_path("opencode")


def human_time(value: int | None) -> str:
    if not value:
        return "n/a"
    if value > 10_000_000_000:
        value = value / 1000
    dt = datetime.fromtimestamp(value, tz=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return f"{seconds}s ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def format_dt(value: int | None) -> str:
    if not value:
        return "n/a"
    if value > 10_000_000_000:
        value = value / 1000
    return datetime.fromtimestamp(value, tz=timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M")


def load_folder_meta(app: str) -> list[WorkspaceMeta]:
    meta_db_path = resolve_meta_db_path(app)
    if not meta_db_path.exists():
        return []

    try:
        with sqlite3.connect(meta_db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT
                    COALESCE(p.session_id, n.session_id, l.session_id) as workspace_id,
                    w.last_known_directory as directory,
                    p.pinned_at,
                    n.note,
                    GROUP_CONCAT(l.label) as labels
                FROM (SELECT DISTINCT session_id FROM pins WHERE type='workspace' OR type='folder'
                      UNION SELECT DISTINCT session_id FROM notes WHERE type='workspace' OR type='folder'
                      UNION SELECT DISTINCT session_id FROM labels WHERE type='workspace' OR type='folder') as all_ids
                LEFT JOIN pins p ON all_ids.session_id = p.session_id AND (p.type='workspace' OR p.type='folder')
                LEFT JOIN notes n ON all_ids.session_id = n.session_id AND (n.type='workspace' OR n.type='folder')
                LEFT JOIN labels l ON all_ids.session_id = l.session_id AND (l.type='workspace' OR l.type='folder')
                LEFT JOIN workspaces w ON all_ids.session_id = w.workspace_id
                GROUP BY all_ids.session_id
            """).fetchall()
    except sqlite3.Error:
        return []

    folders = []
    for row in rows:
        labels_raw = row["labels"]
        labels_list = labels_raw.split(",") if labels_raw else []
        folders.append(
            WorkspaceMeta(
                workspace_id=str(row["workspace_id"] or ""),
                directory=str(row["directory"] or ""),
                is_pinned=bool(row["pinned_at"]),
                note=row["note"],
                labels=labels_list
            )
        )
    return folders


def load_sessions(app: str, search_query: str | None = None, sort_by: str = "time_updated", sort_order: str = "DESC") -> list[Session]:
    db_path = resolve_db_path(app)
    if not db_path.exists():
        return []

    meta_db_path = resolve_meta_db_path(app)
    init_meta_db(meta_db_path)

    # Sync directories to workspace_ids
    try:
        with sqlite3.connect(db_path) as conn:
            cursor = conn.execute("SELECT DISTINCT directory FROM session WHERE directory IS NOT NULL AND directory != ''")
            directories = [row[0] for row in cursor.fetchall()]

        if directories:
            with sqlite3.connect(meta_db_path) as meta_conn:
                for d in directories:
                    wid = resolve_workspace_id(d)
                    if wid:
                        meta_conn.execute("INSERT OR REPLACE INTO workspaces (workspace_id, last_known_directory) VALUES (?, ?)", (wid, d))

                        # We also need to map the sessions for this directory to this workspace_id
                        with sqlite3.connect(db_path) as conn:
                            sess_cursor = conn.execute("SELECT id FROM session WHERE directory = ?", (d,))
                            sess_ids = [r[0] for r in sess_cursor.fetchall()]

                        for sid in sess_ids:
                            meta_conn.execute("INSERT OR REPLACE INTO session_workspaces (session_id, workspace_id) VALUES (?, ?)", (sid, wid))
                meta_conn.commit()
    except sqlite3.Error:
        pass

    valid_sort_fields = {"time_updated": "s.time_updated", "time_created": "s.time_created", "title": "s.title"}
    sort_field = valid_sort_fields.get(sort_by, "s.time_updated")
    sort_order = "ASC" if sort_order.upper() == "ASC" else "DESC"

    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute(f"ATTACH DATABASE '{str(meta_db_path)}' AS meta")

            if search_query:
                query = f"""
                    SELECT
                        s.id, s.title, s.directory, s.time_created, s.time_updated,
                        sw.workspace_id,
                        p.pinned_at, n.note, GROUP_CONCAT(l.label) as labels
                    FROM session s
                    LEFT JOIN message m ON s.id = m.session_id
                    LEFT JOIN meta.session_workspaces sw ON s.id = sw.session_id
                    LEFT JOIN meta.pins p ON s.id = p.session_id AND (p.type = 'session' OR p.type IS NULL)
                    LEFT JOIN meta.notes n ON s.id = n.session_id AND (n.type = 'session' OR n.type IS NULL)
                    LEFT JOIN meta.labels l ON s.id = l.session_id AND (l.type = 'session' OR l.type IS NULL)
                    WHERE s.title LIKE ? OR m.data LIKE ?
                    GROUP BY s.id
                    ORDER BY {sort_field} {sort_order}
                """
                like_term = f"%{search_query}%"
                rows = conn.execute(query, (like_term, like_term)).fetchall()
            else:
                query = f"""
                    SELECT
                        s.id, s.title, s.directory, s.time_created, s.time_updated,
                        sw.workspace_id,
                        p.pinned_at, n.note, GROUP_CONCAT(l.label) as labels
                    FROM session s
                    LEFT JOIN meta.session_workspaces sw ON s.id = sw.session_id
                    LEFT JOIN meta.pins p ON s.id = p.session_id AND (p.type = 'session' OR p.type IS NULL)
                    LEFT JOIN meta.notes n ON s.id = n.session_id AND (n.type = 'session' OR n.type IS NULL)
                    LEFT JOIN meta.labels l ON s.id = l.session_id AND (l.type = 'session' OR l.type IS NULL)
                    GROUP BY s.id
                    ORDER BY {sort_field} {sort_order}
                """
                rows = conn.execute(query).fetchall()
    except sqlite3.Error:
        return []

    sessions: list[Session] = []
    for row in rows:
        labels_raw = row["labels"]
        labels_list = labels_raw.split(",") if labels_raw else []
        sessions.append(
            Session(
                sid=str(row["id"]),
                title=str(row["title"] or ""),
                directory=str(row["directory"] or ""),
                created_at=int(row["time_created"]) if row["time_created"] is not None else None,
                updated_at=int(row["time_updated"]) if row["time_updated"] is not None else None,
                workspace_id=str(row["workspace_id"]) if "workspace_id" in row.keys() and row["workspace_id"] is not None else None,
                is_pinned=bool(row["pinned_at"]),
                note=row["note"],
                labels=labels_list
            )
        )
    return sessions


def export_session(app: str, session_id: str) -> None:
    db_path = resolve_db_path(app)
    if not db_path.exists():
        print("[]")
        return
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT data FROM message WHERE session_id = ? ORDER BY id ASC",
                (session_id,)
            ).fetchall()
            
            messages = []
            for row in rows:
                try:
                    messages.append(json.loads(row["data"]))
                except Exception:
                    pass
            print(json.dumps(messages))
    except sqlite3.Error:
        print("[]")


def delete_session(app: str, session_id: str) -> None:
    db_path = resolve_db_path(app)
    meta_db_path = resolve_meta_db_path(app)
    
    # Delete from sidecar
    if meta_db_path.exists():
        try:
            with sqlite3.connect(meta_db_path) as meta_conn:
                meta_conn.execute("DELETE FROM pins WHERE session_id = ? AND (type = 'session' OR type IS NULL)", (session_id,))
                meta_conn.execute("DELETE FROM notes WHERE session_id = ? AND (type = 'session' OR type IS NULL)", (session_id,))
                meta_conn.execute("DELETE FROM labels WHERE session_id = ? AND (type = 'session' OR type IS NULL)", (session_id,))
                meta_conn.commit()
        except sqlite3.Error:
            pass

    if not db_path.exists():
        print(json.dumps({"status": "error", "message": "DB not found"}))
        return
    try:
        with sqlite3.connect(db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("DELETE FROM session WHERE id = ?", (session_id,))
            conn.commit()
        print(json.dumps({"status": "ok", "id": session_id}))
    except sqlite3.Error as e:
        print(json.dumps({"status": "error", "message": str(e)}))


def execute_meta_update(app: str, query: str, params: tuple) -> None:
    meta_db_path = resolve_meta_db_path(app)
    init_meta_db(meta_db_path)
    try:
        with sqlite3.connect(meta_db_path) as conn:
            conn.execute(query, params)
            conn.commit()
        print(json.dumps({"status": "ok"}))
    except sqlite3.Error as e:
        print(json.dumps({"status": "error", "message": str(e)}))


def build_resume_command(app: str, session_id: str) -> str:
    if app.lower() == "kilo":
        return f"kilo resume {session_id}"
    return f"opencode -s {session_id}"


def try_cd_then_resume(session: Session, app: str) -> None:
    cwd = Path(session.directory).expanduser() if session.directory else None
    if cwd and cwd.exists() and cwd.is_dir():
        os.chdir(cwd)
    subprocess.run(build_resume_command(app, session.sid), shell=True)


def render_lines(app: str, db_path: Path, sessions: list[Session], index: int) -> FormattedText:
    if not sessions:
        return FormattedText([
            ("class:title", "osm\n"),
            ("", f"No sessions found for {app}.\n"),
            ("", f"DB: {db_path}\n"),
        ])

    lines: list[tuple[str, str]] = []
    lines.append(("class:title", f"osm [{app}]\n"))
    lines.append(("", f"DB: {db_path}\n\n"))

    app_obj = get_app_or_none()
    rows = 24
    if app_obj is not None:
        try:
            rows = max(12, app_obj.output.get_size().rows)
        except Exception:
            pass
    per_session = 5
    visible_sessions = max(1, (rows - 4) // per_session)
    top = max(0, min(index - visible_sessions // 2, max(0, len(sessions) - visible_sessions)))
    end = min(len(sessions), top + visible_sessions)

    for i, s in enumerate(sessions[top:end], start=top):
        selected = i == index
        prefix = "> " if selected else "  "
        style = "class:selected" if selected else ""
        
        display_name = s.display_title
        if s.is_pinned:
            display_name = f"?? {display_name}"
        
        lines.append((style, f"{prefix}{display_name}\n"))
        lines.append((style, f"   {s.sid}\n"))
        
        dir_text = s.directory or '(no directory)'
        if s.labels:
            dir_text += f" | ??? {','.join(s.labels)}"
        lines.append((style, f"   {dir_text}\n"))
        
        time_text = f"last: {human_time(s.updated_at)} ({format_dt(s.updated_at)})"
        if s.note:
            time_text += f" - ?? {s.note}"
        lines.append((style, f"   {time_text}\n\n"))
        
    lines.append(("", f"UP/DOWN move  Enter resume  q quit   showing {top + 1}-{end} of {len(sessions)}\n"))
    return FormattedText(lines)


def run_tui(backend: str, label: str) -> int:
    db_path = resolve_db_path(backend)
    sessions = load_sessions(backend)
    index = 0

    body = FormattedTextControl(lambda: render_lines(label, db_path, sessions, index))
    root = Window(content=body, always_hide_cursor=True)

    kb = KeyBindings()

    @kb.add("up")
    def _(event) -> None:
        nonlocal index
        if sessions:
            index = max(0, index - 1)
            event.app.invalidate()

    @kb.add("down")
    def _(event) -> None:
        nonlocal index
        if sessions:
            index = min(len(sessions) - 1, index + 1)
            event.app.invalidate()

    @kb.add("enter")
    def _(event) -> None:
        if sessions:
            event.app.exit(result=("resume", sessions[index]))
        else:
            event.app.exit(result=("quit", None))

    @kb.add("q")
    @kb.add("c-c")
    def _(event) -> None:
        event.app.exit(result=("quit", None))

    app = Application(layout=Layout(HSplit([root])), key_bindings=kb, full_screen=True)
    action, session = app.run()
    if action == "resume" and session:
        try_cd_then_resume(session, backend)
        return 0
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenCode Session Manager", add_help=False)
    parser.add_argument("launcher", nargs="?", default="opencode", help="Launcher name (e.g. opencode, kilo)")
    parser.add_argument("-h", "--help", action="store_true", help="Show this help message and exit")
    parser.add_argument("--json", action="store_true", help="Output session list as JSON")
    parser.add_argument("--view", metavar="SID", help="Output session chat log as JSON")
    parser.add_argument("--delete", metavar="SID", help="Delete a session")
    parser.add_argument("--search", metavar="TERM", help="Search sessions by title or content")
    parser.add_argument("--sort-by", choices=["time_updated", "time_created", "title"], default="time_updated", help="Sort field")
    parser.add_argument("--sort-order", choices=["DESC", "ASC"], default="DESC", help="Sort order")
    
    # Meta actions
    parser.add_argument("--type", choices=["session", "folder", "workspace"], default="session", help="Type of metadata target")
    parser.add_argument("--pin", metavar="ID", help="Pin a session or folder")
    parser.add_argument("--unpin", metavar="ID", help="Unpin a session or folder")
    parser.add_argument("--set-note", nargs=2, metavar=("ID", "NOTE"), help="Set a note for a session or folder")
    parser.add_argument("--add-label", nargs=2, metavar=("ID", "LABEL"), help="Add a label to a session or folder")
    parser.add_argument("--remove-label", nargs=2, metavar=("ID", "LABEL"), help="Remove a label from a session or folder")

    args, unknown = parser.parse_known_args(list(sys.argv[1:] if argv is None else argv))
    
    if args.help:
        parser.print_help()
        return 0

    label = args.launcher
    backend, db_path, meta_path = detect_backend(label)
    
    # Action routing
    if args.view:
        export_session(backend, args.view)
        return 0
        
    if args.delete:
        delete_session(backend, args.delete)
        return 0
        
    if args.pin:
        execute_meta_update(backend, "INSERT OR REPLACE INTO pins (session_id, pinned_at, type) VALUES (?, ?, ?)", (args.pin, int(time.time() * 1000), args.type))
        return 0
        
    if args.unpin:
        execute_meta_update(backend, "DELETE FROM pins WHERE session_id = ? AND type = ?", (args.unpin, args.type))
        return 0
        
    if args.set_note:
        target_id, note = args.set_note
        if not note.strip():
            execute_meta_update(backend, "DELETE FROM notes WHERE session_id = ? AND type = ?", (target_id, args.type))
        else:
            execute_meta_update(backend, "INSERT OR REPLACE INTO notes (session_id, note, updated_at, type) VALUES (?, ?, ?, ?)", (target_id, note, int(time.time() * 1000), args.type))
        return 0
        
    if args.add_label:
        target_id, lbl = args.add_label
        execute_meta_update(backend, "INSERT OR IGNORE INTO labels (session_id, label, type) VALUES (?, ?, ?)", (target_id, lbl.strip(), args.type))
        return 0
        
    if args.remove_label:
        target_id, lbl = args.remove_label
        execute_meta_update(backend, "DELETE FROM labels WHERE session_id = ? AND label = ? AND type = ?", (target_id, lbl.strip(), args.type))
        return 0

    if args.json:
        if not db_path.exists():
            print(json.dumps({"sessions": [], "folders": []}))
            return 0
        sessions = load_sessions(backend, search_query=args.search, sort_by=args.sort_by, sort_order=args.sort_order)
        folders = load_folder_meta(backend)
        
        sess_out = []
        for s in sessions:
            d = asdict(s)
            d["display_title"] = s.display_title
            sess_out.append(d)
            
        fold_out = [asdict(f) for f in folders]
        
        print(json.dumps({"sessions": sess_out, "folders": fold_out}))
        return 0

    if not db_path.exists():
        print(f"No sessions DB found for {backend}: {db_path}", file=sys.stderr)
        return 2

    return run_tui(backend, label)


if __name__ == "__main__":
    raise SystemExit(main())
