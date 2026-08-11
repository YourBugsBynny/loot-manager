# Loot Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Побудувати однофайловий вебзастосунок `loot-manager.html` за специфікацією `../ТЗ_Loot_Manager.md` (v2.0) — розподіл здобичі альянсу з чотирма вкладками, алгоритмом пріоритетів і LocalStorage-базою.

**Architecture:** Один HTML-файл з двома скрипт-блоками: `<script id="core">` — чисті функції без DOM/LocalStorage (простір імен `LMCore`, повністю покритий Node-тестами через екстракцію блока), та `<script id="app">` — стан, сховище, рендер вкладок, обробники. Тести — голий Node (`node:assert` + `vm`), нуль залежностей, без package.json.

**Tech Stack:** Vanilla JS (ES2020+), HTML5, CSS3; Node 24 лише для тестів; git — локальний репозиторій у теці проєкту.

## Global Constraints (з ТЗ §2.1 — діють у кожному завданні)

- Поставка: **один самодостатній файл `loot-manager.html`** (CSS і JS інлайн).
- Заборонено: CDN, зовнішні бібліотеки, шрифти, будь-які мережеві запити.
- Працює з `file://` офлайн; актуальні Chrome/Firefox/Safari.
- Vanilla JS ES2020+, без фреймворків і кроку збірки.
- Сховище: LocalStorage, один ключ `lootManagerData`, повний перезапис при кожній зміні.
- Мова UI: українська. Mobile-first від 360 px (карткова верстка матриці заявок < 700 px).
- Каталог предметів і класи — глобальні; гравці/історія/івенти/чернетка — per-alliance (ТЗ §2.1).
- Руйнівні дії — через діалог підтвердження (`confirm()`); тихі відмови заборонені (банер `#banner`).

## Project Layout

```
loot-manager/
├── loot-manager.html            # єдиний артефакт поставки
├── tests/
│   └── core.test.js             # Node-тести LMCore (ростуть із задачами 1–5)
└── docs/superpowers/plans/      # цей план
```

## Global Interfaces — `LMCore` (контракт для всіх задач)

```js
LMCore.DEFAULTS            // заморожений об'єкт налаштувань за ТЗ §3.6
LMCore.RARITY_RANK         // {common:1, rare:2, epic:4? ні — ранг сортування: common:1, rare:2, epic:3, legendary:4}
LMCore.uuid() -> String
LMCore.emptyDb(nowISO) -> db                     // перший запуск, ТЗ §7.1
LMCore.migrate(db) -> {ok:true, db} | {ok:false, error}
LMCore.validateImport(raw) -> {ok:true, db} | {ok:false, error}
LMCore.computeScores(session, playersById, classesById, settings) -> {playerId: Number}
LMCore.historyLoad(history, itemsById, playerId, nowISO, settings) -> Number
LMCore.distribute(ctx) -> {positions: Position[], scores: {playerId: Number}}
//  ctx = {session, playersById, classesById, itemsById, history, settings,
//         nowISO, rng, overrides, rollMemo}
//  Position = {key:"itemId#copyIndex", itemId, copyIndex, winnerId|null,
//              priority|null, rolled, manual, classBonus,
//              candidates: [{playerId, priority}] /* спадно за priority */}
LMCore.topContributors(session, scores) -> Set<playerId>   // правило «ТОП Вклад» ТЗ §6
LMCore.formatReport(args) -> String
//  args = {allianceName, eventTypeName, positions, itemsById, playersById,
//          classesById, topSet}
LMCore.buildRecords(args) -> LootRecord[]                  // ТЗ §5.8, §3.3
//  args = {positions, itemsById, playersById, scores, nowISO, eventTypeName}
```

`session` = `draftSession` з ТЗ §3.7: `{eventTypeName, mode:"simple"|"advanced", presence:{pid:{present,top,damage,taken,heal}}, drops:[{itemId,quantity}], claims:{pid:[itemId]}}`. `drops` унікальні за `itemId` (UI зливає дублі, підсумовуючи кількість).

**Семантика `distribute` (фіксується тут, реалізується в Задачі 4):**

