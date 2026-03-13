#!/usr/bin/env python3
"""
Terra Oracle — Оптимизатор и разбивщик по папкам
=================================================
Запуск:
    python3 optimize.py

Положи этот файл рядом с index.html и запусти.
Результат появится в папке  dist/
"""

import os, re, base64, shutil

# ─── Утилиты ──────────────────────────────────────────────────────────────────

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def write_binary(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)

def kb(s):
    return f"{len(s.encode('utf-8') if isinstance(s, str) else s) / 1024:.1f} KB"

# ─── Шаг 1: Извлечь base64-изображения ───────────────────────────────────────

def extract_base64_images(html):
    """
    Находит все data:image/... base64 строки (в src="..." и url(...))
    Сохраняет как файлы, заменяет на пути.
    """
    images = {}
    counter = [0]
    ext_map = {
        'image/png':     'png',
        'image/jpeg':    'jpg',
        'image/jpg':     'jpg',
        'image/gif':     'gif',
        'image/svg+xml': 'svg',
        'image/webp':    'webp',
    }

    def save_image(mime, data_b64):
        ext  = ext_map.get(mime, 'bin')
        counter[0] += 1
        fname = f'img_{counter[0]:02d}.{ext}'
        try:
            images[fname] = base64.b64decode(data_b64)
        except Exception:
            images[fname] = data_b64.encode()
        return f'assets/images/{fname}'

    # src="data:..."
    def src_repl(m):
        path = save_image(m.group(1), m.group(2))
        return f'src="{path}"'

    html = re.sub(
        r'src="data:(image/[^;]+);base64,([A-Za-z0-9+/=\s]+)"',
        src_repl, html
    )

    # url(data:...)
    def url_repl(m):
        path = save_image(m.group(1), m.group(2))
        return f'url("{path}")'

    html = re.sub(
        r'url\(\s*["\']?data:(image/[^;]+);base64,([A-Za-z0-9+/=\s]+)["\']?\s*\)',
        url_repl, html
    )

    return html, images

# ─── Шаг 2: Извлечь и минифицировать CSS ─────────────────────────────────────

def extract_css(html):
    blocks = re.findall(r'<style[^>]*>(.*?)</style>', html, re.DOTALL)
    css    = '\n'.join(blocks)
    html   = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
    return html, css

def deduplicate_css(css):
    """Убирает дублирующиеся селекторы (оставляет последнее объявление)."""
    seen    = {}
    pattern = re.compile(r'((?:@[^{]+\s*)?[^{@][^{]*)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}', re.DOTALL)

    for m in pattern.finditer(css):
        sel   = re.sub(r'\s+', ' ', m.group(1)).strip()
        props = re.sub(r'\s+', ' ', m.group(2)).strip()
        seen[sel] = props          # перезапись — последняя версия побеждает

    parts = []
    for sel, props in seen.items():
        parts.append(f'{sel}{{{props}}}')
    return '\n'.join(parts)

def minify_css(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)  # комментарии
    css = re.sub(r'\s+',       ' ',  css)
    css = re.sub(r'\s*([{}:;,>~+])\s*', r'\1', css)
    css = re.sub(r';}',        '}',  css)                 # лишняя точка с запятой
    return css.strip()

# ─── Шаг 3: Извлечь JS ────────────────────────────────────────────────────────

def extract_js(html):
    js_blocks   = []
    ext_scripts = []   # src=... оставляем в HTML

    def repl(m):
        attrs   = m.group(1)
        content = m.group(2).strip()
        if 'src=' in attrs:           # внешний скрипт — не трогаем
            ext_scripts.append(m.group(0))
            return '\0EXT_SCRIPT\0'
        if content:
            js_blocks.append(content)
        return ''

    html = re.sub(r'<script([^>]*)>(.*?)</script>', repl, html, flags=re.DOTALL)

    # Возвращаем внешние скрипты
    idx = [0]
    def restore(m):
        s = ext_scripts[idx[0]]
        idx[0] += 1
        return s
    html = re.sub(r'\x00EXT_SCRIPT\x00', restore, html)

    return html, '\n\n'.join(js_blocks)

# ─── Шаг 4: Почистить HTML ────────────────────────────────────────────────────

def clean_html(html):
    html = re.sub(r'<!--(?!\[if).*?-->', '', html, flags=re.DOTALL)  # HTML-комментарии
    html = re.sub(r'[ \t]+',  ' ',  html)    # множественные пробелы
    html = re.sub(r'\n\s*\n', '\n', html)    # пустые строки
    return html.strip()

