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
    webhookUrl: '', language: 'ru'
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
  assert.strictEqual(db.schemaVersion, 2);
  assert.strictEqual(db.alliances.length, 1);
  assert.strictEqual(db.alliances[0].name, 'Мой альянс');
  assert.strictEqual(db.activeAllianceId, db.alliances[0].id);
  assert.deepStrictEqual(db.items, []);
  const names = db.classes.map(c => c.name);
  assert.deepStrictEqual(names, ['Маг', 'Воин', 'Жрец', 'Разбойник', 'Лучник']);
  const mag = db.classes[0];
  assert.deepStrictEqual(
    [mag.wDmg, mag.wTaken, mag.wHeal, mag.isArchived], [0.8, 0.1, 0.1, false]);
  assert.strictEqual(mag.group, 'B');
  assert.strictEqual(db.classes[1].group, 'A');   // Воин
  assert.strictEqual(db.classes[2].group, 'A');   // Жрец
  const pa = db.perAlliance[db.activeAllianceId];
  assert.deepStrictEqual(
    { p: pa.players, h: pa.history, e: pa.eventTypes, d: pa.draftSession },
    { p: [], h: [], e: [], d: null });
  assert.deepStrictEqual(db.settings, { ...LMCore.DEFAULTS,
    rarityWeights: { ...LMCore.DEFAULTS.rarityWeights } });
  assert.notStrictEqual(db.settings, LMCore.DEFAULTS); // копія, не посилання
  assert.ok(!Object.isFrozen(db.settings.rarityWeights));
});
test('migrate: база v1 піднімається до v2 — групи класів, чиста чернетка', () => {
  const old = LMCore.emptyDb(NOW);
  old.schemaVersion = 1;
  for (const c of old.classes) delete c.group;
  const aid = old.activeAllianceId;
  old.perAlliance[aid].draftSession = {
    eventTypeName: 'Вторжение', mode: 'advanced',
    presence: { 'p-x': { present: true, top: true, damage: 500, taken: 0, heal: 0 },
                'p-y': { present: false, top: false, damage: 0, taken: 0, heal: 0 } },
    drops: [{ itemId: 'i-box', quantity: 1 }], claims: {}, overrides: {}, rollMemo: {} };
  old.perAlliance[aid].history.push({ id: 'r1', timestamp: NOW, eventTypeName: 'Старий',
    itemId: 'i-box', itemNameSnapshot: 'Скриня', playerId: 'p-x',
    playerNicknameSnapshot: 'X', quantity: 1, scoreAtDistribution: 50,
    rolled: false, manual: false, cancelled: false });

  const res = LMCore.migrate(old);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.db.schemaVersion, 2);
  assert.deepStrictEqual(res.db.classes.map(c => c.name + ':' + c.group),
    ['Маг:B', 'Воин:A', 'Жрец:A', 'Разбойник:B', 'Лучник:B']);
  const d = res.db.perAlliance[aid].draftSession;
  assert.strictEqual(d.mode, undefined);
  assert.deepStrictEqual(d.presence, { 'p-x': { top: true }, 'p-y': { top: false } });
  assert.ok(d.firstGroup === 'A' || d.firstGroup === 'B');
  assert.deepStrictEqual(d.drops, [{ itemId: 'i-box', quantity: 1 }]);
  assert.strictEqual(res.db.perAlliance[aid].history.length, 1,
    'історія — снапшоти минулих івентів, міграція їх не чіпає');
  assert.strictEqual(res.db.perAlliance[aid].history[0].scoreAtDistribution, 50);
});
test('migrate: база v2 проходить без змін, чужа версія — ні', () => {
  const fresh = LMCore.emptyDb(NOW);
  assert.strictEqual(fresh.schemaVersion, 2);
  assert.strictEqual(LMCore.migrate(fresh).ok, true);
  const bad = LMCore.migrate({ ...fresh, schemaVersion: 99 });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /версі/i);
});
test('migrate: стара мова uk падає на ru (обидві версії схеми)', () => {
  const v1 = LMCore.emptyDb(NOW); v1.schemaVersion = 1; v1.settings.language = 'uk';
  assert.strictEqual(LMCore.migrate(v1).db.settings.language, 'ru');
  const v2 = LMCore.emptyDb(NOW); v2.settings.language = 'uk';
  assert.strictEqual(LMCore.migrate(v2).db.settings.language, 'ru');
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
function mkClass(id, name, wDmg, wTaken, wHeal, group) {
  return { id, name, wDmg, wTaken, wHeal, group: group || 'B', isArchived: false };
}
const CLS = {
  tank: mkClass('c-tank', 'Танк', 0.2, 0.7, 0.1, 'A'),
  heal: mkClass('c-heal', 'Хіл', 0.1, 0.1, 0.8, 'A'),
  mdd:  mkClass('c-mdd', 'МДД', 0.8, 0.1, 0.1, 'B')
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

test('computeScores v3: усі активні гравці мають бал, ТОП — більший', () => {
  const session = { presence: { 'p-a': { top: true } } };
  const scores = LMCore.computeScores(session, PBYID, S);
  assert.deepStrictEqual(scores, { 'p-a': 100, 'p-b': 50, 'p-c': 50 });
});
test('computeScores v3: вибулий гравець балу не отримує', () => {
  const players = { ...PBYID, 'p-b': { ...P.b, isActive: false } };
  const scores = LMCore.computeScores({ presence: {} }, players, S);
  assert.deepStrictEqual(Object.keys(scores).sort(), ['p-a', 'p-c']);
});
test('computeScores v3: порожня чернетка — усі по 50', () => {
  const scores = LMCore.computeScores({}, PBYID, S);
  assert.deepStrictEqual(scores, { 'p-a': 50, 'p-b': 50, 'p-c': 50 });
});
test('groupForClassName: танки й лекарі — A, решта — B', () => {
  for (const n of ['Воин', 'воин', 'Жрец', 'Танк', 'Лекарь', 'Хил']) {
    assert.strictEqual(LMCore.groupForClassName(n), 'A', n);
  }
  for (const n of ['Маг', 'Разбойник', 'Лучник', 'Некромант', '']) {
    assert.strictEqual(LMCore.groupForClassName(n), 'B', n);
  }
});
test('defaultFirstGroup: до 15:00 — танки/лекарі, далі — ДД', () => {
  assert.strictEqual(LMCore.defaultFirstGroup(9), 'A');
  assert.strictEqual(LMCore.defaultFirstGroup(14), 'A');
  assert.strictEqual(LMCore.defaultFirstGroup(15), 'B');
  assert.strictEqual(LMCore.defaultFirstGroup(21), 'B');
});

// ---- Task 4 ----
function mkItem(id, name, rarity, targetClasses, category) {
  return { id, name, category: category || 'Зброя', targetClasses: targetClasses || [],
           rarity, isArchived: false };
}
const IT = {
  sword: mkItem('i-sword', 'Меч', 'legendary', ['c-tank']),
  staff: mkItem('i-staff', 'Посох', 'epic', ['c-heal']),
  box:   mkItem('i-box', 'Скриня', 'common', [], 'Ресурси')
};
const ITBYID = Object.fromEntries(Object.values(IT).map(i => [i.id, i]));
function mkRec(playerId, itemId, timestamp, quantity, cancelled) {
  return { id: LMCore.uuid(), timestamp, eventTypeName: 'Тест', itemId,
    itemNameSnapshot: ITBYID[itemId].name, playerId,
    playerNicknameSnapshot: 'x', quantity: quantity || 1,
    scoreAtDistribution: 0, rolled: false, manual: false, cancelled: !!cancelled };
}
const rngZero = () => 0;

test('historyLoad: вікно N днів, cancelled і рідкість (ТЗ §5.4, §7.7)', () => {
  const hist = [
    mkRec('p-a', 'i-sword', '2026-08-10T00:00:00.000Z', 1),        // legendary ×8
    mkRec('p-a', 'i-box',   '2026-08-01T00:00:00.000Z', 3),        // common ×1×3
    mkRec('p-a', 'i-staff', '2026-07-01T00:00:00.000Z', 1),        // поза вікном 14 дн
    mkRec('p-a', 'i-staff', '2026-08-09T00:00:00.000Z', 1, true),  // cancelled
    mkRec('p-b', 'i-sword', '2026-08-10T00:00:00.000Z', 1)         // чужий
  ];
  assert.strictEqual(LMCore.historyLoad(hist, ITBYID, 'p-a', NOW, S), 8 + 3);
});
// з v3.0.0 бонуси й штрафи порівнюють претендентів усередині одного етапу,
// тому обидва претенденти тут — з групи A (танк і хіл)
test('distribute: клас-бонус перемагає при рівному вкладі (крит. приймання 4)', () => {
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: false }, 'p-b': { top: false } },
    drops: [{ itemId: 'i-sword', quantity: 1 }],
    claims: { 'p-a': ['i-sword'], 'p-b': ['i-sword'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions.length, 1);
  assert.strictEqual(positions[0].winnerId, 'p-a');          // танк, бонус +25
  assert.strictEqual(positions[0].classBonus, true);
  assert.strictEqual(positions[0].rolled, false);
  assert.deepStrictEqual(positions[0].candidates.map(c => c.playerId), ['p-a', 'p-b']);
  assert.strictEqual(positions[0].candidates[0].priority, 75);   // 50+25
  assert.strictEqual(positions[0].candidates[1].priority, 50);
});
test('distribute: анти-жадібність — вчорашня легендарка програє (крит. 5)', () => {
  const hist = [mkRec('p-a', 'i-sword', '2026-08-10T00:00:00.000Z', 1)];
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: false }, 'p-b': { top: false } },
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'], 'p-b': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: hist, settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions[0].winnerId, 'p-b');   // p-a: 50−10·8=−30
});
test('distribute: етап важить більше за штраф — жадібний танк випереджає ДД', () => {
  const hist = [mkRec('p-a', 'i-sword', '2026-08-10T00:00:00.000Z', 1)];
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: hist, settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  // p-a має −30 проти 50 у p-c, але p-c у другій групі й до першого етапу не допущений
  assert.strictEqual(positions[0].winnerId, 'p-a');
  assert.strictEqual(positions[0].stage, 1);
});
test('distribute: порядок за рідкістю, одна штука на гравця, вільний залишок', () => {
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: false }, 'p-b': { top: false } },
    drops: [{ itemId: 'i-box', quantity: 3 }, { itemId: 'i-sword', quantity: 1 }],
    claims: { 'p-a': ['i-box', 'i-sword'], 'p-b': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  // сортування: sword (legendary) перший, потім 3 позиції скрині
  assert.deepStrictEqual(positions.map(p => p.itemId),
    ['i-sword', 'i-box', 'i-box', 'i-box']);
  assert.strictEqual(positions[0].winnerId, 'p-a');       // єдиний претендент
  // скриня №1: p-a виграв меч → wWon·1: 50−50=0 проти p-b 50 → p-b
  assert.strictEqual(positions[1].winnerId, 'p-b');
  // скриня №2: p-b уже має скриню (одна штука на гравця) → лишається p-a
  assert.strictEqual(positions[2].winnerId, 'p-a');
  // скриня №3: обидва вже мають → вільний залишок
  assert.strictEqual(positions[3].winnerId, null);
});
test('distribute: нічия — рол за rng, rollMemo стабілізує перерахунок (крит. 8)', () => {
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: false }, 'p-b': { top: false } },
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'], 'p-b': ['i-box'] } };
  const ctx = { session, playersById: PBYID, classesById: CLSBYID, itemsById: ITBYID,
    history: [], settings: S, nowISO: NOW, overrides: {}, rollMemo: {},
    rng: () => 0.9 };                                    // обере останнього лідера
  const r1 = LMCore.distribute(ctx);
  assert.strictEqual(r1.positions[0].rolled, true);
  assert.strictEqual(r1.positions[0].winnerId, 'p-b');
  // мемоізуємо і перераховуємо з іншим rng — переможець не змінюється
  const memo = { [r1.positions[0].key]: r1.positions[0].winnerId };
  const r2 = LMCore.distribute({ ...ctx, rng: () => 0, rollMemo: memo });
  assert.strictEqual(r2.positions[0].winnerId, 'p-b');
  assert.strictEqual(r2.positions[0].rolled, true);
});
test('distribute: override — ручний переможець поза претендентами, перерахунок нижче', () => {
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: true }, 'p-b': { top: false } },
    drops: [{ itemId: 'i-sword', quantity: 1 }, { itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-sword', 'i-box'] } };   // p-b нічого не просив
  const base = { session, playersById: PBYID, classesById: CLSBYID, itemsById: ITBYID,
    history: [], settings: S, nowISO: NOW, rng: rngZero, rollMemo: {} };
  const auto = LMCore.distribute({ ...base, overrides: {} });
  assert.strictEqual(auto.positions[0].winnerId, 'p-a');   // меч
  assert.strictEqual(auto.positions[1].winnerId, 'p-a');   // і скриня (єдиний претендент)
  // офіцер віддає меч p-b вручну:
  const over = LMCore.distribute({ ...base, overrides: { 'i-sword#0': 'p-b' } });
  assert.strictEqual(over.positions[0].winnerId, 'p-b');
  assert.strictEqual(over.positions[0].manual, true);
  // p-a більше не має wWon-штрафу і забирає скриню з повним балом (без клас-бонусу)
  assert.strictEqual(over.positions[1].winnerId, 'p-a');
  assert.strictEqual(over.positions[1].priority, 100);
});

