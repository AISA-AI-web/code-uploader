#!/usr/bin/env node
// Deploys the Apps Script backend as two web apps from the same code:
//   • Public   — Who has access: Anyone. Students open activities; the website's API.
//   • Teachers — Who has access: Anyone within your school. Google's built-in single sign-on.
//
// Run from the code-uploader folder after `clasp login` and `clasp create-script` (see README):
//
//   node apps-script/deploy.mjs
//
// It finds the existing deployments from apiUrl and signInUrl in assets/js/config.js, updates
// them to the latest Code.gs (creating any that are missing) and prints both web app URLs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(DIR, 'appsscript.json');
const CONFIG = path.join(DIR, '..', 'assets', 'js', 'config.js');
const urlFor = (id) => `https://script.google.com/macros/s/${id}/exec`;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function clasp(args) {
  try {
    return execFileSync('clasp', args, { cwd: DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e.code === 'ENOENT') fail('clasp isn’t installed. Run: npm install -g @google/clasp');
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message;
    throw new Error(`“clasp ${args.join(' ')}” failed:\n${detail}`);
  }
}

/** Creates a new version from the uploaded code and points the deployment at it. */
function deploy(id, description) {
  const out = clasp(['--json', ...(id ? ['update-deployment', id] : ['create-deployment']), '-d', description]);
  const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  if (!json.deploymentId) throw new Error(`Unexpected reply from clasp:\n${out}`);
  return json;
}

function idFromConfig(source, key) {
  const value = (source.match(new RegExp(`${key}:\\s*'([^']*)'`)) || [])[1] || '';
  return (value.match(/\/s\/([\w-]{20,})\/exec/) || [])[1] || '';
}

if (!fs.existsSync(path.join(DIR, '.clasp.json'))) {
  fail('This folder isn’t linked to an Apps Script project yet. From code-uploader/apps-script run:\n' +
    '  clasp create-script --type standalone --title "Activity Hub backend" --rootDir .\n' +
    '  git checkout -- appsscript.json');
}

const original = fs.readFileSync(MANIFEST, 'utf8');
const manifest = JSON.parse(original);
if (manifest.webapp?.access !== 'ANYONE_ANONYMOUS') {
  fail('apps-script/appsscript.json has been changed. Restore it with: git checkout -- apps-script/appsscript.json');
}
const configSource = fs.readFileSync(CONFIG, 'utf8');
const publicId = idFromConfig(configSource, 'apiUrl');
const teachersId = idFromConfig(configSource, 'signInUrl');

function restoreManifest() {
  fs.writeFileSync(MANIFEST, original);
  try {
    clasp(['push', '-f']); // leave the project's latest code with the public settings
  } catch (e) {
    console.warn(`\n! Couldn’t re-upload the public settings: ${e.message}`);
  }
}

let pub;
let teachers;
let stage = '';
try {
  stage = 'upload';
  console.log('1/4  Uploading Code.gs…');
  clasp(['push', '-f']);

  stage = 'public';
  console.log(`2/4  ${publicId ? 'Updating' : 'Creating'} the Public deployment (students, no sign-in)…`);
  pub = deploy(publicId, 'Public: students and the website');

  stage = 'teachers';
  console.log('3/4  Uploading the teachers-only settings…');
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ ...manifest, webapp: { ...manifest.webapp, access: 'DOMAIN' } }, null, 2)}\n`);
  clasp(['push', '-f']);
  console.log(`4/4  ${teachersId ? 'Updating' : 'Creating'} the Teachers deployment (school sign-in)…`);
  teachers = deploy(teachersId, 'Teachers: school sign-in');
} catch (e) {
  restoreManifest();
  const hint = stage === 'teachers'
    ? '\n\n“Anyone within your school” only exists for projects owned by a school Google account. Check with: clasp show-authorized-user'
    : '';
  fail(`${e.message}${hint}`);
}
restoreManifest();

const lines = [`  apiUrl: '${urlFor(pub.deploymentId)}',`, `  signInUrl: '${urlFor(teachers.deploymentId)}',`];
const upToDate = pub.deploymentId === publicId && teachers.deploymentId === teachersId;
console.log(`
✔ Deployed.

  Public   (anyone, students):  ${urlFor(pub.deploymentId)}   version ${pub.versionNumber ?? '?'}
  Teachers (school sign-in):    ${urlFor(teachers.deploymentId)}   version ${teachers.versionNumber ?? '?'}
`);
if (upToDate) {
  console.log('assets/js/config.js already points at these. Nothing else to do.\n');
} else {
  console.log(`assets/js/config.js needs these two lines (send them to Claude, or paste them in and push to GitHub):\n\n${lines.join('\n')}\n`);
}