1. Порядок позицій: `drops` сортовані за `RARITY_RANK` спадно, стабільно за початковим індексом; кожна штука — окрема позиція `key = itemId + "#" + copyIndex`.
2. Претенденти позиції: `present && claims містить itemId && ще не виграв штуку цього itemId у цьому проході` (правило «одна штука предмета на гравця», ТЗ §5.4).
3. `priority = score + (targetClasses непорожній і містить клас гравця ? pClass : 0) − kPenalty·historyLoad(pid) − wWon·wonCount[pid]`; `historyLoad` кешується на виклик.
4. `overrides[key]` фіксує переможця вручну (будь-який присутній, навіть не претендент і навіть із другою штукою — ТЗ §4.4); `manual:true`; враховується у `wonCount` і в правилі одної штуки.
5. Нічия: лідери в межах 0.001 від максимуму; переможець — `leaders[Math.floor(rng()*leaders.length)]`, `rolled:true`. **`rollMemo`** (`{key: playerId}`) робить перерахунок стабільним: якщо мемоізований переможець досі серед лідерів — береться він без нового ролу; інакше новий рол, і викликач оновлює мемо з повернутої позиції.
6. Без претендентів → `winnerId:null` («Вільний залишок», в історію не пише).

---

### Task 1: Каркас проєкту, git, тестова упряж

**Files:**
- Create: `loot-manager/loot-manager.html`
- Create: `loot-manager/tests/core.test.js`

**Interfaces:** Produces: механізм екстракції `<script id="core">` у Node `vm`; глобал `LMCore` з `DEFAULTS`.

- [ ] **Step 1: git init**

```bash
cd G:/AI_and_Models/Claude/WhoaBackup/loot-manager && git init -b main
```

- [ ] **Step 2: Написати падаючий тест** — `tests/core.test.js`:

```js
'use strict';
const fs = require('fs'), path = require('path');
const assert = require('assert');

const htmlPath = path.join(__dirname, '..', 'loot-manager.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: <script id="core"> не знайдено'); process.exit(1); }
// ВИКОНАНО ІНАКШЕ, ніж планувалось (vm): new Function у тому самому realm —
// vm-realm мав інші прототипи (deepStrictEqual падав) і не віддавав top-level const.
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
```

- [ ] **Step 3: Запустити — переконатися, що падає** (`node tests/core.test.js`; очікується: FAIL — файл html відсутній).

- [ ] **Step 4: Мінімальна реалізація** — `loot-manager.html`: скелет `<!DOCTYPE html>…`, `<meta charset>`, `<meta name="viewport" content="width=device-width, initial-scale=1">`, `<title>Loot Manager</title>`, порожні `<style>`, `<body>` з заглушкою, і:

```html
<script id="core">
'use strict';
const LMCore = (() => {
  const DEFAULTS = Object.freeze({
    scoreTop: 100, scorePresent: 50, pClass: 25, kPenalty: 10,
    historyDays: 14, wWon: 50,
    rarityWeights: Object.freeze({ common: 1, rare: 2, epic: 4, legendary: 8 }),
    webhookUrl: ''
  });
  const RARITY_RANK = Object.freeze({ common: 1, rare: 2, epic: 3, legendary: 4 });
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  return { DEFAULTS, RARITY_RANK, uuid };
})();
</script>
<script id="app">
'use strict';
// заповнюється Задачами 6–10
</script>
```

(`deepStrictEqual` порівнює і заморожений вкладений `rarityWeights` — ок.)

- [ ] **Step 5: Тести зелені** (`node tests/core.test.js` → `2 passed, 0 failed`).
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: scaffold single-file app + node test harness"`.

---

### Task 2: Ядро — база даних, перший запуск, міграція, валідація імпорту

**Files:** Modify: `loot-manager.html` (`#core`); Modify: `tests/core.test.js` (додати блок).

**Interfaces:** Consumes: `DEFAULTS`, `uuid`. Produces: `emptyDb(nowISO)`, `migrate(db)`, `validateImport(raw)`.

- [ ] **Step 1: Падаючі тести** — додати до `core.test.js` перед фінальним підсумком:

```js
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
```

- [ ] **Step 2: Запуск — FAIL** (`emptyDb is not a function`).
- [ ] **Step 3: Реалізація в `#core`** — `emptyDb(nowISO)` будує об'єкт рівно за схемою ТЗ §2.1 (сід класів §3.4, налаштування — глибока копія DEFAULTS); `migrate(db)`: `db.schemaVersion === 1 ? {ok:true, db} : {ok:false, error: 'Непідтримувана версія схеми: ' + db.schemaVersion}`; `validateImport(raw)`: перевірки — об'єкт; `schemaVersion` число; `alliances` непорожній масив об'єктів з `id`/`name`; `activeAllianceId` є серед альянсів; `settings` об'єкт; `classes`/`items` масиви; `perAlliance` об'єкт, для КОЖНОГО альянсу є запис із масивами `players/history/eventTypes`; далі `migrate`. Повертає `{ok:false, error:<людською мовою що саме не так>}` при першій проблемі. Експортувати нові функції в `return {...}`.
- [ ] **Step 4: Тести зелені** (5 passed).
- [ ] **Step 5: Commit** — `feat(core): db bootstrap, migrate, import validation`.

---

