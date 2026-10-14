// Shared vocabulary for grades, subjects and activity types.
// Keep GRADES, SUBJECT_NAMES and ACTIVITY_TYPES in sync with apps-script/Code.gs
// (tests/taxonomy-sync.test.js checks this).

export const GRADES = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

export const GRADE_BANDS = [
  { id: 'early', label: 'Early Years', grades: ['Pre-K', 'K'] },
  { id: 'elementary', label: 'Elementary', grades: ['1', '2', '3', '4', '5'] },
  { id: 'middle', label: 'Middle School', grades: ['6', '7', '8'] },
  { id: 'high', label: 'High School', grades: ['9', '10', '11', '12'] },
];

export const SUBJECTS = [
  { name: 'Math', icon: '➗' },
  { name: 'Science', icon: '🔬' },
  { name: 'English Language Arts', icon: '📚' },
  { name: 'Social Studies', icon: '🌍' },
  { name: 'Arabic', icon: 'ض' },
  { name: 'Islamic Studies', icon: '🕌' },
  { name: 'World Languages', icon: '💬' },
  { name: 'Computer Science', icon: '💻' },
  { name: 'Art', icon: '🎨' },
  { name: 'Music', icon: '🎵' },
  { name: 'Physical Education & Health', icon: '⚽' },
  { name: 'Social-Emotional Learning', icon: '💛' },
  { name: 'Other', icon: '✨' },
];

export const SUBJECT_NAMES = SUBJECTS.map((s) => s.name);

export const ACTIVITY_TYPES = ['Quiz', 'Game', 'Flashcards', 'Simulation', 'Lesson', 'Worksheet', 'Tool', 'Other'];

/** Numeric position of a grade: Pre-K = -1, K = 0, 1..12. */
export function gradeIndex(grade) {
  return GRADES.indexOf(String(grade)) - 1;
}

export function gradeFromIndex(index) {
  const clamped = Math.max(-1, Math.min(12, Math.round(index)));
  return GRADES[clamped + 1];
}

/** Sort and de-duplicate a list of grade values, dropping anything unknown. */
export function normalizeGrades(grades) {
  const list = Array.isArray(grades) ? grades : String(grades || '').split(',');
  const set = new Set(list.map((g) => String(g).trim()).filter((g) => GRADES.includes(g)));
  return GRADES.filter((g) => set.has(g));
}

export function gradeRange(lo, hi) {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const out = [];
  for (let i = a; i <= b; i++) out.push(gradeFromIndex(i));
  return normalizeGrades(out);
}

/** "Grade 4", "Grades 3–5", "K–2", "Pre-K & K", "Grades 3, 5 & 7" */
export function formatGrades(grades) {
  const list = normalizeGrades(grades);
  if (!list.length) return 'Any grade';
  if (list.length === 1) {
    const g = list[0];
    return g === 'K' ? 'Kindergarten' : g === 'Pre-K' ? 'Pre-K' : `Grade ${g}`;
  }
  const idx = list.map(gradeIndex);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const numericStart = idx[0] >= 1;
  if (consecutive) {
    const range = `${list[0]}–${list[list.length - 1]}`;
    return numericStart ? `Grades ${range}` : range;
  }
  const head = list.slice(0, -1).join(', ');
  const tail = list[list.length - 1];
  return numericStart ? `Grades ${head} & ${tail}` : `${head} & ${tail}`;
}

export function subjectIcon(name) {
  const found = SUBJECTS.find((s) => s.name === name);
  return found ? found.icon : '✨';
}
