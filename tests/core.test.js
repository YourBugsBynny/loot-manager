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

// ---- Task 2 ----
const NOW = '2026-08-11T12:00:00.000Z';
test('emptyDb: перший запуск за ТЗ §7.1', () => {
  const db = LMCore.emptyDb(NOW);
  assert.strictEqual(db.schemaVersion, 1);
  assert.strictEqual(db.alliances.length, 1);
  assert.strictEqual(db.alliances[0].name, 'Мій альянс');
  assert.strictEqual(db.activeAllianceId, db.alliances[0].id);
  assert.deepStrictEqual(db.items, []);
  const names = db.classes.map(c => c.name);
  assert.deepStrictEqual(names, ['Танк', 'Хіл', 'Фріз/Контроль', 'МДД', 'РДД', 'Маг']);
  const tank = db.classes[0];
  assert.deepStrictEqual(
    [tank.wDmg, tank.wTaken, tank.wHeal, tank.isArchived], [0.2, 0.7, 0.1, false]);
  const pa = db.perAlliance[db.activeAllianceId];
  assert.deepStrictEqual(
    { p: pa.players, h: pa.history, e: pa.eventTypes, d: pa.draftSession },
    { p: [], h: [], e: [], d: null });
  assert.deepStrictEqual(db.settings, { ...LMCore.DEFAULTS,
    rarityWeights: { ...LMCore.DEFAULTS.rarityWeights } });
  assert.notStrictEqual(db.settings, LMCore.DEFAULTS); // копія, не посилання
  assert.ok(!Object.isFrozen(db.settings.rarityWeights));
});
test('migrate: v1 проходить, чужа версія — ні', () => {
  const db = LMCore.emptyDb(NOW);
  assert.strictEqual(LMCore.migrate(db).ok, true);
  const bad = LMCore.migrate({ ...db, schemaVersion: 2 });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /версі/i);
});
test('validateImport: відхиляє сміття, приймає валідну базу', () => {
  assert.strictEqual(LMCore.validateImport(null).ok, false);
  assert.strictEqual(LMCore.validateImport('рядок').ok, false);
  assert.strictEqual(LMCore.validateImport({ schemaVersion: 99 }).ok, false);
  const noPA = LMCore.emptyDb(NOW); delete noPA.perAlliance;
  assert.strictEqual(LMCore.validateImport(noPA).ok, false);
  const orphan = LMCore.emptyDb(NOW); orphan.perAlliance = {};
  assert.strictEqual(LMCore.validateImport(orphan).ok, false); // альянс без даних
  const good = LMCore.validateImport(LMCore.emptyDb(NOW));
  assert.strictEqual(good.ok, true);
  assert.ok(good.db);
});

// ---- Task 3 ----
function mkClass(id, name, wDmg, wTaken, wHeal) {
  return { id, name, wDmg, wTaken, wHeal, isArchived: false };
}
const CLS = {
  tank: mkClass('c-tank', 'Танк', 0.2, 0.7, 0.1),
  heal: mkClass('c-heal', 'Хіл', 0.1, 0.1, 0.8),
  mdd:  mkClass('c-mdd', 'МДД', 0.8, 0.1, 0.1)
};
const CLSBYID = Object.fromEntries(Object.values(CLS).map(c => [c.id, c]));
function mkPlayer(id, nickname, classId) {
  return { id, nickname, classId, role: 'Учасник', isActive: true, createdAt: NOW };
}
const P = {
  a: mkPlayer('p-a', 'Andriy', 'c-tank'),
  b: mkPlayer('p-b', 'Bohdan', 'c-heal'),
  c: mkPlayer('p-c', 'Chip', 'c-mdd')
};
const PBYID = { 'p-a': P.a, 'p-b': P.b, 'p-c': P.c };
const S = LMCore.DEFAULTS;

test('computeScores: простий режим — ТОП/присутній/відсутній', () => {
  const session = { mode: 'simple', presence: {
    'p-a': { present: true, top: true },
    'p-b': { present: true, top: false },
    'p-c': { present: false, top: true }   // відсутній ігнорується попри top
  }, drops: [], claims: {} };
  const sc = LMCore.computeScores(session, PBYID, CLSBYID, S);
  assert.deepStrictEqual(sc, { 'p-a': 100, 'p-b': 50 });
});
test('computeScores: розширений — нормалізація і ваги класу', () => {
  const session = { mode: 'advanced', presence: {
    'p-a': { present: true, damage: 50, taken: 200, heal: 0 },
    'p-b': { present: true, damage: 0, taken: 100, heal: 300 },
    'p-c': { present: true, damage: 100, taken: 0, heal: 0 }
  }, drops: [], claims: {} };
  const sc = LMCore.computeScores(session, PBYID, CLSBYID, S);
  // maxD=100, maxT=200, maxH=300
  assert.strictEqual(sc['p-a'], 100 * (0.2 * 0.5 + 0.7 * 1 + 0.1 * 0));   // 80
  assert.strictEqual(sc['p-b'], 100 * (0.1 * 0 + 0.1 * 0.5 + 0.8 * 1));   // 85
  assert.strictEqual(sc['p-c'], 100 * (0.8 * 1 + 0.1 * 0 + 0.1 * 0));     // 80
});
test('computeScores: нульові максимуми не дають NaN (ТЗ §7.2)', () => {
  const session = { mode: 'advanced', presence: {
    'p-a': { present: true, damage: 0, taken: 0, heal: 0 },
    'p-b': { present: true, damage: 0, taken: 0, heal: 0 }
  }, drops: [], claims: {} };
  assert.deepStrictEqual(LMCore.computeScores(session, PBYID, CLSBYID, S),
    { 'p-a': 0, 'p-b': 0 });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
