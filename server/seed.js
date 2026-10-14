'use strict';
/* First-run seed: creates the super admin, the four default portals, the three
   modules, the global library, module books with chapters and objectives, plus
   demo tenants so the system can be explored immediately. */

const fs = require('fs');
const dbm = require('./db');
const auth = require('./auth');

const FRESH = process.argv.includes('--fresh');
const uid = dbm.uid;

function iso() { return new Date().toISOString(); }

function pw(password) { return auth.hashPassword(password); }

function makeUser(o) {
  const h = pw(o.password);
  return {
    id: uid('usr'),
    tenantId: o.tenantId || null,
    role: o.role || 'member',
    supervisorId: o.supervisorId || null,
    fullName: o.fullName || '',
    email: o.email || null,
    studentNumber: o.studentNumber || null,
    className: o.className || null,
    photo: o.photo || null,
    salt: h.salt,
    passwordHash: h.hash,
    createdAt: iso(),
    letterFeedbackAt: null,
    optionalVideoSeen: false,
    watchedVideos: [],
    suspended: false
  };
}

/* ---------------------------------------------------------------- books ---- */
/* mode "summary"     -> Module 1: typed chapter summaries + a letter per book
   mode "objectives"  -> Modules 2/3: shuffled objectives + 3 colour summaries */

