import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classify, explicitGrades, extractText, readingGrade, textForAi } from '../assets/js/classifier.js';

const sample = (name) => fs.readFileSync(new URL(`../dev/samples/${name}`, import.meta.url), 'utf8');

test('sample activities are classified sensibly', () => {
  const expectations = {
    'fractions-quiz.html': { subject: 'Math', grades: ['4'], type: 'Quiz', concept: /fraction/i },
    'water-cycle.html': { subject: 'Science', includes: '4', type: 'Lesson', concept: /water cycle/i },
    'arabic-letters.html': { subject: 'Arabic', includes: 'K', type: 'Game', concept: /arabic letters/i },
    'parts-of-speech.html': { subject: 'English Language Arts', includes: '2', type: 'Game', concept: /noun/i },
    'photosynthesis-sim.html': { subject: 'Science', includes: '6', type: 'Simulation', concept: /photosynthesis/i },
  };
  for (const [file, want] of Object.entries(expectations)) {
    const r = classify(sample(file));
    assert.equal(r.subject, want.subject, `${file} subject`);
    if (want.grades) assert.deepEqual(r.grades, want.grades, `${file} grades`);
    if (want.includes) assert.ok(r.grades.includes(want.includes), `${file} grades ${r.grades}`);
    assert.ok(r.grades.length <= 4, `${file} grade range should be narrow`);
    assert.equal(r.activityType, want.type, `${file} type`);
    assert.match(r.concept, want.concept, `${file} concept`);
    assert.ok(r.title.length > 3, `${file} title`);
    assert.ok(r.tags.every((t) => !t.includes(',')), `${file} tags must not contain commas`);
  }
});

test('explicit grade mentions', () => {
  const g = (text) => explicitGrades(text)[0];
  assert.deepEqual([g('Grade 5 Science').lo, g('Grade 5 Science').hi], [5, 5]);
  assert.deepEqual([g('for grades 3-5').lo, g('for grades 3-5').hi], [3, 5]);
  assert.deepEqual([g('a 2nd grade class').lo, g('a 2nd grade class').hi], [2, 2]);
  assert.deepEqual([g('Seventh-grade math').lo, g('Seventh-grade math').hi], [7, 7]);
  assert.deepEqual([g('Year 8 History').lo, g('Year 8 History').hi], [7, 7]);
  assert.deepEqual([g('KG2 phonics').lo, g('KG2 phonics').hi], [0, 0]);
  assert.deepEqual([g('Algebra I review').lo, g('Algebra I review').hi], [8, 9]);
  assert.equal(explicitGrades('Your grade: 90%').length, 0);
  assert.equal(explicitGrades('Score 10 points to grade 100').length, 0);
});

test('grade hint from the chat message pasted with the code', () => {
  const code = '<html><head><title>Rocket Facts</title></head><body><h1>Rocket Facts</h1><p>Answer the multiplication facts to fuel your rocket.</p></body></html>';
  const r = classify(code, { context: "Here's a game for your 3rd grade class:" });
  assert.deepEqual(r.grades, ['3']);
  assert.ok(r.reasons.some((x) => /pasted with the code/.test(x)));
});

test('unknown content falls back gracefully', () => {
  const r = classify('<html><body><button>Click</button></body></html>');
  assert.equal(r.subject, 'Other');
  assert.deepEqual(r.grades, []);
  assert.equal(r.confidence.grades, 'none');
});

test('quiz questions inside scripts are read', () => {
  const t = extractText('<script>const qs = [{ q: "What is the capital of France?", a: "Paris" }];</script>');
  assert.ok(t.strings.includes('What is the capital of France?'));
});

test('reading level needs enough prose', () => {
  assert.equal(readingGrade('Too short.'), null);
  const easy = 'The cat sat on the mat. The dog ran to the park. We like to play in the sun. It is a fun day for all of us. '.repeat(6);
  assert.ok(readingGrade(easy) < 3);
});

test('AI text includes the pasted note and stays within the limit', () => {
  const text = textForAi(sample('water-cycle.html'), { context: 'for my 4th graders', limit: 500 });
  assert.ok(text.startsWith('Note the teacher pasted along with the code: for my 4th graders'));
  assert.ok(text.length <= 500);
  assert.ok(!text.includes('<section'));
});
