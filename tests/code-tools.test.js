import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePastedCode, analyzeCode, buildSrcdoc } from '../assets/js/code-tools.js';

const PAGE = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<title>T</title>\n</head>\n<body>\n<h1>Hi</h1>\n</body>\n</html>';

test('strips markdown fences and chat text', () => {
  const raw = `Sure! Here is your activity for grade 3:\n\n\`\`\`html\n${PAGE}\n\`\`\`\n\nLet me know if you want changes.`;
  const { code, changes, context } = normalizePastedCode(raw);
  assert.equal(code.trim(), PAGE);
  assert.equal(changes.length, 1);
  assert.match(context, /grade 3/);
  assert.match(context, /Let me know/);
});

test('strips text before and after an unfenced page', () => {
  const { code, changes } = normalizePastedCode(`Here you go:\n${PAGE}\nEnjoy!`);
  assert.equal(code.trim(), PAGE);
  assert.equal(changes.length, 2);
});

test('leaves clean code alone', () => {
  const { code, changes } = normalizePastedCode(PAGE);
  assert.equal(code.trim(), PAGE);
  assert.deepEqual(changes, []);
});

test('merges separate HTML, CSS and JS blocks', () => {
  const raw = [
    '```html', '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>X</h1><script src="script.js"></script></body></html>', '```',
    'And the CSS:', '```css', 'h1 { color: red; }', '```',
    'And the JavaScript:', '```javascript', "document.querySelector('h1').textContent = 'Y';", '```',
  ].join('\n');
  const { code, changes } = normalizePastedCode(raw);
  assert.match(code, /<style>\nh1 \{ color: red; \}\n<\/style>\n<\/head>/);
  assert.match(code, /<script>\ndocument\.querySelector/);
  assert.doesNotMatch(code, /style\.css|script\.js/);
  assert.match(changes[0], /Combined/);
  assert.deepEqual(analyzeCode(code).filter((i) => i.level !== 'info'), []);
});

test('flags common problems', () => {
  const levels = (src) => analyzeCode(src).map((i) => i.level);
  assert.deepEqual(analyzeCode(''), []);
  assert.deepEqual(levels('just some words'), ['error']);
  assert.deepEqual(levels("import React, { useState } from 'react';\nexport default function App() { return <div/>; }"), ['error']);
  assert.ok(analyzeCode('<html><body><h1>Cut off').some((i) => /cut off/.test(i.message)));
  assert.ok(analyzeCode('<html><body><img src="images/cat.png"></body></html>').some((i) => /images\/cat\.png/.test(i.message)));
  assert.ok(analyzeCode('<html><body><!-- rest of the code stays the same --></body></html>').some((i) => /placeholder/.test(i.message)));
  assert.equal(analyzeCode('<html><body><img src="https://example.com/a.png"><a href="page.html">x</a></body></html>').length, 0);
  assert.ok(analyzeCode('<p>x</p>'.repeat(10), { maxBytes: 20 }).some((i) => i.level === 'error'));
});

test('helper script goes after the doctype and inside <head>', () => {
  const out = buildSrcdoc(PAGE);
  assert.ok(out.startsWith('<!DOCTYPE html>'), 'doctype must stay first or the page renders in quirks mode');
  assert.ok(out.indexOf('<script>') > out.indexOf('<head>'));
  assert.ok(out.indexOf('<script>') < out.indexOf('<title>'));
  assert.ok(buildSrcdoc('<header>x</header><p>hi</p>').startsWith('<script>'), '<header> is not <head>');
  assert.match(buildSrcdoc('<p>fragment</p>'), /^<script>[\s\S]*<\/script><p>fragment<\/p>$/);
});

test('saved activity data cannot break out of the helper script', () => {
  const out = buildSrcdoc(PAGE, { storage: { k: '</script><script>alert(1)</script>' } });
  assert.equal(out.match(/<\/script>/g).length, 1);
});
