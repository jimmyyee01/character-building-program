# Character Building Program

A complete multi-portal character-education system: **super admin console**, four
default portals (Schools, Organization, Family, Married) plus unlimited custom
portals, per-school/per-organization isolated accounts, a library-driven module
engine (books → chapters → letters/summaries → certificates) and printable
certificates.

Zero dependencies. **Node.js 16+ is the only requirement** — no `npm install`,
no build step, no database server.

---

## Quick start

```bash
node server/server.js
# or: npm start
```

Then open:

| URL | What it is |
|---|---|
| `http://localhost:3000/` | Landing page — all portals, live active/closed status |
| `http://localhost:3000/super` | **Super admin** login |
| `http://localhost:3000/t/greenfield-academy` | Demo school login page |
| `http://localhost:3000/t/horizon-alliance` | Demo organization login page |
| `http://localhost:3000/t/beloved-family` | Demo family login page |
| `http://localhost:3000/t/covenant-couples` | Demo married-couples login page |

Every school/organization gets its own login URL `/t/<slug>` created by the
super admin — nothing about one school is visible to another.

### Seeded accounts (change them from the consoles)
| Account | Credentials |
|---|---|
| Super admin | `superadmin` / `SuperAdmin@123` |
| **Schools admin** (Greenfield) | `admin@greenfield.edu` / `Admin@123` |
| **Organization admin** (Horizon) | `admin@horizon.org` / `Admin@123` |
| **Family admin** (Beloved Family) | `admin@family.example` / `Admin@123` |
| **Married admin** (Covenant Couples) | `admin@married.example` / `Admin@123` |
| Teacher (Greenfield) | `teacher@greenfield.edu` / `Teacher@123` |
| Student (Greenfield) | `STU-001` / `Student@123` |
| Student 2 (Greenfield) | `STU-002` / `Student@123` — used by the chapter-lock browser check |
| **Demo graduate** (Greenfield) | `STU-100` / `Student@123` — has finished every module, so the dashboards, graphs and the expandable learner summary in *Student progress* all have data |
| Supervisor (Horizon) | `supervisor@horizon.org` / `Super@123` (code `SUP-7788`) |
| Member (under that supervisor) | `olive@horizon.org` / `Member@123` |

Reset the demo data any time with `npm run fresh` (deletes `data/db.json` and
re-seeds). On an **existing PHP database**, `php ensure_logins.php` adds any of
the logins above that are missing (safe to re-run — it never overwrites).

### Automated tests

```bash
node tools/api-test.js http://localhost:3000     # Node backend (npm start)
node tools/api-test.js http://localhost:8080     # PHP backend (see below)
```

UI / render checks (no server needed for the first group):

```bash
node tools/routes-parity-check.js # every endpoint the UI calls exists on BOTH backends,
                                  # and the two route tables expose the same paths
node tools/smoke-pages.js        # every page loads + nav <-> section <-> renderer wiring
node tools/ui-picker-check.js    # chapter page picker: all pages, wrap/scroll, range/all/clear
node tools/ui-report-check.js    # progress-report builders + the expander rule
node tools/ui-pdf-check.js       # book reader, books stay shut until clicked, list placement
```

Checks that talk to a running backend (pass the base URL, default is Node on 3000):

```bash
node tools/ui-live-check.js http://127.0.0.1:3000   # drives every renderer with real API data
                                                    # (also uploads a test PDF and reads its page count)
node tools/pages-api-check.js http://127.0.0.1:3000 # chapter page ranges above 99 round-trip
node tools/reader-browser-check.js http://127.0.0.1:3000 # the reader in a REAL browser
                                                    # (headless Chrome/Edge: page turns must
                                                    #  rebuild the frame, not just the fragment,
                                                    #  and the sheet is fitted to the page's shape)
node tools/chapter-lock-browser-check.js http://127.0.0.1:3000 # submits a chapter in a REAL
                                                    # browser and proves that chapter then becomes
                                                    # inactive: disabled, and clicks do nothing
                                                    # (uses STU-002 — reseed after three runs)
node tools/analytics-api-check.js http://127.0.0.1:3000 # analytics scope: each account sees
                                                    # only itself, supervisors only their
                                                    # members, copy flags name both people
```