const BOOK_DEFS = [
  { mk: 'gamma', title: 'The Foundation of Character', chapters: [
    { t: 'Chapter 1 — The Choice to Build', c: 'Every life is a building. Before the first stone is laid the builder must decide what the structure will stand for. Character is that decision repeated daily. When no one is watching, when nothing is gained and nothing lost, the small choices quietly pour the concrete of who we are becoming. This chapter invites you to inspect the ground beneath your own foundation and to choose, on purpose, the values you will build upon.' },
    { t: 'Chapter 2 — Stones of Integrity', c: 'Integrity is wholeness — the agreement between what we say, what we do and what we believe. A single dishonest stone weakens an entire wall, yet integrity is not perfection. It is the courage to return to truth quickly, to repair what was broken and to let our private conduct match our public words. In this chapter you will gather the stones of honesty, responsibility and humility and lay them one upon another.' },
    { t: 'Chapter 3 — Weathering the Storm', c: 'Foundations are proven in the storm, not in the sunshine. Pressure reveals cracks that calm never shows. When disappointment, temptation or grief arrives, character decides whether we bend with grace or collapse in bitterness. This chapter equips you with habits of resilience: gratitude in trial, patience in delay and hope in darkness, so that when the winds come, your building stands.' }
  ]},
  { mk: 'gamma', title: 'Roots of Righteous Living', chapters: [
    { t: 'Chapter 1 — The Hidden Root System', c: 'Trees are measured by their fruit, but fruit is decided by roots. Beneath the visible life of a person lies a hidden system of beliefs, habits and commitments. Water that root with truth and it will hold firm in drought; neglect it and even a tall tree falls. Here you will examine what feeds your inner life and how to plant yourself beside still waters.' },
    { t: 'Chapter 2 — Growing in the Dark', c: 'The most important growth happens where nobody can see. Roots deepen in darkness, muscles strengthen under resistance, and character matures in secret discipline. This chapter calls you to a private life as strong as your public one: quiet prayer, honest bookkeeping of the heart, and consistency when motivation has gone.' },
    { t: 'Chapter 3 — Fruit That Remains', c: 'Character is finally judged by what it produces in other people. Kindness, self-control, faithfulness and love are fruits that outlive us. In this closing chapter you will learn to measure your days not by achievement alone but by the good that remains in the lives you touch.' }
  ]},
  { mk: 'gamma', title: 'Building an Unshakable Core', chapters: [
    { t: 'Chapter 1 — What Cannot Be Moved', c: 'A person without a core is carried by every wind of opinion. An unshakable core is a settled conviction about who you are, whose you are and what you will never trade away. This chapter helps you define your non-negotiables and to write them into the walls of your decision-making.' },
    { t: 'Chapter 2 — The Discipline of No', c: 'Freedom is found on the far side of a well-placed no. Every refusal of what is cheap protects a yes to what is precious. You will practise the discipline of boundaries — with time, with money, with relationships — and discover that a guarded heart is a free heart.' },
    { t: 'Chapter 3 — A Legacy in Stone', c: 'We do not inherit the earth; we hand it on. The final question of character is not what we achieved but what we deposited. This chapter turns your eyes to the generation after you and challenges you to build a core so steady that others can shelter beneath it.' }
  ]},
  { mk: 'beta', title: 'The Heart of Relationships', chapters: [
    { t: 'Chapter 1 — Why We Relate', c: 'Human beings are not designed for isolation. Relationship is the classroom where character is graded most honestly. In this chapter you will explore why connection hurts, why it heals, and how the health of your inner life shapes every friendship, family and team you belong to.' },
    { t: 'Chapter 2 — Injustice Between People', c: 'Wherever two people meet, the possibility of injustice appears: gossip, favouritism, silence in the face of wrong. This chapter names the injuries that relationships often hide and calls you to become a person who refuses to look away.' }
  ], objectives: [
    [{ q: 'According to the chapter, where is character most honestly graded?', o: ['In isolation', 'In relationship', 'In competition', 'In wealth'], a: 1 },
     { q: 'What does the chapter say relationship is?', o: ['A distraction', 'A classroom', 'A burden', 'A transaction'], a: 1 }],
    [{ q: 'Which of these is named as a hidden injury in relationships?', o: ['Silence in the face of wrong', 'Generous giving', 'Honest apology', 'Patient listening'], a: 0 },
     { q: 'The chapter calls you to become someone who…', o: ['looks away', 'refuses to look away', 'avoids people', 'judges quickly'], a: 1 }]
  ]},
  { mk: 'beta', title: 'Understanding the Human Mind', chapters: [
    { t: 'Chapter 1 — The Story We Tell Ourselves', c: 'No event reaches us untouched by interpretation. The mind is a storyteller, and the story it repeats becomes the weather of our emotions. This chapter teaches you to notice the narrative, test it against truth and rewrite what is false.' },
    { t: 'Chapter 2 — Patterns, Habits and Freedom', c: 'Every habit is a path worn through the forest of the mind. Repeated thoughts become tendencies, and tendencies become destiny. Here you will learn how to interrupt destructive patterns and carve new trails through practice, community and accountability.' }
  ], objectives: [
    [{ q: 'The mind is described in the chapter as…', o: ['a camera', 'a storyteller', 'a machine without feeling', 'a mirror'], a: 1 },
     { q: 'What do repeated thoughts become?', o: ['nothing', 'tendencies', 'instant wisdom', 'forgotten'], a: 1 }],
    [{ q: 'A habit is compared to…', o: ['a path worn through a forest', 'a locked door', 'a falling star', 'a written law'], a: 0 },
     { q: 'Which helps interrupt destructive patterns?', o: ['avoidance', 'practice, community and accountability', 'silence', 'speed'], a: 1 }]
  ]},
  { mk: 'beta', title: 'Psychology in Daily Life', chapters: [
    { t: 'Chapter 1 — Pressure and the Person', c: 'Stress does not create character; it exposes it. Under pressure the mind narrows, the temper shortens and old wounds resurface. This chapter gives you practical tools — breathing, perspective and prayer — to widen the space between stimulus and response.' },
    { t: 'Chapter 2 — The Psychology of Fairness', c: 'A sense of injustice is one of the strongest emotions humans feel. Left unexamined it poisons; examined rightly it mobilises. In this chapter you will distinguish between righteous anger and bitter resentment, and learn to respond to wrong without becoming wrong.' }
  ], objectives: [
    [{ q: 'Stress does not create character; it…', o: ['hides it', 'exposes it', 'destroys it', 'improves it'], a: 1 },
     { q: 'The chapter suggests widening the space between…', o: ['work and rest', 'stimulus and response', 'question and answer', 'plan and result'], a: 1 }],
    [{ q: 'Unexamined injustice…', o: ['poisons', 'heals', 'ignores itself', 'disappears'], a: 0 },
     { q: 'Righteous anger properly examined…', o: ['destroys', 'mobilises', 'avoids', 'forgets'], a: 1 }]
  ]},
  { mk: 'alpha', title: 'The Power of Communication', chapters: [
    { t: 'Chapter 1 — Words That Build', c: 'Communication is the vehicle of leadership. Words can construct a person for years or demolish them in seconds. This chapter studies the anatomy of life-giving speech: truth spoken in love, timing, tone and the discipline of listening twice before speaking once.' },
    { t: 'Chapter 2 — When Silence Speaks', c: 'Sometimes the bravest communication is silence — refusing to repeat gossip, refusing to defend the indefensible. This chapter explores listening as leadership and the courage of measured words in a loud age.' }
  ], objectives: [
    [{ q: 'Communication is described as the vehicle of…', o: ['fortune', 'leadership', 'entertainment', 'conflict'], a: 1 },
     { q: 'The chapter advises listening…', o: ['once before speaking twice', 'twice before speaking once', 'never', 'only when asked'], a: 1 }],
    [{ q: 'The bravest communication in some moments is…', o: ['shouting', 'silence', 'gossip', 'speed'], a: 1 },
     { q: 'Silence can be used to refuse to…', o: ['learn', 'repeat gossip', 'lead', 'listen'], a: 1 }]
  ]},
  { mk: 'alpha', title: 'Purity & Purpose', chapters: [
    { t: 'Chapter 1 — Desire and Direction', c: 'Desire is not the enemy; direction decides whether it blesses or breaks. This chapter treats the subject of sex with honesty and reverence, presenting self-control not as repression but as the protection of something valuable for its intended place.' },
    { t: 'Chapter 2 — Honesty in a Hidden Age', c: 'A screen hides many things, yet nothing is hidden forever. This chapter addresses the private battles of the digital age and calls for accountability, honesty and grace that tells the truth early.' }
  ], objectives: [
    [{ q: 'The chapter presents self-control as…', o: ['repression', 'the protection of something valuable', 'weakness', 'optional'], a: 1 },
     { q: 'What decides whether desire blesses or breaks?', o: ['luck', 'direction', 'age', 'wealth'], a: 1 }],
    [{ q: 'The chapter says nothing is hidden forever, so we need…', o: ['more secrecy', 'accountability, honesty and grace', 'speed', 'indifference'], a: 1 },
     { q: 'Grace that tells the truth early is called…', o: ['cruelty', 'honesty', 'delay', 'judgement'], a: 1 }]
  ]},
  { mk: 'alpha', title: 'Character in Leadership', chapters: [
    { t: 'Chapter 1 — Authority Under Authority', c: 'Leadership without accountability becomes tyranny. The leader who submits their own conduct to truth, counsel and correction earns the right to be followed. This chapter explores character as the only floor beneath the ceiling of authority.' },
    { t: 'Chapter 2 — Serving From the Front', c: 'Great leaders carry what they ask others to carry. Service is not the opposite of leadership but its proof. Here you will study the humility that turns a title into trust.' }
  ], objectives: [
    [{ q: 'Leadership without accountability becomes…', o: ['tyranny', 'service', 'friendship', 'growth'], a: 0 },
     { q: 'Character is described as…', o: ['the ceiling of authority', 'the floor beneath the ceiling of authority', 'a decoration', 'optional'], a: 1 }],
    [{ q: 'Service is…', o: ['the opposite of leadership', 'the proof of leadership', 'a weakness', 'irrelevant'], a: 1 },
     { q: 'What does humility turn a title into?', o: ['fear', 'trust', 'noise', 'distance'], a: 1 }]
  ]},
  { mk: 'alpha', title: 'Leading with Integrity', chapters: [
    { t: 'Chapter 1 — The Leader Everyone Sees', c: 'People forgive imperfect plans; they never forget compromised character. This chapter shows how consistency between promise and performance becomes a leader’s strongest credential.' },
    { t: 'Chapter 2 — Decisions at the Crossroads', c: 'Every crossroad has a cheap route and a right route. This chapter gives a framework for decisions made under pressure: truth first, people always, speed last.' }
  ], objectives: [
    [{ q: 'People forgive imperfect…', o: ['plans', 'money', 'friends', 'weather'], a: 0 },
     { q: 'The strongest credential of a leader is…', o: ['style', 'consistency between promise and performance', 'salary', 'connections'], a: 1 }],
    [{ q: 'The decision framework given is: truth first, people always, …', o: ['speed last', 'profit first', 'pride last', 'power first'], a: 0 },
     { q: 'The crossroads offers a cheap route and a…', o: ['fast route', 'right route', 'wide route', 'silent route'], a: 1 }]
  ]}


];

