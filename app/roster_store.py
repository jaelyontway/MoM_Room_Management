"""Persistent roster overrides for therapist auto-detection.

Stores two lists in a small JSON file next to the project root:
  - "added":   names the user approved from Square (treated as active roster members)
  - "ignored": names the user dismissed (never prompt about them again)

This lets the app detect new masseuse names appearing in Square bookings and ask
the user whether to add them, without hand-editing the hardcoded ALLOWED_THERAPISTS.
"""
import json
import os
import threading
from typing import Dict, List

_LOCK = threading.Lock()
_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "roster_overrides.json",
)


def _normalize(name: str) -> str:
    return " ".join((name or "").lower().strip().split())


def _empty() -> Dict[str, List[str]]:
    return {"added": [], "ignored": []}


def _load() -> Dict[str, List[str]]:
    try:
        with open(_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return _empty()
    except Exception:
        return _empty()
    if not isinstance(data, dict):
        return _empty()
    added = [str(x) for x in data.get("added", []) if isinstance(x, str) and x.strip()]
    ignored = [str(x) for x in data.get("ignored", []) if isinstance(x, str) and x.strip()]
    return {"added": added, "ignored": ignored}


def _save(data: Dict[str, List[str]]) -> None:
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _FILE)


def get_added() -> List[str]:
    return _load()["added"]


def get_ignored() -> List[str]:
    return _load()["ignored"]


def is_added(name: str) -> bool:
    n = _normalize(name)
    return any(_normalize(x) == n for x in _load()["added"])


def is_ignored(name: str) -> bool:
    n = _normalize(name)
    return any(_normalize(x) == n for x in _load()["ignored"])


def add_therapist(name: str) -> bool:
    """Approve a detected name: add to roster and clear it from ignored. Returns False for blank input."""
    name = (name or "").strip()
    if not name:
        return False
    with _LOCK:
        data = _load()
        n = _normalize(name)
        if not any(_normalize(x) == n for x in data["added"]):
            data["added"].append(name)
        data["ignored"] = [x for x in data["ignored"] if _normalize(x) != n]
        _save(data)
    return True


def ignore_therapist(name: str) -> bool:
    """Dismiss a detected name so it stops being suggested. Returns False for blank input."""
    name = (name or "").strip()
    if not name:
        return False
    with _LOCK:
        data = _load()
        n = _normalize(name)
        if not any(_normalize(x) == n for x in data["ignored"]):
            data["ignored"].append(name)
        _save(data)
    return True
