// Reads an HTML activity and guesses its title, grade level(s), subject, concept and type.
// Pure functions with no DOM dependency so they run in the browser and in Node tests.
import { ACTIVITY_TYPES, SUBJECT_NAMES, gradeIndex, gradeRange, formatGrades } from './taxonomy.js';

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', times: '×', divide: '÷', deg: '°' };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Human-readable strings found inside <script> blocks (quiz questions often live there). */
function scriptStrings(html) {
  const out = [];
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const block of scripts) {
    const body = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
    const re = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
    let m;
    while ((m = re.exec(body))) {
      let s = m[2];
      if (s.length < 3 || s.length > 600) continue;
      if (m[1] === '`') s = s.replace(/\$\{[^}]*\}/g, ' ');
      s = stripTags(s.replace(/\\n/g, ' ').replace(/\\(.)/g, '$1'));
      if (!/[A-Za-z؀-ۿ]{2,}/.test(s)) continue;
      if (/^(https?:|data:|#|\.|\/)/.test(s)) continue;
      if (/[{};=]|=>|\bfunction\b/.test(s)) continue;
      if (!/\s/.test(s) && s.length > 24) continue; // ids, class lists, tokens
      out.push(s);
    }
  }
  return out;
}

export function extractText(rawHtml) {
  const html = String(rawHtml || '');
  const pick = (re) => { const m = html.match(re); return m ? stripTags(m[1]) : ''; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = decodeEntities(
    (html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || ''
  ).trim();
  const lang = ((html.match(/<html[^>]*\blang=["']?([a-zA-Z-]+)/i) || [])[1] || '').toLowerCase();

  const headings = [];
  const hre = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hre.exec(html))) {
    const t = stripTags(m[2]);
    if (t) headings.push({ level: Number(m[1]), text: t });
  }

  const paragraphs = [];
  const pre = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pre.exec(html))) {
    const t = stripTags(m[1]);
    if (t) paragraphs.push(t);
  }

  const body = stripTags(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, ' ')
  );
  const strings = scriptStrings(html);

  return { title, metaDescription, lang, headings, paragraphs, body, strings };
}

/** Compact text sent to the optional AI classifier (never the full code). */
export function textForAi(rawHtml, { context = '', limit = 12000 } = {}) {
  const t = extractText(rawHtml);
  const parts = [
    context && `Note the teacher pasted along with the code: ${context.slice(0, 1000)}`,
    t.title && `Page title: ${t.title}`,
    t.metaDescription && `Description: ${t.metaDescription}`,
    t.lang && `Language attribute: ${t.lang}`,
    t.headings.length && `Headings: ${t.headings.map((h) => h.text).join(' | ')}`,
    t.body && `Visible text: ${t.body}`,
    t.strings.length && `Text inside scripts (questions, feedback, etc.): ${t.strings.join(' | ')}`,
  ].filter(Boolean);
  return parts.join('\n').slice(0, limit);
}

// ---------------------------------------------------------------------------
// Knowledge tables
// ---------------------------------------------------------------------------

// Broad words that point to a subject. [pattern, weight]
const SUBJECT_KEYWORDS = {
  Math: [['math(?:s|ematics)?', 3], ['numbers?', 1], ['equations?', 2], ['algebra', 3], ['geometry', 3], ['calculate', 1], ['sum', 1], ['product', 0.5], ['quotient', 2], ['solve for', 2], ['digits?', 1], ['arithmetic', 3], ['shapes?', 1], ['graph(?:ing)?', 1], ['measure(?:ment)?', 1], ['plus', 1], ['minus', 1], ['times', 0.5], ['estimate', 1], ['remainder', 2], ['numerator', 3], ['denominator', 3]],
  Science: [['science', 3], ['scientists?', 2], ['experiment', 2], ['hypothesis', 3], ['energy', 1], ['organisms?', 2], ['biology', 3], ['chemistry', 3], ['physics', 3], ['lab', 1], ['observe', 1], ['matter', 1], ['earth', 1], ['planet', 2], ['species', 2], ['molecules?', 2], ['temperature', 1], ['ecosystem', 2], ['environment', 1]],
  'English Language Arts': [['reading', 1.5], ['writing', 1.5], ['grammar', 3], ['vocabulary', 1.5], ['spelling', 2], ['sentences?', 1.5], ['paragraph', 1.5], ['story', 1], ['poem|poetry', 2], ['author', 1], ['characters?', 1], ['plot', 2], ['words?', 0.5], ['punctuation', 3], ['phonics', 3], ['literacy', 3], ['novel', 2], ['essay', 2], ['text evidence', 3], ['english', 2]],
  'Social Studies': [['history', 3], ['historical', 2], ['geography', 3], ['maps?', 1.5], ['countr(?:y|ies)', 1], ['government', 2], ['citizens?(?:hip)?', 2], ['culture', 1.5], ['civilizations?', 3], ['empire', 2], ['ancient', 2], ['war', 1.5], ['economy', 2], ['continents?', 2], ['social studies', 4], ['century', 1.5], ['heritage', 2], ['uae|emirates|emirati', 1.5]],
  Arabic: [['arabic', 4], ['harakat', 3]],
  'Islamic Studies': [['islam(?:ic)?', 3], ['qur\'?an|koran', 3], ['surah|sura', 3], ['prophet', 2], ['salah|salat|prayer', 2], ['ramadan', 2], ['hadith', 3], ['wudu|wudhu', 3], ['zakat', 3], ['hajj', 3], ['mosque|masjid', 2], ['allah', 2], ['quran', 3]],
  'World Languages': [['french', 3], ['spanish', 3], ['german', 3], ['mandarin|chinese', 3], ['conjugat(?:e|ion)', 3], ['bonjour', 3], ['hola', 3], ['vocabulaire|vocabulario', 3], ['translate', 1.5]],
  'Computer Science': [['coding', 3], ['programming', 3], ['algorithms?', 2.5], ['computer', 2], ['binary', 2], ['python', 3], ['javascript', 2], ['debug(?:ging)?', 2.5], ['loops?', 1], ['robot(?:s|ics)?', 2], ['cyber ?security', 3], ['internet', 1], ['computational', 3], ['sequence', 0.5]],
  Art: [['art(?:work|ist|s)?', 2], ['paint(?:ing)?', 2], ['draw(?:ing)?', 1.5], ['sculpture', 3], ['color wheel|colour wheel', 4], ['hues?', 2], ['canvas', 0.3], ['museum', 1], ['design', 0.5]],
  Music: [['music(?:al)?', 3], ['rhythm', 3], ['melody', 3], ['instruments?', 2], ['notes', 1], ['tempo', 3], ['beat', 1], ['composer', 3], ['treble|bass clef', 3], ['song', 1], ['pitch', 2]],
  'Physical Education & Health': [['exercise', 2], ['fitness', 3], ['health(?:y)?', 1.5], ['nutrition', 3], ['sports?', 2], ['muscles?', 2], ['heart rate', 3], ['physical education', 4], ['warm[- ]up', 2], ['hygiene', 3], ['stretch', 2]],
  'Social-Emotional Learning': [['feelings?', 2.5], ['emotions?', 2.5], ['kindness', 3], ['mindfulness', 3], ['empathy', 3], ['friendship', 2], ['calm', 1], ['growth mindset', 3], ['self[- ]regulation', 3], ['wellbeing|well-being', 3], ['bully(?:ing)?', 3], ['zones of regulation', 4]],
};

// Specific concepts: label, subject, typical grade range [lo, hi] (Pre-K = -1, K = 0), pattern, weight.
const CONCEPTS = [
  // Math
  ['Counting', 'Math', -1, 1, 'counting|count to \\d+|how many', 1.5],
  ['Number recognition', 'Math', -1, 0, 'number recognition|numbers? 1 ?(?:-|to) ?(?:10|20)', 2],
  ['Addition', 'Math', 0, 2, 'addition|adding|add the numbers', 2],
  ['Subtraction', 'Math', 1, 2, 'subtraction|subtracting|take away', 2],
  ['Skip counting', 'Math', 1, 2, 'skip count(?:ing)?', 3],
  ['Place value', 'Math', 1, 4, 'place value|tens and ones|hundreds,? tens', 3],
  ['Telling time', 'Math', 1, 3, 'telling time|tell the time|analog clock|o\'clock|half past', 3],
  ['Money', 'Math', 1, 3, 'coins?|counting money|dirhams?|cents', 2],
  ['2D and 3D shapes', 'Math', -1, 2, '(?:2d|3d|flat|solid) shapes|shapes? (?:hunt|sort|game)|name the shape', 3],
  ['Multiplication', 'Math', 3, 4, 'multiplication|multiply(?:ing)?|times tables?|product of', 3],
  ['Division', 'Math', 3, 5, 'division|divide|dividing|quotient', 2.5],
  ['Long division', 'Math', 4, 5, 'long division', 4],
  ['Fractions', 'Math', 3, 5, 'fractions?|numerator|denominator', 3],
  ['Equivalent fractions', 'Math', 3, 4, 'equivalent fractions?', 4],
  ['Mixed numbers', 'Math', 4, 5, 'mixed numbers?|improper fractions?', 4],
  ['Decimals', 'Math', 4, 6, 'decimals?|tenths|hundredths', 3],
  ['Area and perimeter', 'Math', 3, 4, 'perimeter|area and perimeter', 3],
  ['Angles', 'Math', 4, 7, 'angles?|protractor|acute|obtuse', 2],
  ['Volume', 'Math', 5, 8, 'volume of|cubic units', 3],
  ['Order of operations', 'Math', 5, 6, 'order of operations|pemdas|bodmas|bidmas', 4],
  ['Coordinate plane', 'Math', 5, 6, 'coordinate (?:plane|grid)|ordered pairs?|x-axis|y-axis', 3],
  ['Ratios and rates', 'Math', 6, 7, 'ratios?|unit rates?|proportional', 3],
  ['Percentages', 'Math', 6, 7, 'percent(?:age)?s?', 2.5],
  ['Integers', 'Math', 6, 7, 'integers?|negative numbers|absolute value', 3],
  ['Exponents', 'Math', 6, 8, 'exponents?|powers of|squared|cubed', 2],
  ['Expressions and equations', 'Math', 6, 7, '(?:algebraic )?expressions?|one-step equations?|two-step equations?|solve for x', 2.5],
  ['Probability', 'Math', 6, 7, 'probability|likely|outcomes?', 2.5],
  ['Mean, median and mode', 'Math', 5, 6, 'mean,? median|median and mode|measures of (?:center|central tendency)', 4],
  ['Linear equations', 'Math', 8, 9, 'linear (?:equations?|functions?)|slope|y ?= ?mx ?\\+ ?b|y-intercept', 3.5],
  ['Systems of equations', 'Math', 8, 9, 'systems? of (?:linear )?equations', 4],
  ['Pythagorean theorem', 'Math', 8, 8, 'pythagor(?:as|ean)', 4],
  ['Scientific notation', 'Math', 8, 8, 'scientific notation', 4],
  ['Quadratics', 'Math', 9, 10, 'quadratics?|parabola|completing the square|vertex form', 4],
  ['Polynomials', 'Math', 9, 10, 'polynomials?|factoring|binomials?', 3],
  ['Trigonometry', 'Math', 10, 11, 'trigonometr(?:y|ic)|sine|cosine|tangent|sohcahtoa|unit circle', 4],
  ['Logarithms', 'Math', 10, 12, 'logarithms?|exponential (?:growth|decay|functions?)', 4],
  ['Calculus', 'Math', 11, 12, 'calculus|derivatives?|integrals?|integration|limits? of', 4],
  ['Statistics', 'Math', 9, 12, 'standard deviation|normal distribution|regression|statistics', 3],
  // Science
  ['Five senses', 'Science', -1, 1, 'five senses|5 senses', 4],
  ['Living and non-living things', 'Science', 0, 2, 'living (?:and|or) non-?living|non-?living things', 4],
  ['Animal habitats', 'Science', 1, 4, 'habitats?', 3],
  ['Life cycles', 'Science', 1, 3, 'life cycles?|metamorphosis|caterpillar|tadpole', 3],
  ['Plants', 'Science', 1, 3, 'parts of a plant|seeds?|roots?|stems?|petals?', 2],
  ['Weather and seasons', 'Science', 0, 3, 'weather|seasons?|rainy|sunny', 2],
  ['States of matter', 'Science', 2, 5, 'states of matter|solids?,? liquids?|melting|freezing|evaporat', 3],
  ['Water cycle', 'Science', 3, 5, 'water cycle|evaporation|condensation|precipitation', 4],
  ['Magnets', 'Science', 2, 3, 'magnets?|magnetic', 3],
  ['Forces and motion', 'Science', 3, 6, 'forces?|push and pull|friction|gravity|motion', 2.5],
  ['Food chains and webs', 'Science', 3, 5, 'food chains?|food webs?|producers?|consumers?|decomposers?|predators?', 3],
  ['Solar system', 'Science', 3, 5, 'solar system|planets?|orbit|mercury|jupiter|saturn', 3],
  ['Moon phases', 'Science', 4, 6, 'moon phases?|phases of the moon|crescent|gibbous', 4],
  ['Rocks and minerals', 'Science', 3, 6, 'rock cycle|igneous|sedimentary|metamorphic|minerals?', 3.5],
  ['Ecosystems', 'Science', 5, 7, 'ecosystems?|biomes?|biodiversity', 3],
  ['Photosynthesis', 'Science', 5, 7, 'photosynthesis|chlorophyll|glucose', 4],
  ['Cells', 'Science', 6, 8, 'cell (?:membrane|wall|theory)|organelles?|mitochondria|nucleus|cytoplasm', 4],
  ['Human body systems', 'Science', 4, 7, 'body systems?|digestive system|circulatory|respiratory|skeleton|organs?', 3],
  ['Plate tectonics', 'Science', 6, 8, 'plate tectonics|tectonic plates?|earthquakes?|volcano(?:es)?', 3],
  ['Atoms and elements', 'Science', 7, 9, 'atoms?|protons?|neutrons?|electrons?|elements?', 2.5],
  ['Periodic table', 'Science', 8, 10, 'periodic table', 4],
  ['Chemical reactions', 'Science', 7, 10, 'chemical reactions?|reactants?|products of the reaction|balanc(?:e|ing) (?:chemical )?equations?', 3.5],
  ['Density', 'Science', 6, 8, 'density|sink or float', 3],
  ['Electric circuits', 'Science', 4, 8, 'circuits?|batter(?:y|ies)|conductors?|insulators?', 3],
  ['Waves, light and sound', 'Science', 4, 9, 'waves?|wavelength|frequency|light|sound|reflection|refraction', 1.5],
  ['Genetics and DNA', 'Science', 8, 10, '\\bdna\\b|genes?|genetics|heredity|punnett|alleles?', 4],
  ['Evolution', 'Science', 8, 10, 'evolution|natural selection|adaptations?', 3],
  ['Newton\'s laws', 'Science', 8, 11, 'newton\'?s (?:laws|first|second|third)|inertia', 4],
  ['Velocity and acceleration', 'Science', 9, 11, 'velocity|acceleration|kinematics|momentum', 3.5],
  ['Stoichiometry', 'Science', 10, 11, 'stoichiometry|molar mass|\\bmoles?\\b|avogadro', 4],
  ['Climate change', 'Science', 6, 10, 'climate change|greenhouse|global warming|carbon footprint', 3.5],
  // English Language Arts
  ['Alphabet', 'English Language Arts', -1, 0, 'alphabet|abc|letter of the day|uppercase and lowercase', 3],
  ['Phonics and letter sounds', 'English Language Arts', 0, 1, 'phonics|letter sounds?|beginning sounds?|cvc words?|blending|digraphs?', 4],
  ['Sight words', 'English Language Arts', 0, 1, 'sight words?|high[- ]frequency words', 4],
  ['Rhyming', 'English Language Arts', -1, 1, 'rhym(?:e|es|ing)', 3],
  ['Syllables', 'English Language Arts', 0, 2, 'syllables?', 3],
  ['Nouns, verbs and adjectives', 'English Language Arts', 1, 3, 'nouns?|verbs?|adjectives?', 3],
  ['Parts of speech', 'English Language Arts', 2, 5, 'parts of speech|adverbs?|pronouns?|prepositions?|conjunctions?', 3.5],
  ['Punctuation', 'English Language Arts', 1, 4, 'punctuation|capital letters?|full stops?|periods? and commas|question marks?', 3],
  ['Synonyms and antonyms', 'English Language Arts', 2, 4, 'synonyms?|antonyms?', 4],
  ['Homophones', 'English Language Arts', 2, 4, 'homophones?', 4],
  ['Prefixes and suffixes', 'English Language Arts', 3, 4, 'prefix(?:es)?|suffix(?:es)?|root words?', 4],
  ['Main idea', 'English Language Arts', 3, 5, 'main idea|key details|supporting details', 4],
  ['Reading comprehension', 'English Language Arts', 2, 6, 'reading comprehension|read the passage|according to the (?:text|passage)', 3],
  ['Story elements', 'English Language Arts', 2, 5, 'story elements|characters?,? setting|beginning,? middle,? (?:and )?end', 3.5],
  ['Figurative language', 'English Language Arts', 4, 7, 'figurative language|similes?|metaphors?|personification|hyperbole|idioms?|onomatopoeia', 4],
  ['Theme', 'English Language Arts', 5, 8, 'theme of the|central idea|universal theme', 3],
  ['Persuasive writing', 'English Language Arts', 5, 9, 'persuasive|argumentative|opinion writing|claims? and evidence|counterargument', 3.5],
  ['Literary devices', 'English Language Arts', 8, 10, 'literary devices|irony|foreshadowing|symbolism|allusion', 3.5],
  ['Shakespeare', 'English Language Arts', 9, 12, 'shakespeare|romeo|juliet|macbeth|hamlet|iambic', 4],
  ['Rhetoric', 'English Language Arts', 10, 12, 'rhetorical|ethos|pathos|logos|thesis statement', 4],
  // Social Studies
  ['Community helpers', 'Social Studies', -1, 1, 'community helpers?|firefighters?|police officers?', 4],
  ['Maps and globes', 'Social Studies', 2, 4, 'map skills|compass rose|map key|legend|cardinal directions', 3.5],
  ['Continents and oceans', 'Social Studies', 1, 3, 'continents?|oceans?', 3],
  ['Landforms', 'Social Studies', 2, 4, 'landforms?|peninsula|plateau|valley', 3.5],
  ['Latitude and longitude', 'Social Studies', 4, 6, 'latitude|longitude|equator|prime meridian', 4],
  ['Ancient civilizations', 'Social Studies', 6, 7, 'ancient (?:egypt|greece|rome|china|india)|mesopotamia|pharaohs?|pyramids?', 4],
  ['UAE heritage', 'Social Studies', 1, 8, 'uae|emirates|emirati|national day|sheikh zayed|falconry|dhow', 3],
  ['Government and civics', 'Social Studies', 5, 12, 'government|constitution|democracy|branches of government|elections?|voting', 3],
  ['World wars', 'Social Studies', 9, 11, 'world war|wwi|wwii|allies|axis powers', 4],
  ['Renaissance', 'Social Studies', 7, 9, 'renaissance', 4],
  ['Industrial Revolution', 'Social Studies', 8, 10, 'industrial revolution', 4],
  ['Economics', 'Social Studies', 9, 12, 'supply and demand|economics|inflation|gdp|scarcity', 3.5],
  // Arabic & Islamic Studies
  ['Arabic letters', 'Arabic', -1, 1, 'arabic (?:letters|alphabet)|الحروف|حروف|ألف باء', 4],
  ['Arabic vocabulary', 'Arabic', 1, 6, 'arabic (?:words|vocabulary)|كلمات|مفردات', 3],
  ['Pillars of Islam', 'Islamic Studies', 1, 4, 'pillars of islam|أركان الإسلام|five pillars', 4],
  ['Wudu', 'Islamic Studies', 0, 3, 'wudu|wudhu|الوضوء', 4],
  ['Quran recitation', 'Islamic Studies', 1, 8, 'surah|sura|tajweed|تجويد|سورة', 3],
  // Computer Science
  ['Algorithms and sequencing', 'Computer Science', 1, 5, 'algorithms?|sequencing|step-by-step instructions', 3],
  ['Loops', 'Computer Science', 3, 8, 'loops?|repeat (?:block|loop)|for loop|while loop', 3],
  ['Binary numbers', 'Computer Science', 6, 9, 'binary|bits? and bytes?', 4],
  ['Python programming', 'Computer Science', 7, 12, 'python', 4],
  ['Digital citizenship', 'Computer Science', 2, 8, 'digital citizenship|online safety|cyber ?bully(?:ing)?|passwords?|privacy online', 3.5],
  // Arts, Music, PE, SEL
  ['Color wheel', 'Art', 1, 4, 'color wheel|colour wheel|primary colou?rs|secondary colou?rs|warm and cool colou?rs', 4],
  ['Perspective drawing', 'Art', 6, 9, 'perspective drawing|vanishing point|one-point perspective', 4],
  ['Rhythm and beat', 'Music', 0, 4, 'rhythm|steady beat|quarter notes?|eighth notes?', 3.5],
  ['Reading music', 'Music', 3, 6, 'treble clef|bass clef|staff|note names', 4],
  ['Musical instruments', 'Music', 0, 4, 'instrument families|percussion|woodwinds?|brass|strings', 3],
  ['Nutrition', 'Physical Education & Health', 2, 6, 'nutrition|food groups|healthy eating|balanced diet|my ?plate', 4],
  ['Heart rate and fitness', 'Physical Education & Health', 4, 8, 'heart rate|pulse|cardio|fitness test', 3.5],
  ['Healthy habits', 'Physical Education & Health', -1, 3, 'healthy habits|wash(?:ing)? (?:your )?hands|brush(?:ing)? (?:your )?teeth|hygiene', 3.5],
  ['Feelings and emotions', 'Social-Emotional Learning', -1, 2, 'feelings?|emotions?|happy,? sad|how do you feel', 3],
  ['Mindfulness', 'Social-Emotional Learning', 0, 8, 'mindful(?:ness)?|breathing exercise|deep breaths?|calm down', 3.5],
  ['Growth mindset', 'Social-Emotional Learning', 3, 8, 'growth mindset|fixed mindset|power of yet', 4],
  ['Kindness and friendship', 'Social-Emotional Learning', -1, 3, 'kindness|be kind|friendship|sharing', 3],
];

const TYPE_SIGNALS = {
  Quiz: [['quiz', 4], ['اختبار|أسئلة', 3], ['quick check', 1.5], ['question \\d+|question:', 2], ['correct!?', 1.5], ['incorrect|try again|wrong', 1], ['score', 1.5], ['check (?:my |your )?answers?', 2.5], ['submit', 1], ['multiple choice', 3], ['true or false', 3], ['test yourself|knowledge check', 3]],
  Game: [['game', 3], ['لعبة|العب', 3], ['play again|start game|game over', 4], ['level \\d+|next level', 3], ['lives', 2], ['high ?score|best score', 3], ['you win|you won|winner', 2], ['timer|time left|seconds left', 1], ['points?', 1], ['drag and drop|drag the', 2], ['match(?:ing)? game|memory game', 3]],
  Flashcards: [['flash ?cards?', 5], ['flip (?:the )?card|click to flip|tap to flip', 4], ['shuffle', 1.5], ['next card', 3]],
  Simulation: [['simulation|simulate|simulator', 5], ['interactive model', 3], ['adjust the|use the slider|move the slider', 3], ['virtual lab|explore what happens', 3]],
  Lesson: [['lesson', 3], ['درس', 3], ['learning objectives?|objectives?:|i can', 3], ['introduction', 1.5], ['let\'s learn|did you know', 2], ['key vocabulary', 2], ['summary', 1], ['next slide|slide \\d+', 3], ['read the', 1]],
  Worksheet: [['worksheet', 5], ['ورقة عمل', 5], ['name: ?_+|date: ?_+', 4], ['show your work', 3], ['fill in the blanks?', 3], ['print (?:this|the) (?:page|worksheet)', 3], ['exit ticket', 3], ['graphic organizer', 3]],
  Tool: [['generator', 3], ['random (?:name|student|group) picker|name picker|spinner|wheel of names', 4], ['calculator', 3], ['stopwatch|countdown timer|class timer|noise meter', 4], ['seating chart|group maker|dice roller', 4], ['tool', 1.5]],
};

const GENERIC_TITLES = /^(document|untitled|index|home|my app|app|page|new tab|html|test|demo|interactive activity|activity|quiz|game|lesson)$/i;
const NUMBER_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countMatches(text, pattern, cap = 6) {
  if (!text) return 0;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  let n = 0;
  while (re.exec(text) && n < cap) n++;
  return n;
}

function arabicRatio(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (!letters) return 0;
  return (text.match(/[؀-ۿ]/g) || []).length / letters;
}

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level of running prose, or null when there isn't enough of it. */
export function readingGrade(text) {
  const sentences = String(text).split(/[.!?]+\s/).filter((s) => s.trim().split(/\s+/).length >= 3);
  const words = String(text).match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 80 || sentences.length < 4) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const fk = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return Math.max(0, Math.min(12, fk));
}

