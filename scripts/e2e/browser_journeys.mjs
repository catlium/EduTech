/*
 * Phase 22 — WF-06..10 browser journey matrix against real Chrome.
 * Node builtins only (no playwright): driver in ./lib/browser.mjs.
 * Run: node scripts/e2e/browser_journeys.mjs [scenario]  (default "all")
 */
import { Page, newPage, WEB_URL } from './lib/browser.mjs';
import { launchChrome, stopChrome } from './lib/browser.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE = 5; // auth login limit per 60s per route+IP

let page;
let loginHistory = [];

async function throttleGate() {
  const now = Date.now();
  loginHistory = loginHistory.filter((t) => now - t < 60000);
  while (loginHistory.length >= THROTTLE) {
    await sleep(5000);
    const n = Date.now();
    loginHistory = loginHistory.filter((t) => n - t < 60000);
  }
  loginHistory.push(Date.now());
}

async function doLogin(email, password, expectPath) {
  if (!(await page.url()).endsWith('/login')) await page.navigate(WEB_URL + '/login');
  await page.waitForText('Sign in', { timeout: 15000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    const got = await page.eval(`document.querySelector('input[type="email"]').value`);
    if (got !== email) await sleep(300);
    await page.clickText('Sign in');
    try {
      await page.waitFor(`location.pathname === ${JSON.stringify(expectPath)}`, { timeout: 12000 });
      return;
    } catch {
      await sleep(12000); // auth throttle window
    }
  }
  const q = await page.url();
  const toasts = await page.eval(
    `[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.innerText).join(' ;; ')`,
  );
  const emailVal = await page.eval(`document.querySelector('input[type="email"]').value`);
  throw new Error(`login(${email}) failed. url=${q} toasts="${toasts}" emailVal="${emailVal}"`);
}

async function segment(i) {
  return page.eval(`location.pathname.split('/').filter(Boolean)[${i}]`);
}

/* ------------------------------------------------------------------ */
async function s01PublicVisitorAndAuth() {
  console.log('\n== S01 PUBLIC VISITOR + AUTH ==');
  const p = page;

  await p.navigate(WEB_URL + '/');
  await p.waitForText('Request a Demo', { timeout: 15000 });
  p.assert((await p.text()).includes('CatLium EduTech'), 'brand on landing');
  p.assert(
    (await p.text()).includes('Each institute gets its own controlled academic environment'),
    'institute/tenant section present',
  );
  await p.waitFor(`document.querySelectorAll('section').length >= 8`, { timeout: 12000 });
  p.assert(
    (await p.eval('document.body.innerText')).includes('20 Questions · 20 Marks'),
    'paper pattern example',
  );
  await p.screenshot('s01-landing.png');

  await p.clickText('Sign in');
  await p.waitFor(`location.pathname === '/login'`, { timeout: 15000 });
  await p.screenshot('s01-login.png');

  await p.navigate(WEB_URL + '/dashboard');
  await p.waitFor(`location.pathname === '/login'`, { timeout: 15000 });
  p.assert(true, 'anonymous /dashboard redirects to /login');

  await throttleGate();
  await doLogin('teacher@catlium.dev', 'Password123!', '/dashboard');
  await p.waitForText('Quick actions', { timeout: 15000 });
  await p.screenshot('s01-teacher-dashboard.png');

  await p.eval('location.reload()');
  await p.waitForText('Quick actions', { timeout: 25000 });
  p.assert(true, 'session persists across reload');

  await p.clickText('Sign out');
  await p.waitFor(`location.pathname === '/login'`, { timeout: 15000 });
  p.assert(true, 'logout returns to login');

  await throttleGate();
  await doLogin('student@catlium.dev', 'Password123!', '/student/dashboard');
  await p.screenshot('s01-student-dashboard.png');

  await p.navigate(WEB_URL + '/questions');
  await p.waitForText('No access', { timeout: 15000 });
  await p.screenshot('s01-student-forbidden.png');
  p.assert(true, 'student blocked from /questions');

  await p.navigate(WEB_URL + '/users');
  await p.waitForText('No access', { timeout: 15000 });
  p.assert(true, 'student blocked from /users');
  console.log('  ok S01 public visitor + auth complete');
}

/* ------------------------------------------------------------------ */
async function s02InstituteAdmin() {
  console.log('\n== S02 INSTITUTE ADMIN ==');
  const p = page;

  await throttleGate();
  await doLogin('admin@catlium.dev', 'Password123!', '/dashboard');
  await p.waitForText('Quick actions', { timeout: 15000 });
  await p.screenshot('s02-admin-dashboard.png');

  await p.navigate(WEB_URL + '/institute');
  await p.waitForText('How accounts work here', { timeout: 15000 });
  const t = await p.text();
  for (const label of ['Members', 'Teachers', 'Students', 'Subjects']) {
    p.assert(t.includes(label), `institute stat "${label}" present`);
  }
  await p.screenshot('s02-institute.png');

  await p.navigate(WEB_URL + '/users');
  await p.waitForText('Add user', { timeout: 15000 });
  await p.waitFor(
    `/admin@catlium\\.dev|No users yet|Something went wrong/.test(document.body.innerText)`,
    { timeout: 20000 },
  );
  const u = await p.text();
  for (const who of ['admin@catlium.dev', 'teacher@catlium.dev', 'student@catlium.dev']) {
    p.assert(u.includes(who), `roster contains ${who}`);
  }
  p.assert(u.includes('(you)'), 'admin self-row marked (you)');
  await p.screenshot('s02-users.png');

  const teacherEmail = `browser.teacher${Date.now()}@institute.edu`;
  await p.clickText('Add user');
  await p.waitForText('Create account', { timeout: 10000 });
  await p.fill('[name="name"]', 'Browser Teacher');
  await p.fill('[name="email"]', teacherEmail);
  await p.fill('[name="password"]', 'Password123!');
  await p.clickText('Create account');
  await p.waitFor(
    `document.body.innerText.includes(${JSON.stringify(teacherEmail.toLowerCase())})`,
    { timeout: 15000 },
  );
  p.assert(true, 'provisioned teacher appears in roster');
  await p.screenshot('s02-teacher-created.png');

  const studentEmail = `browser.student${Date.now()}@institute.edu`;
  await p.clickText('Add user');
  await p.waitForText('Create account', { timeout: 10000 });
  await p.fill('[name="name"]', 'Browser Student');
  await p.fill('[name="email"]', studentEmail);
  await p.fill('[name="password"]', 'Password123!');
  await p.selectRadix('Teacher', 'Student');
  await p.clickText('Create account');
  await p.waitFor(
    `document.body.innerText.includes(${JSON.stringify(studentEmail.toLowerCase())})`,
    { timeout: 15000 },
  );
  p.assert(true, 'provisioned student appears in roster');
  await p.screenshot('s02-student-created.png');

  // Provisioned (non-admin) teacher can log in but cannot provision users
  await throttleGate();
  await doLogin(teacherEmail, 'Password123!', '/dashboard');
  await p.navigate(WEB_URL + '/users');
  await p.waitFor(`document.body.innerText.split(/\\n+/).some(l => l.trim() === 'No access')`, {
    timeout: 15000,
  });
  p.assert(true, 'provisioned teacher blocked from /users');
  console.log('  ok S02 institute admin provisioning + boundaries complete');
  return { teacherEmail, studentEmail };
}

/* ------------------------------------------------------------------ */
async function s03Teacher() {
  console.log('\n== S03 TEACHER WORKFLOW ==');
  const p = page;
  await throttleGate();
  await doLogin('teacher@catlium.dev', 'Password123!', '/dashboard');
  await p.waitForText('Quick actions', { timeout: 15000 });
  await p.screenshot('s03-teacher-dashboard.png');

  await p.navigate(WEB_URL + '/subjects');
  await p.waitFor(`document.body.innerText.includes('Mathematics')`, { timeout: 15000 });
  await p.clickText('Mathematics', { exact: false });
  await p.waitFor(
    `location.pathname.includes('/subjects/') && !location.pathname.includes('/subjects/new')`,
    { timeout: 15000 },
  );
  const subjectId = await segment(1);
  const sd = await p.text();
  p.assert(sd.includes('Algebra'), 'subject detail shows chapters/topics');
  await p.screenshot('s03-subject-detail.png');

  await p.clickText('Algebra', { exact: false }); // expand chapter
  await p.waitFor(`document.body.innerText.includes('Linear Equations')`, { timeout: 10000 });
  await p.clickText('Linear Equations', { exact: false });
  await p.waitFor(`location.pathname.includes('/topics/')`, { timeout: 15000 });
  await p.screenshot('s03-topic.png');
  p.assert(true, 'opened chapter/topic page');

  await p.navigate(WEB_URL + `/subjects/${subjectId}/syllabus`);
  await p.waitFor(`document.body.innerText.includes('Generate AI syllabus')`, { timeout: 15000 });
  await p.screenshot('s03-syllabus.png');

  await p.navigate(WEB_URL + '/materials');
  await p.waitFor(`document.body.innerText.includes('Materials')`, { timeout: 15000 });
  await p.screenshot('s03-materials.png');

  await p.navigate(WEB_URL + '/questions');
  await p.waitForText('Question Bank', { timeout: 15000 });
  await p.screenshot('s03-questions.png');

  await p.navigate(WEB_URL + '/paper-patterns');
  await p.waitForText('Paper Patterns', { timeout: 15000 });
  await p.screenshot('s03-paper-patterns.png');

  await p.navigate(WEB_URL + '/assessments');
  await p.waitForText('Assessments', { timeout: 15000 });
  await p.screenshot('s03-assessments.png');
  console.log('  ok S03 teacher navigation complete');
}

const SCENARIOS = { s01: s01PublicVisitorAndAuth, s02: s02InstituteAdmin, s03: s03Teacher };

async function main() {
  const want = process.argv[2] || 'all';
  const results = [];
  await launchChrome();
  try {
    page = await newPage();
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      if (want !== 'all' && want !== name) continue;
      try {
        await fn();
        results.push(`PASS ${name}`);
      } catch (e) {
        let diag = '';
        try {
          const url = await page.url();
          const snip = (await page.text()).slice(-260).replace(/\n+/g, ' | ');
          diag = ` [url=${url} pageTail="${snip}"]`;
        } catch {}
        try {
          await page.screenshot(`${name}-FAIL.png`);
        } catch {}
        results.push(`FAIL ${name}: ${e.message}${diag}`);
      }
    }
  } finally {
    await stopChrome();
  }
  console.log('\nBROWSER JOURNEYS: ' + results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}

main();
