# RAW-Switch — IoT SIM / i-SIM / eSIM platform

Fleet management for physical IoT SIMs, soldered i-SIMs and downloadable eSIM
profiles: provisioning, activation (GSMA `LPA:1$…` codes and install QR), data
metering, suspend/resume, credential re-issue and termination — dashboard plus
REST API.

| Half | Folder | What it is |
|---|---|---|
| Dashboard | `nexora-iot/` | Static HTML/CSS/JS UI (`index.html`, `app.js`, `sim-studio.js`, `billing.js`) |
| Platform API | `sim_aggregator/` | FastAPI app: accounts, inventory, provisioning, eSIM/RSP, metering, billing |

## Start it (one command, one URL)

```powershell
.\start-local.ps1
```

That installs any missing dependency, starts the API and opens
**<http://127.0.0.1:8000>** — the dashboard, the REST API and the OpenAPI docs all
live on that single origin. Useful switches:

```powershell
.\start-local.ps1 -NoBrowser        # do not open a browser
.\start-local.ps1 -Port 8080        # different port
.\start-local.ps1 -Stop             # stop the background server
```

Without the helper script:

```bash
python -m uvicorn sim_aggregator.main:app --host 127.0.0.1 --port 8000
```

Seeded accounts on a fresh database:

| Email | Password | Role |
|---|---|---|
| `admin@raw-switch.io` | `admin123` | Administrator |
| `customer@raw-switch.io` | `customer123` | Customer portal |

Local data lives in `local_studio.db` (`-Database` changes it); production uses
`sim_aggregator/sim_aggregator.db` or whatever `DATABASE_URL` points at.

## Verify it

```powershell
# API: 48 checks — provisioning, metering, lifecycle, QR SVG, guard rails
sim_aggregator\.venv\Scripts\python.exe validate_sim_lifecycle.py

# UI: 16 checks — headless Chrome signs in, provisions an eSIM, checks the QR
python validate_sim_ui.py
```

Both exit `0` only when every check passes. `validate_sim_ui.py` needs
`pip install websocket-client` and Chrome.

## Where things are

| Topic | Read |
|---|---|
| Every screen, workflow and failure mode | `RAW-SWITCH-USAGE-GUIDE.md` |
| API endpoints and environment variables | `sim_aggregator/README.md` |
| Dashboard, deployment units and nginx | `nexora-iot/README.md` |
| VPS deployment | `DEPLOY-VPS.md` |

## Production note

In production the two halves run as separate services (`sim-aggregator.service`
on port 8000, the static dashboard on port 80). The API only serves the dashboard
when it finds the `nexora-iot` folder next to `sim_aggregator/` or in
`/var/www/raw-switch-iot`; set `UI_DIR` to point it somewhere else. The dashboard
resolves its API base URL automatically, so the same files work in both setups.
