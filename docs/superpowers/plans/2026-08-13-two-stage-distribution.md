# Двоетапний розподіл (v3.0.0) — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Прибрати відмітку присутніх і зависаючий банер, показати повні назви предметів
і навчити розподіл працювати у два етапи — танки/лекарі та ДД, у порядку, який задає офіцер.

**Architecture:** Уся математика лишається в `<script id="core">` (`LMCore`) — чисті функції
без DOM. `distribute` перетворюється з одного проходу на пре-прохід ручних рішень плюс два
етапні проходи за групою класу. UI (`<script id="app">`) лише подає нові поля стану
(`class.group`, `draftSession.firstGroup`) і читає `position.stage`.

**Tech Stack:** vanilla JS, один HTML-файл без збірки й залежностей; тести — голий Node
(`node tests/core.test.js`), без фреймворків.

**Спека:** `docs/superpowers/specs/2026-08-13-two-stage-distribution-design.md`

## Global Constraints

* Жодних залежностей, CDN чи збірки: файл мусить працювати з `file://`.
* `I18N.ru` та `I18N.en` мусять мати **однаковий набір ключів** — це перевіряє `tests/docs.test.js`.
* Рядки звіту живуть окремо, у `REPORT_I18N` всередині ядра (не експортується).
* Перед кожним комітом: `node tests/core.test.js && node tests/docs.test.js` — обидва зелені.
* `git add` **тільки адресно** (`git add loot-manager.html tests/core.test.js`). Ніколи `git add -A`:
  у теці лежать файли чужого проєкту (`index.html`, `data/loot.json`, `icons/`, `frames/`, `portraits/`).
* Групи класів позначаються `'A'` (танки та лекарі) і `'B'` (ДД). Значення за замовчуванням
  скрізь `'B'`, крім класів із назвою `воин`, `жрец`, `танк`, `лекарь`, `хил` (без регістру).
* Порядок етапів у сеансі — `draftSession.firstGroup`, `'A'` або `'B'`. Дефолт за годинником:
  година < 15 → `'A'`, інакше `'B'`.
* Мова коментарів у коді — українська, як у наявному файлі. Рядки UI — ru/en.

---

### Task 1: Банер і повні назви предметів (CSS)

Дві незалежні від ядра правки, які одразу видно користувачеві.

**Files:**
- Modify: `loot-manager.html:26-34` (правило `#banner`), `loot-manager.html:169` (`.item-tab .nm`)

**Interfaces:**
- Consumes: нічого
- Produces: нічого (лише CSS)

- [ ] **Step 1: Приховати банер, коли він порожній**

Знайти в `<style>` блок `#banner { ... }` і **одразу після** правила `#banner button { ... }`
додати рядок:

```css
#banner[hidden] { display: none; }
```

Причина: `display: flex` у `#banner` має вищу специфічність за `[hidden] { display: none }`
з таблиці браузера, тому атрибут `hidden` не працює і порожня плашка висить постійно.

- [ ] **Step 2: Дозволити назві предмета перенос у два рядки**

Замінити рядок 169:

```css
.item-tab .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
```

на:

```css
.item-tab .nm { white-space: normal; overflow-wrap: anywhere; max-width: 22ch; text-align: left; }
```

- [ ] **Step 3: Перевірити в браузері**

Запустити прев'ю: `preview_start` з конфігурацією `loot-manager-static`
(`.claude/launch.json`, порт 8641), відкрити `http://localhost:8641/loot-manager.html`.

Перевірити:
1. На старті вгорі сторінки немає порожньої чорної плашки.
2. Вкладка 2 → у смужці предметів назви «Подземный владыка», «Обсидиановая…»,
   «Тотем гнева ветра» видно повністю; чипи не наїжджають один на одного.
3. Натиснути «Копировать» на вкладці 3 (якщо є розрахунок) — банер «Скопировано»
   з'являється і зникає через 6 секунд.

- [ ] **Step 4: Тести (нічого не має зламатися)**

Run: `node tests/core.test.js && node tests/docs.test.js`
Expected: обидва — `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add loot-manager.html && git commit -m "fix: hide empty banner and show full item names in the drop strip"
```

---

### Task 2: Ядро — бал вкладу без присутності

Кандидатом стає кожен активний гравець; від `presence[pid]` лишається тільки `top`;
розширений режим (`mode: 'advanced'`, метрики damage/taken/heal) зникає з ядра.

**Files:**
- Modify: `loot-manager.html` — `computeScores` (~рядок 313), `topContributors` (~рядок 532),
  `distribute` (рядки ~360-365: `presentIds`)
- Test: `tests/core.test.js` — секції `---- Task 3 ----` і `---- Task 5 ----`

**Interfaces:**
- Consumes: нічого
- Produces:
  - `LMCore.computeScores(session, playersById, settings) -> { [playerId]: number }`
    (третій параметр `classesById` **видалено** — ваги класів більше не потрібні)
  - `LMCore.topContributors(session, scores) -> Set<playerId>` (сигнатура та сама, логіка
    лише за прапорцем `top`)

- [ ] **Step 1: Написати падаючі тести**

У `tests/core.test.js` **замінити** три наявні тести `computeScores` (простий режим,
розширений режим, розширений із нулями — блок від `test('computeScores: простий режим`
до кінця третього з них) на:

```js
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
```

Далі знайти тест `topContributors` (секція `---- Task 5 ----`, він створює `simple` і `adv`
сесії) і замінити його цілком на:

```js
test('topContributors v3: лише прапорець ТОП, режимів більше немає', () => {
  const session = { presence: { 'p-a': { top: true }, 'p-b': { top: false } } };
  const scores = LMCore.computeScores(session, PBYID, S);
  assert.deepStrictEqual([...LMCore.topContributors(session, scores)], ['p-a']);
  assert.deepStrictEqual([...LMCore.topContributors({ presence: {} }, scores)], []);
});
```

- [ ] **Step 2: Запустити тести — мають упасти**

Run: `node tests/core.test.js`
Expected: FAIL — `computeScores` поверне `{}` (бо стара реалізація читає `presence`,
а тепер третій аргумент — `settings`, тож `settings.scoreTop` буде `undefined`).

