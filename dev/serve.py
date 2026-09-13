#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
serve.py - локальный сервер для проверки terraoracle.io.

Зачем: `python3 -m http.server` отдаёт только существующие файлы, а /draw,
/home, /winners - это пути маршрутизатора. Пока переходишь кликами, сервер
не спрашивают. Жёсткая перезагрузка спрашивает - и получает 404. На проде
этот случай закрывает 404.html в GitHub Pages.

Здесь та же подмена:
    /draw, /home, /governance ...     -> index.html            (внешний сайт)
    /draw-app/winners, /draw-app/... -> draw-app/index.html    (рамка)
Всё, что существует на диске, отдаётся как есть. Всё, что похоже на файл
(есть точка в имени), по-прежнему даёт 404 - иначе битую ссылку на скрипт
не заметишь: вместо ошибки приедет HTML.

Плюс Cache-Control: no-store на всё. Галочка Disable cache в браузере не
действует на документ внутри iframe, и рамка регулярно доставалась из кеша -
из-за этого дважды чинили уже починенное.

Запуск из корня репо terra-oracle:

    python3 dev/serve.py           # порт 8080
    python3 dev/serve.py 8081
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        SimpleHTTPRequestHandler.end_headers(self)

    def translate_path(self, path):
        full = SimpleHTTPRequestHandler.translate_path(self, path)

        # Существует - отдаём как есть.
        if os.path.exists(full):
            return full

        # Похоже на файл (есть расширение) - пусть будет честный 404.
        if '.' in os.path.basename(full):
            return full

        # Путь маршрутизатора. Внутри рамки - её собственный index.html.
        clean = path.split('?', 1)[0].split('#', 1)[0]
        root = os.getcwd()
        if clean.startswith('/draw-app/') or clean == '/draw-app':
            return os.path.join(root, 'draw-app', 'index.html')
        return os.path.join(root, 'index.html')

    def log_message(self, fmt, *args):
        # Короткий лог: подмены видно отдельно, чтобы не спутать их с 200.
        sys.stderr.write('%s %s\n' % (self.command, self.path))


if not os.path.isfile('index.html'):
    print('ОШИБКА: запускать из корня репо terra-oracle.')
    sys.exit(1)

print('http://localhost:%d/          - сайт' % PORT)
print('http://localhost:%d/draw      - раздел Oracle Draw (перезагрузка работает)' % PORT)
print('http://localhost:%d/draw-app/index.html?embed=1  - рамка отдельно' % PORT)
print('Ctrl+C - остановить')
ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
