// Runs the real apps-script/Code.gs against mocked Google services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas, devFetchHandler } from '../dev/gas-mock.mjs';

const SITE = 'https://site.test/hub/';

// Most tests run with the teacher list on; 'until the teacher list is turned on…' covers it off.
function setup({ props = {}, fetchHandler } = {}) {
  const gas = createGas({ fetchHandler: fetchHandler || devFetchHandler(), props: { SCHOOL_DOMAIN: 'aisa.test', SITE_URL: SITE, TEACHER_LIST: 'on', ...props } });
  gas.run('setup');
  const teachers = gas.sheet('Teachers');
  teachers.appendRow(['Teacher@AISA.test', 'Ms. Rivera', 'teacher']);
  teachers.appendRow(['coach@aisa.test', 'Mr. Haddad', 'Teacher']);
  teachers.appendRow(['teacher.home@gmail.com', 'Ms. Rivera (personal)', 'teacher']);
  teachers.appendRow(['head@aisa.test', 'Dr. Head', 'Admin']);
  gas.run('clearCaches');
  // Signs in through the real sign-in page, as if Google had signed `email` in.
  const login = (email) => {
    const res = gas.signIn(email, `${SITE}library.html`);
    return res.session ? res.session.token : res;
  };
  return { gas, login };
}

const ACTIVITY = { title: 'Fractions', grades: ['4', '3'], subject: 'Math', concept: 'Equivalent fractions', activityType: 'Quiz', tags: ['fractions'], code: '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>' };

test('setup creates the sheets and makes the owner an admin', () => {
  const { gas } = setup();
  assert.ok(gas.sheet('Activities'));
  assert.deepEqual(gas.sheet('Teachers').getRange(2, 1, 1, 3).getValues()[0], ['owner@aisa.test', '', 'admin']);
  assert.ok(gas.props.get('SESSION_SECRET'));
  assert.equal(gas.doGet({}).ok, true);
});

test('only rostered teachers at the school domain can sign in', () => {
  const { gas, login } = setup();
  assert.equal(typeof login('teacher@aisa.test'), 'string', 'emails match case-insensitively');
  assert.equal(login('student@aisa.test').code, 'NOT_TEACHER', 'school accounts not on the Teachers tab are refused');
  assert.equal(login('teacher.home@gmail.com').code, 'WRONG_DOMAIN', 'personal accounts are refused even if listed');
  assert.equal(login('teacher@other-school.test').code, 'WRONG_DOMAIN');
  assert.equal(login('').code, 'NO_IDENTITY', 'the public deployment never knows who the visitor is');
  const config = gas.doPost({ action: 'config' });
  assert.equal(config.schoolDomain, 'aisa.test');
  assert.equal(config.auth, 'sso');
  assert.equal(config.teacherList, true);
});

test('until the teacher list is turned on, any account at the school domain can sign in', () => {
  const { gas, login } = setup();
  gas.props.delete('TEACHER_LIST');
  assert.equal(gas.doPost({ action: 'config' }).teacherList, false, 'off by default');
  const newcomer = gas.signIn('new.teacher@aisa.test', `${SITE}library.html`).session;
  assert.equal(newcomer.role, 'teacher');
  assert.equal(newcomer.name, 'New Teacher');
  assert.equal(gas.doPost({ action: 'list', session: newcomer.token }).ok, true);
  assert.ok(gas.doPost({ action: 'create', session: newcomer.token, ...ACTIVITY }).ok);
  const head = gas.signIn('head@aisa.test', `${SITE}library.html`).session;
  assert.equal(head.role, 'admin', 'the Teachers tab still sets admins');
  assert.equal(head.name, 'Dr. Head', 'and names');
  assert.equal(login('teacher.home@gmail.com').code, 'WRONG_DOMAIN', 'other domains are still refused');
  assert.equal(login('').code, 'NO_IDENTITY');

  gas.props.set('TEACHER_LIST', 'on');
  assert.equal(gas.doPost({ action: 'list', session: newcomer.token }).code, 'NOT_TEACHER', 'turning the list on ends access for anyone not on it');
  assert.equal(login('new.teacher@aisa.test').code, 'NOT_TEACHER');
  assert.equal(gas.doPost({ action: 'list', session: head.token }).ok, true);
});

