// End-to-end smoke test in a real browser, against the local dev server.
//
//   npm run dev                       (in one terminal; it seeds sample activities)
//   npm install --no-save playwright && npx playwright install chromium
//   node tests/e2e/smoke.mjs          (screenshots go to tests/e2e/screenshots/)
//
// Restart the dev server before each run — the test publishes and deletes activities.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8787';
const OUT = process.env.SCREENSHOTS || new URL('./screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
await ctx.route('https://classroom.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Classroom</h1>' }));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

// --- Library gate + sign-in ---
await page.goto(`${BASE}/library.html`);
await page.waitForSelector('.gate');
check('library shows teacher gate before sign-in', await page.isVisible('text=Teachers only'));
await page.screenshot({ path: `${OUT}/01-gate.png` });

// Student account is refused
await page.fill('.dev-signin input[type=email]', 'kid@students.aisa.test');
await page.click('text=Dev sign-in');
await page.waitForSelector('.gate-status.is-error');
check('student email refused', /isn’t on the teacher list/.test(await page.textContent('.gate-status')), await page.textContent('.gate-status'));

await page.fill('.dev-signin input[type=email]', 'teacher@aisa.test');
await page.click('text=Dev sign-in');
await page.waitForSelector('.activity-card');
const cards = await page.$$eval('.activity-card', (els) => els.length);
check('library lists seeded activities', cards === 5, `cards=${cards}`);
check('header shows teacher name', await page.isVisible('.user-chip'));
await page.screenshot({ path: `${OUT}/02-library.png`, fullPage: true });

await page.click('.grade-chips button:has-text("Gr 4")');
await page.waitForTimeout(100);
const g4 = await page.$$eval('.activity-card h3', (els) => els.map((e) => e.textContent));
check('grade 4 filter', g4.length >= 1 && g4.some((t) => /Fractions/.test(t)), JSON.stringify(g4));
check('grade filter in URL', page.url().includes('grade=4'));
await page.click('.grade-chips button:has-text("All grades")');
await page.fill('#q', 'cycle');
await page.waitForTimeout(300);
const qres = await page.$$eval('.activity-card h3', (els) => els.map((e) => e.textContent));
check('search cycle', qres.length === 1 && /Water/.test(qres[0]), JSON.stringify(qres));
await page.fill('#q', '');
await page.waitForTimeout(300);
await page.click('#mine');
await page.waitForTimeout(150);
const mine = await page.$$eval('.activity-card', (els) => els.length);
check('my activities filter', mine === 3, `mine=${mine}`);
await page.click('#mine');

// --- Create: paste ChatGPT-style answer ---
await page.goto(`${BASE}/index.html`);
await page.waitForSelector('#app:not([hidden])');
const pasted = "Sure! Here's a fun multiplication game for your 3rd grade class:\n\n```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<title>Times Tables Space Race</title>\n<style>body{font-family:sans-serif;background:#0b0b2b;color:#fff;text-align:center} button{font-size:1.5rem;margin:.3rem}</style>\n</head>\n<body>\n<h1>🚀 Times Tables Space Race</h1>\n<p>Answer the multiplication facts to fuel your rocket! Practice your times tables from 2 to 10.</p>\n<h2 id=\"q\"></h2><div id=\"opts\"></div><p>Score: <span id=\"s\">0</span></p>\n<a href=\"#q\">Jump to question</a>\n<script>\nlet s=0;function next(){const a=2+Math.floor(Math.random()*9),b=2+Math.floor(Math.random()*9);document.getElementById('q').textContent=`What is ${a} × ${b}?`;const o=document.getElementById('opts');o.innerHTML='';[a*b,a*b+a,a*b-b].sort(()=>Math.random()-.5).forEach(v=>{const x=document.createElement('button');x.textContent=v;x.onclick=()=>{if(v===a*b){s++;document.getElementById('s').textContent=s;localStorage.setItem('best',s)}next()};o.appendChild(x)})}next();\n</script>\n</body>\n</html>\n```\n\nLet me know if you'd like more levels!";
await page.evaluate((text) => {
  const ta = document.getElementById('code');
  ta.focus();
  ta.value = text;
  ta.dispatchEvent(new Event('paste', { bubbles: true }));
}, pasted);
await page.waitForSelector('.notice-success');
const codeVal = await page.inputValue('#code');
check('markdown fences stripped', codeVal.startsWith('<!DOCTYPE html>') && !codeVal.includes('```') && !codeVal.includes('Let me know'));
await page.waitForSelector('#preview-stage iframe');
const fr = page.frameLocator('#preview-stage iframe');
await fr.locator('h1').waitFor();
check('preview renders activity', (await fr.locator('h1').textContent()).includes('Space Race'));
await page.waitForTimeout(700);
check('title auto-filled', (await page.inputValue('#f-title')) === 'Times Tables Space Race', await page.inputValue('#f-title'));
const pressed = await page.$$eval('#grade-chips [aria-pressed=true]', (els) => els.map((e) => e.textContent));
check('grade auto-detected (3rd grade)', JSON.stringify(pressed) === '["3"]', JSON.stringify(pressed));
check('subject auto-detected', (await page.inputValue('#f-subject')) === 'Math');
check('type auto-detected', (await page.inputValue('#f-type')) === 'Game', await page.inputValue('#f-type'));
check('concept auto-detected', /Multiplication/i.test(await page.inputValue('#f-concept')), await page.inputValue('#f-concept'));
// AI (simulated in dev) should run after paste and badge fields
await page.waitForTimeout(800);
check('AI button visible', await page.isVisible('#ai-btn'));
const badges = await page.$$eval('.auto-badge:not([hidden])', (els) => els.map((e) => e.textContent));
check('auto/AI badges shown', badges.length >= 4, JSON.stringify(badges));
await page.screenshot({ path: `${OUT}/03-create.png`, fullPage: true });