Handy npm shortcuts: `npm run check:routes`, `npm run check:ui`, `npm run check:api`,
`npm run check:api:php`, `npm run check:live`, `npm run check:pages`, `npm run check:keywords`,
`npm run check:browser`, `npm run check:chapter-lock`, `npm run check:analytics`.

If you are updating an **existing PHP database**, run the migration once after
pulling (it only adds what is missing — it never touches data):

```bash
php migrate.php
```

It adds the key-word columns used to assess typed answers and the transcript
snapshot stored with the general graduation certificate. Existing graduates
receive their transcript the next time their certificates are loaded.

### "Unknown endpoint: GET /api/..." — the server is running older code

That answer comes from the app's own route table, so the code answering the
request does not have that route yet. Two markers tell you exactly which part is
stale — files or backend:

* **`/build.json`** — a static file served from the files themselves.
* **`/api/health`** — served by the running backend.

```bash
curl -s https://your-site/build.json     # files on the server
curl -s https://your-site/api/health     # backend that is running
```

| `/build.json` | `/api/health` | What it means / what to do |
|---|---|---|
| current build | current build + the feature listed | nothing to do — the endpoint exists |
| current build | **missing or older** | the **files were updated but the backend process was not**: restart PHP-FPM/Apache (OPcache keeps old code) or the Node process, then reload |
| **missing or older** | missing or older | the **folder being served is not the one you pulled**: fix the document root, `git pull` there, restart |

Both consoles also show this themselves: if the page is newer than the server
they print a red card with the two builds, the step that is missing, the shell
commands to run and a *Try again* button (`#staleBuild` in `admin.html` /
`super.html`).

### Fastest fix on a PHP host: flush OPcache (no service name needed)

If `/build.json` is current but `/api/health` is not, the files are fine and only
the **process** is old. On PHP that process keeps compiled files in OPcache, and
`/cache-clear.php` flushes them without touching any service:

```bash
curl -s https://your-site/cache-clear.php     # { ok:true, did_reset:true, ... }
curl -s https://your-site/api/health          # now report the new build
```

It is a brand-new file after a pull, so it compiles even when the old code is
cached; it only drops compiled bytecode (never data) and is safe to delete after
use. Apache reaches it through the `.htaccess` rule, `php -S` through
`tools/php-router.php`. If it answers `did_reset:false`, PHP-FPM is not the
process answering you — restart the process instead (see above), which is the
only fix for a Node backend.

### `/api/health` answers an HTML page (not JSON)? The rewrite is the problem

