'use strict';
/* Guard для CLAUDE.md: кожне число й шлях у документі здобувається запуском,
   а не читанням. Падає з обома значеннями, щоб було видно, що з чим розійшлося. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const DOC = 'CLAUDE.md';
const docPath = path.join(ROOT, DOC);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name + '\n      ' + e.message); }
}

if (!fs.existsSync(docPath)) {
  console.error('FAIL: ' + DOC + ' відсутній');
  process.exit(1);
}
const doc = fs.readFileSync(docPath, 'utf8');

// ---- 1. Шляхи, названі в документі, існують ----
test('усі файли з таблиці «Файли» існують', () => {
  const claimed = [...doc.matchAll(/^\| `([^`]+)`/gm)].map(m => m[1]);
  assert.ok(claimed.length >= 5, DOC + ': таблиця файлів не розпізнана');
  for (const rel of claimed) {
    const clean = rel.replace(/<[^>]*>/g, '*');          // cards/<uid>_<ru|en>.jpg → шаблон
    if (clean.includes('*')) {
      const dir = path.join(ROOT, clean.split('/')[0]);
      assert.ok(fs.existsSync(dir), DOC + ' називає теку «' + clean.split('/')[0] +
        '», якої немає');
      continue;
    }
    assert.ok(fs.existsSync(path.join(ROOT, clean)),
      DOC + ' називає файл «' + rel + '», якого немає');
  }
});

// ---- 2. Специфікація, названа обов'язковою, лежить за вказаним шляхом ----
test('ТЗ існує за шляхом із документа', () => {
  const m = doc.match(/`(\.\.\/[^`]*ТЗ[^`]*\.md)`/);
  assert.ok(m, DOC + ': посилання на ТЗ не знайдено');
  assert.ok(fs.existsSync(path.join(ROOT, m[1])),
    DOC + ' посилається на «' + m[1] + '», якого немає');
});

// ---- 3. Команди з блоку «Команди» справді запускаються ----
test('тести ядра, названі в документі, проходять', () => {
  assert.ok(/node tests\/core\.test\.js/.test(doc),
    DOC + ': команда запуску тестів ядра не згадана');
  const out = cp.execSync('node tests/core.test.js', { cwd: ROOT, encoding: 'utf8' });
  const m = out.match(/(\d+) passed, (\d+) failed/);
  assert.ok(m, 'core.test.js не віддав підсумок');
  assert.strictEqual(m[2], '0', 'core.test.js: ' + m[2] + ' тестів падає');
});

// ---- 4. Функції LMCore, названі в документі, справді експортуються ----
test('LMCore-символи з документа існують у ядрі', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/);
  assert.ok(core, 'блок <script id="core"> не знайдено');
  const LMCore = new Function(core[1] + '\n;return LMCore;')();
  const named = [...doc.matchAll(/LMCore\.(\w+)/g)].map(m => m[1]);
  assert.ok(named.length > 0, DOC + ': жодної згадки LMCore.* — guard беззмістовний');
  for (const fn of named) {
    assert.ok(LMCore[fn] !== undefined,
      DOC + ' називає LMCore.' + fn + ', якого немає в ядрі');
  }
});

// ---- 5. Ключ сховища та версія схеми збігаються з кодом ----
test('ключ LocalStorage і schemaVersion збігаються з кодом', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const keyInCode = html.match(/const STORAGE_KEY = '([^']+)'/);
  const keyInDoc = doc.match(/ключ `(\w+)`/);
  assert.ok(keyInCode && keyInDoc, 'ключ сховища не розпізнано');
  assert.strictEqual(keyInDoc[1], keyInCode[1],
    DOC + ' каже «' + keyInDoc[1] + '», у коді «' + keyInCode[1] + '»');
  const verInCode = html.match(/schemaVersion:\s*(\d+)/)[1];
  const verInDoc = doc.match(/`schemaVersion:\s*(\d+)`/)[1];
  assert.strictEqual(verInDoc, verInCode,
    DOC + ' каже schemaVersion ' + verInDoc + ', у коді ' + verInCode);
});

// ---- 6. Константи алгоритму в документі = DEFAULTS у коді ----
test('константи алгоритму в документі збігаються з DEFAULTS', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
  const LMCore = new Function(core + '\n;return LMCore;')();
  const pairs = [
    ['pClass', /pClass\((\d+)\)/], ['kPenalty', /kPenalty\((\d+)\)/],
    ['wWon', /wWon\((\d+)\)/], ['historyDays', /`historyDays` \((\d+)\)/],
    ['scoreTop', /ТОП→(\d+)/], ['scorePresent', /учасник→(\d+)/]
  ];
  for (const [key, re] of pairs) {
    const m = doc.match(re);
    assert.ok(m, DOC + ': константу ' + key + ' не знайдено в тексті');
    assert.strictEqual(Number(m[1]), LMCore.DEFAULTS[key],
      DOC + ' каже ' + key + '=' + m[1] + ', у коді ' + LMCore.DEFAULTS[key]);
  }
});

// ---- 7. Мови в документі = мови в коді ----
test('перелік мов збігається з реалізацією', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const block = html.match(/const LANG_NAMES = \{([^}]*)\};/)[1];
  const inCode = [...block.matchAll(/(\w+):/g)].map(m => m[1]).sort();
  const inDoc = (doc.match(/\*\*([a-z]{2}) \(дефолт\) \+ ([a-z]{2})\*\*/) || []).slice(1).sort();
  assert.deepStrictEqual(inDoc, inCode,
    DOC + ' каже [' + inDoc + '], у коді [' + inCode + ']');
});