### Task 3: Ядро — бал вкладу `computeScores`

**Files:** Modify: `loot-manager.html` (`#core`); Modify: `tests/core.test.js`.

**Interfaces:** Consumes: `DEFAULTS`. Produces: `computeScores(session, playersById, classesById, settings)` → `{pid: Number}` лише для присутніх.

- [ ] **Step 1: Падаючі тести** (фікстури-хелпери додати над блоком):

```js
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
```

- [ ] **Step 2: Запуск — FAIL.**
- [ ] **Step 3: Реалізація** — за ТЗ §5.2; відсутні (`!presence[pid]?.present`) не входять у результат і в максимуми; метрики `Number(...) || 0`.
- [ ] **Step 4: Тести зелені.**
- [ ] **Step 5: Commit** — `feat(core): contribution score for simple and advanced modes`.

---

### Task 4: Ядро — історія, пріоритет, `distribute`

**Files:** Modify: `loot-manager.html` (`#core`); Modify: `tests/core.test.js`.

**Interfaces:** Consumes: `computeScores`, `RARITY_RANK`. Produces: `historyLoad(...)`, `distribute(ctx)` (семантика — Global Interfaces п.1–6).

- [ ] **Step 1: Падаючі тести:**

```js
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
test('distribute: клас-бонус перемагає при рівному вкладі (крит. приймання 4)', () => {
  const session = { mode: 'simple', eventTypeName: 'Бос',
    presence: { 'p-a': { present: true, top: false }, 'p-c': { present: true, top: false } },
    drops: [{ itemId: 'i-sword', quantity: 1 }],
    claims: { 'p-a': ['i-sword'], 'p-c': ['i-sword'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions.length, 1);
  assert.strictEqual(positions[0].winnerId, 'p-a');          // танк, бонус +25
  assert.strictEqual(positions[0].classBonus, true);
  assert.strictEqual(positions[0].rolled, false);
  assert.deepStrictEqual(positions[0].candidates.map(c => c.playerId), ['p-a', 'p-c']);
  assert.strictEqual(positions[0].candidates[0].priority, 75);   // 50+25
  assert.strictEqual(positions[0].candidates[1].priority, 50);
});
test('distribute: анти-жадібність — вчорашня легендарка програє (крит. 5)', () => {
  const hist = [mkRec('p-a', 'i-sword', '2026-08-10T00:00:00.000Z', 1)];
  const session = { mode: 'simple', eventTypeName: 'Бос',
    presence: { 'p-a': { present: true, top: false }, 'p-c': { present: true, top: false } },
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: hist, settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions[0].winnerId, 'p-c');   // p-a: 50−10·8=−30
});
test('distribute: порядок за рідкістю, одна штука на гравця, вільний залишок', () => {
  const session = { mode: 'simple', eventTypeName: 'Бос',
    presence: { 'p-a': { present: true, top: false }, 'p-b': { present: true, top: false } },
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
  // скриня №2: p-b уже має скриню (одна штука на гравця) → лишається p-a (0 балів, але претендент)
  assert.strictEqual(positions[2].winnerId, 'p-a');
  // скриня №3: обидва вже мають → вільний залишок
  assert.strictEqual(positions[3].winnerId, null);
});
test('distribute: нічия — рол за rng, rollMemo стабілізує перерахунок (крит. 8)', () => {
  const session = { mode: 'simple', eventTypeName: 'Бос',
    presence: { 'p-a': { present: true, top: false }, 'p-b': { present: true, top: false } },
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
});
test('distribute: override — ручний переможець поза претендентами, перерахунок нижче', () => {
  const session = { mode: 'simple', eventTypeName: 'Бос',
    presence: { 'p-a': { present: true, top: true }, 'p-b': { present: true, top: false } },
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
  // p-a більше не має wWon-штрафу і забирає скриню з повним балом
  assert.strictEqual(over.positions[1].winnerId, 'p-a');
  assert.strictEqual(over.positions[1].priority, 125);     // 100 top + 0 клас... ні: скриня без класів → 100
});
```

  ⚠️ Останній assert: скриня `targetClasses: []` → бонусу нема; очікуваний priority `p-a` = 100. Виправити рядок на `assert.strictEqual(over.positions[1].priority, 100);` (коментар у тесті прибрати).

- [ ] **Step 2: Запуск — FAIL.**
- [ ] **Step 3: Реалізація `historyLoad` і `distribute`** строго за Global Interfaces (кеш `historyLoad` через `Map`; `priority` переможця пишеться в позицію; для manual-переможця поза претендентами `priority:null`).
- [ ] **Step 4: Тести зелені.**
- [ ] **Step 5: Commit** — `feat(core): priority queue distribution with history, ties, overrides`.