// Hash link inside preview must not navigate the frame away
await fr.locator('a[href="#q"]').click();
await page.waitForTimeout(300);
check('hash link stays inside activity', (await fr.locator('h1').count()) === 1);

// Teacher edits a field: detection must not overwrite it
await page.fill('#f-concept', 'Times tables 2–10');
await page.evaluate(() => { const ta = document.getElementById('code'); ta.value = ta.value.replace('Space Race', 'Space Race!'); ta.dispatchEvent(new Event('input')); });
await page.waitForTimeout(900);
check('edited field kept after code change', (await page.inputValue('#f-concept')) === 'Times tables 2–10');

await page.click('#publish-btn');
await page.waitForURL(/view\.html\?id=/);
await page.waitForSelector('dialog[open]');
check('share dialog after publish', await page.isVisible('text=Your activity is live!'));
check('QR code rendered', (await page.$$('dialog .qr-svg')).length >= 1);
check('new=1 removed from URL', !page.url().includes('new=1'), page.url());
await page.screenshot({ path: `${OUT}/04-published.png` });
const shareLink = await page.inputValue('dialog .link-input');
check('share link is clean', /view\.html\?id=[A-Za-z0-9]+$/.test(shareLink), shareLink);

// Classroom popup
const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('dialog >> text=Share to Google Classroom')]);
const purl = popup.url();
check('classroom share URL', purl.startsWith('https://classroom.google.com/share?') && purl.includes(encodeURIComponent(shareLink)) && purl.includes('itemtype=assignment'), purl.slice(0, 160));
await popup.close();

// QR PNG download
const [qrdl] = await Promise.all([page.waitForEvent('download'), page.click('dialog >> text=Download QR code (PNG)')]);
check('QR png download', /-qr\.png$/.test(qrdl.suggestedFilename()), qrdl.suggestedFilename());
await page.keyboard.press('Escape');

// Viewer: activity renders, download works, storage persists
const vf = page.frameLocator('#stage iframe');
await vf.locator('h1').waitFor();
check('viewer renders activity', (await vf.locator('h1').textContent()).includes('Space Race'));
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.viewer-actions >> text=Download')]);
check('download html', dl.suggestedFilename() === 'times-tables-space-race.html', dl.suggestedFilename());
const dlText = fs.readFileSync(await dl.path(), 'utf8');
check('download is original code (no shim)', dlText.startsWith('<!DOCTYPE html>') && !dlText.includes('__hub'));
await page.screenshot({ path: `${OUT}/05-viewer-teacher.png` });
const activityUrl = page.url();

// localStorage shim persistence (fractions quiz uses localStorage best score)
await page.goto(`${BASE}/library.html?q=pizza`);
await page.click('.activity-card h3 a');
await page.waitForURL(/view\.html/);
const ff = page.frameLocator('#stage iframe');
await ff.locator('#options button').first().waitFor();
await ff.locator('#options button', { hasText: '2/4' }).click();
await page.waitForTimeout(500);
await page.reload();
await page.frameLocator('#stage iframe').locator('#best').waitFor();
await page.waitForTimeout(200);
check('activity localStorage persists across reloads', (await page.frameLocator('#stage iframe').locator('#best').textContent()) === '1');