/* ------------------------------------------------------------- library ---- */
const CHRIST_LETTER = [
  'My Dear Friend,',
  '',
  'I have not come to condemn you, but to find you. Before you read another page of this programme, hear this: you are not a project to be corrected — you are a person to be loved, and love does not give up.',
  '',
  'I know the chapters of your story that you would rather nobody ever reads. I have seen them, and I have not looked away. The shame you carry was never meant to be carried alone; bring it to Me and trade it for peace. Where you are weak, I am patient. Where you have failed, I am not finished.',
  '',
  'Character is built in the quiet places: in the choice nobody applauds, in the honest word when a lie would be easier, in getting up again after falling. Every small yes to what is right is a stone laid in a foundation that will not shake.',
  '',
  'Read, think, argue, question — and then let the truth change you. I am nearer than your next breath, and I will be with you on every page of this journey.',
  '',
  'With unending love,',
  'Jesus Christ'
].join('\n');

const BOOK_LETTERS = [
  ['Letter of Encouragement — Foundation', 'You have finished the chapters of this book. Do not rush the letter that follows; let what you read settle like seed in open ground. Write your summary in your own words, from your own heart, and then take the next step with courage.'],
  ['Letter of Encouragement — Roots', 'Reading without reflecting is like rain on closed ground. Take these words, turn them over, and send back a summary that shows what took root in you. The next book will open when this one has done its work.'],
  ['Letter of Encouragement — Core', 'This is the final letter of the book. Tell me plainly what changed, what challenged and what you will carry forward. Honest words, typed by your own hand, are more valuable than perfect words borrowed from another.']
];