---

### Task 5: Ядро — «ТОП Вклад», текст звіту, записи історії

**Files:** Modify: `loot-manager.html` (`#core`); Modify: `tests/core.test.js`.

**Interfaces:** Consumes: усе з задач 2–4. Produces: `topContributors`, `formatReport`, `buildRecords`.

- [ ] **Step 1: Падаючі тести** (включно з побайтовим прикладом ТЗ §6):

```js
// ---- Task 5 ----
test('topContributors: простий — прапорці, розширений — максимум балу', () => {
  const simple = { mode: 'simple', presence: {
    'p-a': { present: true, top: true }, 'p-b': { present: true, top: false } } };
  assert.deepStrictEqual([...LMCore.topContributors(simple, { 'p-a': 100, 'p-b': 50 })], ['p-a']);
  const adv = { mode: 'advanced', presence: {} };
  assert.deepStrictEqual([...LMCore.topContributors(adv, { 'p-a': 80, 'p-b': 85 })], ['p-b']);
  assert.deepStrictEqual([...LMCore.topContributors(adv, {})], []);
});
test('formatReport: побайтово збігається з прикладом ТЗ §6', () => {
  const cls = {
    tank: mkClass('c1', 'Танк', 0.2, 0.7, 0.1), mag: mkClass('c2', 'Маг', 0.8, 0.1, 0.1),
    mdd: mkClass('c3', 'МДД', 0.8, 0.1, 0.1), heal: mkClass('c4', 'Хіл', 0.1, 0.1, 0.8),
    rdd: mkClass('c5', 'РДД', 0.8, 0.1, 0.1)
  };
  const classesById = Object.fromEntries(Object.values(cls).map(c => [c.id, c]));
  const pl = [['n1', 'Нік1', 'c1'], ['n2', 'Нік2', 'c2'], ['n3', 'Нік3', 'c2'],
    ['n4', 'Нік4', 'c3'], ['n5', 'Нік5', 'c4'], ['n6', 'Нік6', 'c5']]
    .map(([id, nickname, classId]) => mkPlayer(id, nickname, classId));
  const playersById = Object.fromEntries(pl.map(p => [p.id, p]));
  const items = [mkItem('m', 'Меч Дракона', 'legendary'), mkItem('s', 'Посох Сили', 'epic'),
    mkItem('k', 'Кольчуга Гвардійця', 'rare'), mkItem('r', 'Сундук Ресурсів', 'common')];
  const itemsById = Object.fromEntries(items.map(i => [i.id, i]));
  const mkPos = (itemId, copyIndex, winnerId) => ({ key: itemId + '#' + copyIndex,
    itemId, copyIndex, winnerId, priority: 0, rolled: false, manual: false,
    classBonus: false, candidates: [] });
  const positions = [
    mkPos('m', 0, 'n1'), mkPos('s', 0, 'n2'), mkPos('s', 1, 'n3'),
    mkPos('k', 0, 'n4'), mkPos('r', 0, 'n5'), mkPos('r', 1, 'n6'), mkPos('r', 2, null)
  ];
  const text = LMCore.formatReport({ allianceName: 'Alpha', eventTypeName: 'PvP-Івент',
    positions, itemsById, playersById, classesById, topSet: new Set(['n1']) });
  assert.strictEqual(text,
    '📜 [АЛЬЯНС: Alpha] РОЗПОДІЛ ЗДОБИЧІ (PvP-Івент)\n' +
    '\n' +
    '🔹 Меч Дракона (1 шт.) — @Нік1 [Танк | ТОП Вклад]\n' +
    '🔹 Посох Сили (2 шт.) — @Нік2 [Маг], @Нік3 [Маг]\n' +
    '🔹 Кольчуга Гвардійця (1 шт.) — @Нік4 [МДД]\n' +
    '🔹 Сундук Ресурсів (3 шт.) — @Нік5 [Хіл], @Нік6 [РДД], [Вільний залишок]\n' +
    '\n' +
    'Дякуємо всім за участь! Предмети чекають у магазині альянсу.');
});
test('formatReport: кілька вільних штук — одна позначка', () => {
  const itemsById = { b: mkItem('b', 'Скриня', 'common') };
  const positions = [
    { key: 'b#0', itemId: 'b', copyIndex: 0, winnerId: 'p-a', priority: 0,
      rolled: false, manual: false, classBonus: false, candidates: [] },
    { key: 'b#1', itemId: 'b', copyIndex: 1, winnerId: null, priority: null,
      rolled: false, manual: false, classBonus: false, candidates: [] },
    { key: 'b#2', itemId: 'b', copyIndex: 2, winnerId: null, priority: null,
      rolled: false, manual: false, classBonus: false, candidates: [] }
  ];
  const text = LMCore.formatReport({ allianceName: 'A', eventTypeName: 'X', positions,
    itemsById, playersById: PBYID, classesById: CLSBYID, topSet: new Set() });
  assert.strictEqual((text.match(/\[Вільний залишок\]/g) || []).length, 1);
});
test('buildRecords: групування пар гравець×предмет, снапшоти, пропуск залишку (крит. 11)', () => {
  const positions = [
    { key: 'i-box#0', itemId: 'i-box', copyIndex: 0, winnerId: 'p-a', priority: 50,
      rolled: true, manual: false, classBonus: false, candidates: [] },
    { key: 'i-box#1', itemId: 'i-box', copyIndex: 1, winnerId: 'p-a', priority: 0,
      rolled: false, manual: true, classBonus: false, candidates: [] },
    { key: 'i-box#2', itemId: 'i-box', copyIndex: 2, winnerId: null, priority: null,
      rolled: false, manual: false, classBonus: false, candidates: [] },
    { key: 'i-sword#0', itemId: 'i-sword', copyIndex: 0, winnerId: 'p-b', priority: 50,
      rolled: false, manual: false, classBonus: false, candidates: [] }
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
});
```