- [ ] **Step 3: Переписати `computeScores` і `topContributors`**

Замінити функцію `computeScores` цілком на:

```js
  // ТЗ §5.2 (v3.0.0): бал вкладу — кожному активному гравцю складу; ТОП дає більший бал.
  // Відмітки присутності немає: офіцеру задовго відмічати ~70 нікнеймів щоівенту.
  function computeScores(session, playersById, settings) {
    const scores = {};
    const presence = (session && session.presence) || {};
    for (const pid of Object.keys(playersById)) {
      if (playersById[pid].isActive === false) continue;
      scores[pid] = (presence[pid] && presence[pid].top)
        ? settings.scoreTop : settings.scorePresent;
    }
    return scores;
  }
```

Замінити функцію `topContributors` цілком на:

```js
  // ТЗ §6 (v3.0.0): «ТОП Вклад» — виключно прапорець офіцера
  function topContributors(session, scores) {
    const presence = (session && session.presence) || {};
    return new Set(Object.keys(scores).filter(pid => presence[pid] && presence[pid].top));
  }
```

- [ ] **Step 4: Полагодити виклик усередині `distribute`**

У `distribute` замінити рядок

```js
    const scores = computeScores(session, playersById, classesById, settings);
```

на

```js
    const scores = computeScores(session, playersById, settings);
```

- [ ] **Step 5: Прибрати `present: true` зі старих фікстур тестів**

У `tests/core.test.js` замінити всі входження `{ present: true, top: false }` на `{ top: false }`
і `{ present: true, top: true }` на `{ top: true }`; прибрати `mode: 'simple',` і
`mode: 'advanced',` з усіх об'єктів `session`. Це чисто механічна заміна:

```bash
sed -i "s/{ present: true, top: false }/{ top: false }/g; s/{ present: true, top: true }/{ top: true }/g; s/mode: 'simple', //g; s/mode: 'advanced', //g" tests/core.test.js
```

Після заміни перечитати файл очима: у фікстурах `session` не має лишитися ані `mode`,
ані `present`. Тести з класом-бонусом і анти-жадібністю тепер бачать усіх трьох гравців
(`p-a`, `p-b`, `p-c`), а не двох — але претендентами лишаються тільки ті, хто в `claims`,
тож очікувані переможці не змінюються.

- [ ] **Step 6: Запустити тести — мають пройти**

Run: `node tests/core.test.js`
Expected: `0 failed`. Якщо якийсь тест розподілу впав — причина в тому, що третій гравець
тепер має бал; перевірити, чи він є в `claims` цього тесту, і не додавати його туди.

- [ ] **Step 7: Commit**

```bash
git add loot-manager.html tests/core.test.js && git commit -m "feat!: every active player is eligible; presence flag replaced by TOP only"
```

---

### Task 3: Ядро — групи класів і два етапи розподілу

**Files:**
- Modify: `loot-manager.html` — `CLASS_SEED` (~243), `CLASS_WEIGHT_HINTS` (~248),
  `emptyDb` (~257), `applyRoster` (~465-475), `distribute` (~356-425), блок `return { ... }`
  наприкінці `LMCore`
- Test: `tests/core.test.js` — `mkClass`, `CLS`, нові тести етапів

**Interfaces:**
- Consumes: `LMCore.computeScores(session, playersById, settings)` з Task 2
- Produces:
  - `LMCore.groupForClassName(name) -> 'A' | 'B'`
  - `LMCore.defaultFirstGroup(hour) -> 'A' | 'B'` (година 0–23 за місцевим часом)
  - `ClassConfig.group: 'A' | 'B'` — нове поле довідника класів
  - `session.firstGroup: 'A' | 'B'` — нове поле чернетки сеансу
  - `position.stage: 1 | 2` — новий етап у кожній позиції результату

- [ ] **Step 1: Написати падаючі тести**

У `tests/core.test.js` замінити `mkClass` і `CLS` (секція `---- Task 3 ----`) на:

```js
function mkClass(id, name, wDmg, wTaken, wHeal, group) {
  return { id, name, wDmg, wTaken, wHeal, group, isArchived: false };
}
const CLS = {
  tank: mkClass('c-tank', 'Танк', 0.2, 0.7, 0.1, 'A'),
  heal: mkClass('c-heal', 'Хіл', 0.1, 0.1, 0.8, 'A'),
  mdd:  mkClass('c-mdd', 'МДД', 0.8, 0.1, 0.1, 'B')
};
```

У кінець секції `---- Task 3 ----` (одразу перед `// ---- Task 5 ----`) додати:

```js
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
test('distribute: етап 1 (танки/лекарі) забирає предмет, ДД дістається залишок', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } };   // p-a — танк (A), p-c — МДД (B)
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-a', 'p-c']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: вечірній порядок дзеркалить результат', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'B',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-c': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-c', 'p-a']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: гравець першого етапу без виграшу в другий не переходить', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'], 'p-b': ['i-box'] } };   // обидва — група A
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  // перша скриня — комусь із двох, друга — другому; третьої заявки немає
  assert.deepStrictEqual(positions.map(p => p.winnerId).sort(), ['p-a', 'p-b']);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 1]);
});
test('distribute: вільний залишок після обох етапів іде в другий етап', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 2 }],
    claims: { 'p-a': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.deepStrictEqual(positions.map(p => p.winnerId), ['p-a', null]);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 2]);
});
test('distribute: wWon діє наскрізно всередині етапу', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-sword', quantity: 1 }, { itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-sword', 'i-box'], 'p-b': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: {}, rollMemo: {} });
  assert.strictEqual(positions[0].winnerId, 'p-a');   // меч: єдиний претендент, 50
  assert.strictEqual(positions[1].winnerId, 'p-b');   // скриня: p-a 50−50=0 проти p-b 50
  assert.strictEqual(positions[1].rolled, false);
  assert.deepStrictEqual(positions.map(p => p.stage), [1, 1]);
});
test('distribute: override віддає предмет гравцю іншої групи, stage — за його групою', () => {
  const session = { eventTypeName: 'Бос', firstGroup: 'A',
    presence: {},
    drops: [{ itemId: 'i-box', quantity: 1 }],
    claims: { 'p-a': ['i-box'] } };
  const { positions } = LMCore.distribute({ session, playersById: PBYID,
    classesById: CLSBYID, itemsById: ITBYID, history: [], settings: S,
    nowISO: NOW, rng: rngZero, overrides: { 'i-box#0': 'p-c' }, rollMemo: {} });
  assert.strictEqual(positions[0].winnerId, 'p-c');
  assert.strictEqual(positions[0].manual, true);
  assert.strictEqual(positions[0].stage, 2);          // p-c у групі B, першою йде A
  assert.deepStrictEqual(positions[0].candidates.map(c => c.playerId), ['p-a']);
});
```

