import os
import sqlite3
from pathlib import Path

candidates = [
    Path("/var/www/litigationspace-staging/backend/app.db"),
    Path("/var/www/litigationspace-staging/backend/litigationspace.db"),
    Path("/var/www/litigationspace-staging/data/app.db"),
    Path("/var/www/litigationspace/data/app.db"),
    Path("app.db"),
    Path("litigationspace.db"),
]
for p in candidates:
    if not p.exists():
        continue
    print("DB", p)
    con = sqlite3.connect(str(p))
    con.row_factory = sqlite3.Row
    cols = [r[1] for r in con.execute("pragma table_info(users)").fetchall()]
    print("cols", cols)
    try:
        rows = con.execute(
            "SELECT id, email, COALESCE(is_admin,0) as is_admin FROM users ORDER BY created_at DESC LIMIT 15"
        ).fetchall()
    except Exception:
        rows = con.execute("SELECT id, email FROM users LIMIT 15").fetchall()
    for r in rows:
        print(dict(r))
    con.close()