- [ ] **Step 2: Запуск — FAIL.**
- [ ] **Step 3: Реалізація** — `formatReport`: групування позицій за `itemId` у порядку першої появи; сума штук = кількість позицій предмета; записи переможців у порядку копій; `rolled`-позначку в текст НЕ виводити (🎲 — лише в UI-списку, ТЗ §4.4/§6); `buildRecords`: агрегація `rolled`/`manual` через OR.
- [ ] **Step 4: Тести зелені** (весь файл: 14 passed).
- [ ] **Step 5: Commit** — `feat(core): report formatting and history records`.

---

### Task 6: Каркас UI — стилі, шапка, вкладки, сховище, перший запуск

**Files:** Modify: `loot-manager.html` (`<style>`, `<body>`, `#app`).

**Interfaces:** Consumes: `LMCore.emptyDb/migrate/uuid`. Produces (для задач 7–10): глобальний стан `let db` та `let ui = {activeTab, calcResult:null}`; функції `save()`, `activeAlliance()`, `pa()` (дані активного альянсу), `draft()` (ледаче створення `draftSession` за §3.7), `banner(msg)`, `switchTab(n)`, `renderAll()` (диспетчер `renderTab1..4()` — заглушки), `escapeHtml(s)`; розмітка: `#banner`, `header` з `#allianceSelect` і `#btnSettings`, `<nav>` з `button.tab[data-tab="1..4"]`, панелі `#tab1..#tab4`.

- [ ] **Step 1: Розмітка + CSS.** Мінімальна система: змінні кольорів; `body{font-family:system-ui}`; липка шапка; вкладки — горизонтальний скрол на вузьких екранах; класи `.card`, `.btn`, `.btn-primary`, `.btn-danger`, `.row`; таблиці з `overflow-x:auto`; `@media (max-width:699px)` — карткова верстка для матриці заявок (задача 8) і таблиць. Жодних зовнішніх ресурсів.
- [ ] **Step 2: Сховище в `#app`:**

```js
const STORAGE_KEY = 'lootManagerData';
function nowISO() { return new Date().toISOString(); }
function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch (e) { banner('LocalStorage недоступний: ' + e.message + '. Дані не збережуться!'); }
  if (!raw) return LMCore.emptyDb(nowISO());
  try {
    const parsed = JSON.parse(raw);
    const mig = LMCore.migrate(parsed);
    if (!mig.ok) { banner('База не завантажена: ' + mig.error); return LMCore.emptyDb(nowISO()); }
    return mig.db;
  } catch (e) { banner('База пошкоджена, створено нову. Помилка: ' + e.message); return LMCore.emptyDb(nowISO()); }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
  catch (e) { banner('Не вдалося зберегти (сховище переповнене?): ' + e.message +
    '. Зробіть експорт JSON на вкладці 4!'); }
}
```

  (Пошкоджена база: старий raw НЕ перетирається до першого `save()` — а `save()` викликається лише мутаціями користувача; цього досить за §7.11.)