// ---- v3.0.0: два етапи розподілу ----
const stageCtx = session => ({ session, playersById: PBYID, classesById: CLSBYID,
  itemsById: ITBYID, history: [], settings: S, nowISO: NOW, rng: rngZero,
  overrides: {}, rollMemo: {} });

test('distribute: етап 1 (танки/лекарі) забирає предмет, ДД дістається залишок', () => {
  const { positions } = LMCore.distribute(stageCtx({ eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } }));   // p-a — танк (A), p-c — МДД (B)
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-a', 'p-c']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: вечірній порядок дзеркалить результат', () => {
  const { positions } = LMCore.distribute(stageCtx({ eventTypeName: 'Бос', firstGroup: 'B',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } }));
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-c', 'p-a']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: гравець першого етапу без виграшу в другий не переходить', () => {
  const { positions } = LMCore.distribute(stageCtx({ eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-b': ['i-box'] } }));   // обидва — група A
  assert.deepStrictEqual(positions.map(p => p.winnerId).sort(), ['p-a', 'p-b']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 1]);
});
test('distribute: вільний залишок після обох етапів іде в другий етап', () => {
  const { positions } = LMCore.distribute(stageCtx({ eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'] } }));
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-a', null]);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: wWon діє наскрізно всередині етапу', () => {
  const { positions } = LMCore.distribute(stageCtx({ eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-sword', quantity: 1 }, { itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-sword', 'i-box'], 'p-b': ['i-box'] } }));
  assert.strictEqual(positions[0].winnerId, 'p-a');   // меч: єдиний претендент
  assert.strictEqual(positions[1].winnerId, 'p-b');   // скриня: p-a 50−50=0 проти p-b 50
  assert.strictEqual(positions[1].rolled, false);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 1]);
});
test('distribute: override віддає предмет гравцю іншої групи, stage — за його групою', () => {
  const ctx = stageCtx({ eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'] } });
  const { positions } = LMCore.distribute({ ...ctx, overrides: { 'i-box#0': 'p-c' } });
  assert.strictEqual(positions[0].winnerId, 'p-c');
  assert.strictEqual(positions[0].manual, true);
  assert.strictEqual(positions[0].stage, 2);          // p-c у групі B, першою йде A
  assert.deepStrictEqual(positions[0].candidates.map(c => c.playerId), ['p-a']);
});

// ---- Task 5 ----
test('topContributors v3: лише прапорець ТОП, режимів більше немає', () => {
  const session = { presence: { 'p-a': { top: true }, 'p-b': { top: false } } };
  const scores = LMCore.computeScores(session, PBYID, S);
  assert.deepStrictEqual([...LMCore.topContributors(session, scores)], ['p-a']);
  assert.deepStrictEqual([...LMCore.topContributors({ presence: {} }, scores)], []);
});
test('formatReport: дефолт без lang — російська, побайтово (ТЗ §6)', () => {
  const cls6 = [mkClass('c1', 'Танк', 0.2, 0.7, 0.1), mkClass('c2', 'Маг', 0.8, 0.1, 0.1),
    mkClass('c3', 'МДД', 0.8, 0.1, 0.1), mkClass('c4', 'Хіл', 0.1, 0.1, 0.8),
    mkClass('c5', 'РДД', 0.8, 0.1, 0.1)];
  const classesById = Object.fromEntries(cls6.map(c => [c.id, c]));
  const pl = [['n1', 'Нік1', 'c1'], ['n2', 'Нік2', 'c2'], ['n3', 'Нік3', 'c2'],
    ['n4', 'Нік4', 'c3'], ['n5', 'Нік5', 'c4'], ['n6', 'Нік6', 'c5']]
    .map(([id, nickname, classId]) => mkPlayer(id, nickname, classId));
  const playersById = Object.fromEntries(pl.map(p => [p.id, p]));
  const items6 = [mkItem('m', 'Меч Дракона', 'legendary'), mkItem('s', 'Посох Сили', 'epic'),
    mkItem('k', 'Кольчуга Гвардійця', 'rare'), mkItem('r', 'Сундук Ресурсів', 'common')];
  const itemsById = Object.fromEntries(items6.map(i => [i.id, i]));
  const mkPos = (itemId, copyIndex, winnerId) => ({ key: itemId + '#' + copyIndex,
    itemId, copyIndex, winnerId, priority: 0, rolled: false, manual: false,
    stage: 1, classBonus: false, candidates: [] });
  const positions = [
    mkPos('m', 0, 'n1'), mkPos('s', 0, 'n2'), mkPos('s', 1, 'n3'),
    mkPos('k', 0, 'n4'), mkPos('r', 0, 'n5'), mkPos('r', 1, 'n6'), mkPos('r', 2, null)
  ];
  const text = LMCore.formatReport({ allianceName: 'Alpha', eventTypeName: 'PvP-Івент',
    positions, itemsById, playersById, classesById, topSet: new Set(['n1']),
    firstGroup: 'A' });
  assert.strictEqual(text,
    '📜 [АЛЬЯНС: Alpha] РАСПРЕДЕЛЕНИЕ ДОБЫЧИ (PvP-Івент)\n' +
    '\n' +
    '▸ ЭТАП 1 — Танки и лекари\n' +
    '🔹 Меч Дракона (1 шт.) — @Нік1 [Танк | ТОП Вклад]\n' +
    '🔹 Посох Сили (2 шт.) — @Нік2 [Маг], @Нік3 [Маг]\n' +
    '🔹 Кольчуга Гвардійця (1 шт.) — @Нік4 [МДД]\n' +
    '🔹 Сундук Ресурсів (3 шт.) — @Нік5 [Хіл], @Нік6 [РДД], [Свободный остаток]\n' +
    '\n' +
    'Спасибо всем за участие! Предметы ждут в магазине альянса.');
});
test('formatReport: кілька вільних штук — одна позначка', () => {
  const itemsById = { b: mkItem('b', 'Скриня', 'common') };
  const mkPos2 = (ci, w) => ({ key: 'b#' + ci, itemId: 'b', copyIndex: ci, winnerId: w,
    priority: w ? 0 : null, rolled: false, manual: false, classBonus: false, candidates: [] });
  const text = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X',
    positions: [mkPos2(0, 'p-a'), mkPos2(1, null), mkPos2(2, null)],
    itemsById, playersById: PBYID, classesById: CLSBYID, topSet: new Set() });
  assert.strictEqual((text.match(/\[Свободный остаток\]/g) || []).length, 1);
});
test('formatReport v3: дві секції етапів у порядку сеансу', () => {
  const positions = [
    { key: 'i-sword#0', itemId: 'i-sword', copyIndex: 0, winnerId: 'p-a', stage: 1,
      priority: 100, rolled: false, manual: false, classBonus: false, candidates: [] },
    { key: 'i-box#0', itemId: 'i-box', copyIndex: 0, winnerId: 'p-c', stage: 2,
      priority: 50, rolled: false, manual: false, classBonus: false, candidates: [] },
    { key: 'i-box#1', itemId: 'i-box', copyIndex: 1, winnerId: null, stage: 2,
      priority: null, rolled: false, manual: false, classBonus: false, candidates: [] }
  ];
  const text = LMCore.formatReport({ allianceName: 'СПАРТА', eventTypeName: 'Бос',
    positions, itemsById: ITBYID, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(['p-a']), lang: 'ru', firstGroup: 'A' });
  const lines = text.split('\n').filter(Boolean);
  assert.strictEqual(lines[1], '▸ ЭТАП 1 — Танки и лекари');
  assert.strictEqual(lines[2], '🔹 Меч (1 шт.) — @Andriy [Танк | ТОП Вклад]');
  assert.strictEqual(lines[3], '▸ ЭТАП 2 — ДД');
  assert.strictEqual(lines[4], '🔹 Скриня (2 шт.) — @Chip [МДД], [Свободный остаток]');
});
test('formatReport v3: вечірній порядок міняє підписи етапів місцями', () => {
  const positions = [
    { key: 'i-box#0', itemId: 'i-box', copyIndex: 0, winnerId: 'p-c', stage: 1,
      priority: 50, rolled: false, manual: false, classBonus: false, candidates: [] }
  ];
  const text = LMCore.formatReport({ allianceName: 'СПАРТА', eventTypeName: 'Бос',
    positions, itemsById: ITBYID, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(), lang: 'ru', firstGroup: 'B' });
  assert.ok(text.includes('▸ ЭТАП 1 — ДД'), text);
  assert.ok(!text.includes('ЭТАП 2'), 'порожній етап не друкується');
});
test('buildRecords: групування пар гравець×предмет, снапшоти, пропуск залишку (крит. 11)', () => {
  const mkPos3 = (itemId, ci, w, extra) => Object.assign({ key: itemId + '#' + ci, itemId,
    copyIndex: ci, winnerId: w, priority: 0, rolled: false, manual: false,
    classBonus: false, candidates: [] }, extra);
  const positions = [
    mkPos3('i-box', 0, 'p-a', { rolled: true }),
    mkPos3('i-box', 1, 'p-a', { manual: true }),
    mkPos3('i-box', 2, null),
    mkPos3('i-sword', 0, 'p-b')
  ];
  const recs = LMCore.buildRecords({ positions, itemsById: ITBYID, playersById: PBYID,
    scores: { 'p-a': 100, 'p-b': 50 }, nowISO: NOW, eventTypeName: 'Бос' });
  assert.strictEqual(recs.length, 2);
  const boxRec = recs.find(r => r.itemId === 'i-box');
  assert.deepStrictEqual({
    q: boxRec.quantity, r: boxRec.rolled, m: boxRec.manual, c: boxRec.cancelled,
    nick: boxRec.playerNicknameSnapshot, item: boxRec.itemNameSnapshot,
    sc: boxRec.scoreAtDistribution, t: boxRec.timestamp, ev: boxRec.eventTypeName
  }, { q: 2, r: true, m: true, c: false, nick: 'Andriy', item: 'Скриня',
       sc: 100, t: NOW, ev: 'Бос' });
  assert.match(boxRec.id, /^[0-9a-f-]{36}$/i);
  const swordRec = recs.find(r => r.itemId === 'i-sword');
  assert.deepStrictEqual([swordRec.quantity, swordRec.rolled, swordRec.manual],
    [1, false, false]);
});

// ---- i18n (v1.1) ----
test('migrate: бекфіл і нормалізація settings.language (дефолт ru)', () => {
  const noLang = LMCore.emptyDb(NOW);
  delete noLang.settings.language;
  assert.strictEqual(LMCore.migrate(noLang).db.settings.language, 'ru');
  const ukDb = LMCore.emptyDb(NOW);
  ukDb.settings.language = 'uk';   // мова, якої більше немає в переліку
  assert.strictEqual(LMCore.migrate(ukDb).db.settings.language, 'ru');
  const enDb = LMCore.emptyDb(NOW);
  enDb.settings.language = 'en';
  assert.strictEqual(LMCore.migrate(enDb).db.settings.language, 'en');
});
test('formatReport: російська — побайтово', () => {
  const itemsById = { b: mkItem('b', 'Скриня', 'common') };
  const mkPosL = (ci, w) => ({ key: 'b#' + ci, itemId: 'b', copyIndex: ci, winnerId: w,
    priority: 0, rolled: false, manual: false, stage: 1, classBonus: false, candidates: [] });
  const text = LMCore.formatReport({ allianceName: 'Alpha', eventTypeName: 'PvP',
    positions: [mkPosL(0, 'p-a'), mkPosL(1, null)],
    itemsById, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(['p-a']), lang: 'ru', firstGroup: 'A' });
  assert.strictEqual(text,
    '📜 [АЛЬЯНС: Alpha] РАСПРЕДЕЛЕНИЕ ДОБЫЧИ (PvP)\n' +
    '\n' +
    '▸ ЭТАП 1 — Танки и лекари\n' +
    '🔹 Скриня (2 шт.) — @Andriy [Танк | ТОП Вклад], [Свободный остаток]\n' +
    '\n' +
    'Спасибо всем за участие! Предметы ждут в магазине альянса.');
});
test('formatReport: англійська — побайтово', () => {
  const itemsById = { b: mkItem('b', 'Скриня', 'common') };
  const mkPosL = (ci, w) => ({ key: 'b#' + ci, itemId: 'b', copyIndex: ci, winnerId: w,
    priority: 0, rolled: false, manual: false, stage: 1, classBonus: false, candidates: [] });
  const text = LMCore.formatReport({ allianceName: 'Alpha', eventTypeName: 'PvP',
    positions: [mkPosL(0, 'p-a'), mkPosL(1, null)],
    itemsById, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(['p-a']), lang: 'en', firstGroup: 'A' });
  assert.strictEqual(text,
    '📜 [ALLIANCE: Alpha] LOOT DISTRIBUTION (PvP)\n' +
    '\n' +
    '▸ STAGE 1 — Tanks & healers\n' +
    '🔹 Скриня (2 pcs) — @Andriy [Танк | TOP Contribution], [Unclaimed]\n' +
    '\n' +
    'Thanks everyone for participating! Items are waiting in the alliance shop.');
});
test('formatReport: невідома мова падає на російську', () => {
  const itemsById = { b: mkItem('b', 'Скриня', 'common') };
  const pos = { key: 'b#0', itemId: 'b', copyIndex: 0, winnerId: 'p-a',
    priority: 0, rolled: false, manual: false, classBonus: false, candidates: [] };
  const text = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X',
    positions: [pos], itemsById, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(), lang: 'uk' });
  assert.ok(text.includes('РАСПРЕДЕЛЕНИЕ ДОБЫЧИ'));
  assert.ok(text.endsWith('Спасибо всем за участие! Предметы ждут в магазине альянса.'));
});