# ─── Шаг 5: Извлечь содержимое <body> ────────────────────────────────────────

def get_body(html):
    m = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL)
    return m.group(1).strip() if m else html

def get_title(html):
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL)
    return m.group(1).strip() if m else 'Terra Oracle'

# ─── Шаг 6: Собрать финальный index.html ─────────────────────────────────────

INDEX_TEMPLATE = '''\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script>if (history.scrollRestoration) history.scrollRestoration = 'manual';</script>
  <title>{title}</title>

  <!-- Шрифты -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;500;600;700&family=Rajdhani:wght@500;600;700&family=Stalinist+One&family=Boldonse&display=swap" rel="stylesheet">

  <!-- Стили -->
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

{body}

  <!-- Логика -->
  <script src="assets/js/app.js"></script>
</body>
</html>
'''

# ─── Главная функция ──────────────────────────────────────────────────────────

def process(src='index.html', out='dist'):
    print()
    print('═' * 55)
    print('  Terra Oracle — оптимизация и разбивка по папкам')
    print('═' * 55)

    # Читаем
    print(f'\n📄 Читаем {src} ...')
    html = read_file(src)
    size_before = len(html.encode())
    print(f'   Исходный размер: {size_before/1024:.1f} KB')

    # Шаг 1
    print('\n🖼️  [1/5] Извлекаем base64-изображения ...')
    html, images = extract_base64_images(html)
    for name, data in images.items():
        print(f'   ✓ {name}  ({len(data)/1024:.1f} KB)')
    if not images:
        print('   — не найдено')

    # Шаг 2
    print('\n🎨 [2/5] Извлекаем и минифицируем CSS ...')
    html, css_raw = extract_css(html)
    css_dedup = deduplicate_css(css_raw)
    css_min   = minify_css(css_dedup)
    print(f'   CSS: {kb(css_raw)} → {kb(css_min)}  (−{100*(1-len(css_min)/max(len(css_raw),1)):.0f}%)')

    # Шаг 3
    print('\n⚙️  [3/5] Извлекаем JavaScript ...')
    html, js = extract_js(html)
    print(f'   JS:  {kb(js)}')

    # Шаг 4
    print('\n🧹 [4/5] Чистим HTML ...')
    html  = clean_html(html)
    title = get_title(html)
    body  = get_body(html)

    # Шаг 5
    print('\n📦 [5/5] Собираем новую структуру ...')

    # Чистим dist если есть
    if os.path.exists(out):
        shutil.rmtree(out)

    # index.html
    new_index = INDEX_TEMPLATE.format(title=title, body=body)
    write_file(f'{out}/index.html', new_index)

    # CSS
    write_file(f'{out}/assets/css/style.css', css_min)

    # JS
    write_file(f'{out}/assets/js/app.js', js)

    # Изображения
    for name, data in images.items():
        write_binary(f'{out}/assets/images/{name}', data)

    # ─── Итог ─────────────────────────────────────────────────────────────────
    size_html = len(new_index.encode())
    size_css  = len(css_min.encode())
    size_js   = len(js.encode())
    size_imgs = sum(len(d) for d in images.values())
    size_after = size_html + size_css + size_js + size_imgs

    print()
    print('─' * 55)
    print(f'  📁 dist/')
    print(f'  ├── index.html              {size_html/1024:>7.1f} KB')
    print(f'  └── assets/')
    print(f'      ├── css/')
    print(f'      │   └── style.css       {size_css/1024:>7.1f} KB')
    print(f'      ├── js/')
    print(f'      │   └── app.js          {size_js/1024:>7.1f} KB')
    if images:
        print(f'      └── images/')
        for name, data in images.items():
            print(f'          └── {name:<18} {len(data)/1024:>5.1f} KB')
    print('─' * 55)
    print(f'  До:    {size_before/1024:>7.1f} KB')
    print(f'  После: {size_after/1024:>7.1f} KB  ', end='')
    saved = (1 - size_after / size_before) * 100
    if saved > 0:
        print(f'🎉 экономия {saved:.0f}%')
    else:
        print('(изображения сохранены отдельно)')
    print()
    print('  ✅ Готово! Открывай  dist/index.html')
    print('═' * 55)
    print()

# ─── Точка входа ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import sys

    src = sys.argv[1] if len(sys.argv) > 1 else 'index.html'
    out = sys.argv[2] if len(sys.argv) > 2 else 'dist'

    if not os.path.exists(src):
        print(f'\n❌ Файл "{src}" не найден.')
        print('   Использование:  python3 optimize.py [index.html] [dist]\n')
        sys.exit(1)

    process(src, out)