- [ ] **Step 3: Шапка** — `#allianceSelect` (options з `db.alliances`, value=`activeAllianceId`; `change` → `db.activeAllianceId = value; save(); renderAll()`); `#btnSettings` → `switchTab(4)`. Вкладки: `switchTab(n)` перемикає `hidden` панелей і `.active` кнопок, `ui.activeTab = n`, рендерить панель.
- [ ] **Step 4: Ініціалізація** — `let db = load(); save();` + `renderAll()` на `DOMContentLoaded`. `banner(msg)` показує `#banner` з кнопкою «×».
- [ ] **Step 5: Верифікація в браузері (Browser pane):** відкрити `file:///G:/AI_and_Models/Claude/WhoaBackup/loot-manager/loot-manager.html` (fallback: `python -m http.server` через launch.json). Перевірити: консоль без помилок; мережа — нуль запитів; у шапці «Мій альянс»; чотири вкладки перемикаються; `localStorage.lootManagerData` створено з `schemaVersion:1`; ⚙️ відкриває вкладку 4 (порожню). Мобільний прескан: resize 375 — без горизонтального скролу сторінки.
- [ ] **Step 6: Commit** — `feat(ui): app shell, storage, alliance switcher, tabs`.

---

### Task 7: Вкладка 1 — «Подія та вклад»

**Files:** Modify: `loot-manager.html` (`#app`, розмітка `#tab1`).

**Interfaces:** Consumes: `draft()`, `save()`, `pa()`. Produces: `renderTab1()`; чернетка `presence`/`mode`/`eventTypeName` наповнюється згідно §3.7; `commitEventType()` НЕ тут — довідник поповнюється при підтвердженні (задача 9).

- [ ] **Step 1: Розмітка/рендер** — `#eventTypeInput` (`<input list="eventTypeList">` + `<datalist id="eventTypeList">` з `pa().eventTypes`); радіо `#modeSimple`/`#modeAdvanced`; `#btnAllPresent`/`#btnNonePresent`; `#rosterList`: рядок на кожного `isActive` гравця (`data-pid`): чекбокс `.chkPresent`, тогл `.chkTop` (простий режим) або три `<input type="number" min="0">` `.inpDmg/.inpTaken/.inpHeal` (розширений; `disabled` для неприсутніх). Порожній стан: «Додайте гравців на вкладці 4».
- [ ] **Step 2: Обробники** — кожна зміна пише у `draft()` і `save()`; перемикання режиму перерендерює список (дані обох режимів зберігаються в `presence` — перемикання не стирає числа).
- [ ] **Step 3: Верифікація в браузері:** створити тимчасово 2–3 гравців через консоль заборонено — натомість зайти на вкладку 4? Вона ще порожня, тому: тимчасово через `#app`-код? Ні. Порядок: цей крок виконати ПІСЛЯ задачі 10 не можна. Рішення: у задачі 7 верифікувати з порожнім ростером (порожній стан) + перевірити збереження `eventTypeName`/`mode` через reload; повний прогін ростера — у задачі 11 (після CRUD задачі 10). Зафіксувати в нотатках задачі 11.
- [ ] **Step 4: Commit** — `feat(ui): tab1 event and contribution input`.

---

### Task 8: Вкладка 2 — «Здобич і заявки»

**Files:** Modify: `loot-manager.html` (`#app`, розмітка `#tab2`).

**Interfaces:** Consumes: `draft()`, `db.items`, `save()`. Produces: `renderTab2()`; `draft().drops` (унікальні itemId — повторне додавання сумує кількість), `draft().claims`.

- [ ] **Step 1: Блок «Що випало»** — `#itemSearch` (`<input list>` по назвах неархівних предметів), `#inpQty` (number, min 1, дефолт 1), `#btnAddDrop`. Якщо введена назва не знайдена в каталозі — розгорнути інлайн-форму `#quickItemForm`: `#qiName` (префіл), `#qiCategory` (select: Зброя/Броня/Біжутерія/Ресурси/Інше), `#qiRarity` (select: Звичайний…Легендарний → common…legendary), `#qiClasses` (мультичекбокси неархівних класів; жодного = для всіх), кнопка «Створити і додати» → `db.items.push({id:LMCore.uuid(), name, category, targetClasses, rarity, isArchived:false})`, у дроп. `#dropList`: рядки з назвою, рідкістю (кольоровий бейдж), кількістю (редагована), кнопка «✕» (прибирає з дропу і чистить claims цього предмета).
- [ ] **Step 2: Матриця заявок** — `#claimsMatrix`: ≥700px — таблиця (рядки: присутні гравці; стовпці: предмети дропу; чекбокси `data-pid data-iid`); <700px — картка на гравця зі списком чекбоксів. Порожні стани: «Немає присутніх (вкладка 1)» / «Додайте здобич».
- [ ] **Step 3: Верифікація в браузері:** створити предмет через quick-create (перевірити появу в `db.items` через export пізніше — на око: повторний пошук знаходить); додати той самий предмет двічі → кількість сумується, рядок один; зняти предмет → чекбокси заявок зникають; reload зберігає все.
- [ ] **Step 4: Commit** — `feat(ui): tab2 drops and claims`.

---

