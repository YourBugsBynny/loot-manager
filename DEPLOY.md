# Публікація на GitHub Pages

Сайт: https://yourbugsbynny.github.io/loot-manager/
Репозиторій: https://github.com/YourBugsBynny/loot-manager

- Гілка `main` — вихідний код: `loot-manager.html`, `tests/`, `docs/`, `cards/`.
- Гілка `gh-pages` — те, що бачить браузер: `index.html` (копія застосунку),
  `cards/`, `icons/`, `data/loot.json`. Файл `.nojekyll` вимикає обробку Jekyll.

## Оновити сайт після зміни застосунку

```bash
cd loot-manager
git add loot-manager.html && git commit -m "..." && git push          # код у main
./deploy.sh                                                            # сайт у gh-pages
```

`deploy.sh` збирає теку сайту з поточних файлів і пушить її в `gh-pages`.
Оновлення з'являється на сайті за 1–2 хвилини.

Редактор каталогу (`index.html` сусіднього проєкту, `portraits/`, `frames/`)
навмисно НЕ публікується — це локальний авторський інструмент на ~25 МБ.
