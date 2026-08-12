#!/usr/bin/env bash
# Збирає теку сайту й пушить її в гілку gh-pages репозиторію loot-manager.
set -euo pipefail
cd "$(dirname "$0")"
SITE="$(mktemp -d)/site"
WORK="$(mktemp -d)/work"
mkdir -p "$SITE/cards" "$SITE/icons" "$SITE/data"
cp loot-manager.html "$SITE/index.html"
cp cards/*.jpg "$SITE/cards/" 2>/dev/null || true
cp icons/*.png "$SITE/icons/" 2>/dev/null || true
cp data/loot.json "$SITE/data/" 2>/dev/null || true
touch "$SITE/.nojekyll"
git clone --quiet --branch gh-pages "$(git remote get-url origin)" "$WORK"
cd "$WORK"
git rm -rq --ignore-unmatch .
cp -r "$SITE"/. .
git add -A
git commit -qm "deploy: $(date -u +%Y-%m-%d\ %H:%M) UTC" || { echo "Змін немає."; exit 0; }
git push -q origin gh-pages
echo "Опубліковано: https://yourbugsbynny.github.io/loot-manager/"
