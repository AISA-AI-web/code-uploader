import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGas } from '../dev/gas-mock.mjs';
import { GRADES, SUBJECT_NAMES, ACTIVITY_TYPES, formatGrades } from '../assets/js/taxonomy.js';

test('frontend and Apps Script use the same grades, subjects and types', () => {
  const gas = createGas();
  assert.deepEqual([...gas.eval('GRADES')], GRADES);
  assert.deepEqual([...gas.eval('SUBJECTS')], SUBJECT_NAMES);
  assert.deepEqual([...gas.eval('ACTIVITY_TYPES')], ACTIVITY_TYPES);
});

test('grade labels', () => {
  assert.equal(formatGrades([]), 'Any grade');
  assert.equal(formatGrades(['4']), 'Grade 4');
  assert.equal(formatGrades(['K']), 'Kindergarten');
  assert.equal(formatGrades(['5', '3', '4']), 'Grades 3–5');
  assert.equal(formatGrades(['Pre-K', 'K', '1']), 'Pre-K–1');
  assert.equal(formatGrades(['3', '5', '7']), 'Grades 3, 5 & 7');
});
