<<<<<<< HEAD
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
```

Handy npm shortcuts: `npm run check:ui`, `npm run check:api`, `npm run check:api:php`,
`npm run check:live`, `npm run check:pages`, `npm run check:keywords`.

If you are updating an **existing PHP database**, run the migration once after
pulling (it only adds what is missing — it never touches data):

```bash
php migrate.php
```

It adds the key-word columns used to assess typed answers. Until it is run the
app still works: key words are derived from the chapter text and answers are
scored when they are read.

73 checks covering every seeded login, the per-portal role rules (schools /
organization / family / married), the supervisor 100-user cap, account colour,
dashboards + graphs, the ranked *Student progress* report (ordering, level,
recent work, role scoping), reports, certificates and the participant flow. It
prints a PASS/FAIL summary and exits non-zero if anything fails.

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
- **Library** — upload every book (PDF), letter and video; modules *pick* their
  content from this library. A PDF stays shut until it is clicked: listings and
  previews show a small cover card ("Open book"), and only then does the reader
  start — one page at a time with page-turn arrows either side of the sheet,
  `←`/`→` keys, a page counter (`Page 3 of 12`) and a full-page mode, never a
  long scrolling document.
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
  submissions with copy-similarity flags, program name/logo, letter & letter
  video, credentials.

### School / Organization admin (`/admin`, also used by supervisors)
- Users (students, teachers, members), supervisors with **100-user limit**.
  **Self-registration is disabled** — only super admin, tenant admins and
  supervisors add users (single form or **bulk insert** up to 500 CSV rows).
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
   While a chapter is open only **that chapter's pages** may be read — the book
   covers at the end of the chapter open a reader clamped to that page range.
5. **Module 2 — BETA (Personal Relationship & Applied Psychology)** — 3 books,
   chapters end with **objectives shuffled on every login**, then 3 mandatory
   colour-tagged summaries (injustices in the book → injustices in your
   community → solutions) → best book → video → **BETA CERTIFICATE**.
6. **Module 3 — ALPHA (Communication, Sex & Applied Character in Leadership)**
   — 4 books, same objective + colour-summary flow (communication, sex,
   character) → **ALPHA CERTIFICATE**.
7. **Books** stay shut while a learner is working through the modules: a chapter
   only ever opens its own page range, and the **whole book opens after every
   module is finished** (the Final records level unlocks the full readers and
   the library books). The API withholds library book files until then, so it
   cannot be bypassed from the page.

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

=======
# character-building-program
>>>>>>> 4e064eb957b22ecf9cb2bcae455206b0653637ca