/** Explicit grade mentions like "Grade 4", "3rd grade", "Grades 3-5", "Year 7", "KG2", "Algebra I". */
export function explicitGrades(text) {
  const t = String(text);
  const found = [];
  const add = (lo, hi, why) => {
    if (lo > hi) [lo, hi] = [hi, lo];
    if (lo < -1 || hi > 12 || hi - lo > 6) return;
    found.push({ lo, hi, why });
  };
  let m;
  const range = /\b(?:grades?|gr\.?)\s*(k|\d{1,2})\s*(?:-|–|—|to|through|&|and)\s*(\d{1,2})\b/gi;
  while ((m = range.exec(t))) add(m[1].toLowerCase() === 'k' ? 0 : +m[1], +m[2], m[0]);
  const kRange = /\b(?:k|kg|kindergarten)\s*(?:-|–|—|to|through)\s*(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  while ((m = kRange.exec(t))) add(0, +m[1], m[0]);
  const single = /\b(?:grade|gr\.)\s*(\d{1,2})(?!\s*(?:%|\/|-|–|—|to\b|through\b|&|and\b|\d))/gi;
  while ((m = single.exec(t))) add(+m[1], +m[1], m[0]);
  const ordinal = /\b(\d{1,2})(?:st|nd|rd|th)[\s-]*grade(?:rs?)?\b/gi;
  while ((m = ordinal.exec(t))) add(+m[1], +m[1], m[0]);
  const words = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)[\s-]+grade(?:rs?)?\b/gi;
  while ((m = words.exec(t))) add(NUMBER_WORDS[m[1].toLowerCase()], NUMBER_WORDS[m[1].toLowerCase()], m[0]);
  const year = /\byears?\s*(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\b(?!\s*(?:old|olds|ago))/gi;
  while ((m = year.exec(t))) { const a = +m[1], b = m[2] ? +m[2] : a; if (a >= 1 && b <= 13) add(a - 1, b - 1, m[0]); }
  const ages = /\bages?\s*(\d{1,2})\s*(?:-|–|to|\+)\s*(\d{1,2})?\b/gi;
  while ((m = ages.exec(t))) { const a = +m[1], b = m[2] ? +m[2] : a + 2; if (a >= 3 && b <= 18) add(a - 6, b - 6, m[0]); }
  if (/\b(?:kg\s*1|pre-?k(?:indergarten)?|pre-?school|nursery)\b/i.test(t)) add(-1, -1, 'Pre-K');
  if (/\b(?:kg\s*2|kindergarten|kinder)\b/i.test(t)) add(0, 0, 'Kindergarten');
  if (/\bmiddle school\b/i.test(t)) add(6, 8, 'middle school');
  if (/\bhigh school\b/i.test(t)) add(9, 12, 'high school');
  if (/\b(?:AP|IB)\s+[A-Z][a-z]+/.test(t)) add(11, 12, 'AP/IB course');
  if (/\b(?:I?GCSE)\b/.test(t)) add(9, 10, 'GCSE');
  if (/\balgebra\s*(?:1|i)\b/i.test(t)) add(8, 9, 'Algebra I');
  if (/\balgebra\s*(?:2|ii)\b/i.test(t)) add(10, 11, 'Algebra II');
  if (/\bpre-?calculus\b/i.test(t)) add(11, 11, 'Pre-calculus');
  return found;
}

function cleanTitle(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '')
    .trim()
    .slice(0, 120);
}

