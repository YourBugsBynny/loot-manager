'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');

const htmlPath = path.join(__dirname, '..', 'loot-manager.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: <script id="core"> не знайдено'); process.exit(1); }
// той самий realm, що й тести: спільні прототипи для deepStrictEqual
const LMCore = new Function(m[1] + '\n;return LMCore;')();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name + '\n      ' + e.message); }
}

// ---- Task 1 ----
test('LMCore існує, DEFAULTS відповідає ТЗ §3.6', () => {
  assert.ok(LMCore, 'LMCore відсутній');
  assert.deepStrictEqual(LMCore.DEFAULTS, {
    scoreTop: 100, scorePresent: 50, pClass: 25, kPenalty: 10,
    historyDays: 14, wWon: 50,
    rarityWeights: { common: 1, rare: 2, epic: 4, legendary: 8 },
    webhookUrl: ''
  });
  assert.ok(Object.isFrozen(LMCore.DEFAULTS));
});
test('uuid: формат v4 і унікальність', () => {
  const a = LMCore.uuid(), b = LMCore.uuid();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notStrictEqual(a, b);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