const SAMPLE_VIDEO_URL = 'https://www.w3schools.com/html/mov_bbb.mp4';

/* ------------------------------------------------------------- portals ---- */
function defaultPortals() {
  return [
    { id: 'prt_schools', key: 'schools', name: 'Schools Portal', type: 'schools', scheduleMode: 'windows',
      windows: [{ from: '02-01', to: '09-20' }, { from: '10-01', to: '02-01' }], enabled: true,
      description: 'Active 1 February – 20 September and 1 October – 1 February. Closed dates make the portal inactive.' },
    { id: 'prt_org', key: 'organization', name: 'Organization Portal', type: 'organization', scheduleMode: 'always', windows: [], enabled: true,
      description: 'Active throughout the year.' },
    { id: 'prt_family', key: 'family', name: 'Family Portal', type: 'family', scheduleMode: 'always', windows: [], enabled: true,
      description: 'Active throughout the year.' },
    { id: 'prt_married', key: 'married', name: 'Married Portal', type: 'married', scheduleMode: 'always', windows: [], enabled: true,
      description: 'Active throughout the year.' }
  ];
}

/* ------------------------------------------------------------- modules ---- */
function defaultModules() {
  return [
    { id: 'mod_gamma', order: 1, key: 'gamma', mode: 'summary',
      title: 'MODULE ONE — BUILDING CHARACTER / FOUNDATION',
      certificateName: 'GAMMA CERTIFICATE (BUILDING CHARACTER / FOUNDATION)',
      defaultBooks: 3, letterAfterBook: true, completionVideoId: null,
      summaryPrompts: [], colors: [] },
    { id: 'mod_beta', order: 2, key: 'beta', mode: 'objectives',
      title: 'MODULE TWO — PERSONAL RELATIONSHIP & APPLIED PSYCHOLOGY',
      certificateName: 'BETA CERTIFICATE (PERSONAL RELATIONSHIP & APPLIED PSYCHOLOGY)',
      defaultBooks: 3, letterAfterBook: false, completionVideoId: null,
      summaryPrompts: [
        { label: 'Show the injustices you see in the book', color: '#e74c3c' },
        { label: 'Select where you come from and submit injustices in that community', color: '#f39c12' },
        { label: 'Submit solutions to those injustices', color: '#27ae60' }
      ],
      colors: ['#e74c3c', '#f39c12', '#27ae60'] },
    { id: 'mod_alpha', order: 3, key: 'alpha', mode: 'objectives',
      title: 'MODULE THREE — COMMUNICATION, SEX & APPLIED CHARACTER IN LEADERSHIP',
      certificateName: 'ALPHA CERTIFICATE (COMMUNICATION, SEX & APPLIED CHARACTER IN LEADERSHIP)',
      defaultBooks: 4, letterAfterBook: false, completionVideoId: null,
      summaryPrompts: [
        { label: 'Summary on Communication', color: '#3498db' },
        { label: 'Summary on Sex', color: '#e74c3c' },
        { label: 'Summary on Character in Leadership', color: '#2ecc71' }
      ],
      colors: ['#3498db', '#e74c3c', '#2ecc71'] }
  ];
}
/* --------------------------------------------------------------- build ---- */
function buildLibrary() {
  const lib = [];
  const mk = (id, type, title, text, url) => ({ id, type, title, scope: 'global', text: text || null, url: url || null, fileName: null, createdAt: iso() });
  lib.push(mk('lib_christ_letter', 'letter', 'The Letter from Christ', CHRIST_LETTER, null));
  lib.push(mk('lib_welcome_video', 'video', 'Welcome Video (covers the letter page)', null, SAMPLE_VIDEO_URL));
  BOOK_LETTERS.forEach((l, i) => lib.push(mk('lib_book_letter_' + (i + 1), 'letter', l[0], l[1], null)));
  lib.push(mk('lib_extra_book_1', 'book', 'Daily Meditations for Young Minds', 'A collection of short daily readings on discipline, kindness and courage. Not part of the modules — available in the library as an “other book”.', null));
  lib.push(mk('lib_extra_book_2', 'book', 'Letters to a Future Leader', 'Practical letters on servant leadership, written for young people preparing to carry responsibility. Available in the library as an “other book”.', null));
  lib.push(mk('lib_extra_video_1', 'video', 'The Story of Character (library video)', null, SAMPLE_VIDEO_URL));
  return lib;
}

