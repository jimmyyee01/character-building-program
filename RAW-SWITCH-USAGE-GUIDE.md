# RAW-Switch IoT — Complete Usage & Deployment Guide

**Product:** RAW-Switch (repo `nexora-iot`) — IoT SIM / iSIM / eSIM fleet management dashboard
**Live site:** <http://45.159.228.52>
**API:** <http://45.159.228.52:8000> (FastAPI, OpenAPI docs at `/docs`)
**Guide version:** 5 November 2026 · every screenshot in this guide was captured from the live site, not mocked up
**Published copy:** <http://45.159.228.52/docs/> — the same guide rendered as HTML, served next to the dashboard

---

## Contents

1. [What you are looking at](#1-what-you-are-looking-at)
2. [Before you start](#2-before-you-start)
3. [Signing in](#3-signing-in)
4. [The dashboard shell (every part explained)](#4-the-dashboard-shell)
5. [Using it on a phone](#5-using-it-on-a-phone)
6. [Screen-by-screen walkthrough](#6-screen-by-screen-walkthrough)
   - [6.1 Overview](#61-overview) · [6.2 Notifications](#62-notifications) · [6.3 SIM management](#63-sim-management) · [6.4 Add a SIM](#64-add-a-sim-single-provisioning) · [6.5 SIM studio](#65-sim-studio-guided-provisioning) · [6.6 Global roaming](#66-global-roaming) · [6.7 Customers](#67-customers) · [6.8 Analytics](#68-analytics) · [6.9 Reports](#69-reports) · [6.10 Network APIs](#610-network-apis) · [6.11 Billing & data pricing](#611-billing--data-pricing) · [6.12 SIM & data management](#612-sim--data-management) · [6.13 Settings](#613-settings) · [6.14 User profiles](#614-user-profiles)
7. [Customer portal end to end](#7-customer-portal-end-to-end)
   - [7.1 My dashboard](#71-my-dashboard) · [7.2 SIM & data management](#72-sim--data-management-customer-view) · [7.3 My reports](#73-my-reports) · [7.4 Team & permissions](#74-team--permissions) · [7.5 Billing](#75-billing--data-pricing-customer-view)
8. [Billing workflow end to end](#8-billing-workflow-end-to-end)
9. [Deploying to the server](#9-deploying-to-the-server)
10. [Post-deploy verification](#10-post-deploy-verification)
11. [Rolling back](#11-rolling-back)
12. [Troubleshooting](#12-troubleshooting)
13. Appendix A — [API map](#appendix-a--api-map)
14. Appendix B — [File map & credentials](#appendix-b--file-map--credentials)
15. Appendix C — [Sample data pack (dummy data)](#appendix-c--sample-data-pack)

> **Looking for the dummy data?** Every worked example in this guide uses one fictional account, *Acme Cold Chain Ltd*. The full fixture — JSON, CSV, curl calls, expected screen values and cleanup — is in [Appendix C](#appendix-c--sample-data-pack), and `seed_demo_data.py` loads it in one command.

---

## 1. What you are looking at

RAW-Switch has two halves that run separately:

| Half | What it is | Where it runs | Managed by |
|---|---|---|---|
| **Dashboard** (this guide's photos) | Static HTML/CSS/JS — `index.html`, `app.js`, `billing.js`, `sim-studio.js`, `styles.css` | `/var/www/raw-switch-iot` served on port **80** | systemd unit `raw-switch.service` |
| **Platform API** | FastAPI app: accounts, inventory, provisioning, eSIM/RSP, roaming, metering, invoices, payments | `/opt/sim-aggregator` on port **8000** | systemd unit `sim-aggregator.service` |

In production the dashboard and the API are two services. For local work the API
now serves the dashboard itself, so **one command and one URL** is all you need:

```powershell
# from the repo root, Windows PowerShell
.\start-local.ps1              # starts the API + dashboard, opens http://127.0.0.1:8000
.\start-local.ps1 -NoBrowser   # same, without opening a browser
.\start-local.ps1 -Stop        # stop the background server again
```

```bash
# the same thing without the helper script
python -m uvicorn sim_aggregator.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000> — the sign-in card, all screens and the API
(`/docs`) come from that one origin. `start-local.ps1` checks the dependencies,
waits for `/system/health`, and prints the seeded logins when the server is up.

`app.js` no longer hardcodes a host; it resolves the API base in this order:

1. `window.RAW_SWITCH_API` (or the `<meta name="raw-switch-api">` tag) — explicit override
2. the page's own origin when it is served by the API (`http://…:8000`)
3. `http://<same-host>:8000` for localhost / private LAN addresses
4. the production API (`http://45.159.228.52:8000`) when the page is served from anywhere else

That means a plain static copy of `nexora-iot/` still works on the VPS, and the
local single-URL mode needs no configuration at all.

Nothing is stored in the browser except the session; SIMs, customers, users, rates, invoices and payments all live in SQLite at `/opt/sim-aggregator/sim_aggregator.db` on the server, or in `local_studio.db` when you run locally.

**Fleet snapshot at the time of writing:** 35 SIMs, 35 active, 8 regions, 5 per-megabyte rate cards, 0 open invoices.

![Overview](docs/screenshots/02-overview.png)

---

## 2. Before you start

| You need | Details |
|---|---|
| A browser | Chrome, Edge, Firefox or Safari, current version. The UI loads Google Fonts + Lucide icons from the internet; without a connection it still works but looks plainer. |
| The site URL | <http://45.159.228.52> — plain HTTP. Only use it on trusted networks until HTTPS is set up (see §9.7). |
| An account | Demo accounts are printed on the sign-in card (below). Create real ones in **User profiles** / **Customers**. |
| SSH access (admins only) | `root@45.159.228.52`, port 22 — needed only for deployment (§9). |

### Roles and what they see

| Role | Can do |
|---|---|
| **Administrator** | Everything: the whole fleet, all customers, billing, network APIs, settings, user/role management. |
| **Customer** (Customer Admin) | Only their own fleet: *My dashboard*, *SIM & data management*, *My reports*, *Billing*, *My profile*, *Team & permissions*. The customer-only items in the sidebar only appear for this role. |
| **User** | Staff account created under **Settings → Add user**, with a role and checkbox permissions assigned by an administrator. |

### Demo accounts (printed on the sign-in screen)

| Email | Password | Role |
|---|---|---|
| `admin@raw-switch.io` | `admin123` | Administrator |
| `customer@raw-switch.io` | `customer123` | Customer (Trackfinity) |

> Change these before letting anyone outside your team in — they are public knowledge.


---

## 3. Signing in

![Sign in](docs/screenshots/01-sign-in.png)

1. Open <http://45.159.228.52>. The sign-in card covers the app until you are authenticated.
2. Type your **Email address** and **Password** (the card is prefilled with `admin@raw-switch.io` in the screenshot).
3. Tick **Remember me** on your own workstation — the browser then keeps the session instead of asking on every visit.
4. Press **Sign in** (or Enter). *Forgot password?* is a placeholder on this build — an administrator resets accounts from **User profiles** (§6.14).

The demo credentials are printed under the button (`Admin: admin@raw-switch.io / admin123`, `Customer: customer@raw-switch.io / customer123`) so nobody is ever locked out of a demo box.

What happens behind the scenes: the page `POST`s to `/auth/login`, stores the returned session, loads the live fleet from `/inventory`, and only then reveals the dashboard. A green toast — *"Welcome back, Alex Morgan"* — confirms it.

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid email or password" | Wrong credentials, or the account was created in a different environment | Use the demo accounts above, or reset the account from **User profiles** as an administrator |
| Card stays, page empty | API unreachable on port 8000 | Check `systemctl status sim-aggregator` (§12) |
| Signed in but numbers show 0 | `/inventory` failed; the UI falls back to an empty state | Same as above, then reload |

To sign out, use the **logout icon** next to your name at the bottom of the sidebar (on a phone: open the drawer first).

---

## 4. The dashboard shell

Every screen in the app is drawn inside the same frame. Once you know these five parts you can navigate the whole product.

![Overview with the shell](docs/screenshots/02-overview.png)

### 4.1 Sidebar (left, dark column)

| Part | What it does |
|---|---|
| **RAW-Switch logo** | Home. Click the workspace switcher underneath to see the account you are working in (`RAW-Switch / IoT connectivity`). |
| **WORKSPACE** group | *Overview*, *SIM management* (badge shows fleet size), *SIM studio* (marked `new`), *Global roaming*, *Customers*, plus *SIM & data management*. Customers also get *My dashboard*, *My reports*, *My profile*, *Team & permissions*. |
| **INSIGHTS** group | *Analytics*, *Network APIs*, *Reports*. |
| **BILLING** group | *Billing & data pricing*. |
| **ADMIN** group | *Settings*, *User profiles*, *Help & support*. |
| **Network status card** | Live summary — e.g. *"Inventory online · 3 SIMs connected to configured networks"* with network and region counts. Populated from `/system/health` and `/sims/summary`. |
| **Profile strip** | Your initials, name, role, and the **sign-out** icon. |

The active item is highlighted with the amber bar on the left edge.

### 4.2 Topbar

| Part | What it does |
|---|---|
| **Search field** (`⌘K` / `Ctrl K` hint) | Type a device name, ICCID or customer and press **Enter** — it jumps to SIM management with that filter applied. |
| **Status pill** ("All networks online") | Green when `/system/health` reports every configured network up; the pill turns amber/red with the failing network name. |
| **Bell** | Opens the notification panel (§6.2). A dot means unread activity. |
| **Avatar** | Signed-in identity; the same menu as the sidebar profile. |
| **Page actions** | Each screen adds its own buttons on the right — e.g. **Export report** and **+ Add new SIM** on Overview. |

### 4.3 Main area

Cards use a consistent anatomy: icon + label, the number, then a small caption and a sparkline/bar. `Live` chips mean the value came from the API in this session, not from sample data.

### 4.4 Toasts and modals

Toasts appear bottom-right (green = success, red = error) and disappear on their own. Modals dim the page behind them; close with the **×**, by clicking the backdrop, or with **Escape**.

### 4.5 Keyboard shortcuts

| Key | Action |
|---|---|
| `Ctrl`/`⌘` + `K` | Focus the global search |
| `Enter` in global search | Search the fleet for that text |
| `Escape` | Close the mobile drawer, a modal or the notification panel |

---

## 5. Using it on a phone

![Mobile drawer open](docs/screenshots/20-mobile-menu.png)

Below roughly 800 px wide the sidebar becomes a drawer:

| Action | Result |
|---|---|
| Tap **☰** (top-left) | Drawer slides in over a dimmed backdrop |
| Tap the dimmed area | Drawer closes |
| Press `Escape` | Drawer closes |
| Tap any menu item | The page changes and the drawer closes itself |
| Open the drawer | Page scroll locks, so you never scroll the page behind it |
| Rotate / widen to desktop | The drawer state is dropped and the sidebar returns to its fixed column |

Signing out also closes the drawer. Every screen is responsive: tables scroll or stack, filter rows wrap, and the primary button always stays reachable with a thumb.

---

## 6. Screen-by-screen walkthrough

Each subsection answers three questions: **what you see**, **what to do**, and **what the data means**. The worked examples use one fictional customer — *Acme Cold Chain Ltd* — so the numbers stay consistent from screen to screen.

> **Sample data used throughout this guide.** `Acme Cold Chain Ltd` (customer id `CUS-90001`), contact `ops@acmecold.example`, 3 devices:
> `Acme Reefer 001` `89441007770000001001` (IoT SIM, LTE-M, 1 GB/month, Europe) ·
> `Acme Reefer 002` `89441007770000001002` (IoT SIM, NB-IoT, 1 GB/month, Africa) ·
> `Acme Gateway 003` `89441007770000001003` (eSIM SGP.32, 4G, 5 GB/month, Asia Pacific).
> None of it exists in your database — it is a template you can copy. The full fixture (CSV, JSON, curl) is in [Appendix C](#appendix-c--sample-data-pack).

### 6.1 Overview

![Overview](docs/screenshots/02-overview.png)

**What you see.** The landing screen after sign-in: *Good morning, Alex* plus today's date, then four live counters, two breakdown groups, a usage chart, a status donut, recent activity and quick actions.

**Top-right actions.** *Export report* downloads a CSV of the fleet as currently visible; *+ Add new SIM* opens the provisioning modal (§6.4).

**The four counters** (read from `/inventory` and `/sims/summary`, each tagged `Live`):

| Counter | Value in the screenshot | Meaning |
|---|---|---|
| Total SIM cards | 35 | Rows registered in the database |
| Active connections | 35 · 100.0% of total fleet | `status = active` |
| Data used | 0.00 GB of 19.14 GB allocated | Sum of `usageMb` ÷ 1024 against summed allowances |
| Roaming-enabled SIMs | 35 · Across 8 regions | `roamingEnabled` true, distinct `location` |

**Breakdown tiles.** *Network technology*: 2G 1 · 3G 1 · 4G 3 · LTE-M 26 · NB-IoT 4 — these add up to 35. *SIM format* shows the four profile formats only — UICC 2 · eSIM SGP22 1 · eSIM SGP32 3 · SoftSIM 1 = 7 profile rows; the remaining rows are plain IoT SIM / iSIM and are counted in the header total (SIM studio reports **29 IoT + 2 iSIM + 4 eSIM = 35**).

**Data usage chart.** Consumption from 26 Oct to 1 Nov; the dropdown switches between the current database total and the allocation line. A flat 0.00 GB means the fleet is provisioned but nothing has been metered yet — normal on a fresh install.

**Fleet status donut.** Active 35 · 100.0%, Inactive 0, Suspended 0.

**Recent activity.** Newest first: device, customer, location, data used, status, last seen. *View all activity* jumps to SIM management.

**Quick actions** (bottom-right): *Provision a new SIM*, *Manage roaming*, *Generate a report*, plus a support card.

**Try it with the sample data.** Provision the three Acme devices (§6.4 / Appendix C) and this screen reads: *Total SIM cards 3*, *Data used 3.71 GB of 7.00 GB allocated* (420 MB + 180 MB + 3.2 GB), *Roaming-enabled SIMs 3 · Across 3 regions*, and LTE-M 1 · NB-IoT 1 · 4G 1.

### 6.2 Notifications

![Notification panel](docs/screenshots/03-notifications.png)

The bell in the topbar opens a panel of recent fleet events; the dot on the bell clears once it is opened. Close with **×**, a backdrop click, or `Escape`.

The entries in the screenshot (*"Roaming traffic increased — usage in Germany is 12% higher this week"*, *"220 SIMs activated — your latest batch is ready to deploy"*) are the panel's built-in **sample feed** — illustrations, not readings from your database. For real events (connects, provisioning, threshold breaches) use **Settings → Backend service health → Recent network events** (§6.13), which is served by `/system/health` and shows device, ICCID, network, timestamp and latency.

### 6.3 SIM management

![SIM management](docs/screenshots/04-sim-management.png)

The master inventory of every SIM you are allowed to see — where you spend most of your day.

**Header buttons.**

| Button | What it does |
|---|---|
| *SIM studio* | Opens the guided provisioning wizard (§6.5) |
| *Download template* | Downloads the bulk-import CSV skeleton |
| *Bulk provision* | Administrators only — upload that CSV to create many SIMs at once (`POST /inventory/bulk`) |
| *+ Add new SIM* | Single provisioning modal (§6.4) |

**Counters:** *All SIMs 35* (*Across your connected fleet*), *Active connections 35* (*Ready to transmit*), *Needs attention 0* (*Inactive or suspended*).

**Format cards:** *All formats 35* (*Complete inventory*), *Physical SIM 29* (*UICC & IoT SIM*), *eSIM profiles 4* (*SGP.22 & SGP.32*), *iSIM & SoftSIM 2* (*Built into the device*) — click one to filter the table to that format.

**Filter row:** free-text search (device, ICCID or customer), *All statuses*, *All SIM formats*, *All network tech*, and **Export** for the filtered set.

**Table columns:** Device / ICCID, SIM format, Net tech (`LTE-M`, `NB-IoT`, `4G`…), Customer, Network, Usage, Status, and a **⋯** row menu that toggles Active ⇄ Suspended.

**Reading a row** (dummy example):

| Column | Example value | Source field |
|---|---|---|
| Device / ICCID | `Acme Reefer 001` / `89441007770000001001` | `device`, `iccid` |
| SIM format | `IoT SIM` | `type` |
| Net tech | `LTE-M` | `networkTech` |
| Customer | `Acme Cold Chain Ltd` | `customer` |
| Network | `RAW-Switch Sandbox`, or `Auto select` when unassigned | `network` |
| Usage | `0.00 GB` of the plan allowance | `usageMb` |
| Status | `Active` | `status` |

**Footer:** *"Showing N of M"* — if N < M a filter is hiding rows, so clear the search before concluding a SIM is missing.

**Search recipes.**

| Goal | Type in the search box |
|---|---|
| Every device of one customer | `Acme Cold Chain` |
| One device family | `Reefer` |
| A specific card | `89441007770000001001` |
| Anything using NB-IoT | `NB-IoT` |

> **Fixed 5 Nov 2026.** The table (and its counters) used to stay at *0 / No matching SIMs* after the inventory fetch, because `renderSims()` was not re-run when live data arrived. Capturing this guide's screenshots is what caught it — the fix shipped as `app.js?v=20261105-6`.

### 6.4 Add a SIM (single provisioning)

![Provision a new SIM](docs/screenshots/04b-add-sim-modal.png)

1. Press **+ Add new SIM** (Overview or SIM management).
2. **Device name** — anything recognisable, e.g. `Fleet Tracker 042`.
3. **SIM format** — `UICC` (physical), `iSIM` or `eSIM`. For an eSIM the ICCID may be left blank; §6.10 registers the eUICC and downloads the profile.
4. **Network technology** — `2G`, `3G`, `4G`, `LTE-M`, `NB-IoT`.
5. **Customer** — the owning account, which is what makes the customer portal show only their own devices.
6. **ICCID** — 19–20 digits. *Optional for eSIM.*
7. **Data plan** and **Home region** — the allowance and the region used for roaming analysis.
8. **Enable global roaming** — leave on unless the device must stay on its home network.
9. **Provision SIM** → toast confirms, the row appears immediately, and the stat cards update without a reload.

**Exact payload the form sends** (`POST /inventory`, verified against the live API):

```json
{
  "device": "Acme Reefer 001",
  "iccid": "89441007770000001001",
  "customer": "Acme Cold Chain Ltd",
  "type": "IoT SIM",
  "networkTech": "LTE-M",
  "location": "Europe",
  "dataPlan": "1 GB / month",
  "dataLimitMb": 1024,
  "roamingEnabled": true,
  "status": "active"
}
```

The API answers with the stored record and the id it assigned:

```json
{
  "id": 36,
  "iccid": "89441007770000001001",
  "device": "Acme Reefer 001",
  "type": "IoT SIM",
  "networkTech": "LTE-M",
  "customer": "Acme Cold Chain Ltd",
  "location": "Europe",
  "usageMb": 0.0,
  "dataPlan": "1 GB / month",
  "dataLimitMb": 1024.0,
  "roamingEnabled": true,
  "status": "active",
  "network": "Auto select",
  "telecomNetworkId": null,
  "createdAt": "2026-11-05T05:32:00"
}
```

**Bulk alternative.** *Download template* → fill it → *Bulk provision* → upload (`POST /inventory/bulk`, administrators only):

```csv
device,iccid,customer,type,networkTech,location,dataPlan,dataLimitMb,roamingEnabled,status
Acme Reefer 001,89441007770000001001,Acme Cold Chain Ltd,IoT SIM,LTE-M,Europe,1 GB / month,1024,true,active
Acme Reefer 002,89441007770000001002,Acme Cold Chain Ltd,IoT SIM,NB-IoT,Africa,1 GB / month,1024,true,active
Acme Gateway 003,89441007770000001003,Acme Cold Chain Ltd,eSIM,4G,Asia Pacific,5 GB / month,5120,true,active
```

**Housekeeping.** A provisioning test writes a real row, and the API has no delete route (only `PATCH /inventory/{iccid}`). Remove test devices on the server:

```bash
sqlite3 /opt/sim-aggregator/sim_aggregator.db \
  "DELETE FROM devices WHERE iccid LIKE '89441007770000001%';"
systemctl restart sim-aggregator
```

### 6.5 SIM studio (guided provisioning)

![SIM studio](docs/screenshots/05-sim-studio.png)

The wizard for anyone who does not want to fill a modal field by field. Four steps: **1 Choose SIM type → 2 Device details → 3 Review → 4 Activate**. *View inventory* returns to the table, *Start over* resets the wizard.

**The five counters at the top** are the workspace summary:

| Card | Live value in the screenshot | Meaning |
|---|---|---|
| SIMs in fleet | 35 · 35 active | Inventory rows, of which how many are active |
| Customers | 5 · registered accounts | Accounts you can assign a SIM to |
| Plans | 4 · on the catalogue | Data plans offered |
| Data used | 0 MB · of 19 GB allowance | Metered ÷ allocated |
| Monthly recurring | $58.10 · 0 over allowance | Sum of plan prices, plus any over-cap charges |

**The three type cards** explain the difference and show how many of each you already run — *IoT SIM 29 in fleet*, *i-SIM 2 in fleet*, *eSIM 4 in fleet*. Pick one with **Select**. Then:

1. **Device details** — name, customer, ICCID (blank for eSIM/IoT depending on type), plan, home region, roaming.
2. **Review** — a plain-language recap of exactly what will be created.
3. **Activate** — creates the record and offers the eSIM QR/profile download when the type is eSIM (`/sims/{iccid}/qr.svg`).

**Recently provisioned** lists the newest SIMs issued from this workspace with an **Open** button per row — the fast path back to a device you just created.

**Sample data walk-through.** For *Acme Gateway 003*: type **eSIM** → device name `Acme Gateway 003`, customer `Acme Cold Chain Ltd`, ICCID left blank (filled by the RSP download), plan `5 GB / month`, home region `Asia Pacific`, roaming on → Review shows `eSIM · 5 GB/month · Asia Pacific · roaming enabled` → **Activate**. *SIMs in fleet* becomes 36, *Monthly recurring* rises by the plan price.

### 6.6 Global roaming

![Roaming control center](docs/screenshots/06-global-roaming.png)

One policy switchboard for the whole fleet. The banner summarises it — *"One SIM. Everywhere."* with **5 regions · 2 networks · 3 connected SIMs** in the screenshot.

**Roaming policies** (fleet-wide defaults):

| Policy | Screenshot state | What it does |
|---|---|---|
| International roaming | On | Allow devices to attach outside their home network |
| Automatic network selection | On | Connect to the strongest available partner network |
| Automatic network failover | On | Re-attach to another network if the current one drops |
| Data cap protection | Off | Pause roaming when a device hits its plan limit |

Change the toggles, then press **Save policies** (top-right). Nothing is applied until you save.

**Top roaming regions** ranks regions by connected devices with a percentage of the fleet — Asia Pacific 25 (71.4%, networks *RAW-Switch Sandbox, MTN U*), Europe 4 (11.4%), Texas USA 1, Paris France 1, Amsterdam NL 1. The network line under each region is blank when no device there is currently attached — that is a live connection state, not a configuration.

**Sample data.** With Acme's three devices, the banner would read **3 regions · 2 networks · 3 connected SIMs** and the ranking would be Europe 1 (33.3%), Africa 1 (33.3%), Asia Pacific 1 (33.3%).

Per-device roaming still lives on the SIM itself: the `roamingEnabled` flag set in §6.4, and `POST /devices/{iccid}/switch` to move a single device to another configured network.

### 6.7 Customers

![Customers](docs/screenshots/07-customers.png)

Every account, its fleet and its data package.

**Each card shows:** company name + status pill, *Registered SIMs* (and how many are active), *Live usage*, *Package remaining of X GB*, and how many of their SIMs have roaming enabled. Two links finish the job: **Manage credentials** (the portal login for that customer) and **View fleet →** (SIM management filtered to them).

In the screenshot: *Trackfinity* — 29 registered, 29 active, 0.00 GB live usage, 1022.86 GB package remaining, 29 roaming-enabled; *James Kabuye* — 0 registered, 262.86 GB remaining.

**Add customer** (top-right) creates the account and its first administrator in one step:

| Field | Dummy example |
|---|---|
| Company name | `Acme Cold Chain Ltd` |
| Customer admin name | `Dana Mwangi` |
| Customer admin email | `ops@acmecold.example` |
| Industry | `Logistics` (others: Agriculture, Energy, Smart cities) |
| Initial SIMs | `3` |
| Temporary password | `AcmeTemp2026!` (minimum 8 characters) |

Press **Create customer & admin**. The account appears on this grid *and* becomes a portal login (§7) — `ops@acmecold.example` can sign in and immediately sees Acme's fleet only.

> **Housekeeping.** The customer-admin password you type here is a real credential. Hand it over out of band and ask for it to be changed in **My profile** on first sign-in.

### 6.8 Analytics

![Fleet analytics](docs/screenshots/08-analytics.png)

Trend analysis for the month chosen in the top-right selector (`November 2026` in the screenshot).

| Card | Value shown | How it is computed |
|---|---|---|
| Average daily usage | 0.0 GB · *Live inventory usage* | Metered total ÷ days in the period |
| Network availability | 100.00% · *35 of 35 SIMs active* | Active ÷ total |
| Average session time | 0.0 GB/SIM · *Calculated from live usage* | Metered total ÷ SIM count (unit label is GB per SIM, not time) |
| Estimated connectivity cost | $53 · *Calculated from active SIMs* | Active SIMs × plan price |

**Usage by SIM technology** — IoT SIM, iSIM, eSIM (SGP.32), UICC, eSIM (SGP.22), SoftSIM, each with a bar and GB total. **Usage by network tech** — NB-IoT, 4G, LTE-M, 3G, 2G. Both read `0.0 GB` on a fleet that has been provisioned but never metered; they fill in as soon as usage is recorded (§8.2).

**Connection quality** — the headline score (98.7 *Excellent* here) plus four indicators: 42 ms average latency, 0.03% packet loss, 98.2% attach success, 4.8 min failover recovery. These are derived network-health indicators for the fleet, useful as a sanity check when a customer reports "my devices are slow".

**Sample data.** With Acme's 3 SIMs and one week of metering (420 + 180 + 1024 MB ≈ 3.71 GB): *Average daily usage* ≈ 0.53 GB, *Network availability* 100% (3 of 3), *Average session time* ≈ 1.24 GB/SIM, and the technology bars would show IoT SIM 1.59 GB and eSIM 3.2 GB.

### 6.9 Reports

![Reports & exports](docs/screenshots/09-reports.png)

Three one-click CSV exports, generated from the inventory this browser can see:

| Tile | Contents |
|---|---|
| **Fleet inventory** | Every SIM with status, plan, network, ICCID and customer |
| **Data usage** | Device-level consumption and network sessions |
| **Roaming activity** | International usage by country and partner network |

Click **Download CSV** on a tile, or **+ Create report** at the top right, which generates the file and adds an entry to the list below.

**Recent reports** shows what has been generated from this browser, with a `Ready` pill and a re-download icon. Two things worth knowing:

* The list lives in your **browser** (`localStorage` key `nexoraReportHistory`), not on the server — another device, or a private window, starts empty.
* The seeded entries in the screenshot (*October connectivity summary*, *Q3 roaming & usage report*) are **examples** that ship with the UI, so the panel is never blank on a fresh install. Real ones appear exactly as generated.

For a customer account the same screen becomes **My reports** (§7.4), scoped to their own fleet.

### 6.10 Network APIs

![Network APIs](docs/screenshots/10-network-apis.png)

Where the platform is wired to real operator networks and GSMA RSP services. Administrator-only — a non-admin gets a toast and the item refuses to open.

**1 · Local telecom networks.** One block per configured operator: *Network name*, *Country*, *API base URL*, *Authentication* (e.g. `Bearer token`), *API key*, then **Save network**. The pill in the card header counts what is configured (`0 configured` until you add one).

**2 · eUICC registry.** Embedded SIM identities (EIDs) must be registered before an RSP download can be requested. The **Register eUICC** button (top-right) adds one; the card lists what is registered.

**3 · Remote SIM Provisioning.** Choose the *eUICC EID*, the *Telecom network*, optionally a *Profile ICCID*, then **Submit profile download**. The selects read `Register an eUICC first` / `Configure a network first` until steps 1 and 2 are done — the form tells you what it is waiting for.

**4 · RSP adapters & credentials** (`Admin only`). For certified SM-DP+ / SM-DS providers:

| Field | Placeholder shown in the UI |
|---|---|
| Provider name | `Local operator RSP` |
| Protocol | `SGP.32 IoT` (or SGP.22) |
| Adapter | `Provider HTTPS API` |
| API base URL | `https://smdp.example/api` |
| Health path | `/health` |
| Profile download path | `/rsp/profiles/download` |
| Credential storage | `Environment variable` (secrets are never displayed again) |
| Credential reference | `RSP_PROVIDER_TOKEN` |
| Documentation URL | `https://operator.example/docs` |

Then **Save RSP adapter**. Because the credential is an environment reference, the secret itself lives in the service environment (see `SANDBOX_API_KEY` in §9.2), never in the database or the page.

**A working local test double already exists.** The server runs `raw-switch-sandbox.service` — a stand-in operator API on `127.0.0.1:8100` with provider name `RAW-Switch Sandbox`, SMDP `rsp.raw-switch.io`, 35 ms simulated latency and the API key `sbx_rawswitch_dev`. Point *Local telecom networks* at it to exercise the flows without a commercial contract:

| Field | Dummy/dev value |
|---|---|
| Network name | `RAW-Switch Sandbox` |
| Country | `Ghana` (any value; it is a label) |
| API base URL | `http://127.0.0.1:8100` |
| Authentication | `Bearer token` |
| API key | `sbx_rawswitch_dev` |

### 6.11 Billing & data pricing

![Pay-per-data billing](docs/screenshots/11-billing.png)

The metering → invoicing → settlement pipeline. Everything here is per customer; the date range in the top-right (`2026-11-01 — 2026-11-04` in the screenshot) scopes the four headline cards, and **Refresh** re-reads them.

| Card | Live value shown | Meaning |
|---|---|---|
| Data metered (month) | 0.0 MB · USD 0.00 priced this period | Usage recorded in the selected range and its price |
| Unbilled usage | USD 0.00 · 0.0 MB metered, not yet invoiced | Metered but not attached to an invoice yet |
| Outstanding | USD 0.00 · 0 open invoice(s) | Invoices issued and unpaid |
| Collected | USD 0.00 · 0 confirmed Pesapal payment(s) | Confirmed settlements |

**Per-megabyte rate card** (`5 rates` pill). The left-hand form adds a rate: *Rate name*, *Price per MB (USD)*, *Metering block (MB)*, *Minimum charge (USD)*, *Bound plan* (optional — leave it on *All plans (default tariff)* to make it the fallback) → **Add per-MB rate**. The table shows what exists; the *Per GB* column is the per-MB price × 1024:

| Rate | Per MB | Per GB | Block | Min | Plan |
|---|---|---|---|---|---|
| Standard metered | 0.0025 | 2.56 | 0.010 MB | 0.01 | All plans |
| Light sensor 500 MB | 0.0016 | 1.64 | 0.010 MB | 0.01 | 500 MB / month |
| Tracker 1 GB | 0.0021 | 2.15 | 0.010 MB | 0.01 | 1 GB / month |
| Gateway 5 GB | 0.0014 | 1.43 | 0.010 MB | 0.01 | 5 GB / month |
| Pooled data | 0.0010 | 1.02 | 0.010 MB | 0.01 | Pooled data |

Rules that follow from those numbers:

* The rate is chosen by the SIM's **plan**; a SIM without a dedicated rate falls back to *Standard metered*.
* Usage is rounded up to whole **metering blocks** (0.010 MB) before pricing.
* A reading never prices below the **minimum charge** (USD 0.01).

**Meter data** panel. Record a reading for one SIM: pick the *SIM*, type *Megabytes*, optionally override the *Rate override* (defaults to *Use the plan tariff*) → **Record metered usage**. **Meter 25 MB on every SIM** pushes the same reading across the fleet — handy for demos and for proving the pipeline end to end. The table lists each reading: SIM, customer, data, rate, amount, invoice, when. It reads *"No metered usage yet — record a reading to start the meter."* until the first one lands.

**Invoices** panel. Pick the *Customer*, set *Tax %* and *Due in (days)* (default 7) → **Generate invoice**. All of that customer's unbilled usage is aggregated into one invoice with a document number, totals, balance and status.

**Pesapal checkout** (marked `simulated` — no money moves). Settle an invoice or top up prepaid credit: *Invoice* (or *Top-up credit (no invoice)*), *Amount (USD)* (blank = invoice balance), payer name/email/phone, description → **Start Pesapal payment**. Each attempt appears in **Payment history** with reference, amount, mode, status and tracking id.

#### Worked example — billing the Acme fleet (dummy data)

1. Record **420 MB** for `Acme Reefer 001` (plan *1 GB / month* → *Tracker 1 GB*, 0.0021) → **0.88** USD.
2. Record **180 MB** for `Acme Reefer 002` → **0.38** USD.
3. Record **3276.8 MB** for `Acme Gateway 003` (plan *5 GB / month* → *Gateway 5 GB*, 0.0014) → **4.59** USD.
4. *Unbilled usage* now reads **USD 5.85** (3876.8 MB metered).
5. Invoices → customer `Acme Cold Chain Ltd`, Tax `16`, Due in `7` → **Generate invoice**.

| Invoice | Customer | Data | Subtotal | Tax (16%) | Total | Due |
|---|---|---|---|---|---|---|
| `INV-2026-0001` | Acme Cold Chain Ltd | 3.79 GB | 5.85 | 0.94 | **6.79** | 2026-11-12 |

*(Invoice numbers are generated as `INV-<year>-<sequence>`; yours will differ if the year already has invoices.)*

6. Pesapal checkout → invoice `INV-2026-0001`, amount `6.79`, payer `Dana Mwangi` / `ops@acmecold.example` / `+254712345678`, description `Metered data settlement` → **Start Pesapal payment**. Payment history shows the attempt; *Collected* becomes **USD 6.79** and *Outstanding* returns to **USD 0.00**.

> Fleet-wide sanity check: **Meter 25 MB on every SIM** writes 875 MB on a 35-SIM fleet. Priced across a mixed plan portfolio that came out at **USD 1.45** (≈ USD 2.19 if every SIM sat on the 0.0025/MB fallback) — a quick way to prove the meter works before pointing it at real traffic.

### 6.12 SIM & data management

![SIM & data management](docs/screenshots/12-sim-and-data-management.png)

The pooled-data desk: one row per SIM, shared-data logic on top, and the controls that keep devices inside their caps.

**Header.** *Customer* selector (`All customers` = admin view; pick one account to see only its pool) and **+ Add SIM**.

**Pool cards.**

| Card | Value in the screenshot | Meaning |
|---|---|---|
| Available shared data | 601.7 GB | Pool credit not yet assigned to a SIM |
| Active SIMs | 35 | Devices drawing from the pool |
| Data allocated | 1285.7 GB | Sum of every SIM allowance |
| Data remaining | 601.7 GB | What is left to consume |
| Account balance | `$ -74.43` · *Auto-pay enabled* | Credit on the pooled account; negative means allocated usage has outrun the purchased credit (top up below) |

**Buy shared data.** Type a GB amount (`10` in the screenshot) → **+ Add data** to top the pool up instantly.

**Fleet data protection.** *Automatic data capping* — when on, a SIM that reaches its individual limit is suspended instead of running up overage.

**My SIM cards & data plans** table, one row per device: *Customer*, *SIM / Device* (name + ICCID + format), *Connectivity* (`Auto select` or the attached network), *Data used* (bar + % of allowance), *Allocated data*, *Remaining data*, *Cap & protection* (editable GB cap + on/off switch), *Status*, and *Actions* → **Assign data** (draw GB from the pool) or **Deactivate**. **Export usage** downloads the table.

**Sample data — capping a device.** `Acme Gateway 003` arrives as `0.00 GB used of 5 GB · 5.00 GB remaining`. Type `4` in *Cap & protection* and leave the switch on: the device is suspended as soon as it passes 4 GB, and 1 GB stays in the pool. For `Acme Reefer 001`, press **Assign data**, give it `0.5` GB — *Available shared data* falls from `601.7 GB` to `601.2 GB` and *Allocated data* rises by exactly the same amount.

### 6.13 Settings

![Settings](docs/screenshots/13-settings.png)

Account-wide configuration, saved with the button in the top-right (**Save changes**). Some panels are admin-only and say so (`Admin only`).

| Panel | What you can change |
|---|---|
| **Profile information** | First name, last name, work email, role (role is read-only — change it in *User profiles*) |
| **Notifications** | Network incidents, usage thresholds, weekly summary — the three email/alert switches |
| **Users & access** | *Add user* and *Manage users* shortcuts; a reminder that permission changes apply immediately |
| **Roles & permissions** | The role catalogue — Administrator (8 permissions), User (4), Viewer (2, read-only) — with per-role permission chips and **Add role** for custom ones |
| **Company branding** (`Admin only`) | Company name, logo upload (`Choose file`, keep it ≤ 512 px), primary colour, navigation colour, live preview of the sidebar tile, **Remove logo**, **Save branding** |
| **Backend service health** | Live `/system/health` readout: badge `Online`, "Checked 11/4/2026, 11:38:23 PM", *Devices 35*, *Active devices 35*, *Telecom networks 2*, *Roaming providers 0*, *eUICCs 1*, *RSP operations 4*, a **Refresh** button that re-queries the API, and **Recent network events** |

**Backend service health is the first thing to check when the dashboard looks empty or stale.** If the badge is not `Online`, the API is down or unreachable — see §12.

**Sample data — a custom role.** Add role `Acme NOC` with the chips *Dashboard*, *SIM management*, *SIM studio*, *Reports & exports*, then create the user (§6.14) with that role. Their sidebar then shows exactly those four items — no billing, no settings.

### 6.14 User profiles

![User profiles](docs/screenshots/14-user-profiles.png)

Staff accounts and who can do what.

**Counters:** *Total users* (6 — *Active accounts*), *Administrators* (1 — *Full access*), *Standard users* (2 — *Limited access*). The gap between the three numbers is customers, who are counted in the total but hold a portal role rather than a staff role.

**Table columns:** *User* (initials chip, name, `#id`), *Email*, *Role* pill (`Administrator` highlighted), *Status* (`Active` / `Inactive`), *Last login* (`Just now`, `Never`), and three row actions: **edit**, **suspend/resume**, **delete**.

**Filters:** free-text *Search by name or email…*, an *All roles* dropdown, and **Export**.

**Add user** (top-right) — the form behind it:

| Field | Dummy example |
|---|---|
| Full name | `Dana Mwangi` |
| Email | `dana@acmecold.example` |
| Platform role | `User` (or `Administrator`) |
| Access role | `Acme NOC` (from §6.13) |
| Status | `Active` |
| Password | leave blank to keep the current one when editing |
| Permissions | checkbox list; the role pre-selects a set, you can add or remove individually |

**Reading the screenshot rows.** `Alex Morgan · admin@raw-switch.io · Administrator · Active · Just now` is the account you are signed in as. `Taylor Freight · customer@raw-switch.io · Customer` is the demo customer. `Browser Test · browser-admin@test.io` is an automated-test account — safe to delete once you are done with it. Delete is refused for the account you are currently using, which is why you must test with a second admin.

> Every account listed here can sign in to the dashboard; customer accounts land in the portal (§7) instead.

---

## 7. Customer portal end to end

Sign in as `customer@raw-switch.io` / `customer123` (or any customer admin you created in §6.7) and the product changes shape: the sidebar keeps only the customer's own views, the global search disappears, and every number is scoped to that account.

| Sidebar item | What it is |
|---|---|
| **My dashboard** | Their fleet at a glance (§7.1) |
| **SIM & data management** | Their SIMs, pool, caps and actions (§7.2) |
| **My reports** | Account-scoped reports (§7.3) |
| **My profile** | Opens the profile modal for their own account |
| **Team & permissions** | Their own colleagues and roles (§7.4) |
| **Billing & data pricing** | Their metered usage, invoices, checkout (§7.5) |
| **Help & support** | Opens a mail to `support@raw-switch.io` prefilled with *Customer fleet support* |
| **SIM studio** (`new`) | Same guided wizard, scoped to their fleet |

### 7.1 My dashboard

![Customer dashboard](docs/screenshots/15-customer-dashboard.png)

*Your fleet at a glance* → *Real-time insights for your Trackfinity devices and data.* Two buttons: **Export usage** (CSV) and **Manage SIMs** (jumps to §7.2).

| Card | Screenshot value | Meaning |
|---|---|---|
| My active SIMs `Live` | 29 · *29 SIMs in your fleet* | Their active devices |
| Data used this month | 0.00 GB · ↑8.2% | Metered this month versus last |
| Shared data balance `Available` | 25.00 GB · *Ready to assign to your SIMs* | Pool credit not yet assigned |
| SIMs with data caps `Protected` | 29 · *Automatic overspend protection* | Devices with a cap switch on |

**My data usage** — their last 7 days (Oct 27 → Nov 2 in the screenshot), with the weekly delta (`3.07 GB`, ↑8.2%) and a `Live usage` badge. **My fleet status** — *Active 29*, *Standby / suspended 0*, beside a support card whose **Get support** button opens a pre-addressed email.

**My recent SIM activity** — one row per device: name + ICCID, *Network*, *Data used*, *Data allowance*, *Remaining data*, *Status*, with *Manage data & caps →* in the header.

**Sample data.** Acme's admin would see *My active SIMs 3*, *Data used this month 3.71 GB*, *Shared data balance 2.29 GB*, *SIMs with data caps 3*, and three rows — e.g. `Acme Reefer 001 · Auto select · 0.41 GB of 1.00 GB · 0.59 GB remaining · Active`.

### 7.2 SIM & data management (customer view)

![Customer SIM & data management](docs/screenshots/16-customer-portal.png)

*Welcome, Trackfinity* — *Manage your Trackfinity fleet, data and account settings.*

**Identity card:** company name, `Customer ID: CUS-10024`, `Customer account`, an *Account active* pill and **Edit account** for their own details. Your Acme account would read `Acme Cold Chain Ltd · CUS-90001`.

| Card | Screenshot value |
|---|---|
| Available shared data | 338.9 GB — *Assign to any active SIM* |
| Active SIMs | 29 — *Devices in your fleet* |
| Data allocated | 1022.9 GB — *Across all SIMs* |
| Data remaining | 338.9 GB — *Across all SIMs* |
| Account balance | $202.79 — *Auto-pay enabled* |

**Buy shared data** (`10` GB → **+ Add data**) buys pool credit; **Fleet data protection → Automatic data capping** suspends a device when it hits its limit.

**My SIM cards & data plans** is the customer's action surface: *SIM / Device*, *Connectivity*, *Data used* (bar + %), *Allocated data*, *Remaining data*, *Cap & protection* (editable cap in GB + on/off switch), *Status*, and **Assign data** / **Deactivate** per row, plus **Export usage**.

**Sample data — a customer top-up.** Acme starts with `2.29 GB` available. Their admin types `10` → **+ Add data**: available becomes `12.29 GB` and the account is charged. *Data allocated* does **not** move until they press **Assign data** on a specific device.

### 7.3 My reports

![Customer reports](docs/screenshots/17-customer-reports.png)

*SIM & data reports* → *Download detailed reports for your Trackfinity account only.* Pick the month (`November 2026`) and press **Download report**, or open one of the four tiles:

| Tile | *View report* shows |
|---|---|
| **SIM inventory** | Device, ICCID, SIM type, network, status — the table at the bottom of the screen |
| **Data usage** | Consumption per SIM with monthly totals and usage percentages |
| **Data allocation** | Shared-data assignments, allowances and remaining balances |
| **Caps & compliance** | Per-SIM limits, utilisation, protected SIMs and over-cap status |

The preview table is tagged `Account-scoped`: it can never include another customer's device, and the CSV respects the same filter.

### 7.4 Team & permissions

![Customer team](docs/screenshots/18-customer-team.png)

*Give colleagues access to only the features they need.* Four ready-made roles:

| Role | Description (as shown) | Permission set |
|---|---|---|
| **Customer Admin** | Full account, team, SIM, data, billing, and report access | *All permissions* |
| **Fleet Manager** | Manage SIMs, connectivity, data allocations, and reports | *Operations* |
| **Data Analyst** | View dashboards and generate account-scoped reports | *Read only* |
| **Billing Manager** | Manage data purchases, billing details, and reports | *Billing* |

**Your account users** lists the team: user (initials, name, email), role pill, permission chips (*Dashboard*, *Sims*, *Data*, *Reports*, *Billing*, *Team*), status, and edit/suspend actions. The row marked **Your account** is you and cannot be removed. **Add team member** invites a colleague under one of those roles.

**Sample data.** Add `Kevin Otieno · kevin@acmecold.example` as **Fleet Manager**: he can assign data and pull reports, but *Billing* is not in his chip list, so invoices and payments stay out of reach.

### 7.5 Billing & data pricing (customer view)

![Customer billing](docs/screenshots/19-customer-billing.png)

The same billing engine as §6.11 with two differences that matter: the subtitle is scoped (*"Metered data for Trackfinity; priced per megabyte, invoiced and settled through Pesapal."*) and the invoice customer is already set to them — a customer cannot bill anyone else.

Everything else behaves identically: the four cards (*Data metered*, *Unbilled usage*, *Outstanding*, *Collected*), the read-only rate card, *Meter data* (they can record their own readings), *Invoices* (**Generate invoice** over their own unbilled usage, tax and due date included) and *Pesapal checkout* to settle.

**Sample data.** After the §6.11 example, Acme's admin opens this screen and sees *Data metered 3.79 GB · USD 5.85*, *Unbilled USD 0.00*, *Outstanding USD 6.79* (one open invoice `INV-2026-0001`), and settles it with a Pesapal payment of `6.79` — after which *Collected* reads `6.79` and *Outstanding* `0.00`.

---

## 8. Billing workflow end to end

A full period of pay-per-data billing, in the order the screens expect it.

### 8.1 One-time setup: rate cards

1. **Billing & data pricing → Per-megabyte rate card.**
2. Make sure a fallback exists — a rate bound to *All plans (default tariff)*. The shipped *Standard metered* (`0.0025`/MB) is exactly that.
3. Add a rate per plan family: *Cold chain 1 GB* — Price per MB `0.0021`, block `0.01`, minimum `0.01`, bound plan `1 GB / month` → **Add per-MB rate**.

Result: any SIM on `1 GB / month` now prices at 0.0021/MB (≈ 2.15/GB); everything else falls back to 0.0025/MB. The same thing over the API:

```bash
curl -X POST http://45.159.228.52:8000/billing/rates \
  -H 'Content-Type: application/json' \
  -d '{"name":"Cold chain 1 GB","pricePerMb":0.0021,"blockMb":0.01,"minCharge":0.01,
       "planName":"1 GB / month","description":"Reefer telemetry, hourly batch","currency":"USD"}'
```

`PATCH /billing/rates/{rate_id}` edits a rate (the *Per GB* column re-derives itself as price × 1024), and `GET /billing/rates` lists them.

### 8.2 Meter usage

From the UI (**Meter data**, one SIM or *Meter 25 MB on every SIM*), or from the API — which is what a real network feed would do:

```bash
# one SIM, real reading
curl -X POST http://45.159.228.52:8000/billing/usage \
  -H 'Content-Type: application/json' \
  -d '{"records":[{"iccid":"89441007770000001001","megabytes":420}],"source":"api"}'

# the whole fleet, for a demo (0 < megabytes <= 102400)
curl -X POST http://45.159.228.52:8000/billing/usage/simulate \
  -H 'Content-Type: application/json' \
  -d '{"megabytes":25}'
```

Readings are priced at write time, so *Unbilled usage* moves the moment the record lands. `GET /billing/usage` lists them with the timestamp on each row; `POST /inventory/{iccid}/usage` is the inventory-side equivalent for a single device.

### 8.3 Invoice the period

`Billing & data pricing → Invoices`: customer `Acme Cold Chain Ltd`, Tax `16`, Due in `7` → **Generate invoice**. Equivalent call:

```bash
curl -X POST http://45.159.228.52:8000/billing/invoices \
  -H 'Content-Type: application/json' \
  -d '{"customer":"Acme Cold Chain Ltd","taxPct":16,"dueDays":7,
       "notes":"November 2026 metered data"}'
```

You now hold `INV-2026-0001` — 3.79 GB, subtotal `5.85`, tax `0.94`, total `6.79`, due 2026-11-12. Only *new* unbilled usage is picked up by the next call, so invoices never double-bill. Lifecycle: `GET /billing/invoices`, `GET /billing/invoices/{id}`, `POST /billing/invoices/{id}/void`.

### 8.4 Settle via Pesapal

`Pesapal checkout` → pick the invoice, leave *Amount (USD)* blank to settle the full balance, fill payer details → **Start Pesapal payment**. The gateway on this deployment is **simulated**: the flow returns a reference and a tracking id and records the payment, but no money moves.

Live integration endpoints already exist:

| Endpoint | Purpose |
|---|---|
| `POST /billing/payments` | Create a payment attempt against an invoice |
| `GET /billing/payments/{id}` | Payment status |
| `POST /billing/payments/{id}/cancel` | Cancel before completion |
| `GET`/`POST /billing/pesapal/checkout/{payment_id}` | Build the Pesapal redirect/checkout |
| `POST /billing/pesapal/ipn` | Pesapal instant payment notification |
| `POST /billing/gateway/register-ipn` | Register the IPN URL with Pesapal |
| `POST /billing/gateway/test` | Verify gateway credentials |

Dummy payer used in the screenshots (safe for the simulated gateway): `Jane Doe` · `jane@example.com` · `+254712345678` · description `Metered data settlement`.

### 8.5 Reconcile

`GET /billing/summary` powers the four headline cards. Month end, the check is simple:

* **Data metered × rate = invoiced + unbilled**
* **Outstanding + Collected = invoiced total**

Anything else means a rate changed mid-period or a reading was back-dated — both visible in `GET /billing/usage`, where every row carries its own timestamp and rate.

> **Cleanup after a test run.** Invoices and payments created while learning should be voided/cancelled, otherwise *Outstanding* keeps showing test money. `POST /billing/invoices/{id}/void` removes an invoice from the balance without deleting the audit trail.

---

## 9. Deploying to the server

The stack is two systemd units and two directories. Deploying means "get the files there, restart the right unit, verify".

| Piece | Server path | systemd unit | Listens on |
|---|---|---|---|
| Dashboard (static) | `/var/www/raw-switch-iot` | `raw-switch.service` (`python3 -m http.server 80`) | port **80** |
| Platform API | `/opt/sim-aggregator` (package `sim_aggregator`, `.venv`) | `sim-aggregator.service` (`uvicorn sim_aggregator.main:app`) | port **8000** |
| Network sandbox (test double) | `/opt/net-sandbox` | `raw-switch-sandbox.service` | `127.0.0.1:8100` |
| Database | `/opt/sim-aggregator/sim_aggregator.db` (SQLite, ~300 KB) | — | — |

### 9.1 Prerequisites

* SSH to `root@45.159.228.52:22`.
* `python3` ≥ 3.10, `unzip`, `sqlite3` on the server.
* PuTTY's `plink`/`pscp` (or OpenSSH) on your Windows machine — this repo's scripts use `plink -pw … -batch` and `pscp -P 22`.
* The dashboard files live in `nexora-iot/` (`index.html`, `app.js`, `billing.js`, `sim-studio.js`, `styles.css`, `sim-studio.css`).

### 9.2 First-time / full deploy (dashboard + service)

`deploy.ps1` does the whole dance: zip → upload → extract → install the unit → verify.

```powershell
cd "C:\Users\MAMA TECH SOLUTIONS"
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

Under the hood (`deploy_remote.sh`): extract into `/var/www/raw-switch-iot`, `chmod -R 755`, write `/etc/systemd/system/raw-switch.service`, `daemon-reload`, `enable --now`, then open port 80 and `curl` the site. Confirm with:

```bash
systemctl status raw-switch --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
```

### 9.3 Front-end-only change (the common case)

Any edit to `index.html`, `app.js`, `billing.js`, `sim-studio.js` or the CSS is a copy + cache-bust:

```powershell
pscp -P 22 -pw <password> -batch .\nexora-iot\app.js root@45.159.228.52:/var/www/raw-switch-iot/app.js
```

1. **Bump the cache-buster** in `index.html` so browsers fetch the new file (`app.js?v=20261105-7` → `…-8`). Without this, users keep the old JS for hours and "the bug is still there".
2. Copy the file(s).
3. `node --check app.js` locally first — a syntax error blanks the whole dashboard.
4. Verify the served copy matches:

```bash
md5sum /var/www/raw-switch-iot/app.js
```

…and compare with the local `Get-FileHash .\nexora-iot\app.js -Algorithm MD5`.

> **LF, not CRLF.** Files edited on Windows can arrive with CRLF. HTML/JS tolerate it; shell scripts do not (`bash: \r: command not found`). If you upload a `.sh`, strip it first: `sed -i 's/\r$//' /tmp/script.sh`. PowerShell's `Set-Content` silently converts LF → CRLF; writing files with Python (`open(..., newline='')`) keeps LF.

### 9.4 Backend-only change

The API lives in `/opt/sim-aggregator/sim_aggregator/` (`main.py`, `models.py`, `billing.py`, `config.py`, `switching.py`). Upload, then back up + restart + poll, exactly as `_billing_deploy.sh` does:

```bash
# on the server, after uploading the changed .py files
sed -i 's/\r$//' /tmp/_billing_deploy.sh && bash /tmp/_billing_deploy.sh
```

That script copies `main.py`, `models.py`, `billing.py` to `/opt/sim-aggregator/backup-<stamp>-<file>.py`, restarts the unit, then **polls** `http://127.0.0.1:8000/billing/rates` for up to 20 s instead of sleeping blindly — a cold start of the FastAPI app takes 6–8 s. It finishes by printing the unit state, the rates/summary/gateway payloads, the billing paths and the last log lines.

Dependency changes only: `/opt/sim-aggregator/.venv/bin/pip install -r /opt/sim-aggregator/requirements.txt` **then** restart.

### 9.5 Database: back up, inspect, restore

```bash
# backup (do this before any schema change)
cp /opt/sim-aggregator/sim_aggregator.db /opt/sim-aggregator/sim_aggregator.db.bak-$(date +%Y%m%d)

# what is in there
sqlite3 /opt/sim-aggregator/sim_aggregator.db ".tables"
sqlite3 /opt/sim-aggregator/sim_aggregator.db "SELECT COUNT(*) FROM devices;"

# restore
systemctl stop sim-aggregator
cp /opt/sim-aggregator/sim_aggregator.db.bak-20261104 /opt/sim-aggregator/sim_aggregator.db
systemctl start sim-aggregator
```

Tables: `carriers`, `customers`, `data_rates`, `devices`, `esim_profiles`, `euiccs`, `invoice_lines`, `invoices`, `network_events`, `payment_gateways`, `payments`, `plans`, `roaming_policies`, `rsp_operations`, `rsp_providers`, `telecom_networks`, `usage_records`, `users`.

**Remove test data without touching the real fleet:**

```bash
# everything the automated suites provision sits above the real fleet's ids
sqlite3 /opt/sim-aggregator/sim_aggregator.db "DELETE FROM devices WHERE id > 35;"
# or by name pattern
sqlite3 /opt/sim-aggregator/sim_aggregator.db "DELETE FROM devices WHERE device LIKE '%Browser Test%';"
systemctl restart sim-aggregator
```

Stop the unit while you edit the database, then restart — the app holds its own SQLAlchemy session and will not notice a row deleted underneath it.

### 9.6 Network sandbox (operator test double)

`raw-switch-sandbox.service` gives you a fake operator API so network flows can be tested without a carrier contract. Its whole configuration is in the unit file:

```
Environment="SANDBOX_API_KEY=sbx_rawswitch_dev"
Environment="SANDBOX_PROVIDER_NAME=RAW-Switch Sandbox"
Environment="SANDBOX_SMDP=rsp.raw-switch.io"
Environment="SANDBOX_LATENCY_MS=35"
Environment="SANDBOX_HOST=127.0.0.1"
Environment="SANDBOX_PORT=8100"
ExecStart=/opt/sim-aggregator/.venv/bin/python -m uvicorn sandbox_server:app --host 127.0.0.1 --port 8100
```

Change a value with `systemctl edit raw-switch-sandbox` (or edit the unit + `daemon-reload`), then `systemctl restart raw-switch-sandbox`. It is bound to `127.0.0.1` on purpose — never expose it publicly.

### 9.7 Before you call it production

| Risk | Fix |
|---|---|
| Plain HTTP (no TLS) | Put nginx in front with a Let's Encrypt certificate; `nginx-raw-switch.conf` ships in the web root as a starting point |
| Demo passwords are public | Change `admin@raw-switch.io` / `customer@raw-switch.io`, or delete the demo accounts (§6.14) |
| API reads are unauthenticated | `http://45.159.228.52:8000` is world-readable — restrict port 8000 to the web host or add a token/gateway |
| SQLite single file | Fine at this scale; schedule a backup (§9.5) and copy it off-box |
| Pesapal is simulated | `POST /billing/gateway/test` before trusting a live key set |
| `python3 -m http.server` serves the UI | Static only, no TLS, no cache headers — swap for nginx when you go live |

---

## 10. Post-deploy verification

Five minutes of checks that catch almost every bad deploy.

### 10.1 One-shot script

`_deploy_verify.sh` restarts the API and prints everything you need to judge the result (upload it, strip CRLF, run):

```bash
sed -i 's/\r$//' /tmp/_deploy_verify.sh && bash /tmp/_deploy_verify.sh
```

In order it reports: unit state, `/system/health`, MD5s of the API modules and dashboard assets, HTTP status for `/`, `/app.js`, `/styles.css`, `/sim-studio.js`, `/sim-studio.css`, the **version tags actually served** (`app.js?v=…`), the fleet summary/catalog/recent payloads, and the DB file sizes.

### 10.2 Manual checklist

| Check | Command / place | Expected |
|---|---|---|
| Dashboard responds | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/` | `200` |
| API responds | `curl -s http://127.0.0.1:8000/system/health` | JSON with device and network counts |
| Fleet intact | `curl -s http://127.0.0.1:8000/sims/summary` | `total` = expected SIM count (35 here) |
| Cache-buster shipped | `curl -s http://127.0.0.1/` and look for `app.js?v=` | the version you just deployed |
| SIM table renders | Sign in → **SIM management** | rows present, counters non-zero, no `undefined` in the *Network* column |
| Health panel agrees | **Settings → Backend service health** | badge `Online`, *Devices* matches the fleet |
| Billing alive | **Billing & data pricing** → *Refresh* | rate cards listed, cards repaint |
| Survives reboot | `systemctl is-enabled raw-switch sim-aggregator` | `enabled` |

> The `undefined Auto select` text that used to appear in the *Network* column came from joining an optional value into a template string; it is now built with `${[s.flag, s.network].filter(Boolean).join(' ')}` (`app.js?v=20261105-7`). If `undefined` shows up anywhere after a deploy, that is the pattern to look for.

### 10.3 Two validators that run anywhere

Both are stdlib-only probes: they print one `PASS`/`FAIL` line per behaviour and exit `0` only when everything passes, so they also work as CI gates.

```powershell
# API: provisioning, metering, suspend/resume, credential re-issue, QR SVG, termination, guard rails
sim_aggregator\.venv\Scripts\python.exe validate_sim_lifecycle.py
# 48 checks, 48 passed, 0 failed

# UI: headless Chrome signs in, opens SIM studio, provisions an eSIM, checks the QR
python validate_sim_ui.py
# 16 checks, 16 passed, 0 failed
```

`validate_sim_lifecycle.py` takes `SIM_API` (default `http://127.0.0.1:8000`) and proves all three card families: IoT SIM, i-SIM and eSIM.

`validate_sim_ui.py` needs `pip install websocket-client` and Chrome. It launches its own headless Chrome on port 9232 (`SIM_DEBUG_PORT`), signs in as the seeded admin, verifies the studio offers all three card types with fleet counts matching `/sims/summary`, provisions an eSIM through the wizard, checks the `LPA:1$…` activation code and the rendered install QR, and compares the SIM table against `/inventory` — failing if the page logs any JavaScript error. Each run provisions one real eSIM; delete `local_studio.db` if you want a clean fleet again.

---

## 11. Rolling back

Everything shipped today is reversible in under a minute, because every deploy leaves a copy behind.

### 11.1 Front end

Keep the previous `app.js`/`index.html` before copying the new ones:

```bash
cp /var/www/raw-switch-iot/app.js /var/www/raw-switch-iot/app.js.prev
# rollback
cp /var/www/raw-switch-iot/app.js.prev /var/www/raw-switch-iot/app.js
```

…and set the `?v=` tag in `index.html` back to the previous value (or bump it again — any change forces re-fetch). Static files need no restart.

### 11.2 Backend

`_billing_deploy.sh` already wrote timestamped backups:

```bash
ls -1 /opt/sim-aggregator/backup-*-main.py
cp /opt/sim-aggregator/backup-20261104-2348-main.py  /opt/sim-aggregator/sim_aggregator/main.py
cp /opt/sim-aggregator/backup-20261104-2348-billing.py /opt/sim-aggregator/sim_aggregator/billing.py
systemctl restart sim-aggregator
curl -s http://127.0.0.1:8000/system/health
```

### 11.3 Database

Schema changes are the one genuinely risky deploy. Roll back the file, not the code:

```bash
systemctl stop sim-aggregator
cp /opt/sim-aggregator/sim_aggregator.db.bak-20261104 /opt/sim-aggregator/sim_aggregator.db
systemctl start sim-aggregator
```

If your migration added columns the old code does not know about, this is the only clean path — which is why §9.5 says *copy the file before you touch the schema*.

### 11.4 Full uninstall (last resort)

```bash
systemctl disable --now raw-switch sim-aggregator raw-switch-sandbox
rm -rf /var/www/raw-switch-iot /opt/sim-aggregator /opt/net-sandbox
rm -f /etc/systemd/system/{raw-switch,sim-aggregator,raw-switch-sandbox}.service
systemctl daemon-reload
```

That deletes the database with everything else — take a copy of `sim_aggregator.db` first if there is any real data in it.

---

## 12. Troubleshooting

Symptoms met in real life on this deployment, with cause and fix.

| Symptom | Cause | Fix |
|---|---|---|
| **SIM management shows "0 / No matching SIMs"** although the API returns 35 | The inventory fetch resolved after the first render and the table was never re-rendered | Fixed in `app.js?v=20261105-6`; if it recurs, make sure `loadActualInventory()` calls both `renderSims()` and `renderSimManagementStats()` |
| **Network column reads `undefined Auto select`** | Optional `flag` joined into a template string | Fixed in `app.js?v=20261105-7` — `${[s.flag, s.network].filter(Boolean).join(' ')}` |
| **Every screen is blank / white** | JS syntax error from a partial upload, or a stale cached bundle | `node --check app.js`, re-upload, bump `?v=`, hard-refresh (Ctrl+F5) |
| **Settings says the backend is Offline** | `/system/health` unreachable from the browser although the page loads | `curl -s http://45.159.228.52:8000/system/health` on the server; if that works it is a firewall/path problem to port 8000 |
| **Sign-in works but nothing loads** | API restarted mid-session, or mixed content (`https:` page calling `http://…:8000`) | Keep `http://` consistently, or terminate TLS in front of **both** UI and API |
| **`bash: $'\r': command not found`** | Script uploaded from Windows with CRLF | `sed -i 's/\r$//' script.sh` (or `tr -d '\015'`) before running |
| **`405 Method Not Allowed` deleting a SIM** | There is no DELETE on `/inventory/{iccid}` — `PATCH` only | Delete from the DB (§9.5) or deactivate via the ⋯ row menu |
| **Inventory suddenly has 36–40 SIMs** | The browser suites provision probe devices | `sqlite3 … "DELETE FROM devices WHERE id > 35;"` then restart (§9.5) |
| **API takes ~8 s after a restart** | FastAPI cold start + SQLAlchemy init | Poll the port, never `sleep 3` — `_billing_deploy.sh` does it right |
| **Old JS keeps loading after deploy** | The `?v=` tag did not change | Bump `app.js?v=`, `billing.js?v=`, `sim-studio.js?v=`, `styles.css?v=` in `index.html` |
| **Billing cards all zero** | No usage recorded in the selected range | *Meter data* → record a reading, or `POST /billing/usage/simulate` |
| **Invoice total is 0.00** | Nothing unbilled for that customer | Meter first; an invoice only aggregates *unbilled* usage |
| **A zero-byte `sim_aggregator.db\r` file appears** | A CRLF rename from an upload script | Safe to delete: `rm -f /opt/sim-aggregator/'sim_aggregator.db'$'\r'` |
| **Nothing renders on a phone** | Drawer open with page scroll locked, or an old cached CSS | `Escape` / tap the backdrop; bump `styles.css?v=` |

**Where to look first, always:** `journalctl -u sim-aggregator -n 40 --no-pager` (API), `systemctl status raw-switch --no-pager` (static site), and **Settings → Backend service health** (what the browser can actually reach).

---

## Appendix A — API map

Base `http://45.159.228.52:8000` · interactive docs at `/docs` · schema at `/openapi.json`.

### Accounts, users & customers
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Sign in; returns the user record |
| GET, POST | `/auth/users` | List / create staff and customer users |
| PATCH, DELETE | `/auth/users/{user_id}` | Edit or remove a user |
| GET, POST | `/customers` · PATCH `/customers/{customer_id}` | Customer accounts |
| GET, PATCH | `/plans`, `/plans/{plan_id}` | Data plans |

### Inventory & devices
| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/inventory` | List the fleet / provision one SIM |
| POST | `/inventory/bulk` | Bulk provision from CSV rows |
| PATCH | `/inventory/{iccid}` | Update a SIM (status, plan, roaming…) |
| POST | `/inventory/{iccid}/usage` | Record usage against a SIM |
| GET | `/sims/summary`, `/sims/catalog`, `/sims/recent?limit=` | Dashboard counters, plan/rate catalogue, newest SIMs |
| POST | `/sims/provision` | Studio-style guided provisioning |
| GET | `/sims/{iccid}` · `/sims/{iccid}/qr.svg` | One SIM · eSIM activation QR |
| POST | `/sims/{iccid}/activation`, `/lifecycle`, `/usage` | Activation, transitions, usage |
| POST | `/devices/` · GET `/devices/{iccid}/status` · POST `/devices/{iccid}/switch` | Device create, live status, network switch |

### Connectivity, eSIM & roaming
| Method | Path | Purpose |
|---|---|---|
| GET | `/carriers/` | Carrier list |
| GET, POST | `/telecom/networks` · PATCH `/telecom/networks/{id}` | Operator API configuration |
| POST | `/telecom/networks/{id}/attach`, `/bind`, `/test` | Attach devices, bind, health-test |
| GET, POST | `/euicc` | eUICC registry |
| POST | `/esim/provision`, `/esim/deactivate` · GET `/esim/profiles` | RSP profile lifecycle |
| GET, POST | `/rsp/providers` · PATCH `/rsp/providers/{id}` | RSP adapters & credentials |
| POST | `/rsp/download` · GET `/rsp/operations` | Profile download + history |
| GET, PATCH | `/roaming/policies` | The four fleet-wide roaming switches |
| POST | `/webhooks/carrier-event` | Inbound carrier events |

### Billing
| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/billing/rates` · PATCH, DELETE `/billing/rates/{id}` | Per-megabyte rate cards |
| GET, POST | `/billing/usage` | Usage records (priced at write) |
| POST | `/billing/usage/simulate` | Meter N MB on every SIM (`0 < N ≤ 102400`) |
| GET, POST | `/billing/invoices` · GET `/billing/invoices/{id}` · POST `/billing/invoices/{id}/void` | Invoicing |
| GET, POST | `/billing/payments` · GET `/billing/payments/{id}` · POST `/billing/payments/{id}/cancel` | Payments |
| GET, POST | `/billing/pesapal/checkout/{payment_id}`, `/billing/pesapal/ipn`, `/billing/pesapal/callback` | Pesapal |
| GET, PATCH | `/billing/gateway` · POST `/billing/gateway/test`, `/billing/gateway/register-ipn` | Gateway settings |
| GET | `/billing/summary` | The four dashboard cards |

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/system/health` | Service health + recent network events |

---

## Appendix B — File map & credentials

### Local repository (this machine)

| File | Role |
|---|---|
| `nexora-iot/index.html` | The whole dashboard markup + all views and modals (cache-busted asset tags at the bottom) |
| `nexora-iot/app.js` | Navigation, rendering, inventory/roaming/customers/users logic, CSV export |
| `nexora-iot/billing.js` | Rate cards, metering, invoices, Pesapal panel |
| `nexora-iot/sim-studio.js` | Provisioning wizard |
| `nexora-iot/styles.css`, `sim-studio.css` | All styling |
| `deploy.ps1` | Windows one-shot deploy (zip → upload → extract → service → verify) |
| `deploy_remote.sh` | Server side of the above (installs `raw-switch.service`) |
| `_billing_deploy.sh` | Backend backup + restart + poll + smoke output |
| `_deploy_be.sh` | Quick API restart + catalog/summary/log check |
| `_deploy_verify.sh` | Full post-deploy verification (§10.1) |
| `_sandbox_deploy.sh` | Sandbox unit install/restart |
| `_purge_demo.sh`, `_purge_probe_devs.sh` | Remove demo/probe SIMs above the 35-SIM baseline |
| `seed_demo_data.py` | Recreates the Acme demo fleet (Appendix C) |
| `_capture_guide_shots.py` | Regenerates every screenshot in `docs/screenshots/` via headless Chrome/CDP (signs in as admin + customer, walks all 15 views) |
| `render_guide.py` | Renders this Markdown into the styled `docs/index.html` that is served at <http://45.159.228.52/docs/> |
| `validate_network_sandbox.py`, `validate_billing.py`, `validate_*.py`, `_run_regression.py` | Automated validation suites |
| `docs/screenshots/01…20*.png` | The 21 screenshots used in this guide |

**Published copy.** The guide is live at **<http://45.159.228.52/docs/>** — same server as the dashboard, so it works wherever the app works and needs no login. Server layout: `/var/www/raw-switch-iot/docs/index.html` plus `docs/screenshots/*.png`. To update it after editing the Markdown:

```powershell
python render_guide.py                                              # Markdown -> docs/index.html
pscp -P 22 -pw <password> -batch .\docs\index.html root@45.159.228.52:/var/www/raw-switch-iot/docs/
pscp -P 22 -pw <password> -batch .\docs\screenshots\*.png root@45.159.228.52:/var/www/raw-switch-iot/docs/screenshots/
```


### Server

| Path | Contents |
|---|---|
| `/var/www/raw-switch-iot/` | `index.html`, `app.js`, `billing.js`, `sim-studio.js`, `styles.css`, `sim-studio.css`, `nginx-raw-switch.conf`, `raw-switch.service`, `README.md` |
| `/opt/sim-aggregator/sim_aggregator/` | `main.py`, `models.py`, `billing.py`, `config.py`, `switching.py` (+ `__pycache__`) |
| `/opt/sim-aggregator/` | `.venv`, `requirements.txt`, `sim_aggregator.db`, `sim_aggregator.db.bak-*`, `backup-<stamp>-<file>.py`, `backups/` |
| `/opt/net-sandbox/` | `sandbox_server.py`, `README.md` (the operator test double) |
| `/etc/systemd/system/` | `raw-switch.service`, `sim-aggregator.service`, `raw-switch-sandbox.service` |

### Credentials & secrets

| What | Value | Where it lives |
|---|---|---|
| Dashboard admin | `admin@raw-switch.io` / `admin123` | Printed on the sign-in card — change before going live |
| Dashboard customer | `customer@raw-switch.io` / `customer123` | Same |
| SSH root | `root@45.159.228.52:22` | Password is held in `deploy.ps1` (`$vpsPass`) and in your PuTTY config |
| Sandbox operator API | `sbx_rawswitch_dev` | `raw-switch-sandbox.service` environment |
| RSP provider token | reference name `RSP_PROVIDER_TOKEN` (value in the service environment) | `Network APIs → RSP adapters` |
| Pesapal | consumer key/secret in `/billing/gateway` | Currently **simulated**; `POST /billing/gateway/test` before trusting live keys |

> `deploy.ps1` stores the root password in plain text. Move it to an environment variable (`$env:VPS_PASS`) or a key before this repo leaves your machine, and rotate the password if it has ever been pasted into a chat or a ticket.

---

## Appendix C — Sample data pack

One fictional account, used consistently by every worked example in this guide. Copy it, run it, then delete it — the numbers in §6 and §7 assume exactly these values.

### The account

| Field | Value |
|---|---|
| Company | `Acme Cold Chain Ltd` |
| Customer id | `CUS-90001` |
| Admin | `Dana Mwangi` · `ops@acmecold.example` · `+254712345678` |
| Industry | Logistics |
| Temporary password | `AcmeTemp2026!` |

### The devices

| Device | ICCID | Format | Tech | Plan | Limit | Region | Roaming |
|---|---|---|---|---|---|---|---|
| Acme Reefer 001 | `89441007770000001001` | IoT SIM (UICC) | LTE-M | 1 GB / month | 1024 MB | Europe | on |
| Acme Reefer 002 | `89441007770000001002` | IoT SIM (UICC) | NB-IoT | 1 GB / month | 1024 MB | Africa | on |
| Acme Gateway 003 | `89441007770000001003` | eSIM (SGP.32) | 4G | 5 GB / month | 5120 MB | Asia Pacific | on |

```json
[
  {"device":"Acme Reefer 001","iccid":"89441007770000001001","customer":"Acme Cold Chain Ltd","type":"IoT SIM","networkTech":"LTE-M","location":"Europe","dataPlan":"1 GB / month","dataLimitMb":1024,"roamingEnabled":true,"status":"active"},
  {"device":"Acme Reefer 002","iccid":"89441007770000001002","customer":"Acme Cold Chain Ltd","type":"IoT SIM","networkTech":"NB-IoT","location":"Africa","dataPlan":"1 GB / month","dataLimitMb":1024,"roamingEnabled":true,"status":"active"},
  {"device":"Acme Gateway 003","iccid":"89441007770000001003","customer":"Acme Cold Chain Ltd","type":"eSIM","networkTech":"4G","location":"Asia Pacific","dataPlan":"5 GB / month","dataLimitMb":5120,"roamingEnabled":true,"status":"active"}
]
```

The same three rows as a bulk-provision CSV (headers exactly as *Download template* produces them):

```csv
device,iccid,customer,type,networkTech,location,dataPlan,dataLimitMb,roamingEnabled,status
Acme Reefer 001,89441007770000001001,Acme Cold Chain Ltd,IoT SIM,LTE-M,Europe,1 GB / month,1024,true,active
Acme Reefer 002,89441007770000001002,Acme Cold Chain Ltd,IoT SIM,NB-IoT,Africa,1 GB / month,1024,true,active
Acme Gateway 003,89441007770000001003,Acme Cold Chain Ltd,eSIM,4G,Asia Pacific,5 GB / month,5120,true,active
```

### Load it in one command

```powershell
cd "C:\Users\MAMA TECH SOLUTIONS"
python seed_demo_data.py                 # 3 SIMs, no usage
python seed_demo_data.py --with-usage    # 3 SIMs + 420 / 180 / 3276.8 MB priced readings
```

The script reads the current inventory first, so re-running it never duplicates a device — it prints `skip … (already provisioned)` instead.

### Or by hand, with curl

```bash
# 1. one device (repeat for the other two)
curl -X POST http://45.159.228.52:8000/inventory \
  -H 'Content-Type: application/json' \
  -d '{"device":"Acme Reefer 001","iccid":"89441007770000001001","customer":"Acme Cold Chain Ltd",
       "type":"IoT SIM","networkTech":"LTE-M","location":"Europe","dataPlan":"1 GB / month",
       "dataLimitMb":1024,"roamingEnabled":true,"status":"active"}'

# 2. meter the three readings in one call
curl -X POST http://45.159.228.52:8000/billing/usage \
  -H 'Content-Type: application/json' \
  -d '{"records":[
        {"iccid":"89441007770000001001","megabytes":420},
        {"iccid":"89441007770000001002","megabytes":180},
        {"iccid":"89441007770000001003","megabytes":3276.8}
      ],"source":"api"}'

# 3. invoice it (tax 16%, due in 7 days)
curl -X POST http://45.159.228.52:8000/billing/invoices \
  -H 'Content-Type: application/json' \
  -d '{"customer":"Acme Cold Chain Ltd","taxPct":16,"dueDays":7,"notes":"November 2026 metered data"}'
```

### What the screens show after loading it

| Screen | Expected result |
|---|---|
| Overview | *Total SIM cards 3* · *Active 3* · *Data used 3.71 GB of 7.00 GB* · *Roaming 3 · 3 regions* · LTE-M 1, NB-IoT 1, 4G 1 |
| SIM management | 3 rows, `Acme Reefer 001/002` and `Acme Gateway 003`, all `Active` |
| SIM & data management | *Active SIMs 3*, small pool, caps editable per row |
| Billing | Metered `3.79 GB` → **USD 5.85** (0.88 + 0.38 + 4.59), one invoice `6.79` with 16% tax |
| Customer portal (`ops@acmecold.example`) | Only Acme's 3 devices, their pool, their invoice |

### Clean it up

```powershell
python seed_demo_data.py --purge-command   # prints the exact sqlite command
pscp -P 22 -pw <password> -batch .\_purge_demo.sh root@45.159.228.52:/tmp/
```

```bash
# on the server — removes the demo devices and their orphaned usage rows, then restarts
bash /tmp/_purge_demo.sh
curl -s http://127.0.0.1:8000/sims/summary      # expect the original total, e.g. 35
```

> **Verified end to end.** These payloads were exercised against the live API on 5 November 2026: the three devices were accepted (`/inventory` returned ids 36–38), the readings were priced by the *Tracker 1 GB* and *Gateway 5 GB* cards at **0.88 / 0.38 / 4.59 USD**, and the rows were then removed again, returning the fleet to its 35-SIM baseline.