// ---- Синхронізація з каталогом (v1.4) ----
const CAT = [
  { uid: 1, ru: 'Гидра тёмного прилива', en: 'Dark Tide Hydra', rarity: 4,
    rarity_ru: 'Уник.', rarity_en: 'Unique', creature: '2219_1', confident: true,
    icon: 'icons/loot_002.png', stats: [['Уклонение', 'Evasion', '+180']] },
  { uid: 2, ru: 'Орк-командир', en: 'Orc Commander', rarity: 2,
    rarity_ru: 'Ред.', rarity_en: 'Rare', creature: '2203', confident: true,
    icon: 'icons/loot_009.png', stats: [] },
  { uid: 3, ru: 'Тотем гнева ветра', en: 'Totem of Wind Wrath', rarity: 0,
    rarity_ru: 'Обыч.', rarity_en: 'Common', creature: '', confident: false,
    icon: '', stats: [] }
];
test('mapCatalogRarity: 6 рівнів гри → 4 рівні механіки', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(LMCore.mapCatalogRarity),
    ['common', 'common', 'rare', 'epic', 'legendary', 'legendary']);
});
test('validateCatalog: масив з uid+ru проходить, сміття — ні', () => {
  assert.strictEqual(LMCore.validateCatalog(CAT).ok, true);
  assert.strictEqual(LMCore.validateCatalog({}).ok, false);
  assert.strictEqual(LMCore.validateCatalog([{ ru: 'без uid' }]).ok, false);
});
test('syncCatalog: додає нові предмети з усіма полями', () => {
  const items = [];
  const res = LMCore.syncCatalog(items, CAT);
  assert.deepStrictEqual({ a: res.added, u: res.updated }, { a: 3, u: 0 });
  const hydra = items.find(i => i.catalogUid === 1);
  assert.deepStrictEqual({
    name: hydra.name, nameEn: hydra.nameEn, rarity: hydra.rarity,
    lru: hydra.rarityLabelRu, len: hydra.rarityLabelEn,
    icon: hydra.icon, cat: hydra.category, tc: hydra.targetClasses, arch: hydra.isArchived
  }, { name: 'Гидра тёмного прилива', nameEn: 'Dark Tide Hydra', rarity: 'legendary',
       lru: 'Уник.', len: 'Unique', icon: 'icons/loot_002.png', cat: 'Інше',
       tc: [], arch: false });
  assert.match(hydra.id, /^[0-9a-f-]{36}$/i);
});
test('syncCatalog: оновлює за catalogUid, усиновлює за назвою, ідемпотентний', () => {
  const items = [
    // ручний предмет з таким самим ім'ям (інший регістр) — мусить бути усиновлений, не задубльований
    { id: 'manual-1', name: 'орк-командир', category: 'Зброя', targetClasses: ['c-tank'],
      rarity: 'common', isArchived: false }
  ];
  const r1 = LMCore.syncCatalog(items, CAT);
  assert.deepStrictEqual({ a: r1.added, u: r1.updated }, { a: 2, u: 1 });
  const orc = items.find(i => i.catalogUid === 2);
  assert.strictEqual(orc.id, 'manual-1');                  // той самий запис
  assert.strictEqual(orc.name, 'Орк-командир');            // назва з каталогу
  assert.deepStrictEqual(orc.targetClasses, ['c-tank']);   // ручні класи збережені
  assert.strictEqual(orc.rarity, 'rare');
  // повторний прогін: нічого нового
  const r2 = LMCore.syncCatalog(items, CAT);
  assert.deepStrictEqual({ a: r2.added, u: r2.updated, len: items.length },
    { a: 0, u: 3, len: 3 });
  // оновлення назви в каталозі підтягується за uid
  const cat2 = CAT.map(c => c.uid === 1 ? { ...c, ru: 'Гидра (нова)' } : c);
  LMCore.syncCatalog(items, cat2);
  assert.strictEqual(items.find(i => i.catalogUid === 1).name, 'Гидра (нова)');
});
test('formatReport v3: обидві назви предмета, мова інтерфейсу першою', () => {
  const itemsById = { x: { id: 'x', name: 'Гидра', nameEn: 'Hydra', category: 'Інше',
    targetClasses: [], rarity: 'epic', isArchived: false } };
  const pos = [{ key: 'x#0', itemId: 'x', copyIndex: 0, winnerId: 'p-a', priority: 0,
    rolled: false, manual: false, stage: 1, classBonus: false, candidates: [] }];
  const en = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X', positions: pos,
    itemsById, playersById: PBYID, classesById: CLSBYID, topSet: new Set(), lang: 'en' });
  assert.ok(en.includes('🔹 Hydra / Гидра (1 pcs)'), en);
  const ru = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X', positions: pos,
    itemsById, playersById: PBYID, classesById: CLSBYID, topSet: new Set(), lang: 'ru' });
  assert.ok(ru.includes('🔹 Гидра / Hydra (1 шт.)'), ru);
});
test('formatReport v3: без англійської назви — один рядок без роздільника', () => {
  const itemsById = {
    x: { id: 'x', name: 'Сундук', nameEn: '', category: 'Інше',
         targetClasses: [], rarity: 'common', isArchived: false },
    y: { id: 'y', name: 'Amulet', nameEn: 'Amulet', category: 'Інше',
         targetClasses: [], rarity: 'common', isArchived: false }
  };
  const mk = id => ({ key: id + '#0', itemId: id, copyIndex: 0, winnerId: 'p-a', priority: 0,
    rolled: false, manual: false, stage: 1, classBonus: false, candidates: [] });
  const text = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X',
    positions: [mk('x'), mk('y')], itemsById, playersById: PBYID, classesById: CLSBYID,
    topSet: new Set(), lang: 'ru' });
  assert.ok(text.includes('🔹 Сундук (1 шт.)'), text);          // немає nameEn
  assert.ok(text.includes('🔹 Amulet (1 шт.)'), text);          // назви збігаються
  assert.ok(!/Amulet \/ Amulet/.test(text), text);
});