// Edit own activity
await page.goto(activityUrl);
await page.click('.viewer-actions [aria-haspopup=menu]');
await page.click('.menu-list >> text=Edit');
await page.waitForURL(/index\.html\?edit=/);
await page.waitForFunction(() => document.getElementById('f-title').value.length > 0);
await page.fill('#f-title', 'Times Tables Space Race (v2)');
await page.click('#publish-btn');
await page.waitForURL(/view\.html\?id=/);
await page.waitForSelector('#title:has-text("v2")');
check('edit saved', (await page.textContent('#title')).includes('(v2)'));

// Cannot edit someone else's (coach's) activity: no Edit item
await page.goto(`${BASE}/library.html?q=pizza`);
await page.click('.activity-card h3 a');
await page.waitForSelector('.viewer-actions [aria-haspopup=menu]');
await page.click('.viewer-actions [aria-haspopup=menu]');
check("no edit on a colleague's activity", !(await page.isVisible('.menu-list >> text=Edit')) && await page.isVisible('.menu-list >> text=Remix'));
await page.keyboard.press('Escape');

// --- Student (fresh context, no sign-in) ---
const student = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const sp = await student.newPage();
sp.on('pageerror', (e) => errors.push(`student pageerror: ${e.message}`));
await sp.goto(activityUrl);
await sp.frameLocator('#stage iframe').locator('h1').waitFor();
const studentButtons = await sp.$$eval('.viewer-actions button', (els) => els.map((e) => e.textContent.trim()));
check('student sees only download/print/fullscreen', JSON.stringify(studentButtons) === '["Download","Print","Full screen"]', JSON.stringify(studentButtons));
check('student brand is not a library link', (await sp.getAttribute('#brand', 'href')) === null);
await sp.screenshot({ path: `${OUT}/06-viewer-student-phone.png` });
await sp.goto(`${BASE}/library.html`);
await sp.waitForSelector('.gate');
check('student blocked from library', await sp.isVisible('text=Teachers only'));
await sp.goto(`${BASE}/view.html?id=doesnotexist`);
await sp.waitForSelector('.viewer-status h2');
check('missing activity message', /couldn’t find/.test(await sp.textContent('.viewer-status h2')));
await sp.screenshot({ path: `${OUT}/07-not-found.png` });

// Phone layouts for teacher pages
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const pp = await phone.newPage();
pp.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`));
await pp.goto(`${BASE}/library.html`);
await pp.waitForSelector('.activity-card');
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('library has no horizontal scroll on phone', !overflow);
await pp.screenshot({ path: `${OUT}/08-library-phone.png`, fullPage: true });
await pp.goto(`${BASE}/index.html`);
await pp.waitForSelector('#app:not([hidden])');
check('create has no horizontal scroll on phone', !(await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await pp.screenshot({ path: `${OUT}/09-create-phone.png`, fullPage: true });
await pp.goto(activityUrl);
await pp.frameLocator('#stage iframe').locator('h1').waitFor();
check('viewer has no horizontal scroll on phone', !(await pp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await pp.screenshot({ path: `${OUT}/10-viewer-teacher-phone.png` });

// Delete
await page.goto(activityUrl);
await page.click('.viewer-actions [aria-haspopup=menu]');
await page.click('.menu-list >> text=Delete');
await page.click('dialog >> button:has-text("Delete")');
await page.waitForURL(/library\.html/);
await page.waitForSelector('.activity-card');
const titles = await page.$$eval('.activity-card h3', (els) => els.map((e) => e.textContent));
check('deleted activity gone from library', !titles.some((t) => /Space Race/.test(t)), JSON.stringify(titles));
await sp.goto(activityUrl);
await sp.waitForSelector('.viewer-status h2');
check('deleted link shows not found', /couldn’t find/.test(await sp.textContent('.viewer-status h2')));

// Sign out clears session
await page.click('.user-chip button');
await page.waitForSelector('.gate');
check('sign out returns to gate', await page.isVisible('text=Teachers only'));

const relevantErrors = errors.filter((e) => !/fonts\.g|ERR_|Failed to load resource|net::/.test(e));
check('no page errors', relevantErrors.length === 0, JSON.stringify(relevantErrors.slice(0, 5)));
await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
