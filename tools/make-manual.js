const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableCell, TableRow, WidthType, AlignmentType } = require("docx");
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "Character_Building_Program_User_Manual.docx");
function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true, size: 32, color: "1F4E79" })] }); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true, size: 26, color: "2E74B5" })] }); }
function h3(t) { return new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, bold: true, size: 22 })] }); }
function p(t, opt) { opt = opt || {}; return new Paragraph({ alignment: opt.center ? AlignmentType.CENTER : undefined, children: [new TextRun({ text: t, bold: !!opt.bold, size: opt.size || 22, color: opt.color })] }); }
function bullets(items) { return items.map(function (t) { return new Paragraph({ text: t, bullet: { level: 0 } }); }); }
function table(headers, rows) {
  const mkRow = function (cells, bold) {
    return new TableRow({ children: cells.map(function (c) {
      return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(c), bold: !!bold, size: 20 })] })] });
    }) });
  };
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [mkRow(headers, true)].concat(rows.map(function (r) { return mkRow(r, false); })) });
}
const KIDS = [];
function add() { for (var i = 0; i < arguments.length; i++) { var a = arguments[i]; if (Array.isArray(a)) KIDS.push.apply(KIDS, a); else KIDS.push(a); } }

add(
  p("CHARACTER BUILDING PROGRAM", { center: true, bold: true, size: 48, color: "1F4E79" }),
  p("User Manual", { center: true, size: 40, color: "2E74B5" }),
  p("Multi-Portal Character-Education System", { center: true, size: 24 }),
  p("Schools - Organizations - Families - Married Couples + Custom Portals", { center: true, size: 20 }),
  p("Version: 2026-10-19-self-assessment", { center: true, size: 20 }),
  p("Written using the seeded demo data", { center: true, size: 20 }),
  h1("1. Introduction"),
  p("The Character Building Program is a complete multi-portal character-education system. It provides a super admin console, four default portals (Schools, Organization, Family, Married) plus unlimited custom portals, per-school and per-organization isolated accounts, a library-driven module engine (books, chapters, letters/summaries, certificates) and printable certificates."),
  p("Key design facts:"),
  bullets([
    "Zero dependencies on the Node backend - Node.js 16+ is the only requirement; no npm install, no build step, no database server.",
    "A PHP + MySQL backend mirrors all 80 Node endpoints (route parity is enforced by automated checks), so the same application can be deployed on shared PHP hosting.",
    "Every school/organization gets its own login URL /t/<slug> created by the super admin - nothing about one tenant is visible to another."
  ]),
  h2("1.1 What you will learn in this manual"),
  bullets([
    "How to start the application and sign in (all demo accounts).",
    "How learners take the pre-score self-assessment, read the Letter from Christ, complete modules, and take the post-score.",
    "How administrators manage users, books, reports, messaging and certificates.",
    "How the super administrator manages portals, tenants, modules, library and global settings."
  ]),
  h1("2. Getting Started"),
  h2("2.1 System requirements"),
  p("Node.js 16 or newer is the only requirement for the Node backend. For the PHP backend: PHP 8+ with MySQL/MariaDB behind Apache or Nginx."),
  h2("2.2 Starting the application"),
  p("From the project folder, run: node server/server.js (or: npm start). The server listens on port 3000 by default (override with the PORT environment variable)."),
  h2("2.3 Important URLs"),
  table(["URL", "What it is"], [
    ["http://localhost:3000/", "Landing page - all portals, live active/closed status"],
    ["http://localhost:3000/super", "Super admin login"],
    ["http://localhost:3000/t/greenfield-academy", "Demo school login page (Greenfield Academy)"],
    ["http://localhost:3000/t/horizon-alliance", "Demo organization login page (Horizon Alliance)"],
    ["http://localhost:3000/t/beloved-family", "Demo family login page (Beloved Family)"],
    ["http://localhost:3000/t/covenant-couples", "Demo married-couples login page (Covenant Couples)"]
  ]),
  h2("2.4 Resetting the demo data"),
  p("Reset the demo data any time with: npm run fresh (deletes data/db.json and re-seeds)."),
  h1("3. Demo Accounts (seeded logins)"),
  p("Use these accounts to explore every role. Change the passwords from the consoles after signing in."),
  table(["Role / account", "Username", "Password"], [
    ["Super admin", "superadmin", "SuperAdmin@123"],
    ["Schools admin (Greenfield)", "admin@greenfield.edu", "Admin@123"],
    ["Organization admin (Horizon)", "admin@horizon.org", "Admin@123"],
    ["Family admin (Beloved Family)", "admin@family.example", "Admin@123"],
    ["Married admin (Covenant Couples)", "admin@married.example", "Admin@123"],
    ["Teacher (Greenfield)", "teacher@greenfield.edu", "Teacher@123"],
    ["Student STU-001 (Greenfield)", "STU-001", "Student@123"],
    ["Student STU-002 (Greenfield)", "STU-002", "Student@123"],
    ["Demo graduate STU-100 (finished every module)", "STU-100", "Student@123"],
    ["Supervisor (Horizon)", "supervisor@horizon.org", "Super@123 (access code SUP-7788)"],
    ["Member under that supervisor", "olive@horizon.org", "Member@123"]
  ]),
  p("Tip: sign in as STU-100 to see a fully finished programme - dashboards, graphs, learner details, final records and the graduate transcript are all populated.")
);
add(
  h1("4. Self-Assessment: Pre-Score and Post-Score"),
  p("The self-assessment tool measures each learner's growth. It appears twice, using one table with two score columns:"),
  table(["Moment", "Pre-score column", "Post-score column"], [
    ["At the beginning, just before the Letter from Christ", "ACTIVE - learner rates every statement 1-5", "INACTIVE - shown greyed out, cannot be filled yet"],
    ["At the end, after the last module (Final records)", "INACTIVE - shows the saved pre-score (read-only)", "ACTIVE - learner rates every statement 1-5"]
  ]),
  h2("4.1 The 1-to-5 rating scale"),
  table(["Rating", "Meaning"], [
    ["1", "Strongly Disagree"],
    ["2", "Disagree"],
    ["3", "Neutral"],
    ["4", "Agree"],
    ["5", "Strongly Agree"]
  ]),
  h2("4.2 The five categories (20 statements, maximum total score 100)"),
  p("Faith & Spiritual Life (4 statements): daily prayer and reflection, meditating on God's Word, trusting God's plan, giving thanks."),
  p("Character & Integrity (4): telling the truth even when it costs, keeping promises, owning mistakes, choosing right over easy."),
  p("Relationships & Love (4): kindness and respect, forgiveness, patient listening, serving others."),
  p("Purpose & Discipline (4): setting and pursuing goals, managing time and habits, staying committed, using gifts fully."),
  p("Courage & Witness (4): standing for beliefs, speaking about faith with confidence, facing fears, encouraging others."),
  h2("4.3 How the learner takes it"),
  bullets([
    "Sign in. If the pre-score has never been taken, the self-assessment form appears first (it cannot be skipped).",
    "Rate every statement from 1 to 5. A live running total shows at all times (for example 0/100). Every statement must be rated.",
    "Click Save my pre-score & continue - the recorded total score is shown, and the Letter from Christ opens next.",
    "After finishing every module, open Final records. The Assessment tab opens first, with the saved pre-score shown read-only and the post-score column active.",
    "Rate every statement again and click Save my post-score. Both totals are then shown along with the growth (post minus pre)."
  ]),
  h2("4.4 Rules enforced by the server (both backends)"),
  bullets([
    "Every statement must be rated with a whole number from 1 to 5 - anything else is rejected.",
    "Each phase (pre, post) can be submitted only once.",
    "The post-score opens only after the learner has finished every module (allDone).",
    "The same definition and the same endpoints exist on the Node and PHP backends (routes in parity)."
  ])
);



