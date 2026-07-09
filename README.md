# LitigationSpace — Single Working Copy

**This is the one folder to use.** All other copies are mooted/archived.

| What | Where |
|------|-------|
| **Live site** | https://litigationspace.com |
| **VPS production** | `/var/www/litigationspace-staging` on `72.62.165.54` |
| **This folder** | `C:\Users\DOROTHY\litigationspace` |

## Quick start

Double-click **LitigationSpace** on your Desktop, or run:

```
START.bat
```

The control panel lets you:
- Open the live site
- Open this code folder
- Start local preview (`http://localhost:5173`)
- Restart the live server on VPS

## Folder layout

```
litigationspace/
├── LitigationSpace-Control.ps1   ← main program
├── START.bat                     ← double-click launcher
├── server.js                     ← local preview server
├── backend/                      ← FastAPI backend
├── frontend/                     ← compiled production frontend
└── src-app/                      ← React source (npm run dev)
```

## Archive

Old copies are at: https://github.com/queensworld1984-max/litigationspace-archive