#!/usr/bin/env bash
# Проставляет в index.html git-хеш каждого скрипта.
# Хеш меняется вместе с файлом, поэтому «забыл обновить версию» -
# ошибка, которой больше не существует. Запускать перед коммитом.
set -euo pipefail
for f in assets/js/*.js; do
  name=$(basename "$f" .js)
  h=$(git hash-object "$f" | cut -c1-10)
  sed -i "s|${name}\.js?v=[0-9a-f]*|${name}.js?v=${h}|" index.html
done
grep -o 'assets/js/[A-Za-z-]*\.js?v=[0-9a-f]*' index.html