add(
  h1("5. The Participant Journey (learners: students / members)"),
  h2("5.1 First login: Letter from Christ"),
  p("On first login the learner watches the welcome video (which can be pinned to the corner), reads The Letter from Christ, and must type feedback of at least 20 characters before continuing. An optional second video may follow."),
  h2("5.2 Dashboard (Home)"),
  p("The home view shows an overall performance ring, modules completed, the active module, certificates earned, copy flags, recent work, and (where relevant) the supervisor access-code prompt."),
  h2("5.3 Modules, books and chapters"),
  p("Each learner works through modules in order. Module 1 uses typed chapter summaries plus letters of encouragement per book; Modules 2 and 3 use shuffled objective questions plus colour summaries. Chapters unlock one at a time: exactly one chapter is open and clickable, the rest are locked until the open one is submitted."),
  p("Books stay shut until clicked: clicking a chapter opens only that chapter's pages (with a Close button and no full-book control on the page). The reader fits the page by width for the largest readable text; a page taller than the sheet scrolls inside it (wheel, swipe or drag reads through it), and the flick at its end turns the leaf - nothing is ever cropped. The whole book opens only after every module is finished (Final records and library)."),
  h2("5.4 Paste prevention and copy detection"),
  p("Paste is disabled in answer boxes and every free-text submission needs at least 30 characters. A copy check compares each submission with every other learner's work for the same chapter (word overlap flagged at 75% or more) - it is shown to admins as an assessment, not a blocker."),
  h2("5.5 Certificates"),
  p("Each finished module awards its own certificate (for example the ALPHA CERTIFICATE and the GAMMA CERTIFICATE). Completing the final module graduates the learner and awards the GENERAL CERTIFICATE plus a printable transcript with each module's performance and objectives score."),
  h2("5.6 Final records"),
  p("After the last module, the Final records view unlocks with tabs: Assessment (post-score first), All summaries, Thoughts, General summaries, Book questions, Library, Other books, All videos, Certificates. General summaries, thoughts and the post-score can still be submitted here."),
  h1("6. Teacher and Supervisor"),
  p("Teachers (schools) view their learners' progress, submissions and reports. Supervisors (organizations) each look after up to 100 assigned members - a 101st learner is waitlisted and the oldest waitlisted learner backfills a freed slot. A supervisor has an access code (for example SUP-7788) that learners use to link to them."),
  h2("6.1 Messaging"),
  p("Supervisors can bulk-message their own learners (one private thread per learner); learners can reply to their supervisor. A supervisor cannot message another supervisor's learner, and messages never cross tenant (account) boundaries.")
);