Про порядок кандидатів: `claimantsFor` бере `Object.keys(scores)`, тобто порядок ключів
`playersById` (`p-a`, `p-b`, `p-c`), і сортує стабільно за спаданням пріоритету. При нічиї
`rngZero` (`() => 0`) обирає **першого** лідера в цьому порядку. Тести вище підібрані так,
щоб нічиї не було, — крім тесту «гравець першого етапу без виграшу в другий не переходить»,
де перевіряється тільки склад переможців (`.sort()`), а не хто саме був першим.

- [ ] **Step 2: Запустити тести — мають упасти**

Run: `node tests/core.test.js`
Expected: FAIL — `LMCore.groupForClassName is not a function`, `stage` === `undefined`.

- [ ] **Step 3: Додати довідники груп у ядро**

Одразу після `CLASS_WEIGHT_HINTS` додати:

```js
  // v3.0.0: група розподілу класу — 'A' танки та лекарі, 'B' ДД (усе інше).
  // Реальний процес альянсу: зранку першими обирають A, ввечері — B.
  const GROUP_A_NAMES = Object.freeze(['воин', 'жрец', 'танк', 'лекарь', 'хил']);
  function groupForClassName(name) {
    return GROUP_A_NAMES.includes(String(name || '').trim().toLowerCase()) ? 'A' : 'B';
  }
  // година за місцевим часом клієнта; межа — 15:00
  function defaultFirstGroup(hour) { return Number(hour) < 15 ? 'A' : 'B'; }
```

Додати `'лекарь': [0.1, 0.1, 0.8],` у `CLASS_WEIGHT_HINTS` поруч із `'хил'`.

Проставити групу в засіві — замінити `CLASS_SEED` на:

```js
  // v1.5: реальні класи гри (склад альянсу замовника); v3.0.0: + група розподілу
  const CLASS_SEED = [
    ['Маг', 0.8, 0.1, 0.1], ['Воин', 0.3, 0.6, 0.1], ['Жрец', 0.1, 0.1, 0.8],
    ['Разбойник', 0.8, 0.1, 0.1], ['Лучник', 0.8, 0.1, 0.1]
  ];
```

(перелік не змінюється — групу підставляє `emptyDb` через `groupForClassName`).

У `emptyDb` у місці створення класів додати поле `group`. Знайти рядок

```js
      classes: CLASS_SEED.map(([name, wDmg, wTaken, wHeal]) =>
```

і в об'єкті, який він будує, додати `group: groupForClassName(name),`.

У `applyRoster`, там де створюється новий клас (`classes.push(cls); addedClasses++;`),
додати в об'єкт `cls` поле `group: groupForClassName(g.className),`.

- [ ] **Step 4: Переписати `distribute` на пре-прохід + два етапи**

Замінити тіло `distribute` від рядка `const drops = (session.drops || [])` до
`return { positions, scores };` включно на:

```js
    const drops = (session.drops || [])
      .map((d, idx) => ({ ...d, idx,
        rank: (itemsById[d.itemId] && RARITY_RANK[itemsById[d.itemId].rarity]) || 0 }))
      .sort((a, b) => b.rank - a.rank || a.idx - b.idx);

    const firstGroup = session.firstGroup === 'B' ? 'B' : 'A';
    const groupOf = pid => {
      const p = playersById[pid];
      const c = p && classesById[p.classId];
      return c && c.group === 'A' ? 'A' : 'B';
    };
    const stageOf = pid => (groupOf(pid) === firstGroup ? 1 : 2);

    const wonCount = {};   // pid → штук виграно в сеансі (wWon-штраф), наскрізно між етапами
    const wonItem = {};    // pid → Set(itemId): правило «одна штука предмета на гравця»
    const take = (itemId, pid) => {
      wonCount[pid] = (wonCount[pid] || 0) + 1;
      (wonItem[pid] = wonItem[pid] || new Set()).add(itemId);
    };
    const hasClassBonus = (item, pid) => item.targetClasses.length > 0 &&
      item.targetClasses.includes(playersById[pid].classId);

    // усі штуки здобичі одним пласким списком — порядок звіту не залежить від етапів
    const slots = [];
    for (const d of drops) {
      const item = itemsById[d.itemId];
      if (!item) continue;
      const qty = Math.max(1, Number(d.quantity) || 1);
      for (let copy = 0; copy < qty; copy++) {
        slots.push({ key: d.itemId + '#' + copy, itemId: d.itemId, copyIndex: copy, item,
          winnerId: null, priority: null, rolled: false, manual: false, candidates: [] });
      }
    }

    // претенденти на штуку; stage === null — без фільтра за групою (для ручних рішень)
    const claimantsFor = (slot, stage) => Object.keys(scores)
      .filter(pid => stage === null || stageOf(pid) === stage)
      .filter(pid => Array.isArray(session.claims && session.claims[pid]) &&
                     session.claims[pid].includes(slot.itemId))
      .filter(pid => !(wonItem[pid] && wonItem[pid].has(slot.itemId)))
      .map(pid => ({ playerId: pid, priority: scores[pid]
        + (hasClassBonus(slot.item, pid) ? settings.pClass : 0)
        - settings.kPenalty * loadOf(pid)
        - settings.wWon * (wonCount[pid] || 0) }))
      .sort((a, b) => b.priority - a.priority);

    // ТЗ §5.7 крок 0: ручні рішення офіцера — поза чергою етапів і поза обмеженнями
    for (const slot of slots) {
      const manualWinner = overrides && overrides[slot.key];
      if (!manualWinner || !playersById[manualWinner] ||
          scores[manualWinner] === undefined) continue;
      slot.candidates = claimantsFor(slot, null);
      const c = slot.candidates.find(x => x.playerId === manualWinner);
      slot.winnerId = manualWinner; slot.manual = true;
      slot.priority = c ? c.priority : null;
      take(slot.itemId, manualWinner);
    }

    // ТЗ §5.7 кроки 1-2: етап першої групи по всій здобичі, далі друга група по залишках
    for (const stage of [1, 2]) {
      for (const slot of slots) {
        if (slot.winnerId) continue;
        const cands = claimantsFor(slot, stage);
        slot.candidates = cands;
        if (cands.length === 0) continue;
        const top = cands[0].priority;
        const leaders = cands.filter(c => top - c.priority < 0.001);
        let chosen = leaders[0];
        if (leaders.length > 1) {
          slot.rolled = true;
          const memoWinner = rollMemo && rollMemo[slot.key];
          chosen = (memoWinner && leaders.some(l => l.playerId === memoWinner))
            ? leaders.find(l => l.playerId === memoWinner)
            : leaders[Math.floor(rng() * leaders.length)];
        }
        slot.winnerId = chosen.playerId; slot.priority = chosen.priority;
        take(slot.itemId, chosen.playerId);
      }
    }

    const positions = slots.map(s => ({
      key: s.key, itemId: s.itemId, copyIndex: s.copyIndex,
      winnerId: s.winnerId, priority: s.priority, rolled: s.rolled, manual: s.manual,
      stage: s.winnerId ? stageOf(s.winnerId) : 2,
      classBonus: s.winnerId ? hasClassBonus(s.item, s.winnerId) : false,
      candidates: s.candidates
    }));
    return { positions, scores };
```