### Task 9: Вкладка 3 — «Розподіл»

**Files:** Modify: `loot-manager.html` (`#app`, розмітка `#tab3`).

**Interfaces:** Consumes: `LMCore.distribute/topContributors/formatReport/buildRecords`, `draft()`. Produces: `renderTab3()`; `ui.calcResult = {positions, scores}`; `draft().overrides` (`{key: playerId}`) і `draft().rollMemo` — зберігаються в чернетці (розширення §3.7 полем `result` — тут: `overrides`+`rollMemo`, бо `positions` детерміновано відновлюються).

- [ ] **Step 1: Розрахунок** — `#btnCalc` → якщо немає присутніх або дропу: banner з поясненням; інакше `runCalc()`:

```js
function runCalc() {
  const d = draft();
  const res = LMCore.distribute({ session: d, playersById: byId(pa().players),
    classesById: byId(db.classes), itemsById: byId(db.items),
    history: pa().history, settings: db.settings, nowISO: nowISO(),
    rng: Math.random, overrides: d.overrides || {}, rollMemo: d.rollMemo || {} });
  for (const p of res.positions) if (p.rolled && p.winnerId) d.rollMemo[p.key] = p.winnerId;
  ui.calcResult = res; save(); renderTab3();
}
```

- [ ] **Step 2: Список позицій** — рядок: назва предмета + №штуки, переможець (або «Вільний залишок»), `priority` (1 знак після коми), бейджі `[клас-бонус]` `[🎲 рол]` `[ручне]`; `<select class="winnerSelect" data-key>`: options = кандидати «Нік (пріоритет)» + optgroup «Інший присутній гравець» (решта присутніх) + опція «— авто —» (знімає override). `change` → `d.overrides[key] = value or delete`; `runCalc()` (перерахунок нижчих позицій — автоматично, бо `distribute` детермінований + rollMemo).
- [ ] **Step 3: Текст і кнопки** — `#reportText` (readonly textarea) = `formatReport(...)` з `topContributors`; `#btnCopy`:

```js
async function copyReport() {
  const t = document.getElementById('reportText');
  try { await navigator.clipboard.writeText(t.value); banner('Скопійовано ✓'); }
  catch (e) { t.focus(); t.select(); document.execCommand('copy'); banner('Скопійовано (fallback) ✓'); }
}
```

  `#btnConfirm` → `confirm('Зберегти розподіл в історію?')` → `buildRecords(...)` → `pa().history.push(...records)`; додати `eventTypeName` у `pa().eventTypes` (якщо непорожній і новий — §4.2); `notificationService.send(text)`; `pa().draftSession = null; ui.calcResult = null; save();` → повідомлення «Збережено в історію ✓» і рендер. `NotificationService`:

```js
const notificationService = { // Етап 2: DiscordWebhookService (POST webhookUrl {content})
  async send(reportText) { /* no-op, Етап 1 */ }
};
```

- [ ] **Step 4: Верифікація в браузері** (можлива лише частково до задачі 10 — без гравців; повний прогін у задачі 11): кнопки рендеряться, порожні стани коректні.
- [ ] **Step 5: Commit** — `feat(ui): tab3 distribution, manual overrides, report, confirm`.

---

### Task 10: Вкладка 4 — «Бази та налаштування»

**Files:** Modify: `loot-manager.html` (`#app`, розмітка `#tab4`).

**Interfaces:** Consumes: усе попереднє. Produces: `renderTab4()` — секції-акордеони: Альянси, Гравці, Предмети, Класи, Типи івентів, Історія, Налаштування, Резервна копія.

- [ ] **Step 1: Альянси** — список + «Додати» (prompt назви; `perAlliance[id]` ініціалізується порожнім), «Перейменувати», «Видалити» (`confirm` з текстом про повне знищення даних; заборонено видаляти останній — banner).
- [ ] **Step 2: Гравці** — таблиця (нік, клас-select, роль-select, статус); «Додати гравця» (нік унікальний case-insensitive у межах альянсу — інакше banner); «Деактивувати/Активувати»; «Видалити» — лише якщо `history.every(r => r.playerId !== id)`, інакше banner «лише деактивація» (§3.1).
- [ ] **Step 3: Предмети** — пошук-фільтр, таблиця (назва, категорія, рідкість, цільові класи, архів); додавання/редагування формою як quick-create; «Видалити» — якщо предмет у жодній історії жодного альянсу; інакше — «Архівувати» (§3.2).
- [ ] **Step 4: Класи** — таблиця з інлайн-редагуванням назви і ваг (number step 0.05, 0..1); «Видалити» — заборонено, якщо є гравці з `classId` у будь-якому альянсі → «Архівувати» (§3.4).
- [ ] **Step 5: Типи івентів** — список рядків з «✕».
- [ ] **Step 6: Історія** — фільтри `#histPlayerFilter` (select гравців), `#histFrom/#histTo` (date); список новіші згори: дата, івент, предмет×кількість, нік, бал, бейджі 🎲/ручне; скасовані — закреслені; кнопка «Скасувати» (`confirm`) → `cancelled = true` (§7.7).
- [ ] **Step 7: Налаштування** — форма ключів §3.6 (число-інпути; rarityWeights — 4 поля) + «Скинути до дефолтів» (`confirm`; глибока копія `LMCore.DEFAULTS`). `webhookUrl` НЕ показувати (§3.6).
- [ ] **Step 8: Експорт/імпорт:**