An HTML 404 (or the site's home page) means the request **never reached the app**,
so no restart will ever fix it. The document root must be the **project folder**
(not `public/`), and its `.htaccess` must be honoured:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://your-site/api/health
curl -s https://your-site/php/api.php?r=/health      # JSON here => only the rewrite is missing
```

Apache — allow the file and the module, then reload:

```apache
<Directory /var/www/character-building-program>
    AllowOverride All
    Require all granted
</Directory>
```

```bash
sudo a2enmod rewrite && sudo systemctl reload apache2   # or your web server's name
```

nginx has no `.htaccess`; give the same paths explicitly:

```nginx
root /var/www/character-building-program;
location /api/ { try_files $uri /php/api.php?r=$uri; }
location /cache-clear { try_files $uri /public/cache-clear.php; }
location / { try_files $uri $uri/ /public/index.html; }
location ~ ^/(css|js)/ { root /var/www/character-building-program/public; }
location ~ \.php$ { include snippets/fastcgi-php.conf; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }
```

### Restarting the backend (which command?)

The new code is loaded by a **process**, so a `git pull` alone is not enough.
There is no single service name — `apache2`, `php8.2-fpm`, `httpd`, `nginx`,
`caddy`, a Plesk stack or a hand-started `php -S` are all possible, and guessing
gives you `Unit php8.2-fpm.service not found.` / `Unit apache2.service not found.`
Instead, ask the machine:

```bash
bash tools/which-backend.sh            # read-only: names the process answering + the restart to use
sudo bash tools/restart-backend.sh --yes   # restarts just that process, then asks /api/health
```

`restart-backend.sh` is a dry run without `--yes`: it finds the process serving
this folder through `/proc` (Node under pm2 → `pm2 restart <pid>`; Node under
systemd → `systemctl restart <unit>`; a hand-started `node server/server.js` or
`php -S` → kill it and start the same command line again) and otherwise falls back
to PHP-FPM / apache2 / httpd / nginx. Then it prints what `/api/health` and
`/build.json` answer.

It prints this folder's commit and build marker (and whether `php/api.php` has
the `/api/health` route), the listening ports, the PHP/Node processes, the
installed web/PHP services, what the local API answers, and then the restart
command for what it found. If you would rather look yourself:

```bash
ss -ltnp | grep -E ':(80|443|8080|3000)'                        # what is listening, with PIDs
ps -ef | grep -Ei 'php|node|nginx|apache|httpd|caddy' | grep -v grep
systemctl list-units --type=service --no-legend | grep -Ei 'php|apache|httpd|nginx|node'

sudo systemctl restart apache2        # Apache + mod_php (this repo's .htaccess)
sudo systemctl restart httpd          # same, on distros that name it httpd
sudo systemctl restart "php$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')-fpm"   # nginx + FPM
sudo systemctl restart nginx          # only if nginx is in front of it
pm2 restart <app>                     # Node backend (or: systemctl restart <service>)
# php -S dev server: kill the PID shown above, then start the same command again
# Plesk: Tools & Settings > Services Management > restart the web server
```

Then confirm the running build (this needs no browser):

```bash
curl -s http://127.0.0.1/api/health      # add -H 'Host: your-domain' if the vhost needs it
curl -s https://your-site/api/health     # build 2026-10-18-period-marks, reports.module-performers, routes 69
curl -s https://your-site/build.json     # must show the same build
```

The API suite covers every seeded login, the per-portal role rules (schools /
organization / family / married), the supervisor 100-user cap, account colour,
both console dashboards (including `/super/overview`, whose missing `tenants`
used to 500 the super dashboard), the ranked *Student progress* report (ordering,
level, recent work, period-based module top 10s and role scoping), reports,
certificates and the participant flow. It prints a PASS/FAIL summary and exits
non-zero if anything fails.

Run the PHP build without Apache (useful for local testing — `php -S` does not
read `.htaccess`, so the bundled router does the rewriting):

```bash
php -S 127.0.0.1:8080 -t . tools/php-router.php
```

---

## Feature map

### Super admin (`/super`)
- **Portals** — create/edit/disable any portal with schedule windows
  (`MM-DD → MM-DD`). Schools default: **Feb 1 → Sep 20** and **Oct 1 → Feb 1**;
  if no dates are selected the portal is *inactive*. Family & Married portals
  are always active. Custom portals can be added at any time.
- **Accounts** — create each school/organization with its own admin, slug URL,
  school logo and program logo; see everything about each account.
- **Modules** — the three seeded modules (GAMMA/BETA/ALPHA) plus the ability to
  add more, set certificate names, summary prompts/colours and completion video.
- **Top performers** — dropdown views for the top 10 learners in each module
  and the top 10 graduates who completed the full programme.
- **Library** — upload every book (PDF), letter and video; modules *pick* their
  content from this library. A PDF stays shut until it is clicked: listings and
  previews show a small cover card ("Open book"), and only then does the reader
  start — one page at a time with page-turn arrows either side of the sheet,
  `←`/`→` keys, a page counter (`Page 3 of 12`) and a full-page mode, never a
  long scrolling document. Every page is shown WHOLE inside the sheet (the
  viewer fits the page, so the text may be smaller but nothing is cut off) and
  the viewer's scrollbar strip is covered rather than cropped.
- **Books & Chapters** — set chapters (title, content, page ranges) and enter
  the objective questions (question, options, correct answer). The page picker
  offers **every page of the book** (it reads the page count from the PDF linked
  to the book and you can type a total, tick a range, tick all pages or clear),
  and it wraps below the title field inside a scrollable box so it always fits
  the page — in the super console and in each account's console.
- **MODE: SUMMARY chapters (Module 1)** are answered by **typing**, never by
  selecting. Each chapter carries **key words** taken from its own text (or set
  by an admin): the learner sees them before typing, their answer is scored on
  how many it uses, and the score, the words used and the words still missing
  are shown to the learner and to the office in the progress report.
- **Users / Reports / Settings** — all users across all tenants, all
  submissions with copy-similarity flags (each flag names the learner **and the
  person whose work it matched**), program name/logo, letter & letter
- **Analytics** — the whole picture in one place: impact indices (involvement,
  completion, certificates, average progress, key-word coverage, objective
  accuracy, original work, activity in the last 14 days), graphs of weekly
  activity, new learners, per-portal and per-account performance, progress
  distribution, module funnel and per-chapter completion, plus tables for
  accounts, modules → books → chapters and every individual. Filters for portal,
  account, module and period; every table exports to print/PDF/Excel/Word.
  Each **account admin has the same Analytics view limited to their own account**
  (a supervisor sees only the members they look after) — never another account's
  data, and every copy flag is shown together with the person it is connected to.
  video, credentials.

### School / Organization admin (`/admin`, also used by supervisors)
- Users (students, teachers, members), supervisors with **100-user limit**.
  **Self-registration is disabled** — only super admin, tenant admins and
  supervisors add users (single form or **bulk insert** up to 500 CSV rows).
- **Student progress → Top performers** — view the top 10 per module for a
  selected calendar year and custom date range, ranked by marks earned during
  that period. Admins can choose a combined percentage (objective-question
  accuracy and written-answer keyword scores, with each scored activity weighted
  equally) or objective-question marks only. The all-modules view ranks period
  marks across modules and includes only learners who had completed every module
  by the selected period's end. Tenant admins see only their account, and
  supervisors see only their assigned learners. The graduation ranking remains
  available separately.
- Own library uploads, picking books into modules, chapters, and **all
  questions** (school/org admin or super admin only).
- Submissions & copy-flags for their own people, certificates, branding —
  including an **account colour** that repaints the whole school/org layout
  (console, menus, buttons, the account login page and the participant app).

### Participant flow (`/app`)
1. **Registration** — name, email (teachers) or student number (students),
   class, photo, password. Data is scoped to the account only.
2. **First login** — the Letter from Christ video pops over the letter; it can
   be closed at any time and *pins itself to the corner*; letter feedback is
   mandatory before continuing; then an **optional** video pops (dismissable).
   Neither appears again once feedback is submitted.
3. **Modules page** — module 1 active, others locked; finishing and submitting
   everything in a module closes it and opens the next.
4. **Module 1 — GAMMA (Building Character/Foundation)** — 3 books (more can be
   added), chapters unlock one after another with **typed-only** summaries
   (paste disabled, date/time shown, copy detection vs other students), a
   letter unlocks after all chapters of a book, then the next book; at the end:
   best-book prompt → completion video → **GAMMA CERTIFICATE**. Each chapter
   shows the **key words** of its own text and the typed answer is scored on how
   many of them it uses (score + words still missing are shown straight away).
   While a chapter is open only **that chapter's pages** may be read: clicking
   the chapter opens its page range straight away (with a **Close** button that
   leaves a cover to reopen it), the reader can only turn pages — never scroll —
   and **no full-book PDF is offered on that page** at all. The sheet is fitted to
   the page's **own shape** and to the space it has, so the whole page is visible:
   the page is scaled down (its print gets smaller) instead of being cropped, and
   it changes shape for a square or landscape page rather than assuming A4. Only
   the chapter that is open **now** responds to clicks: a chapter that has been
   **submitted** and one that is **not unlocked yet** are both **inactive** — drawn
   as disabled buttons (dimmed, lock glyph on the locked ones, the reason on
   hover) with **no click handler at all**, so clicking them changes nothing, and
   neither reveals its text, its pages or a form. Submitting into one is refused
   by both backends anyway (`Submit previous chapters first`, 403).
5. **Module 2 — BETA (Personal Relationship & Applied Psychology)** — 3 books,
   chapters end with **objectives shuffled on every login**, then 3 mandatory
   colour-tagged summaries (injustices in the book → injustices in your
   community → solutions) → best book → video → **BETA CERTIFICATE**.
6. **Module 3 — ALPHA (Communication, Sex & Applied Character in Leadership)**
   — 4 books, same objective + colour-summary flow (communication, sex,
   character) → **ALPHA CERTIFICATE**.
   Completing the final module automatically graduates the learner and awards
   the **GENERAL CERTIFICATE** plus a printable transcript with each module's
   performance and objectives score.
7. **Books** stay shut while a learner is working through the modules: clicking a
   chapter opens **only that chapter's pages** (with a Close button and no
   full-book control on the page), and the **whole book opens after every module
   is finished** — at the Final records level, and in the library, where the API
   withholds book files until then so it cannot be bypassed from the page.

---

## Architecture

```
character-building-program/
├─ package.json           # no dependencies; npm start / npm run fresh
├─ publish.ps1            # one-shot script to push this repo to GitHub
├─ server/
│  ├─ server.js           # HTTP server, static files, /t/<slug> pages, body parsing
│  ├─ api.js              # every REST route + progress/gating engine + copy detection
│  ├─ auth.js             # PBKDF2 password hashing, sessions, role guards
│  ├─ db.js               # JSON file store (data/db.json, atomic writes)
│  └─ seed.js             # first-run seed: portals, modules, books, questions, demo tenants
├─ public/
│  ├─ index.html          # portal landing page
│  ├─ login.html          # per-tenant register/login (own logo & branding)
│  ├─ super.html + js/super.js      # super admin console
│  ├─ admin.html + js/admin.js      # school/org admin + supervisor console
│  ├─ app.html  + js/app.js         # participant experience
│  ├─ js/common.js        # API wrapper, auth state, uploads, helpers
│  └─ css/style.css       # full design system (incl. printable certificate)
├─ data/db.json           # created on first run (git-ignored)
└─ uploads/               # uploaded PDFs/images/videos (git-ignored)
```

### Key design decisions / limitations
- **JSON file storage** keeps deployment trivial; it comfortably handles a
  school/organization rollout (thousands of records). Swap `db.js` for a real
  database if you outgrow it.
- **Copy detection** compares each free-text submission with every other user's
  submission for the same chapter/summary (Jaccard word overlap; flagged at
  ≥ 75%). It is an *assessment*, not a blocker — flagged work stays visible to
  admins in Reports/Submissions with the similarity percentage.
- **Paste prevention** is enforced in the UI *and* by a 30-character minimum
  server-side; the copy check is the safety net for retyped copying.
- File uploads arrive base64-encoded in JSON (keeps the server dependency-free);
  keep individual uploads under ~40 MB.
- Demo videos use a public sample MP4 URL — replace them with your own uploads
  in the Library and pick the completion video per module.

## Changing the port

```bash
set PORT=8080 && node server/server.js     # Windows
PORT=8080 node server/server.js            # macOS/Linux
```

## Publishing to GitHub (`jimmyyee01`)

Run `publish.ps1`, or manually:

```bash
cd character-building-program
git init
git add .
git commit -m "Character Building Program: portals, modules, certificates"
git branch -M main
git remote add origin https://github.com/jimmyyee01/character-building-program.git
git push -u origin main
```

Use a personal access token as the password, or configure SSH first.
`data/` and `uploads/` are git-ignored, so no personal data is ever pushed.