Заодно видалити з початку `distribute` рядок `const presentIds = Object.keys(scores);`
(більше не використовується) — `claimantsFor` бере ключі `scores` напряму.

- [ ] **Step 5: Експортувати нові функції**

У блоці `return { ... }` наприкінці `LMCore` додати `groupForClassName, defaultFirstGroup,`
поруч із рештою експортів.

- [ ] **Step 6: Запустити тести**

Run: `node tests/core.test.js`
Expected: `0 failed`.

Якщо падає тест «порядок за рідкістю, одна штука на гравця, вільний залишок» — перевірити,
що `CLS.tank` і `CLS.heal` мають `group: 'A'`, а `CLS.mdd` — `'B'`, і що в тому тесті
`p-a` (танк) і `p-b` (хіл) обидва в першій групі: очікувані переможці не змінюються.

- [ ] **Step 7: Commit**

```bash
git add loot-manager.html tests/core.test.js && git commit -m "feat!: two-stage distribution by class group (tanks+healers vs DPS)"
```

---

### Task 4: Ядро — міграція бази v1 → v2

**Files:**
- Modify: `loot-manager.html` — `emptyDb` (`schemaVersion`), `migrate` (~271)
- Test: `tests/core.test.js` — тест `migrate` у секції `---- Task 2 ----`

**Interfaces:**
- Consumes: `LMCore.groupForClassName(name)` з Task 3
- Produces: `db.schemaVersion === 2`; кожен `db.classes[i].group` заповнений;
  `draftSession.presence[pid] === { top: boolean }`; `draftSession.firstGroup` заданий

- [ ] **Step 1: Написати падаючі тести**

Замінити тест `migrate: v1 проходить, чужа версія — ні` на:

```js
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
  const bad = LMCore.emptyDb(NOW); bad.schemaVersion = 99;
  assert.strictEqual(LMCore.migrate(bad).ok, false);
});
test('migrate: стара мова uk падає на ru (обидві версії схеми)', () => {
  const v1 = LMCore.emptyDb(NOW); v1.schemaVersion = 1; v1.settings.language = 'uk';
  assert.strictEqual(LMCore.migrate(v1).db.settings.language, 'ru');
  const v2 = LMCore.emptyDb(NOW); v2.settings.language = 'uk';
  assert.strictEqual(LMCore.migrate(v2).db.settings.language, 'ru');
});
```

У тесті `emptyDb: перший запуск за ТЗ §7.1` замінити
`assert.strictEqual(db.schemaVersion, 1);` на `assert.strictEqual(db.schemaVersion, 2);`
і додати після перевірки ваг мага:

```js
  assert.strictEqual(mag.group, 'B');
  assert.strictEqual(db.classes[1].group, 'A');   // Воин
  assert.strictEqual(db.classes[2].group, 'A');   // Жрец
```

- [ ] **Step 2: Запустити тести — мають упасти**

Run: `node tests/core.test.js`
Expected: FAIL — `schemaVersion` 1 замість 2, `c.group` — `undefined`.

- [ ] **Step 3: Реалізувати міграцію**

В `emptyDb` змінити `schemaVersion: 1,` на `schemaVersion: 2,`.

Замінити функцію `migrate` цілком на:

```js
  function migrate(db) {
    // v1.2: мова лише ru|en; відсутня чи невідома (зокрема стара uk) → ru
    if (db.settings && !LANGS.includes(db.settings.language)) db.settings.language = 'ru';
    if (db.schemaVersion === 1) {
      // v3.0.0: класи дістають групу розподілу за назвою
      for (const c of db.classes || []) {
        if (c.group !== 'A' && c.group !== 'B') c.group = groupForClassName(c.name);
      }
      // чернетка сеансу: присутність і метрики розширеного режиму більше не існують
      for (const pa of Object.values(db.perAlliance || {})) {
        const d = pa.draftSession;
        if (!d) continue;
        delete d.mode;
        for (const pid of Object.keys(d.presence || {})) {
          d.presence[pid] = { top: !!d.presence[pid].top };
        }
        if (d.firstGroup !== 'A' && d.firstGroup !== 'B') d.firstGroup = 'A';
      }
      db.schemaVersion = 2;
      return { ok: true, db };
    }
    if (db.schemaVersion === 2) return { ok: true, db };
    return { ok: false, error: 'Непідтримувана версія схеми: ' + db.schemaVersion };
  }
```

- [ ] **Step 4: Запустити тести**

Run: `node tests/core.test.js`
Expected: `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add loot-manager.html tests/core.test.js && git commit -m "feat: migrate saved databases to schemaVersion 2 (class groups, cleaned draft)"
```