```js
function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lootmanager-backup-' + nowISO().slice(0, 10) + '.json';
  a.click(); URL.revokeObjectURL(a.href);
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch (e) { banner('Файл не є коректним JSON: ' + e.message); return; }
    const v = LMCore.validateImport(parsed);
    if (!v.ok) { banner('Імпорт відхилено: ' + v.error); return; }
    if (!confirm('Замінити ВСЮ поточну базу вмістом файлу?')) return;
    db = v.db; save(); renderAll(); banner('Базу імпортовано ✓');
  };
  reader.readAsText(file);
}
```

- [ ] **Step 9: Верифікація в браузері:** повний CRUD-прохід кожної секції; експорт скачує файл; імпорт битого файлу → банер, база ціла.
- [ ] **Step 10: Commit** — `feat(ui): tab4 database management, settings, backup`.

---

### Task 11: Наскрізне приймання за ТЗ §8

**Files:** Modify: `loot-manager.html` (виправлення знахідок).

- [ ] **Step 1: Node-тести** — `node tests/core.test.js` → усе зелене (регресія).
- [ ] **Step 2: Повний сценарій у браузері (desktop 1280):** створити 3 гравців (Танк/Хіл/МДД) → івент «Вторгнення монстрів», простий режим, ТОП у танка → дроп: меч (targetClasses=[Танк], legendary) + 2 скрині (без класів) → заявки всіх на все → розрахунок: перевірити критерії 3 (ТОП), 4 (клас-бонус), 7 (wWon), 8 (🎲 при рівності) → ручна заміна переможця (крит. 9) → копіювання тексту → формат (крит. 10) → підтвердити → історія з снапшотами, чернетка чиста, повторне підтвердження неможливе (крит. 11).
- [ ] **Step 3: Анти-жадібність (крит. 5, 6):** другий розрахунок тим самим складом — учорашній переможець легендарки програє; скасувати запис в історії → третій розрахунок повертає йому пріоритет.
- [ ] **Step 4: Ізоляція альянсів (крит. 13):** другий альянс — порожні гравці/історія/івенти, спільні предмети/класи; чернетки незалежні (крит. 14 + §7.10: reload посеред сеансу).
- [ ] **Step 5: Експорт → повне очищення localStorage через DevTools → імпорт → база ідентична (крит. 12).**
- [ ] **Step 6: Мобільний прогін (resize 375×812):** весь сценарій кроку 2; без горизонтального скролу сторінки; матриця заявок — картки (крит. 2).
- [ ] **Step 7: Гігієна (крит. 1):** консоль — нуль помилок; мережа — нуль запитів; файл відкрито з `file://`.
- [ ] **Step 8: Фінальний commit** — `chore: acceptance pass fixes` + тег `v1.0.0`.

---

## Self-Review Notes (виконано при написанні)

- **Покриття ТЗ:** §2.1→T1/T6; §2.2 (Noop + виклик send)→T9; §3.1–3.6→T2/T10; §3.7→T6/T7/T9; §4.1→T6; §4.2→T7; §4.3→T8; §4.4→T9; §4.5→T10; §4.6→T6/T7 (автозбереження в кожному обробнику); §5→T3/T4; §6→T5; §7.1–7.12→T2/T3/T4/T6/T9/T10; §8→T11 (пункти 3–8, 10, 11 продубльовані Node-тестами в T3–T5).
- **Розширення §3.7:** чернетка додатково зберігає `overrides` і `rollMemo` (замість сирого `result` — позиції детерміновано відтворюються). Це у межах «структура result на розсуд виконавця» з ТЗ.
- **Узгодженість типів:** сигнатури зафіксовані в Global Interfaces; тести задач 3–5 використовують спільні фікстури (`mkClass/mkPlayer/mkItem/mkRec`, `NOW`, `S`).
- **Верифікація вкладок 7/9 частково відкладена до T11** — до появи CRUD гравців (T10) ростер порожній; зафіксовано в кроках задач.
