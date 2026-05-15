from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, asdict
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

    @property
    def display_title(self) -> str:
        cleaned = SUBAGENT_TITLE_RE.sub("", self.title.strip())
        return cleaned or "(untitled)"


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


def detect_backend(preferred: str | None = None) -> tuple[str, Path]:
    preferred = (preferred or os.environ.get("OSM_APP") or "").lower().strip()
    if preferred in {"opencode", "kilo"}:
        return preferred, resolve_db_path(preferred)

    candidates = [(name, resolve_db_path(name)) for name in ("opencode", "kilo")]
    existing = [(name, db) for name, db in candidates if db.exists()]
    if len(existing) == 1:
        return existing[0]
    if len(existing) > 1:
        if "kilo" in preferred:
            return "kilo", resolve_db_path("kilo")
        if "opencode" in preferred or preferred in {"oc", "open"}:
            return "opencode", resolve_db_path("opencode")
        return existing[0]
    return "opencode", resolve_db_path("opencode")


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


def load_sessions(app: str) -> list[Session]:
    db_path = resolve_db_path(app)
    if not db_path.exists():
        return []
    try:
        with sqlite3.connect(db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, title, directory, time_created, time_updated
                FROM session
                ORDER BY time_updated DESC
                """
            ).fetchall()
    except sqlite3.Error:
        return []
    sessions: list[Session] = []
    for row in rows:
        sessions.append(
            Session(
                sid=str(row["id"]),
                title=str(row["title"] or ""),
                directory=str(row["directory"] or ""),
                created_at=int(row["time_created"]) if row["time_created"] is not None else None,
                updated_at=int(row["time_updated"]) if row["time_updated"] is not None else None,
            )
        )
    return sessions


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
        lines.append((style, f"{prefix}{s.display_title}\n"))
        lines.append((style, f"   {s.sid}\n"))
        lines.append((style, f"   {s.directory or '(no directory)'}\n"))
        lines.append((style, f"   last: {human_time(s.updated_at)} ({format_dt(s.updated_at)})\n\n"))
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
    args = list(sys.argv[1:] if argv is None else argv)
    
    json_mode = False
    if "--json" in args:
        json_mode = True
        args.remove("--json")
        
    if not json_mode and (not args or args[0] in {"-h", "--help"}):
        print("usage: osm <launcher-name> [--json]")
        print("       optional: OSM_APP=opencode|kilo")
        return 0

    label = args[0] if args else "opencode"
    backend, db_path = detect_backend(label)
    
    if json_mode:
        if not db_path.exists():
            print("[]")
            return 0
        sessions = load_sessions(backend)
        out = []
        for s in sessions:
            d = asdict(s)
            d["display_title"] = s.display_title
            out.append(d)
        print(json.dumps(out))
        return 0

    if not db_path.exists():
        print(f"No sessions DB found for {backend}: {db_path}", file=sys.stderr)
        return 2

    return run_tui(backend, label)


if __name__ == "__main__":
    raise SystemExit(main())