---

### Task 5: Ядро — звіт двома етапами

**Files:**
- Modify: `loot-manager.html` — `REPORT_I18N` (~545), `formatReport` (~554-585)
- Test: `tests/core.test.js` — тести `formatReport`

**Interfaces:**
- Consumes: `position.stage` з Task 3
- Produces: `LMCore.formatReport({ allianceName, eventTypeName, positions, itemsById,
  playersById, classesById, topSet, lang, firstGroup })` — новий обов'язковий ключ `firstGroup`

- [ ] **Step 1: Написати падаючий тест**

Додати в `tests/core.test.js` поруч із наявними тестами `formatReport`:

```js
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
  assert.match(lines[2], /^🔹 Меч .*@Andriy \[Танк \| ТОП Вклад\]$/);
  assert.strictEqual(lines[3], '▸ ЭТАП 2 — ДД');
  assert.match(lines[4], /^🔹 Сундук \(2 шт\.\) — @Chip \[МДД\], \[Свободный остаток\]$/);
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
```

Перевірити назви предметів у фікстурі `ITBYID` (`i-sword`, `i-box`) і за потреби
підправити очікувані рядки під фактичні назви з тестового каталогу.

- [ ] **Step 2: Запустити тести — мають упасти**

Run: `node tests/core.test.js`
Expected: FAIL — у звіті немає рядків «ЭТАП».

- [ ] **Step 3: Додати рядки етапів у `REPORT_I18N`**

```js
  const REPORT_I18N = Object.freeze({
    ru: { header: (a, e) => '📜 [АЛЬЯНС: ' + a + '] РАСПРЕДЕЛЕНИЕ ДОБЫЧИ (' + e + ')',
          pcs: 'шт.', top: 'ТОП Вклад', free: '[Свободный остаток]',
          stage: (n, who) => '▸ ЭТАП ' + n + ' — ' + who,
          groupA: 'Танки и лекари', groupB: 'ДД',
          footer: 'Спасибо всем за участие! Предметы ждут в магазине альянса.' },
    en: { header: (a, e) => '📜 [ALLIANCE: ' + a + '] LOOT DISTRIBUTION (' + e + ')',
          pcs: 'pcs', top: 'TOP Contribution', free: '[Unclaimed]',
          stage: (n, who) => '▸ STAGE ' + n + ' — ' + who,
          groupA: 'Tanks & healers', groupB: 'DPS',
          footer: 'Thanks everyone for participating! Items are waiting in the alliance shop.' }
  });
```

- [ ] **Step 4: Переписати `formatReport`**

```js
  // ТЗ §6 (v3.0.0): дві секції етапів; рядок на предмет усередині секції;
  // кілька вільних штук — одна позначка; 🎲/manual у текст не виводяться
  function formatReport({ allianceName, eventTypeName, positions, itemsById,
                          playersById, classesById, topSet, lang, firstGroup }) {
    const L = REPORT_I18N[lang] || REPORT_I18N.ru;
    const first = firstGroup === 'B' ? 'B' : 'A';
    const groupName = g => (g === 'A' ? L.groupA : L.groupB);
    const linesFor = stage => {
      const byItem = [];       // порядок першої появи предмета в межах етапу
      const groups = new Map();
      for (const pos of positions) {
        if ((pos.stage === 1 ? 1 : 2) !== stage) continue;
        if (!groups.has(pos.itemId)) { groups.set(pos.itemId, []); byItem.push(pos.itemId); }
        groups.get(pos.itemId).push(pos);
      }
      const out = [];
      for (const itemId of byItem) {
        const item = itemsById[itemId];
        const posList = groups.get(itemId);
        const entries = [];
        let freeCount = 0;
        for (const pos of posList) {
          if (!pos.winnerId) { freeCount++; continue; }
          const player = playersById[pos.winnerId];
          const cls = player && classesById[player.classId];
          const nick = player ? player.nickname : '?';
          const clsName = cls ? cls.name : '?';
          const topMark = topSet.has(pos.winnerId) ? ' | ' + L.top : '';
          entries.push('@' + nick + ' [' + clsName + topMark + ']');
        }
        if (freeCount > 0) entries.push(L.free);
        const displayName = item ? ((lang === 'en' && item.nameEn) ? item.nameEn : item.name) : '?';
        out.push('🔹 ' + displayName + ' (' + posList.length + ' ' + L.pcs + ') — ' +
          entries.join(', '));
      }
      return out;
    };
    const blocks = [];
    for (const stage of [1, 2]) {
      const lines = linesFor(stage);
      if (lines.length === 0) continue;
      const g = stage === 1 ? first : (first === 'A' ? 'B' : 'A');
      blocks.push(L.stage(stage, groupName(g)) + '\n' + lines.join('\n'));
    }
    return L.header(allianceName, eventTypeName) + '\n\n' +
      blocks.join('\n\n') + '\n\n' + L.footer;
  }
```

- [ ] **Step 5: Запустити тести**

Run: `node tests/core.test.js`
Expected: `0 failed`. Наявні тести `formatReport` без `stage` у позиціях тепер потраплять
у етап 2 (`pos.stage === 1 ? 1 : 2` дає 2 для `undefined`) — додати їм `firstGroup: 'A'`
і `stage: 1` у фікстури позицій, щоб очікуваний текст лишився тим самим.

- [ ] **Step 6: Commit**

```bash
git add loot-manager.html tests/core.test.js && git commit -m "feat: chat report split into two stage sections"
```

---

### Task 6: UI вкладки 1 — порядок етапів замість присутності

**Files:**
- Modify: `loot-manager.html` — `I18N.ru`/`I18N.en` (~640-810), `rosterGridHtml` (~942-982),
  `renderTab1` (~984-1050), `presenceOf` (~1052), `presentPlayers` (~1081),
  `emptyDraft`/`draftSession` (~894), CSS `.roster-cell.absent` / `.roster-grid.advanced`