test('the sign-in page returns a working session to the page the teacher came from', () => {
  const { gas } = setup();
  const res = gas.signIn('coach@aisa.test', `${SITE}index.html?remix=abc123`);
  assert.ok(res.target.startsWith(`${SITE}index.html?remix=abc123#hub-session=`));
  assert.equal(res.session.email, 'coach@aisa.test');
  assert.equal(res.session.name, 'Mr. Haddad');
  assert.equal(res.session.role, 'teacher');
  assert.ok(Date.parse(res.session.expiresAt) > Date.now());
  assert.equal(gas.doPost({ action: 'list', session: res.session.token }).ok, true);
  assert.match(res.html, /window\.top\.location\.replace/, 'goes back automatically');
  assert.match(res.html, /target="_top"/, 'with a button as a fallback');
});

test('sign-in never sends a session to another site', () => {
  const { gas } = setup();
  for (const evil of ['https://evil.test/steal', 'https://site.test/other/', `${SITE}../other/`, `${SITE}x@evil.test`, 'javascript:alert(1)', '']) {
    const res = gas.signIn('teacher@aisa.test', evil);
    assert.ok(res.target.startsWith(`${SITE}library.html#hub-session=`), `${evil} → ${res.target.slice(0, 60)}`);
  }
});

test('the sign-in page escapes what it shows', () => {
  const { gas } = setup({ props: { SCHOOL_DOMAIN: 'any' } });
  const res = gas.signIn('"><script>alert(1)</script>@x.test', `${SITE}library.html`);
  assert.equal(res.code, 'NOT_TEACHER');
  assert.ok(!res.html.includes('<script>alert(1)'));
});

test('names default to the email when the Teachers tab has none', () => {
  const { gas } = setup();
  gas.sheet('Teachers').appendRow(['jane.van-dyke@aisa.test', '', 'teacher']);
  gas.run('clearCaches');
  assert.equal(gas.signIn('jane.van-dyke@aisa.test', `${SITE}library.html`).session.name, 'Jane Van Dyke');
});

test('the school domain defaults to aisa.sch.ae', () => {
  const gas = createGas();
  gas.run('setup');
  assert.equal(gas.doPost({ action: 'config' }).schoolDomain, 'aisa.sch.ae');
});

test('with SCHOOL_DOMAIN=any, *@domain rows admit a whole domain (subdomains excluded)', () => {
  const { gas, login } = setup({ props: { SCHOOL_DOMAIN: 'any' } });
  gas.sheet('Teachers').appendRow(['*@staff.aisa.test', '', 'teacher']);
  gas.run('clearCaches');
  assert.equal(typeof login('new.hire@staff.aisa.test'), 'string');
  assert.equal(login('someone@sub.staff.aisa.test').code, 'NOT_TEACHER');
  assert.equal(typeof login('teacher.home@gmail.com'), 'string');
});

test('sessions from outside the school domain stop working if the domain is locked later', () => {
  const { gas, login } = setup({ props: { SCHOOL_DOMAIN: 'any' } });
  const personal = login('teacher.home@gmail.com');
  assert.equal(gas.doPost({ action: 'list', session: personal }).ok, true);
  gas.props.set('SCHOOL_DOMAIN', 'aisa.test');
  assert.equal(gas.doPost({ action: 'list', session: personal }).code, 'NOT_TEACHER');
});