function buildContent(modules) {
  const books = [], chapters = [], objectives = [];
  const byKey = {};
  modules.forEach(m => { byKey[m.key] = m.id; });
  const counts = {};
  BOOK_DEFS.forEach(def => {
    const moduleId = byKey[def.mk];
    counts[def.mk] = (counts[def.mk] || 0) + 1;
    const order = counts[def.mk];
    const bookId = 'book_' + def.mk + '_' + order;
    const book = { id: bookId, moduleId, scope: 'global', order, title: def.title, libraryId: null, letterId: null, createdAt: iso() };
    if (def.mk === 'gamma') book.letterId = 'lib_book_letter_' + Math.min(order, BOOK_LETTERS.length);
    def.chapters.forEach((ch, ci) => {
      const chId = bookId + '_ch' + (ci + 1);
      chapters.push({ id: chId, bookId, scope: 'global', order: ci + 1, title: ch.t, content: ch.c, pageStart: null, pageEnd: null, createdAt: iso() });
      const objs = (def.objectives && def.objectives[ci]) || [];
      objs.forEach((o, oi) => objectives.push({
        id: chId + '_q' + (oi + 1), chapterId: chId, scope: 'global', order: oi + 1,
        question: o.q, options: o.o, answerIndex: o.a, createdAt: iso()
      }));
    });
    books.push(book);
  });
  return { books, chapters, objectives };
}