// ---- Імпорт складу з тексту (v1.5) ----
const ROSTER_TEXT = [
  'Маг ', '',
  '1. Bunny — Ур. 66',
  '2. Dead Angel — Ур. 65',
  '3. АЛХИМИК — Ур. 59', '',
  '🔨 Воин', '',
  '1. Final Fantasy — Ур. 65',
  '2. CØRĒ — Ур. 59', '',
  '⚔️ Разбойник', '',
  '1. Krähe — Ур. 64',
  '2. ЧёTkuй — Ур. 55'
].join('\n');

test('parseRoster: заголовки з емодзі, нумерація, «— Ур. N», юнікод-ніки', () => {
  const r = LMCore.parseRoster(ROSTER_TEXT);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.groups.map(g => [g.className, g.players.length]),
    [['Маг', 3], ['Воин', 2], ['Разбойник', 2]]);
  assert.deepStrictEqual(r.groups[0].players[0], { nickname: 'Bunny', level: 66 });
  assert.deepStrictEqual(r.groups[1].players[1], { nickname: 'CØRĒ', level: 59 });
  assert.deepStrictEqual(r.groups[2].players[0], { nickname: 'Krähe', level: 64 });
});
test('parseRoster: гравці до першого класу або порожньо — помилка', () => {
  assert.strictEqual(LMCore.parseRoster('1. Bunny — Ур. 66').ok, false);
  assert.strictEqual(LMCore.parseRoster('   \n\n').ok, false);
});
test('applyRoster: створює класи з розумними вагами, апсертить гравців', () => {
  const players = [
    { id: 'p-old', nickname: 'bunny', classId: 'c-x', role: 'Офіцер', isActive: false,
      createdAt: NOW }
  ];
  const classes = [mkClass('c-x', 'Стара', 0.5, 0.5, 0)];
  const parsed = LMCore.parseRoster(ROSTER_TEXT);
  const res = LMCore.applyRoster(players, classes, parsed.groups, NOW);
  assert.deepStrictEqual(
    { ap: res.addedPlayers, up: res.updatedPlayers, ac: res.addedClasses },
    { ap: 6, up: 1, ac: 3 });
  // класи: Воин — танкові ваги, решта — ДД
  const voin = classes.find(c => c.name === 'Воин');
  assert.deepStrictEqual([voin.wDmg, voin.wTaken, voin.wHeal], [0.3, 0.6, 0.1]);
  const mag = classes.find(c => c.name === 'Маг');
  assert.deepStrictEqual([mag.wDmg, mag.wTaken, mag.wHeal], [0.8, 0.1, 0.1]);
  // наявний гравець оновлений: клас+рівень, роль/активність НЕ чіпаються
  const bunny = players.find(p => p.id === 'p-old');
  assert.deepStrictEqual(
    { cls: bunny.classId, lvl: bunny.level, role: bunny.role, act: bunny.isActive },
    { cls: mag.id, lvl: 66, role: 'Офіцер', act: false });
  // новий гравець
  const core = players.find(p => p.nickname === 'CØRĒ');
  assert.deepStrictEqual({ role: core.role, act: core.isActive, lvl: core.level },
    { role: 'Учасник', act: true, lvl: 59 });
  // ідемпотентність
  const res2 = LMCore.applyRoster(players, classes, parsed.groups, NOW);
  assert.deepStrictEqual(
    { ap: res2.addedPlayers, up: res2.updatedPlayers, ac: res2.addedClasses },
    { ap: 0, up: 7, ac: 0 });
  assert.strictEqual(players.length, 7);
});
test('applyRoster v3.2: replaceRoster вибуває тих, кого немає в списку', () => {
  const players = [
    { id: 'p-gone', nickname: 'Ghost', classId: 'c-x', role: 'Ветеран', isActive: true,
      level: 60, createdAt: NOW },
    { id: 'p-back', nickname: 'bunny', classId: 'c-x', role: 'Офіцер', isActive: false,
      level: 60, createdAt: NOW }
  ];
  const classes = [mkClass('c-x', 'Стара', 0.5, 0.5, 0)];
  const parsed = LMCore.parseRoster(ROSTER_TEXT);
  const res = LMCore.applyRoster(players, classes, parsed.groups, NOW,
    { replaceRoster: true });
  assert.strictEqual(res.deactivated, 1);
  const ghost = players.find(p => p.id === 'p-gone');
  assert.strictEqual(ghost.isActive, false, 'кого немає в списку — вибув');
  assert.strictEqual(ghost.role, 'Ветеран', 'роль не чіпається');
  assert.strictEqual(ghost.nickname, 'Ghost', 'гравець не видаляється — лише деактивується');
  const back = players.find(p => p.id === 'p-back');
  assert.strictEqual(back.isActive, true, 'хто повернувся у список — знову активний');
  assert.strictEqual(back.role, 'Офіцер', 'роль не чіпається');
  // повторний імпорт того самого списку більше нікого не вибуває
  const again = LMCore.applyRoster(players, classes, parsed.groups, NOW,
    { replaceRoster: true });
  assert.strictEqual(again.deactivated, 0);
});
test('applyRoster v3.2: без replaceRoster поведінка стара — нікого не вибуває', () => {
  const players = [
    { id: 'p-gone', nickname: 'Ghost', classId: 'c-x', role: 'Учасник', isActive: true,
      level: 60, createdAt: NOW }
  ];
  const classes = [mkClass('c-x', 'Стара', 0.5, 0.5, 0)];
  const parsed = LMCore.parseRoster(ROSTER_TEXT);
  const res = LMCore.applyRoster(players, classes, parsed.groups, NOW);
  assert.strictEqual(res.deactivated, 0);
  assert.strictEqual(players.find(p => p.id === 'p-gone').isActive, true);
});
test('applyRoster: Жрец отримує хільські ваги', () => {
  const classes = [];
  LMCore.applyRoster([], classes,
    [{ className: 'Жрец', players: [{ nickname: 'S1Lnc', level: 65 }] }], NOW);
  const zh = classes.find(c => c.name === 'Жрец');
  assert.deepStrictEqual([zh.wDmg, zh.wTaken, zh.wHeal], [0.1, 0.1, 0.8]);
});
// ---- v1.7: захист від застарілих позначок ----
test('computeScores: деактивований гравець із застарілою присутністю не рахується', () => {
  const players = { 'p-a': { ...P.a }, 'p-b': { ...P.b, isActive: false } };
  const session = { presence: {
    'p-a': { top: false },
    'p-b': { top: true }   // стара позначка, гравець уже вибув
  }, drops: [], claims: {} };
  assert.deepStrictEqual(LMCore.computeScores(session, players, S),
    { 'p-a': 50 });
});
test('distribute: вибулий претендент не бере участі', () => {
  const players = { 'p-a': { ...P.a }, 'p-b': { ...P.b, isActive: false } };
  const session = { eventTypeName: 'Бос',
    presence: { 'p-a': { top: false },
                'p-b': { top: true } },
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'], 'p-b': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: players,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions[0].winnerId, 'p-a');
  assert.deepStrictEqual(positions[0].candidates.map(c => c.playerId), ['p-a']);
});

test('isPristine: чиста база — так; будь-які дані користувача — ні', () => {
  const fresh = LMCore.emptyDb(NOW);
  assert.strictEqual(LMCore.isPristine(fresh), true);
  const withPlayer = LMCore.emptyDb(NOW);
  withPlayer.perAlliance[withPlayer.activeAllianceId].players.push(mkPlayer('p', 'X', 'c'));
  assert.strictEqual(LMCore.isPristine(withPlayer), false);
  const withItem = LMCore.emptyDb(NOW);
  withItem.items.push(mkItem('i', 'Меч', 'rare'));
  assert.strictEqual(LMCore.isPristine(withItem), false);
  const withHistory = LMCore.emptyDb(NOW);
  withHistory.perAlliance[withHistory.activeAllianceId].history.push(
    mkRec('p-a', 'i-box', NOW, 1));
  assert.strictEqual(LMCore.isPristine(withHistory), false);
  const twoAlliances = LMCore.emptyDb(NOW);
  twoAlliances.alliances.push({ id: 'a2', name: 'Другий', createdAt: NOW });
  twoAlliances.perAlliance['a2'] = { players: [], history: [], eventTypes: [],
    draftSession: null };
  assert.strictEqual(LMCore.isPristine(twoAlliances), false);
});
test('emptyDb v1.5: сід — п\'ять реальних класів гри', () => {
  const db = LMCore.emptyDb(NOW);
  assert.deepStrictEqual(db.classes.map(c => c.name),
    ['Маг', 'Воин', 'Жрец', 'Разбойник', 'Лучник']);
  const voin = db.classes[1];
  assert.deepStrictEqual([voin.wDmg, voin.wTaken, voin.wHeal], [0.3, 0.6, 0.1]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