test('students can open an activity by link but cannot list, create or classify', () => {
  const { gas, login } = setup();
  const created = gas.doPost({ action: 'create', session: login('teacher@aisa.test'), ...ACTIVITY });
  assert.ok(created.ok, created.error);
  const got = gas.doPost({ action: 'get', id: created.id });
  assert.equal(got.activity.code, ACTIVITY.code);
  assert.equal(got.activity.canEdit, false);
  assert.equal(gas.doGet({ action: 'get', id: created.id }).activity.title, 'Fractions');
  assert.equal(gas.doPost({ action: 'list' }).code, 'AUTH_REQUIRED');
  assert.equal(gas.doPost({ action: 'create', ...ACTIVITY }).code, 'AUTH_REQUIRED');
  assert.equal(gas.doPost({ action: 'classify', text: 'x'.repeat(50) }).code, 'AUTH_REQUIRED');
  assert.equal(gas.doPost({ action: 'list', session: 'abc.def' }).code, 'AUTH_REQUIRED');
});

test('create, list, update and delete', () => {
  const { gas, login } = setup();
  const t1 = login('teacher@aisa.test');
  const t2 = login('coach@aisa.test');
  const admin = login('head@aisa.test');
  const { id, activity } = gas.doPost({ action: 'create', session: t1, ...ACTIVITY, author: '' });
  assert.match(id, /^[A-Za-z0-9]{9}$/);
  assert.deepEqual(activity.grades, ['3', '4']);
  assert.equal(activity.author, 'Ms. Rivera', 'defaults to the name on the Teachers tab');

  const mine = gas.doPost({ action: 'list', session: t1 }).activities;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].mine, true);
  assert.equal(mine[0].canEdit, true);
  assert.equal(mine[0].code, undefined, 'the list never includes code');
  const theirs = gas.doPost({ action: 'list', session: t2 }).activities[0];
  assert.equal(theirs.mine, false);
  assert.equal(theirs.canEdit, false);

  assert.equal(gas.doPost({ action: 'update', session: t2, id, title: 'Hijacked' }).code, 'FORBIDDEN');
  assert.equal(gas.doPost({ action: 'delete', session: t2, id }).code, 'FORBIDDEN');

  const newCode = '<html><body><h1>Version 2 ✨</h1></body></html>';
  const updated = gas.doPost({ action: 'update', session: t1, id, title: 'Fractions v2', code: newCode });
  assert.ok(updated.ok, updated.error);
  assert.equal(gas.doPost({ action: 'get', id }).activity.code, newCode, 'new code is served, not the cached old version');
  assert.equal(gas.doPost({ action: 'list', session: t2 }).activities[0].title, 'Fractions v2', 'list cache is refreshed');
  const trashed = [...gas.files.values()].filter((f) => f.trashed);
  assert.equal(trashed.length, 1, 'the old file is moved to the Drive trash');

  assert.equal(gas.doPost({ action: 'update', session: admin, id, concept: 'Moderated' }).ok, true, 'admins can edit anything');
  assert.equal(gas.doPost({ action: 'delete', session: admin, id }).ok, true);
  assert.equal(gas.doPost({ action: 'get', id }).code, 'NOT_FOUND');
  assert.equal(gas.doPost({ action: 'list', session: t1 }).activities.length, 0);
});

test('removing a teacher from the list ends their access', () => {
  const { gas, login } = setup();
  const t = login('coach@aisa.test');
  assert.equal(gas.doPost({ action: 'list', session: t }).ok, true);
  const sheet = gas.sheet('Teachers');
  for (let r = 2; r <= sheet.getLastRow(); r++) if (sheet.get(r, 1) === 'coach@aisa.test') sheet.write(r, 1, '');
  gas.run('clearCaches');
  assert.equal(gas.doPost({ action: 'list', session: t }).code, 'NOT_TEACHER');
});

