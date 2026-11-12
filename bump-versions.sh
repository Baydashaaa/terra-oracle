#!/usr/bin/env bash
# Проставляет в index.html git-хеш каждого скрипта, включая подпапки
# (assets/js/app/, assets/js/page/ ...). Хеш меняется вместе с файлом,
# поэтому «забыл обновить версию» - ошибка, которой больше не существует.
# Раньше брался только assets/js/*.js, и правки в app/wallet.js браузеры
# не видели: index.html продолжал просить старую версию из кэша.
# Запускать перед коммитом.
set -euo pipefail
find assets/js -name '*.js' | while read -r f; do
  h=$(git hash-object "$f" | cut -c1-10)
  esc=$(printf '%s' "$f" | sed 's/[.[\*^$/]/\\&/g')
  sed -i "s|${esc}?v=[0-9A-Za-z]*|${f}?v=${h}|g" index.html
done
grep -o 'assets/js/[A-Za-z0-9/_-]*\.js?v=[0-9A-Za-z]*' index.html
