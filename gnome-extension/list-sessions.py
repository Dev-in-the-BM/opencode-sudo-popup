#!/usr/bin/python3
"""Read-only OpenCode session index for the GNOME Shell extension."""

import argparse
import json
import os
import sqlite3
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()
    limit = max(1, min(args.limit, 500))
    database = os.path.join(
        os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")),
        "opencode",
        "opencode.db",
    )
    if not os.path.isfile(database):
        print("[]")
        return

    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=1)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        """SELECT id, title, directory, time_created, time_updated, time_idle,
                  time_suspended, time_archived
           FROM session_v2
           WHERE time_archived IS NULL
           ORDER BY time_updated DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    # OpenCode leaves time_idle NULL while a session is actively being worked.
    result = [
        {
            "id": row["id"],
            "title": row["title"] or "Untitled session",
            "directory": row["directory"],
            "updated": row["time_updated"],
            "running": row["time_idle"] is None,
        }
        for row in rows
    ]
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (sqlite3.Error, OSError) as error:
        print(f"opencode-sudo-popup: {error}", file=sys.stderr)
        sys.exit(1)