- Test: браузер (прев'ю), `node tests/core.test.js` як регресія

**Interfaces:**
- Consumes: `LMCore.defaultFirstGroup(hour)`, `LMCore.computeScores(session, playersById, settings)`
- Produces: `eligiblePlayers()` замість `presentPlayers()`; `draft().firstGroup`

- [ ] **Step 1: Оновити словники i18n**

У `I18N.ru` **видалити** ключі `modeLabel`, `modeSimple`, `modeAdvanced`, `allPresent`,
`nonePresent`, `present`, `claimAutoPresent`; **додати**:

```js
    orderLabel: 'Порядок этапов:', orderMorning: 'Утро: сначала танки и лекари',
    orderEvening: 'Вечер: сначала ДД', clearTop: 'Снять все ТОП',
    topCount: 'ТОП', stageHead: n => 'Этап ' + n,
    groupA: 'Танки и лекари', groupB: 'ДД', thGroup: 'Группа',
```

У `I18N.en` — те саме дзеркально:

```js
    orderLabel: 'Stage order:', orderMorning: 'Morning: tanks & healers first',
    orderEvening: 'Evening: DPS first', clearTop: 'Clear all TOP',
    topCount: 'TOP', stageHead: n => 'Stage ' + n,
    groupA: 'Tanks & healers', groupB: 'DPS', thGroup: 'Group',
```

Змінити `presenceH2` на `'Состав и ТОП вклад'` / `'Roster & TOP contribution'`,
а `setScorePresent` на `'Балл обычного участника'` / `'Regular participant score'`.
Знайти й видалити з обох словників `calcHint`-текст про присутніх, замінивши на
`'Нужна добыча (вкладка 2) и состав альянса.'` / `'Need loot (tab 2) and an alliance roster.'`.

Перевірка симетрії ключів — `node tests/docs.test.js`, тест 8.

- [ ] **Step 2: Переписати клітинку та сітку складу**

Замінити `rosterGridHtml` цілком на:

```js
// v3.0.0: склад — сітка з єдиним прапорцем ТОП; присутність більше не відмічається
function rosterGridHtml(d, visible) {
  const groups = new Map();
  for (const p of visible) {
    if (!groups.has(p.classId)) groups.set(p.classId, []);
    groups.get(p.classId).push(p);
  }
  const order = db.classes.map(c => c.id).filter(id => groups.has(id));
  for (const id of groups.keys()) if (!order.includes(id)) order.push(id);

  const cell = p => {
    const isTop = !!(d.presence[p.id] && d.presence[p.id].top);
    return '<div class="roster-cell' + (isTop ? '' : ' dim') + '">' +
      '<span class="nick">' + escapeHtml(p.nickname) + '</span>' +
      (p.level ? '<span class="muted small lvl">' + p.level + '</span>' : '') +
      '<label class="inline small" title="' + t('topFlag') + '">' +
        '<input type="checkbox" class="chkTop" data-pid="' + p.id + '"' +
        (isTop ? ' checked' : '') + '> ' + t('topFlag') + '</label>' +
    '</div>';
  };

  return '<div class="roster-grid">' +
    order.map(cid => {
      const list = groups.get(cid);
      const tops = list.filter(p => d.presence[p.id] && d.presence[p.id].top).length;
      return '<div class="roster-class-head">' + escapeHtml(className(cid)) +
        '<span class="muted small">' + t('topCount') + ' ' + tops + '/' + list.length +
        '</span></div>' + list.map(cell).join('');
    }).join('') + '</div>';
}
```

- [ ] **Step 3: Переписати `renderTab1`**

Замінити блок перемикача режиму (рядки з `t('modeLabel')`, `modeSimple`, `modeAdvanced`) на
перемикач порядку:

```js
      '<div class="row" style="margin-top:8px">' +
        '<span class="muted small">' + t('orderLabel') + '</span>' +
        '<label class="inline"><input type="radio" name="firstGroup" value="A"' +
          (d.firstGroup !== 'B' ? ' checked' : '') + '> ' + t('orderMorning') + '</label>' +
        '<label class="inline"><input type="radio" name="firstGroup" value="B"' +
          (d.firstGroup === 'B' ? ' checked' : '') + '> ' + t('orderEvening') + '</label>' +
      '</div>' +
```

Замінити кнопки шапки складу:

```js
      '<div class="row"><h2 class="grow">' + t('presenceH2') + '</h2>' +
        '<button class="btn btn-sm" id="btnClearTop">' + t('clearTop') + '</button></div>' +
```

У блоці обробників замінити слухач `input[name="mode"]` на:

```js
  tab.querySelectorAll('input[name="firstGroup"]').forEach(r =>
    r.addEventListener('change', e => { draft().firstGroup = e.target.value; mutated(); }));
```

Видалити слухачі `#btnAllPresent`, `#btnNonePresent`, `.chkPresent`, `.inpMetric` і додати:

```js
  tab.querySelector('#btnClearTop')?.addEventListener('click', () => {
    for (const p of visible) presenceOf(p.id).top = false;
    mutated(); renderTab1();
  });
```

Слухач `.chkTop` лишається, але має скидати кеш розрахунку — замінити його тіло на:

```js
  tab.querySelectorAll('.chkTop').forEach(c =>
    c.addEventListener('change', e => {
      presenceOf(e.target.dataset.pid).top = e.target.checked; mutated(); renderTab1();
    }));
```

(`mutated()` вже визначена у блоці вкладки 4: скидає `ui.calcResult` і зберігає стан.
Переконатися, що вона оголошена **до** першого виклику — якщо ні, підняти її оголошення
до `renderTab1`.)

- [ ] **Step 4: Оновити форму чернетки і допоміжні функції**

`presenceOf`:

```js
function presenceOf(pid) {
  const d = draft();
  if (!d.presence[pid]) d.presence[pid] = { top: false };
  return d.presence[pid];
}
```

`presentPlayers` → перейменувати на `eligiblePlayers` і повернути всіх активних:

```js
// v3.0.0: присутність не відмічається — кандидатом є кожен активний гравець складу
function eligiblePlayers() {
  return pa().players.filter(p => p.isActive);
}
```

Знайти всі виклики `presentPlayers()` (вкладка 3, `renderTab3`) і замінити на `eligiblePlayers()`.

У місці створення чернетки (`data.draftSession = { eventTypeName: '', mode: 'simple', presence: {},`)
замінити на:

```js
    data.draftSession = { eventTypeName: '', firstGroup: LMCore.defaultFirstGroup(new Date().getHours()),
      presence: {},
```

- [ ] **Step 5: Прибрати мертвий CSS**

Видалити правила `.roster-cell.absent { ... }` і `.roster-grid.advanced { ... }`
(та будь-які `.metrics { ... }`), якщо вони більше ні на що не посилаються.
Знайти їх пошуком `absent`, `advanced`, `metrics` у блоці `<style>`.

- [ ] **Step 6: Перевірити в браузері**

Перезавантажити `http://localhost:8641/loot-manager.html`, далі:

1. Вкладка 1: є перемикач «Утро / Вечер», значення підставлено за поточною годиною.
2. Немає чекбоксів присутності, немає перемикача режиму, немає полів Damage/Taken/Heal.
3. Позначити двох гравців ТОП → лічильник класу показує `ТОП 2/25`.
4. «Снять все ТОП» знімає прапорці лише у видимих (за фільтром класу) гравців.
5. У консолі браузера — жодної помилки:
   `mcp__Claude_Browser__read_console_messages` з `onlyErrors: true`.

- [ ] **Step 7: Тести**

Run: `node tests/core.test.js && node tests/docs.test.js`
Expected: обидва `0 failed` (тест 8 у docs перевіряє симетрію ru/en).

- [ ] **Step 8: Commit**

```bash
git add loot-manager.html && git commit -m "feat!: tab 1 drops attendance, adds morning/evening stage order"
```

---

### Task 7: UI вкладок 2 і 3 — заявки без присутності, результат за етапами

**Files:**
- Modify: `loot-manager.html` — заявки (~1195, ~1325), `renderTab3` (~1360-1420)

**Interfaces:**
- Consumes: `position.stage`, `draft().firstGroup`, `eligiblePlayers()`
- Produces: нічого нового

- [ ] **Step 1: Прибрати «заявка ⇒ присутність»**

Знайти рядок

```js
    presenceOf(pid).present = true;   // заявка ⇒ присутність (ТЗ §4.3, v1.3)
```

і видалити його разом із коментарем. Видалити рядок з підказкою:

```js
      '<p class="muted small" style="margin-top:6px">' + t('claimAutoPresent') + '</p>';
```

(лишивши `classFilterBar() + grid;` як кінець виразу).

- [ ] **Step 2: Згрупувати результат за етапами**

У `renderTab3`, у блоці `if (ui.calcResult) {`, замінити побудову `rows`. Було
`const rows = positions.map(pos => { ... }).join('');` — стає:

```js
    const rowHtml = pos => { /* тіло наявної стрілки без змін */ };
    const groupLabel = g => (g === 'A' ? t('groupA') : t('groupB'));
    const first = d.firstGroup === 'B' ? 'B' : 'A';
    const rows = [1, 2].map(stage => {
      const list = positions.filter(p => (p.stage === 1 ? 1 : 2) === stage);
      if (list.length === 0) return '';
      const g = stage === 1 ? first : (first === 'A' ? 'B' : 'A');
      return '<h3 class="stage-head">' + t('stageHead', stage) + ' — ' +
        escapeHtml(groupLabel(g)) + '</h3>' + list.map(rowHtml).join('');
    }).join('');
```

Тобто наявна стрілка `pos => { ... }` просто отримує ім'я `rowHtml`, а `.map(...).join('')`
переїжджає в новий код вище.

- [ ] **Step 3: Передати `firstGroup` у звіт**

У виклику `LMCore.formatReport({ ... })` додати `firstGroup: d.firstGroup,` до об'єкта аргументів.

- [ ] **Step 4: Додати стиль заголовка етапу**

У `<style>`, поруч із `.pos-row`, додати:

```css
.stage-head { font-size: 0.95rem; margin: 14px 0 6px; color: var(--muted);
  border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.stage-head:first-child { margin-top: 0; }
```

- [ ] **Step 5: Перевірити в браузері**

1. Вкладка 2: заявки ставляться, підказки про присутність немає.
2. Вкладка 3 → «Рассчитать»: позиції розбиті на «Этап 1 — Танки и лекари» і
   «Этап 2 — ДД»; при перемиканні на «Вечер» у вкладці 1 і повторному розрахунку
   заголовки міняються місцями.
3. Текст для чату містить обидві секції.
4. Ручний вибір переможця у випадному списку працює, позиція переїжджає у секцію
   етапу того гравця, якого обрали.
5. Консоль без помилок.

- [ ] **Step 6: Тести**

Run: `node tests/core.test.js && node tests/docs.test.js`
Expected: обидва `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add loot-manager.html && git commit -m "feat: distribution result and chat text grouped by stage"
```

---

### Task 8: UI вкладки 4 — група класу

**Files:**
- Modify: `loot-manager.html` — таблиця класів (~1578-1593), обробники класів (~1876-1890)

**Interfaces:**
- Consumes: `LMCore.groupForClassName(name)`
- Produces: редагування `db.classes[i].group` з інтерфейсу

- [ ] **Step 1: Додати колонку «Группа» в таблицю класів**

У заголовку таблиці, після `t('thName')`, додати `'</th><th>' + t('thGroup') +`.
У рядку класу, одразу після клітинки з назвою, додати:

```js
      '<td><select class="selClsGroup" data-cid="' + c.id + '">' +
        '<option value="A"' + (c.group === 'A' ? ' selected' : '') + '>' + t('groupA') + '</option>' +
        '<option value="B"' + (c.group === 'A' ? '' : ' selected') + '>' + t('groupB') + '</option>' +
      '</select></td>' +
```

- [ ] **Step 2: Обробник зміни групи**

Поруч зі слухачем `.inpClsName` додати:

```js
  tab.querySelectorAll('.selClsGroup').forEach(sel =>
    sel.addEventListener('change', e => {
      const c = db.classes.find(x => x.id === e.target.dataset.cid);
      c.group = e.target.value === 'A' ? 'A' : 'B';
      mutated();
    }));
```

- [ ] **Step 3: Новий клас отримує групу за назвою**

У обробнику `#btnAddCls` замінити рядок створення на:

```js
    db.classes.push({ id: LMCore.uuid(), name, wDmg: 0.8, wTaken: 0.1, wHeal: 0.1,
      group: LMCore.groupForClassName(name), isArchived: false });
```

- [ ] **Step 4: Перевірити в браузері**

1. Вкладка 4 → Классы: у Воина і Жреца стоїть «Танки и лекари», у решти — «ДД».
2. Змінити групу Лучника на «Танки и лекари», перерахувати на вкладці 3 —
   лучники потрапляють у перший етап (при ранковому порядку).
3. Додати клас «Лекарь» — він одразу в групі «Танки и лекари».
4. Повернути Лучника назад у «ДД».

- [ ] **Step 5: Тести**

Run: `node tests/core.test.js && node tests/docs.test.js`
Expected: обидва `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add loot-manager.html && git commit -m "feat: class group column in the admin tab"
```

---

### Task 9: Документація, guard і версія

**Files:**
- Modify: `../ТЗ_Loot_Manager.md` (§3.4, §3.7, §4.2, §5.2, §5.3, §5.7, §6),
  `CLAUDE.md`, `tests/docs.test.js`

**Interfaces:**
- Consumes: усе попереднє
- Produces: зелений `node tests/docs.test.js`, тег `v3.0.0`

- [ ] **Step 1: Оновити ТЗ**

У `../ТЗ_Loot_Manager.md`:

* §3.4 `ClassConfig` — додати поле `group: 'A' | 'B'` з поясненням («A — танки та лекарі,
  B — ДД; засів за назвою класу: воин, жрец, танк, лекарь, хил → A»).
* §3.7 `draftSession` — прибрати `mode`, звести `presence[pid]` до `{ top: boolean }`,
  додати `firstGroup: 'A' | 'B'`.
* §4.2 Вкладка 1 — прибрати відмітку присутності, кнопки «Все присутствуют/Снять всех»
  і розширений режим; описати перемикач «Утро/Вечер» і кнопку «Снять все ТОП».
* §4.3 — прибрати правило «заявка ⇒ присутність».
* §5.2 — `Score = ТОП ? 100 : 50` для **кожного активного** гравця складу.
* §5.3 і §5.7 — описати пре-прохід ручних рішень і два етапні проходи; наскрізні
  `wWon`, «одна штука предмета», `kPenalty`.
* §6 — формат звіту з двома секціями етапів.

- [ ] **Step 2: Оновити CLAUDE.md**

* Блок «Алгоритм розподілу (сутність)» — замінити на:

```
Score    = ТОП→100 / учасник→50 (кожен активний гравець складу)
Priority = Score + pClass(25) − kPenalty(10)×історія − wWon(50)×виграно_в_сеансі
Етапи    = ручні рішення → перша група класів → друга група (лише залишки)
```

* «Сховище» — `schemaVersion: 2`.
* Прибрати згадку розширеного режиму й присутності, додати рядок про групи класів
  і `firstGroup`.

- [ ] **Step 3: Полагодити guard під нове формулювання**

`tests/docs.test.js`, тест 6 очікує `/присутній→(\d+)/`. Замінити цей рядок пари на:

```js
    ['scoreTop', /ТОП→(\d+)/], ['scorePresent', /учасник→(\d+)/]
```

- [ ] **Step 4: Додати guard на нові факти**

У `tests/docs.test.js`, перед фінальним `console.log`, додати:

```js
// ---- 11. Групи класів: документ і код називають однакові дефолти ----
test('групи класів у документі збігаються з ядром', () => {
  const html = fs.readFileSync(path.join(ROOT, 'loot-manager.html'), 'utf8');
  const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
  const LMCore = new Function(core + '\n;return LMCore;')();
  const db = LMCore.emptyDb(new Date(0).toISOString());
  const inCode = db.classes.filter(c => c.group === 'A').map(c => c.name).sort();
  assert.deepStrictEqual(inCode, ['Воин', 'Жрец'],
    'засів груп змінився: ' + inCode.join(', '));
  assert.ok(/перша група класів/.test(doc),
    DOC + ': опис етапів розподілу не знайдено');
});
```

- [ ] **Step 5: Прогнати все**

Run: `node tests/core.test.js && node tests/docs.test.js`
Expected: обидва `0 failed`.

- [ ] **Step 6: Commit і тег**

```bash
git add loot-manager.html tests/docs.test.js CLAUDE.md ../ТЗ_Loot_Manager.md && git commit -m "docs: two-stage distribution in spec, handbook and guard"
```

```bash
git tag v3.0.0
```

- [ ] **Step 7: Фінальна перевірка на реальних даних**

У браузері з робочою базою користувача (або після «Импортировать состав из текста»):

1. Вкладка 1 → «Вечер», позначити 3 ТОП.
2. Вкладка 2 → додати 3 предмети, зібрати заявки від магів і жерців.
3. Вкладка 3 → «Рассчитать»: перший етап — ДД, другий — танки й лекарі;
   жоден гравець не отримав дві однакові речі; вільний залишок у другій секції.
4. «Копировать» → банер з'являється і зникає.
5. «В историю» → запис зберігається, чернетка очищується, вкладка 1 показує
   свіжий перемикач порядку за годинником.

---

## Self-Review

**Покриття спеки:** банер — Task 1; назви — Task 1; відмова від присутності — Tasks 2, 6, 7;
групи класів — Tasks 3, 8; порядок етапів — Tasks 3, 6; два проходи — Task 3;
`stage` у позиціях — Task 3; звіт двома секціями — Tasks 5, 7; міграція — Task 4;
тести — у кожній задачі; документація — Task 9.

**Узгодженість імен:** `groupForClassName`, `defaultFirstGroup`, `claimantsFor`, `stageOf`,
`eligiblePlayers`, `rowHtml`, `firstGroup`, `stage` — вживаються однаково в усіх задачах.
`computeScores` має три параметри в Tasks 2, 3 і 6.

**Ризик, про який знати виконавцю:** пре-прохід ручних рішень тепер відбувається **до**
автоматичних, а не в порядку предметів. Для сеансу з кількома override і `wWon` це може
дати інший результат, ніж v2.1.1. Це свідома зміна: ручне рішення офіцера має пріоритет
над чергою етапів.