function tenantUsers(t, list) {
  return list.map(o => makeUser(Object.assign({ tenantId: t.id }, o)));
}
function demoTenants() {
  const tenants = [];
  const users = [];

  const school = {
    id: 'ten_greenfield', portalId: 'prt_schools', type: 'schools', slug: 'greenfield-academy',
    name: 'Greenfield Academy', logo: null, programLogo: null, themeColor: null, createdAt: iso()
  };
  const org = {
    id: 'ten_horizon', portalId: 'prt_org', type: 'organization', slug: 'horizon-alliance',
    name: 'Horizon Alliance', logo: null, programLogo: null, themeColor: null, createdAt: iso()
  };
  const family = {
    id: 'ten_beloved', portalId: 'prt_family', type: 'family', slug: 'beloved-family',
    name: 'Beloved Family', logo: null, programLogo: null, themeColor: null, createdAt: iso()
  };
  const married = {
    id: 'ten_covenant', portalId: 'prt_married', type: 'married', slug: 'covenant-couples',
    name: 'Covenant Couples', logo: null, programLogo: null, themeColor: null, createdAt: iso()
  };
  tenants.push(school, org, family, married);

  users.push.apply(users, tenantUsers(school, [
    { role: 'tenant_admin', fullName: 'Greenfield Admin', email: 'admin@greenfield.edu', password: 'Admin@123' },
    { role: 'teacher', fullName: 'Martha Teachwell', email: 'teacher@greenfield.edu', password: 'Teacher@123' },
    { role: 'student', fullName: 'Jane Student', studentNumber: 'STU-001', className: 'Grade 10A', password: 'Student@123' },
    { role: 'student', fullName: 'John Student', studentNumber: 'STU-002', className: 'Grade 10A', password: 'Student@123' }
  ]));
  users.push.apply(users, tenantUsers(org, [
    { role: 'tenant_admin', fullName: 'Horizon Admin', email: 'admin@horizon.org', password: 'Admin@123' }
  ]));
  const supervisor = makeUser({ tenantId: org.id, role: 'supervisor', fullName: 'Sam Supervisor', email: 'supervisor@horizon.org', password: 'Super@123' });
  supervisor.supervisorCode = 'SUP-7788';
  users.push(supervisor);
  const member = makeUser({ tenantId: org.id, role: 'member', fullName: 'Olive Worker', email: 'olive@horizon.org', password: 'Member@123', supervisorId: supervisor.id });
  users.push(member);

  users.push.apply(users, tenantUsers(family, [
    { role: 'tenant_admin', fullName: 'Family Admin', email: 'admin@family.example', password: 'Admin@123' }
  ]));
  users.push.apply(users, tenantUsers(married, [
    { role: 'tenant_admin', fullName: 'Married Admin', email: 'admin@married.example', password: 'Admin@123' }
  ]));

  return { tenants, users };
}

function build() {
  const superPw = pw('SuperAdmin@123');
  const settings = {
    superAdmin: { username: 'superadmin', salt: superPw.salt, passwordHash: superPw.hash },
    programName: 'Character Building Program',
    programLogo: null,
    letterId: 'lib_christ_letter',
    letterVideoId: 'lib_welcome_video'
  };
  const portals = defaultPortals();
  const modules = defaultModules();
  const library = buildLibrary();
  const content = buildContent(modules);
  const demo = demoTenants();
  return {
    settings,
    portals,
    tenants: demo.tenants,
    users: demo.users,
    sessions: [],
    library,
    modules,
    books: content.books,
    chapters: content.chapters,
    objectives: content.objectives,
    submissions: [],
    certificates: [],
    thoughts: []
  };
}

function main() {
  if (FRESH && fs.existsSync(dbm.DB_FILE)) fs.unlinkSync(dbm.DB_FILE);
  dbm.load();
  if (!dbm.db) {
    dbm.init(build());
    console.log('[seed] Database created with super admin "superadmin" / "SuperAdmin@123"');
console.log('[seed] Portal admins (password Admin@123): admin@greenfield.edu (schools), admin@horizon.org (organization),');
console.log('[seed]                               admin@family.example (family), admin@married.example (married)');
    console.log('[seed] Demo school: /t/greenfield-academy (student STU-001 / Student@123)');
  } else {
    console.log('[seed] Existing database loaded (' + dbm.DB_FILE + ')');
  }
}

main();
module.exports = { build };



