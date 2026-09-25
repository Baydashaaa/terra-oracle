#!/usr/bin/env python3
# Локальный сервер для terra-oracle.
#  - не даёт браузеру кешировать: правки JS и CSS видны после обычного F5
#  - /markets, /home и прочие пути сайта отдают index.html, как на GitHub Pages
# Запуск из корня репозитория: python3 scripts/dev-server.py [порт]
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        name = os.path.basename(self.path.split('?', 1)[0].split('#', 1)[0])
        # Путь без расширения, которого нет на диске, - это страница сайта.
        if not os.path.exists(path) and '.' not in name:
            self.path = '/index.html'
        return super().send_head()


http.server.ThreadingHTTPServer.allow_reuse_address = True
print(f'http://localhost:{PORT}/?preview=1&testnet=1')
http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