add(
  h1("7. School / Organization Admin Console"),
  table(["View", "What the admin does there"], [
    ["Dashboard", "Account overview, performance, recent activity"],
    ["Users", "Create/edit/suspend users; assign supervisors; the search row closes before the list sits below it"],
    ["Supervisors", "Create supervisors (access codes issued), manage the 100-learner cap and waitlist"],
    ["Library", "Upload PDFs, videos, letters, images"],
    ["Books", "Attach library books to modules, set chapter page ranges"],
    ["Submissions", "Review typed work with copy-similarity flags and percentages"],
    ["Certificates", "Issue and print module and general certificates"],
    ["Analytics", "Individuals, modules/books/chapters, weekly activity, copy flags - account-scoped only"],
    ["Progress", "Per-learner progress rings, competence, timelines, rankings and graduation transcripts"],
    ["Branding", "Own logo, tenant name and programme theme colour per login page"]
  ]),
  h1("8. Super Admin Console (/super)"),
  p("The super administrator creates portals (Schools, Organization, Family, Married and unlimited custom portals), creates each school/organization account with its own /t/<slug> login URL, manages global modules and library, views cross-portal analytics and progress reports, and configures settings. Demo portals: greenfield-academy, horizon-alliance, beloved-family, covenant-couples."),
  h1("9. Reporting and Rankings"),
  bullets([
    "Performer rankings by period marks (calendar-year and custom date ranges), top-10 learners per module, top graduates.",
    "Student detail: photo profile, competence rating, activity timeline and completion progress ring.",
    "Supervisor reporting and messaging alerts notify supervisors of completions and flags.",
    "Objective-only marks ranking shows earned and available points."
  ]),
  h1("10. Architecture and Deployment Notes"),
  p("Node backend files: server/server.js (HTTP server, static files, /t/<slug> pages), server/api.js (every REST route + progress/gating engine + copy detection), server/auth.js (PBKDF2 hashing, sessions, role guards), server/db.js (JSON file store at data/db.json with atomic writes), server/seed.js (first-run seed)."),
  p("The PHP backend (php/api.php, engine.php, routes_*.php) mirrors all 80 routes for shared hosting with MySQL (database.sql, install.php, migrate.php). Run php migrate.php after pulling updates that add columns (for example assessment_pre_json/assessment_post_json for this manual's self-assessment). Live build check: compare /api/health and /build.json - both must show build 2026-10-19-self-assessment."),
  p("Known limits: JSON file storage suits thousands of records (swap db.js for a real database if you outgrow it); uploads arrive base64-encoded in JSON (keep each under ~40 MB); demo videos use a public sample MP4 - replace them in the Library."),
  h2("10.1 Automated checks"),
  p("Run node server/server.js, then in a second terminal: node tools/api-test.js http://localhost:3000 (Node) or the :8080 variant (PHP); node tools/routes-parity-check.js; node tools/smoke-pages.js; node tools/ui-picker-check.js; node tools/ui-report-check.js; node tools/ui-pdf-check.js; node tools/ui-live-check.js http://127.0.0.1:3000; node tools/pages-api-check.js, keywords-api-check.js, analytics-api-check.js, messaging-api-check.js, reader-browser-check.js, chapter-lock-browser-check.js.")
);
var doc = new Document({ sections: [{ children: KIDS }] });
Packer.toBuffer(doc).then(function (buf) {
  fs.writeFileSync(OUT, buf);
  console.log("Wrote " + OUT + " (" + buf.length + " bytes)");
}).catch(function (e) { console.error("FATAL " + (e && e.message)); process.exit(1); });