test('sessions expire and cannot be forged', () => {
  const { gas, login } = setup({ props: { SESSION_DAYS: '1' } });
  const token = login('teacher@aisa.test');
  const [body, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.ok(payload.x - Date.now() <= 86400000 + 1000);
  const forgedBody = Buffer.from(JSON.stringify({ e: 'head@aisa.test', x: payload.x })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(gas.doPost({ action: 'list', session: `${forgedBody}.${sig}` }).code, 'AUTH_REQUIRED');
  const expiredBody = Buffer.from(JSON.stringify({ e: 'teacher@aisa.test', x: Date.now() - 1000 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const expiredSig = gas.eval(`Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(${JSON.stringify(expiredBody)}, sessionSecret_()))`);
  assert.equal(gas.doPost({ action: 'list', session: `${expiredBody}.${expiredSig}` }).code, 'SESSION_EXPIRED');
});

test('input is cleaned and stored safely', () => {
  const { gas, login } = setup();
  const t = login('teacher@aisa.test');
  const res = gas.doPost({
    action: 'create', session: t, title: '=IMPORTXML("http://evil")', grades: ['4', 'Grade 99', 'K'], subject: 'Basket weaving',
    activityType: 'Party', tags: 'a, A, b, ' + 'x'.repeat(60), code: '<h1>مرحبا بكم 👋</h1>', description: 'line 1\nline 2\u0007',
  });
  assert.ok(res.ok, res.error);
  const a = gas.doPost({ action: 'get', id: res.id }).activity;
  assert.equal(a.title, '=IMPORTXML("http://evil")', 'kept as text, never run as a formula');
  assert.deepEqual(a.grades, ['K', '4']);
  assert.equal(a.subject, 'Other');
  assert.equal(a.activityType, 'Other');
  assert.deepEqual(a.tags, ['a', 'b', 'x'.repeat(40)]);
  assert.equal(a.description, 'line 1\nline 2');
  assert.equal(a.code, '<h1>مرحبا بكم 👋</h1>', 'Arabic and emoji survive the round trip');
  const row = gas.sheet('Activities').getRange(2, 1, 1, 16).getValues()[0];
  assert.ok(!row.includes('#FORMULA!'));
  assert.equal(row[3], 'K,4', 'grades stay text, not a number');
});

test('rejects missing titles, empty code and oversized code', () => {
  const { gas, login } = setup();
  const t = login('teacher@aisa.test');
  assert.equal(gas.doPost({ action: 'create', session: t, ...ACTIVITY, title: '  ' }).error, 'Please add a title.');
  assert.equal(gas.doPost({ action: 'create', session: t, ...ACTIVITY, code: '   ' }).code, 'BAD_REQUEST');
  assert.equal(gas.doPost({ action: 'create', session: t, ...ACTIVITY, code: 'é'.repeat(3 * 1024 * 1024) }).code, 'TOO_LARGE', 'limit is in bytes, not characters');
  assert.equal(gas.doPost({ action: 'get', id: '../etc' }).code, 'NOT_FOUND');
  assert.equal(gas.doPost('not json').code, 'BAD_REQUEST');
});

test('large activities are cached in chunks and read back intact', () => {
  const { gas, login } = setup();
  const t = login('teacher@aisa.test');
  const big = `<html><body>${'<p>صفحة كبيرة — big page 🚀</p>\n'.repeat(12000)}</body></html>`;
  const { id } = gas.doPost({ action: 'create', session: t, ...ACTIVITY, code: big });
  assert.equal(gas.doPost({ action: 'get', id }).activity.code, big);
  for (const f of gas.files.values()) f.bytes = Buffer.from('changed on disk');
  assert.equal(gas.doPost({ action: 'get', id }).activity.code, big, 'second read is served from the cache');
});

test('many activities: rows grow past the sheet size and the list stays complete', () => {
  const { gas, login } = setup();
  const t = login('teacher@aisa.test');
  gas.sheet('Activities').maxRows = 3;
  for (let i = 0; i < 5; i++) assert.ok(gas.doPost({ action: 'create', session: t, ...ACTIVITY, title: `A${i}` }).ok);
  assert.equal(gas.doPost({ action: 'list', session: t }).activities.length, 5);
});

test('open mode lets anyone in; otherwise teacher actions need a sign-in', () => {
  const open = createGas({ props: { OPEN_MODE: 'true' } });
  open.run('setup');
  assert.equal(open.doPost({ action: 'config' }).auth, 'open');
  assert.ok(open.doPost({ action: 'create', ...ACTIVITY }).ok);
  assert.equal(open.doPost({ action: 'list' }).activities.length, 1);

  const bare = createGas();
  bare.run('setup');
  assert.equal(bare.doPost({ action: 'config' }).auth, 'sso');
  assert.equal(bare.doPost({ action: 'list' }).code, 'AUTH_REQUIRED');
});

test('AI suggestions call Claude with structured output and clean the answer', () => {
  let request;
  const handler = devFetchHandler();
  const { gas, login } = setup({
    props: { ANTHROPIC_API_KEY: 'sk-test', AI_DAILY_LIMIT: '2' },
    fetchHandler: (url, options, ctx) => {
      if (!url.includes('anthropic')) return handler(url, options, ctx);
      request = { url, options, body: JSON.parse(options.payload) };
      return {
        status: 200,
        body: {
          stop_reason: 'end_turn',
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: JSON.stringify({ title: 'Water Cycle', description: 'Students follow a droplet.', grades: ['3', '4', '13'], subject: 'Science', concept: 'Water cycle', activityType: 'Lesson', tags: ['Water', 'cycle'] }) },
          ],
        },
      };
    },
  });
  const t = login('teacher@aisa.test');
  assert.equal(gas.doPost({ action: 'config' }).ai, true);
  const res = gas.doPost({ action: 'classify', session: t, text: 'Page title: The Water Cycle. Evaporation, condensation...' });
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.suggestion.grades, ['3', '4']);
  assert.deepEqual(res.suggestion.tags, ['water', 'cycle']);
  assert.equal(request.body.model, 'claude-opus-5-5');
  assert.equal(request.body.output_config.format.type, 'json_schema');
  assert.equal(request.body.output_config.effort, 'low');
  assert.equal(request.body.fallbacks, 'default');
  assert.equal(request.options.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(request.options.headers['x-api-key'], 'sk-test');
  assert.equal(request.body.thinking, undefined);
  assert.ok(request.body.messages[0].content.includes('<activity>'));
  assert.ok(gas.doPost({ action: 'classify', session: t, text: 'x'.repeat(30) }).ok);
  assert.equal(gas.doPost({ action: 'classify', session: t, text: 'x'.repeat(30) }).code, 'AI_LIMIT');
});

test('AI refusals and errors become friendly messages', () => {
  const handler = devFetchHandler();
  let reply;
  const { gas, login } = setup({
    props: { ANTHROPIC_API_KEY: 'sk-test' },
    fetchHandler: (url, o, ctx) => (url.includes('anthropic') ? reply : handler(url, o, ctx)),
  });
  const t = login('teacher@aisa.test');
  reply = { status: 200, body: { stop_reason: 'refusal', content: [] } };
  assert.equal(gas.doPost({ action: 'classify', session: t, text: 'x'.repeat(30) }).code, 'AI_REFUSED');
  reply = { status: 401, body: { error: { message: 'invalid x-api-key' } } };
  const err = gas.doPost({ action: 'classify', session: t, text: 'x'.repeat(30) });
  assert.equal(err.code, 'AI_ERROR');
  assert.doesNotMatch(err.error, /sk-test/);
});

test('Gemini is used when it is the only key', () => {
  let url;
  const handler = devFetchHandler();
  const { gas, login } = setup({
    props: { GEMINI_API_KEY: 'g-test' },
    fetchHandler: (u, o, ctx) => {
      if (!u.includes('generativelanguage')) return handler(u, o, ctx);
      url = u;
      return { status: 200, body: { candidates: [{ content: { parts: [{ text: '```json\n{"title":"T","description":"","grades":["K"],"subject":"Arabic","concept":"Letters","activityType":"Game","tags":[]}\n```' }] } }] } };
    },
  });
  const res = gas.doPost({ action: 'classify', session: login('teacher@aisa.test'), text: 'x'.repeat(30) });
  assert.ok(res.ok, res.error);
  assert.equal(res.provider, 'gemini');
  assert.equal(res.suggestion.subject, 'Arabic');
  assert.match(url, /models\/gemini-2\.5-flash:generateContent$/);
});