function truncateWords(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,;:–—-]+$/, '') + '…';
}

function rawSignals(html) {
  return {
    canvas: /<canvas\b/i.test(html),
    ranges: (html.match(/<input[^>]+type=["']?range/gi) || []).length,
    inputs: (html.match(/<(?:input|textarea|select)\b/gi) || []).length,
    buttons: (html.match(/<button\b/gi) || []).length,
    animation: /requestAnimationFrame|setInterval/.test(html),
    printCss: /@media\s+print/i.test(html),
    scripts: /<script\b/i.test(html),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @returns {{title, description, grades, subject, concept, activityType, tags, language, confidence, reasons}}
 */
export function classify(rawHtml, { context = '' } = {}) {
  const html = String(rawHtml || '');
  const t = extractText(html);
  const headingText = t.headings.map((h) => h.text).join(' . ');
  const focus = [t.title, t.metaDescription, headingText].join(' . ');
  const rest = [t.body, t.strings.join(' . '), context].join(' . ');
  const reasons = [];

  // --- Language ---
  const arabic = arabicRatio(`${focus} ${rest}`);
  const langCode = t.lang.split('-')[0];
  const language = arabic > 0.3 || langCode === 'ar' ? 'Arabic'
    : { fr: 'French', es: 'Spanish', de: 'German', zh: 'Chinese', it: 'Italian', ja: 'Japanese', ko: 'Korean', ur: 'Urdu', hi: 'Hindi' }[langCode] || 'English';

  // --- Subject scores ---
  const scores = Object.fromEntries(SUBJECT_NAMES.map((s) => [s, 0]));
  for (const [subject, list] of Object.entries(SUBJECT_KEYWORDS)) {
    for (const [pattern, weight] of list) {
      scores[subject] += weight * (3 * countMatches(focus, pattern, 3) + countMatches(rest, pattern, 5));
    }
  }

  // --- Concepts (also vote for subject and grade) ---
  const conceptHits = [];
  for (const [label, subject, lo, hi, pattern, weight] of CONCEPTS) {
    const inFocus = countMatches(focus, pattern, 3);
    const inRest = countMatches(rest, pattern, 6);
    if (!inFocus && !inRest) continue;
    const w = weight * (4 * inFocus + Math.min(inRest, 6) * 0.6);
    conceptHits.push({ label, subject, lo, hi, w, inFocus });
    scores[subject] += w * 0.6;
  }

  if (language === 'Arabic') {
    const islamic = scores['Islamic Studies'];
    scores[islamic >= 6 ? 'Islamic Studies' : 'Arabic'] += 12;
  } else if (language !== 'English') {
    scores['World Languages'] += 10;
  }

  const ranked = Object.entries(scores).filter(([s]) => s !== 'Other').sort((a, b) => b[1] - a[1]);
  const [topSubject, topScore] = ranked[0];
  const secondScore = ranked[1] ? ranked[1][1] : 0;
  const subject = topScore >= 3 ? topSubject : 'Other';
  const subjectConfidence = topScore >= 8 && topScore >= secondScore * 1.8 ? 'high' : topScore >= 3 ? 'medium' : 'low';
  if (subject !== 'Other') reasons.push(`Subject: lots of ${subject.toLowerCase()} vocabulary`);

  // Concepts that belong to the chosen subject, strongest first.
  const relevant = conceptHits
    .filter((c) => subject === 'Other' || c.subject === subject)
    .sort((a, b) => b.w - a.w);

  // --- Grades ---
  let grades = [];
  let gradeConfidence = 'low';
  const explicitFocus = explicitGrades(focus);
  const explicitBody = explicitFocus.length ? [] : explicitGrades([t.body, t.strings.join(' . ')].join(' . '));
  const explicitContext = explicitFocus.length || explicitBody.length ? [] : explicitGrades(context);
  const explicit = explicitFocus.length ? explicitFocus : explicitBody.length ? explicitBody : explicitContext;
  if (explicit.length) {
    const best = explicit[0];
    grades = gradeRange(best.lo, best.hi);
    gradeConfidence = explicitFocus.length ? 'high' : 'medium';
    const where = explicitFocus.length ? 'in the title/headings' : explicitBody.length ? 'in the text' : 'in the message you pasted with the code';
    reasons.push(`Grade: found “${best.why.trim()}” ${where}`);
  } else if (relevant.length) {
    const top = relevant.slice(0, 4);
    const total = top.reduce((n, c) => n + c.w, 0);
    let lo = top.reduce((n, c) => n + c.lo * c.w, 0) / total;
    let hi = top.reduce((n, c) => n + c.hi * c.w, 0) / total;
    const fk = language === 'English' ? readingGrade(t.body) : null;
    if (fk !== null) {
      const center = (lo + hi) / 2;
      const shift = (fk - center) * 0.15;
      lo += shift;
      hi += shift;
    }
    lo = Math.round(lo);
    hi = Math.round(hi);
    if (hi - lo > 3) {
      const mid = Math.round((lo + hi) / 2);
      lo = mid - 1;
      hi = mid + 1;
    }
    grades = gradeRange(lo, hi);
    gradeConfidence = top[0].w >= 12 ? 'medium' : 'low';
    reasons.push(`Grade: ${top.map((c) => c.label.toLowerCase()).slice(0, 2).join(' and ')} ${top.length > 1 ? 'are' : 'is'} usually taught in ${formatGrades(grades)}`);
  } else {
    const fk = language === 'English' ? readingGrade(t.body) : null;
    if (fk !== null) {
      const c = Math.round(fk);
      grades = gradeRange(c - 1, c + 1);
      reasons.push(`Grade: estimated from the reading level of the text`);
    }
  }

  // --- Concept ---
  let concept = relevant.length ? relevant[0].label : '';
  if (relevant.length > 1 && relevant[1].w > relevant[0].w * 0.8 && relevant[1].label !== concept) {
    // Two strong concepts: prefer the more specific one (narrower grade range).
    const [a, b] = relevant;
    concept = (b.hi - b.lo) < (a.hi - a.lo) && b.inFocus >= a.inFocus ? b.label : a.label;
  }
  if (concept) reasons.push(`Concept: mentions ${concept.toLowerCase()}`);

  // --- Activity type ---
  const typeScores = {};
  for (const [type, list] of Object.entries(TYPE_SIGNALS)) {
    typeScores[type] = list.reduce((n, [p, w]) => n + w * (2 * countMatches(focus, p, 2) + countMatches(rest, p, 4)), 0);
  }
  const sig = rawSignals(html);
  if (sig.canvas && sig.ranges) typeScores.Simulation += 4;
  if (sig.canvas && sig.animation) typeScores.Game += 3;
  if (sig.ranges >= 2) typeScores.Simulation += 2;
  if (sig.printCss) typeScores.Worksheet += 2;
  if (sig.inputs >= 6 && !sig.canvas) typeScores.Worksheet += 1.5;
  const words = t.body.split(/\s+/).length;
  if (t.paragraphs.length >= 4 && words >= 150) typeScores.Lesson += sig.scripts ? 4 + Math.min(3, t.paragraphs.length - 4) : 5;
  else if (!sig.scripts && t.paragraphs.length >= 3) typeScores.Lesson += 3;
  const [bestType, bestTypeScore] = Object.entries(typeScores).sort((a, b) => b[1] - a[1])[0];
  const activityType = bestTypeScore >= 3 ? bestType : (sig.scripts ? 'Other' : 'Lesson');

  // --- Title ---
  const h1 = (t.headings.find((h) => h.level === 1) || t.headings[0] || {}).text || '';
  let title = cleanTitle(t.title);
  if (!title || GENERIC_TITLES.test(title)) title = cleanTitle(h1);
  if (!title || GENERIC_TITLES.test(title)) title = concept ? `${concept} ${activityType === 'Other' ? 'Activity' : activityType}` : '';

  // --- Description ---
  let description = t.metaDescription;
  if (!description) description = t.paragraphs.find((p) => p.split(/\s+/).length >= 8 && p.length <= 400) || '';
  if (!description && concept) {
    const kind = activityType === 'Other' ? 'activity' : activityType.toLowerCase();
    description = `An interactive ${kind} about ${concept.toLowerCase()}${grades.length ? ` for ${formatGrades(grades)}` : ''}.`;
  }
  description = truncateWords(description, 240);

  // --- Tags ---
  const tags = [];
  const strongest = relevant.length ? relevant[0].w : 0;
  for (const c of relevant.slice(0, 4)) {
    const tag = c.label.toLowerCase().replace(/,/g, '');
    if (c.w >= strongest * 0.35 && !tags.includes(tag)) tags.push(tag);
  }
  if (activityType !== 'Other') tags.push(activityType.toLowerCase());
  if (language !== 'English') tags.push(language.toLowerCase());

  return {
    title,
    description,
    grades,
    subject: SUBJECT_NAMES.includes(subject) ? subject : 'Other',
    concept,
    activityType: ACTIVITY_TYPES.includes(activityType) ? activityType : 'Other',
    tags: tags.slice(0, 6),
    language,
    confidence: { subject: subjectConfidence, grades: grades.length ? gradeConfidence : 'none' },
    reasons,
  };
}

export { gradeIndex };