// ---- 8. Словники i18n симетричні (документ вимагає однакових ключів) ----
test('ключі I18N.ru та I18N.en збігаються', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const m = html.match(/const I18N = \{\n  ru: \{([\s\S]*?)\n  \},\n  en: \{([\s\S]*?)\n  \}\n\};/);
  assert.ok(m, 'блок I18N не розпізнано');
  const keys = b => new Set([...b.matchAll(/(?:^\s*|[,{]\s+)([a-zA-Z]\w*):/gm)].map(x => x[1]));
  const ru = keys(m[1]), en = keys(m[2]);
  const diff = [...ru].filter(k => !en.has(k)).concat([...en].filter(k => !ru.has(k)));
  assert.deepStrictEqual(diff, [], 'ключі розійшлися: ' + diff.join(', '));
});

// ---- 9. Засів: альянс і склад із seed.json = те, що обіцяє документ ----
test('data/seed.json парситься ядром і містить склад', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
  const LMCore = new Function(core + '\n;return LMCore;')();
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'));
  assert.ok(seed.allianceName, 'seed.json без allianceName');
  const parsed = LMCore.parseRoster(seed.roster || '');
  assert.strictEqual(parsed.ok, true, 'seed.json: склад не парситься — ' + parsed.error);
  const total = parsed.groups.reduce((s, g) => s + g.players.length, 0);
  assert.ok(total > 0, 'seed.json: у складі нуль гравців');
});

// ---- 10. Картки: кожна має обидві мовні версії (конвенція з документа) ----
test('cards/<uid>_<мова>.jpg — обидві мови для кожного uid', () => {
  const dir = path.join(ROOT, 'cards');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg'));
  const byUid = {};
  for (const f of files) {
    const m = f.match(/^(\d+)_(ru|en)\.jpg$/);
    assert.ok(m, 'cards/' + f + ' не відповідає конвенції <uid>_<ru|en>.jpg');
    (byUid[m[1]] = byUid[m[1]] || []).push(m[2]);
  }
  const incomplete = Object.entries(byUid)
    .filter(([, langs]) => !(langs.includes('ru') && langs.includes('en')))
    .map(([uid]) => uid);
  assert.deepStrictEqual(incomplete, [], 'без пари ru/en: uid ' + incomplete.join(', '));
});

// ---- 11. Групи класів: документ і код називають однакові дефолти ----
test('групи класів у документі збігаються з ядром', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
  const LMCore = new Function(core + '\n;return LMCore;')();
  const db = LMCore.emptyDb(new Date(0).toISOString());
  const inCode = db.classes.filter(c => c.group === 'A').map(c => c.name).sort();
  assert.deepStrictEqual(inCode, ['Воин', 'Жрец'],
    'засів груп змінився: ' + inCode.join(', '));
  const namesInDoc = (doc.match(/воин\/жрец\/танк\/лекарь\/хил/) || [])[0];
  assert.ok(namesInDoc, DOC + ': перелік назв класів групи A не знайдено');
  for (const n of namesInDoc.split('/')) {
    assert.strictEqual(LMCore.groupForClassName(n), 'A',
      DOC + ' називає «' + n + '» групою A, у коді — ' + LMCore.groupForClassName(n));
  }
  assert.ok(/перша група класів/.test(doc), DOC + ': опис етапів розподілу не знайдено');
});

// ---- 12. Дефолт порядку етапів у документі = поведінка коду ----
test('межа «ранок/вечір» у документі збігається з кодом', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
  const LMCore = new Function(core + '\n;return LMCore;')();
  const m = doc.match(/`defaultFirstGroup`: <(\d+) год → A/);
  assert.ok(m, DOC + ': межу defaultFirstGroup не знайдено');
  const bound = Number(m[1]);
  assert.strictEqual(LMCore.defaultFirstGroup(bound - 1), 'A');
  assert.strictEqual(LMCore.defaultFirstGroup(bound), 'B');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
