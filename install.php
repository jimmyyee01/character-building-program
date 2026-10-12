<?php
/* =====================================================================
   install.php — one-time database installer / seeder (PHP + MySQL).
   1) Import database.sql (phpMyAdmin or: mysql -u root -p character_db < database.sql)
   2) Edit php/config.php DB credentials if needed.
   3) Open this file in the browser ONCE.
   Re-running shows "already installed" unless ?fresh=1 is appended
   (which wipes all data and reseeds — demo/dev only!).
   DELETE this file from production after installing.
   ===================================================================== */
declare(strict_types=1);
require_once __DIR__ . '/php/config.php';

header('Content-Type: text/html; charset=utf-8');
$log = [];
$fresh = isset($_GET['fresh']) && $_GET['fresh'] === '1';

try {
    $pdo = db();
    $count = (int)$pdo->query('SELECT COUNT(*) FROM portals')->fetchColumn();
    if ($count > 0 && !$fresh) {
        echo '<h2>Character Building Program — already installed</h2>';
        echo '<p>The database already contains data. Append <code>?fresh=1</code> to wipe and reseed (destroys all data).</p>';
        exit;
    }
    if ($fresh) {
        $pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach (['thoughts','certificates','submissions','objectives','chapters','books','modules','library','sessions','users','tenants','portals','settings'] as $t) {
            $pdo->exec("DELETE FROM `$t`");
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS=1');
        $log[] = 'Existing data wiped (?fresh=1).';
    }

    /* ------------------------------------------------------- helpers -- */
    $ins_setting = function () use ($pdo) {
        $stmt = $pdo->prepare('INSERT INTO settings (id,program_name,program_logo,letter_id,letter_video_id,super_username,super_salt,super_hash) VALUES (1,?,?,?,?,?,?,?)');
        $stmt->execute(['Character Building Program', null,
            'lib_christ_letter', 'lib_welcome_video',
            'superadmin', '', password_hash('SuperAdmin@123', PASSWORD_BCRYPT)]);
    };
    $ins_portal = function ($id,$key,$name,$type,$mode,$windows,$desc) use ($pdo) {
        $stmt = $pdo->prepare('INSERT INTO portals (id,`key`,name,type,schedule_mode,windows_json,enabled,description,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$key,$name,$type,$mode,jenc($windows),1,$desc,now_dt()]);
    };

    $ins_setting();
    $log[] = 'Settings + super admin created (superadmin / SuperAdmin@123).';

    $ins_portal('prt_schools','schools','Schools Portal','schools','windows',
        [['from'=>'02-01','to'=>'09-20'],['from'=>'10-01','to'=>'02-01']],
        'Active Feb 1 - Sep 20 and Oct 1 - Feb 1. Closed dates = inactive.');
    $ins_portal('prt_org','organization','Organization Portal','organization','always',[],
        'Active throughout the year.');
    $ins_portal('prt_family','family','Family Portal','family','always',[],
        'Active throughout the year.');
    $ins_portal('prt_married','married','Married Portal','married','always',[],
        'Active throughout the year.');
    $log[] = '4 portals created (schools / organization / family / married).';

    /* -------------------------------------------------------- modules - */
    $ins_module = function ($id,$key,$order,$title,$mode,$cert,$books,$prompts) use ($pdo) {
        $stmt = $pdo->prepare('INSERT INTO modules (id,`key`,`order`,title,mode,certificate_name,default_books,letter_after_book,summary_prompts_json,completion_video_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$key,$order,$title,$mode,$cert,$books,$mode==='objectives'?1:0,jenc($prompts),null,now_dt()]);
    };
    $ins_module('mod_gamma','gamma',1,'MODULE ONE — BUILDING CHARACTER / FOUNDATION','summary',
        'GAMMA CERTIFICATE (BUILDING CHARACTER / FOUNDATION)',3,[]);
    $ins_module('mod_beta','beta',2,'MODULE TWO — PERSONAL RELATIONSHIP & APPLIED PSYCHOLOGY','objectives',
        'BETA CERTIFICATE (PERSONAL RELATIONSHIP & APPLIED PSYCHOLOGY)',3,[
            ['label'=>'Show the injustices you see in the book','color'=>'#e74c3c'],
            ['label'=>'Select where you come from and submit injustices in that community','color'=>'#f39c12'],
            ['label'=>'Solutions to the injustices','color'=>'#27ae60']]);
    $ins_module('mod_alpha','alpha',3,'MODULE THREE — COMMUNICATION, SEX & APPLIED CHARACTER IN LEADERSHIP','objectives',
        'ALPHA CERTIFICATE (COMMUNICATION, SEX & APPLIED CHARACTER IN LEADERSHIP)',4,[
            ['label'=>'Summary on Communication','color'=>'#3498db'],
            ['label'=>'Summary on Sex','color'=>'#e74c3c'],
            ['label'=>'Summary on Character in Leadership','color'=>'#2ecc71']]);
    $log[] = '3 modules created (GAMMA / BETA / ALPHA).';

    /* -------------------------------------------------------- library - */
    $ins_lib = function ($id,$type,$title,$text,$url) use ($pdo) {
        $stmt = $pdo->prepare('INSERT INTO library (id,type,title,scope,`text`,url,file_name,created_at) VALUES (?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$type,$title,'global',$text,$url,null,now_dt()]);
    };
    $christ = "My Dear Friend,\n\nI have not come to condemn you, but to find you. Before you read another page of this programme, hear this: you are not a project to be corrected — you are a person to be loved, and love does not give up.\n\nI know the chapters of your story that you would rather nobody ever reads. I have seen them, and I have not looked away. The shame you carry was never meant to be carried alone; bring it to Me and trade it for peace. Where you are weak, I am patient. Where you have failed, I am not finished.\n\nCharacter is built in the quiet places: in the choice nobody applauds, in the honest word when a lie would be easier, in getting up again after falling. Every small yes to what is right is a stone laid in a foundation that will not shake.\n\nRead, think, argue, question — and then let the truth change you. I am nearer than your next breath, and I will be with you on every page of this journey.\n\nWith unending love,\nJesus Christ";
    $video = 'https://www.w3schools.com/html/mov_bbb.mp4';
    $ins_lib('lib_christ_letter','letter','The Letter from Christ',$christ,null);
    $ins_lib('lib_welcome_video','video','Welcome Video (covers the letter page)',null,$video);
    $ins_lib('lib_book_letter_1','letter','Letter of Encouragement — Foundation','You have finished the chapters of this book. Read slowly, then write your summary in your own words, from your own heart.',null);
    $ins_lib('lib_book_letter_2','letter','Letter of Encouragement — Roots','Reading without reflecting is like rain on closed ground. Send back a summary that shows what took root in you.',null);
    $ins_lib('lib_book_letter_3','letter','Letter of Encouragement — Core','Tell me plainly what changed and what you will carry forward. Honest words are more valuable than perfect borrowed words.',null);
    $ins_lib('lib_extra_book_1','book','Daily Meditations for Young Minds','Short daily readings on discipline, kindness and courage. Not part of the modules — an "other book".',null);
    $ins_lib('lib_extra_book_2','book','Letters to a Future Leader','Practical letters on servant leadership. Available in the library as an "other book".',null);
    $ins_lib('lib_extra_video_1','video','The Story of Character (library video)',null,$video);
    $log[] = 'Library seeded (letters, videos, extra books).';
    $ins_book=function($id,$moduleId,$order,$title,$letterId=null) use ($pdo){
        $stmt=$pdo->prepare('INSERT INTO books (id,module_id,scope,`order`,title,library_id,letter_id,created_at) VALUES (?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$moduleId,'global',$order,$title,null,$letterId,now_dt()]);
    };
    $ins_chapter=function($id,$bookId,$order,$title,$content) use ($pdo){
        $stmt=$pdo->prepare('INSERT INTO chapters (id,book_id,scope,`order`,title,content,page_start,page_end,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$bookId,'global',$order,$title,$content,null,null,now_dt()]);
    };
    $ins_objective=function($id,$chapterId,$order,$q,$options,$a) use ($pdo){
        $stmt=$pdo->prepare('INSERT INTO objectives (id,chapter_id,scope,`order`,question,options_json,answer_index,created_at) VALUES (?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$chapterId,'global',$order,$q,jenc($options),$a,now_dt()]);
    };
    $ins_book('book_gamma_1','mod_gamma',1,'The Foundation of Character','lib_book_letter_1');
    $ins_chapter('book_gamma_1_ch1','book_gamma_1',1,'Chapter 1 — The Choice to Build','Every life is a building. Before the first stone is laid the builder must decide what the structure will stand for. Character is that decision repeated daily. When no one is watching, when nothing is gained and nothing lost, the small choices quietly pour the concrete of who we are becoming. This chapter invites you to inspect the ground beneath your own foundation and to choose, on purpose, the values you will build upon.');
    $ins_chapter('book_gamma_1_ch2','book_gamma_1',2,'Chapter 2 — Stones of Integrity','Integrity is wholeness — the agreement between what we say, what we do and what we believe. A single dishonest stone weakens an entire wall, yet integrity is not perfection. It is the courage to return to truth quickly, to repair what was broken and to let our private conduct match our public words. In this chapter you will gather the stones of honesty, responsibility and humility and lay them one upon another.');
    $ins_chapter('book_gamma_1_ch3','book_gamma_1',3,'Chapter 3 — Weathering the Storm','Foundations are proven in the storm, not in the sunshine. Pressure reveals cracks that calm never shows. When disappointment, temptation or grief arrives, character decides whether we bend with grace or collapse in bitterness. This chapter equips you with habits of resilience: gratitude in trial, patience in delay and hope in darkness, so that when the winds come, your building stands.');
    $ins_book('book_gamma_2','mod_gamma',2,'Roots of Righteous Living','lib_book_letter_2');
    $ins_chapter('book_gamma_2_ch1','book_gamma_2',1,'Chapter 1 — The Hidden Root System','Trees are measured by their fruit, but fruit is decided by roots. Beneath the visible life of a person lies a hidden system of beliefs, habits and commitments. Water that root with truth and it will hold firm in drought; neglect it and even a tall tree falls. Here you will examine what feeds your inner life and how to plant yourself beside still waters.');
    $ins_chapter('book_gamma_2_ch2','book_gamma_2',2,'Chapter 2 — Growing in the Dark','The most important growth happens where nobody can see. Roots deepen in darkness, muscles strengthen under resistance, and character matures in secret discipline. This chapter calls you to a private life as strong as your public one: quiet prayer, honest bookkeeping of the heart, and consistency when motivation has gone.');
    $ins_chapter('book_gamma_2_ch3','book_gamma_2',3,'Chapter 3 — Fruit That Remains','Character is finally judged by what it produces in other people. Kindness, self-control, faithfulness and love are fruits that outlive us. In this closing chapter you will learn to measure your days not by achievement alone but by the good that remains in the lives you touch.');
    $ins_book('book_gamma_3','mod_gamma',3,'Building an Unshakable Core','lib_book_letter_3');
    $ins_chapter('book_gamma_3_ch1','book_gamma_3',1,'Chapter 1 — What Cannot Be Moved','A person without a core is carried by every wind of opinion. An unshakable core is a settled conviction about who you are, whose you are and what you will never trade away. This chapter helps you define your non-negotiables and to write them into the walls of your decision-making.');
    $ins_chapter('book_gamma_3_ch2','book_gamma_3',2,'Chapter 2 — The Discipline of No','Freedom is found on the far side of a well-placed no. Every refusal of what is cheap protects a yes to what is precious. You will practise the discipline of boundaries — with time, with money, with relationships — and discover that a guarded heart is a free heart.');
    $ins_chapter('book_gamma_3_ch3','book_gamma_3',3,'Chapter 3 — A Legacy in Stone','We do not inherit the earth; we hand it on. The final question of character is not what we achieved but what we deposited. This chapter turns your eyes to the generation after you and challenges you to build a core so steady that others can shelter beneath it.');
    $ins_book('book_beta_1','mod_beta',1,'The Heart of Relationships',null);
    $ins_chapter('book_beta_1_ch1','book_beta_1',1,'Chapter 1 — Why We Relate','Human beings are not designed for isolation. Relationship is the classroom where character is graded most honestly. In this chapter you will explore why connection hurts, why it heals, and how the health of your inner life shapes every friendship, family and team you belong to.');
    $ins_objective('book_beta_1_ch1_q1','book_beta_1_ch1',1,'According to the chapter, where is character most honestly graded?',['In isolation','In relationship','In competition','In wealth'],1);
    $ins_objective('book_beta_1_ch1_q2','book_beta_1_ch1',2,'What does the chapter say relationship is?',['A distraction','A classroom','A burden','A transaction'],1);
    $ins_chapter('book_beta_1_ch2','book_beta_1',2,'Chapter 2 — Injustice Between People','Wherever two people meet, the possibility of injustice appears: gossip, favouritism, silence in the face of wrong. This chapter names the injuries that relationships often hide and calls you to become a person who refuses to look away.');
    $ins_objective('book_beta_1_ch2_q1','book_beta_1_ch2',1,'Which of these is named as a hidden injury in relationships?',['Silence in the face of wrong','Generous giving','Honest apology','Patient listening'],0);
    $ins_objective('book_beta_1_ch2_q2','book_beta_1_ch2',2,'The chapter calls you to become someone who…',['looks away','refuses to look away','avoids people','judges quickly'],1);
    $ins_book('book_beta_2','mod_beta',2,'Understanding the Human Mind',null);
    $ins_chapter('book_beta_2_ch1','book_beta_2',1,'Chapter 1 — The Story We Tell Ourselves','No event reaches us untouched by interpretation. The mind is a storyteller, and the story it repeats becomes the weather of our emotions. This chapter teaches you to notice the narrative, test it against truth and rewrite what is false.');
    $ins_objective('book_beta_2_ch1_q1','book_beta_2_ch1',1,'The mind is described in the chapter as…',['a camera','a storyteller','a machine without feeling','a mirror'],1);
    $ins_objective('book_beta_2_ch1_q2','book_beta_2_ch1',2,'What do repeated thoughts become?',['nothing','tendencies','instant wisdom','forgotten'],1);
    $ins_chapter('book_beta_2_ch2','book_beta_2',2,'Chapter 2 — Patterns, Habits and Freedom','Every habit is a path worn through the forest of the mind. Repeated thoughts become tendencies, and tendencies become destiny. Here you will learn how to interrupt destructive patterns and carve new trails through practice, community and accountability.');
    $ins_objective('book_beta_2_ch2_q1','book_beta_2_ch2',1,'A habit is compared to…',['a path worn through a forest','a locked door','a falling star','a written law'],0);
    $ins_objective('book_beta_2_ch2_q2','book_beta_2_ch2',2,'Which helps interrupt destructive patterns?',['avoidance','practice, community and accountability','silence','speed'],1);
    $ins_book('book_beta_3','mod_beta',3,'Psychology in Daily Life',null);
    $ins_chapter('book_beta_3_ch1','book_beta_3',1,'Chapter 1 — Pressure and the Person','Stress does not create character; it exposes it. Under pressure the mind narrows, the temper shortens and old wounds resurface. This chapter gives you practical tools — breathing, perspective and prayer — to widen the space between stimulus and response.');
    $ins_objective('book_beta_3_ch1_q1','book_beta_3_ch1',1,'Stress does not create character; it…',['hides it','exposes it','destroys it','improves it'],1);
    $ins_objective('book_beta_3_ch1_q2','book_beta_3_ch1',2,'The chapter suggests widening the space between…',['work and rest','stimulus and response','question and answer','plan and result'],1);
    $ins_chapter('book_beta_3_ch2','book_beta_3',2,'Chapter 2 — The Psychology of Fairness','A sense of injustice is one of the strongest emotions humans feel. Left unexamined it poisons; examined rightly it mobilises. In this chapter you will distinguish between righteous anger and bitter resentment, and learn to respond to wrong without becoming wrong.');
    $ins_objective('book_beta_3_ch2_q1','book_beta_3_ch2',1,'Unexamined injustice…',['poisons','heals','ignores itself','disappears'],0);
    $ins_objective('book_beta_3_ch2_q2','book_beta_3_ch2',2,'Righteous anger properly examined…',['destroys','mobilises','avoids','forgets'],1);
    $ins_book('book_alpha_1','mod_alpha',1,'The Power of Communication',null);
    $ins_chapter('book_alpha_1_ch1','book_alpha_1',1,'Chapter 1 — Words That Build','Communication is the vehicle of leadership. Words can construct a person for years or demolish them in seconds. This chapter studies the anatomy of life-giving speech: truth spoken in love, timing, tone and the discipline of listening twice before speaking once.');
    $ins_objective('book_alpha_1_ch1_q1','book_alpha_1_ch1',1,'Communication is described as the vehicle of…',['fortune','leadership','entertainment','conflict'],1);
    $ins_objective('book_alpha_1_ch1_q2','book_alpha_1_ch1',2,'The chapter advises listening…',['once before speaking twice','twice before speaking once','never','only when asked'],1);
    $ins_chapter('book_alpha_1_ch2','book_alpha_1',2,'Chapter 2 — When Silence Speaks','Sometimes the bravest communication is silence — refusing to repeat gossip, refusing to defend the indefensible. This chapter explores listening as leadership and the courage of measured words in a loud age.');
    $ins_objective('book_alpha_1_ch2_q1','book_alpha_1_ch2',1,'The bravest communication in some moments is…',['shouting','silence','gossip','speed'],1);
    $ins_objective('book_alpha_1_ch2_q2','book_alpha_1_ch2',2,'Silence can be used to refuse to…',['learn','repeat gossip','lead','listen'],1);
    $ins_book('book_alpha_2','mod_alpha',2,'Purity & Purpose',null);
    $ins_chapter('book_alpha_2_ch1','book_alpha_2',1,'Chapter 1 — Desire and Direction','Desire is not the enemy; direction decides whether it blesses or breaks. This chapter treats the subject of sex with honesty and reverence, presenting self-control not as repression but as the protection of something valuable for its intended place.');
    $ins_objective('book_alpha_2_ch1_q1','book_alpha_2_ch1',1,'The chapter presents self-control as…',['repression','the protection of something valuable','weakness','optional'],1);
    $ins_objective('book_alpha_2_ch1_q2','book_alpha_2_ch1',2,'What decides whether desire blesses or breaks?',['luck','direction','age','wealth'],1);
    $ins_chapter('book_alpha_2_ch2','book_alpha_2',2,'Chapter 2 — Honesty in a Hidden Age','A screen hides many things, yet nothing is hidden forever. This chapter addresses the private battles of the digital age and calls for accountability, honesty and grace that tells the truth early.');
    $ins_objective('book_alpha_2_ch2_q1','book_alpha_2_ch2',1,'The chapter says nothing is hidden forever, so we need…',['more secrecy','accountability, honesty and grace','speed','indifference'],1);
    $ins_objective('book_alpha_2_ch2_q2','book_alpha_2_ch2',2,'Grace that tells the truth early is called…',['cruelty','honesty','delay','judgement'],1);
    $ins_book('book_alpha_3','mod_alpha',3,'Character in Leadership',null);
    $ins_chapter('book_alpha_3_ch1','book_alpha_3',1,'Chapter 1 — Authority Under Authority','Leadership without accountability becomes tyranny. The leader who submits their own conduct to truth, counsel and correction earns the right to be followed. This chapter explores character as the only floor beneath the ceiling of authority.');
    $ins_objective('book_alpha_3_ch1_q1','book_alpha_3_ch1',1,'Leadership without accountability becomes…',['tyranny','service','friendship','growth'],0);
    $ins_objective('book_alpha_3_ch1_q2','book_alpha_3_ch1',2,'Character is described as…',['the ceiling of authority','the floor beneath the ceiling of authority','a decoration','optional'],1);
    $ins_chapter('book_alpha_3_ch2','book_alpha_3',2,'Chapter 2 — Serving From the Front','Great leaders carry what they ask others to carry. Service is not the opposite of leadership but its proof. Here you will study the humility that turns a title into trust.');
    $ins_objective('book_alpha_3_ch2_q1','book_alpha_3_ch2',1,'Service is…',['the opposite of leadership','the proof of leadership','a weakness','irrelevant'],1);
    $ins_objective('book_alpha_3_ch2_q2','book_alpha_3_ch2',2,'What does humility turn a title into?',['fear','trust','noise','distance'],1);
    $ins_book('book_alpha_4','mod_alpha',4,'Leading with Integrity',null);
    $ins_chapter('book_alpha_4_ch1','book_alpha_4',1,'Chapter 1 — The Leader Everyone Sees','People forgive imperfect plans; they never forget compromised character. This chapter shows how consistency between promise and performance becomes a leader’s strongest credential.');
    $ins_objective('book_alpha_4_ch1_q1','book_alpha_4_ch1',1,'People forgive imperfect…',['plans','money','friends','weather'],0);
    $ins_objective('book_alpha_4_ch1_q2','book_alpha_4_ch1',2,'The strongest credential of a leader is…',['style','consistency between promise and performance','salary','connections'],1);
    $ins_chapter('book_alpha_4_ch2','book_alpha_4',2,'Chapter 2 — Decisions at the Crossroads','Every crossroad has a cheap route and a right route. This chapter gives a framework for decisions made under pressure: truth first, people always, speed last.');
    $ins_objective('book_alpha_4_ch2_q1','book_alpha_4_ch2',1,'The decision framework given is: truth first, people always, …',['speed last','profit first','pride last','power first'],0);
    $ins_objective('book_alpha_4_ch2_q2','book_alpha_4_ch2',2,'The crossroads offers a cheap route and a…',['fast route','right route','wide route','silent route'],1);
    $log[] = '10 module books seeded (chapters + objectives).';

    /* -------------------------------------------------- demo tenants -- */
    $ins_tenant = function ($id,$portalId,$type,$slug,$name) use ($pdo) {
        $stmt = $pdo->prepare('INSERT INTO tenants (id,portal_id,type,slug,name,logo,program_logo,created_at) VALUES (?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$portalId,$type,$slug,$name,null,null,now_dt()]);
    };
    $ins_user = function ($tenantId,$role,$fullName,$email,$sn,$class,$pw,$supId=null,$supCode=null) use ($pdo) {
        $id = uid('usr');
        $stmt = $pdo->prepare('INSERT INTO users (id,tenant_id,role,supervisor_id,supervisor_code,username,full_name,email,student_number,class_name,photo,salt,password_hash,letter_feedback_at,letter_feedback,optional_video_seen,watched_videos_json,suspended,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([$id,$tenantId,$role,$supId,$supCode,null,$fullName,$email,$sn,$class,null,'',
            password_hash($pw,PASSWORD_BCRYPT),null,null,0,jenc([]),0,now_dt()]);
        return $id;
    };
    $ins_tenant('ten_greenfield','prt_schools','schools','greenfield-academy','Greenfield Academy');
    $ins_tenant('ten_horizon','prt_org','organization','horizon-alliance','Horizon Alliance');
    $ins_tenant('ten_beloved','prt_family','family','beloved-family','Beloved Family');
    $ins_tenant('ten_covenant','prt_married','married','covenant-couples','Covenant Couples');
    $log[] = '4 demo accounts created (school / organization / family / married).';

    $ins_user('ten_greenfield','tenant_admin','Greenfield Admin','admin@greenfield.edu',null,null,'Admin@123');
    $ins_user('ten_greenfield','teacher','Martha Teachwell','teacher@greenfield.edu',null,null,'Teacher@123');
    $ins_user('ten_greenfield','student','Jane Student',null,'STU-001','Grade 10A','Student@123');
    $ins_user('ten_greenfield','student','John Student',null,'STU-002','Grade 10A','Student@123');
    $ins_user('ten_horizon','tenant_admin','Horizon Admin','admin@horizon.org',null,null,'Admin@123');
    $supId = $ins_user('ten_horizon','supervisor','Sam Supervisor','supervisor@horizon.org',null,null,'Super@123',null,'SUP-7788');
    $ins_user('ten_horizon','member','Olive Worker','olive@horizon.org',null,null,'Member@123',$supId,null);
    $ins_user('ten_beloved','tenant_admin','Family Admin','admin@family.example',null,null,'Admin@123');
    $ins_user('ten_covenant','tenant_admin','Married Admin','admin@married.example',null,null,'Admin@123');
    $log[] = 'Demo users created (admins, teacher, students, supervisor + member).';

    echo '<h2>Character Building Program — installed successfully</h2><ul>';
    foreach ($log as $line) echo '<li>' . htmlspecialchars($line) . '</li>';
    echo '</ul><p><b>Super admin:</b> superadmin / SuperAdmin@123<br>';
    echo '<b>Demo school:</b> /t/greenfield-academy (student STU-001 / Student@123)</p>';
    echo '<p style="color:#a00"><b>Delete install.php from production now.</b></p>';
} catch (Throwable $e) {
    http_response_code(500);
    echo '<h2>Installation failed</h2><p>' . htmlspecialchars($e->getMessage()) . '</p>';
}


