#!/usr/bin/env python3
"""
burn_bootstrap.py — сбор исторических данных burn через FCD.
Исправлено: обработка 400 ошибок, логирование URL, fallback endpoint.
"""

import json, os, time, urllib.request, urllib.error, sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

FCD_ENDPOINTS = [
    'https://fcd.terra-classic.hexxagon.io/v1/txs',
    'https://columbus-fcd.terra.dev/v1/txs',
]
HISTORY_PATH = 'assets/data/burn_history.json'
CHECKPOINT_PATH = '/tmp/burn_checkpoint.json'
DAYS_BACK = int(sys.argv[1]) if len(sys.argv) > 1 else 365
DELAY = 0.3
LIMIT = 100
MAX_RUNTIME = 5 * 3600
ERROR_SLEEP = 10

def fetch_txs(before_id=None, endpoint_idx=0):
    endpoint = FCD_ENDPOINTS[endpoint_idx % len(FCD_ENDPOINTS)]
    url = f'{endpoint}?limit={LIMIT}'
    if before_id:
        url += f'&before={before_id}'
    print(f"  GET {url[:80]}...")
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; burn-bootstrap/1.0)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read()), url

def extract_burn(tx):
    total = 0
    try:
        for log in tx.get('logs', []):
            for event in log.get('events', []):
                if event.get('type') == 'tax_payment':
                    for attr in event.get('attributes', []):
                        if attr.get('key') == 'tax_amount':
                            val = attr['value']
                            if 'uluna' in val:
                                total += int(val.replace('uluna', ''))
    except:
        pass
    return total

def ts_to_hour_key(ts_str):
    return ts_str[:13]

def ts_to_day_key(ts_str):
    return ts_str[:10]

def parse_ts(ts_str):
    return datetime.strptime(ts_str, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)

def load_existing():
    if os.path.exists(HISTORY_PATH):
        try:
            return json.loads(open(HISTORY_PATH).read())
        except:
            pass
    return {'daily': [], 'hourly': [], 'updated': '', 'bootstrap_done': False}

def load_checkpoint():
    if os.path.exists(CHECKPOINT_PATH):
        try:
            return json.loads(open(CHECKPOINT_PATH).read())
        except:
            pass
    return None

def save_checkpoint(data):
    open(CHECKPOINT_PATH, 'w').write(json.dumps(data))

def merge_into_existing(existing, daily_acc, hourly_acc):
    daily_map = {d['date']: d['burn'] for d in existing.get('daily', [])}
    for k, v in daily_acc.items():
        daily_map[k] = daily_map.get(k, 0) + v
    daily_list = sorted([{'date': k, 'burn': v} for k, v in daily_map.items()], key=lambda x: x['date'])

    cutoff_30d = (datetime.now(timezone.utc) - timedelta(days=30)).strftime('%Y-%m-%dT%H')
    hourly_map = {h['ts']: h['burn'] for h in existing.get('hourly', []) if h['ts'] >= cutoff_30d}
    for k, v in hourly_acc.items():
        if k >= cutoff_30d:
            hourly_map[k] = hourly_map.get(k, 0) + v
    hourly_list = sorted([{'ts': k, 'burn': v} for k, v in hourly_map.items()], key=lambda x: x['ts'])

    return daily_list, hourly_list

def main():
    start_time = time.time()
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    print(f"Bootstrap: цель={DAYS_BACK} дней, cutoff={cutoff_dt.strftime('%Y-%m-%d')}")

    cp = load_checkpoint()
    before_id = cp['next_before'] if cp else None
    daily_acc = defaultdict(int, cp.get('daily_acc', {}) if cp else {})
    hourly_acc = defaultdict(int, cp.get('hourly_acc', {}) if cp else {})
    pages = cp.get('pages', 0) if cp else 0
    total_burn = cp.get('total_burn', 0) if cp else 0
    endpoint_idx = 0
    consec_errors = 0

    if cp:
        print(f"Checkpoint: before_id={before_id}, страниц={pages}, burn={total_burn/1e6:.1f}M")

    existing = load_existing()
    done = False

    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed > MAX_RUNTIME:
                print(f"Лимит времени {MAX_RUNTIME/3600:.1f}ч. Сохраняем checkpoint.")
                break

            try:
                data, used_url = fetch_txs(before_id, endpoint_idx)
                consec_errors = 0
            except urllib.error.HTTPError as e:
                print(f"HTTP {e.code} для before_id={before_id}: {e.reason}")
                consec_errors += 1
                if consec_errors >= 3:
                    endpoint_idx += 1
                    print(f"Переключаемся на endpoint {endpoint_idx % len(FCD_ENDPOINTS)}")
                    consec_errors = 0
                time.sleep(ERROR_SLEEP)
                continue
            except Exception as e:
                print(f"Ошибка: {e}")
                consec_errors += 1
                if consec_errors > 6:
                    print("Слишком много ошибок, останавливаемся.")
                    break
                time.sleep(ERROR_SLEEP)
                continue

            txs = data.get('txs', [])
            next_id = data.get('next')

            if not txs:
                print("Транзакции закончились.")
                done = True
                break

            for tx in txs:
                ts = tx.get('timestamp', '')
                if not ts:
                    continue
                if parse_ts(ts) < cutoff_dt:
                    print(f"Достигли cutoff {cutoff_dt.strftime('%Y-%m-%d')}. Готово.")
                    done = True
                    break

                burn = extract_burn(tx)
                if burn > 0:
                    daily_acc[ts_to_day_key(ts)] += burn
                    hourly_acc[ts_to_hour_key(ts)] += burn
                    total_burn += burn

            pages += 1

            if pages % 50 == 0:
                elapsed = time.time() - start_time
                print(f"[{pages}] before={before_id} burn={total_burn/1e6:.1f}M LUNC "
                      f"days={len(daily_acc)} elapsed={elapsed/60:.1f}min")

            if done:
                break

            if not next_id:
                print("Нет next_id.")
                done = True
                break

            before_id = next_id

            if pages % 200 == 0:
                save_checkpoint({
                    'next_before': before_id,
                    'daily_acc': dict(daily_acc),
                    'hourly_acc': dict(hourly_acc),
                    'pages': pages,
                    'total_burn': total_burn,
                })
                print(f"Checkpoint сохранён (страница {pages})")

            time.sleep(DELAY)

    except KeyboardInterrupt:
        print("Прервано.")

    if not done:
        save_checkpoint({
            'next_before': before_id,
            'daily_acc': dict(daily_acc),
            'hourly_acc': dict(hourly_acc),
            'pages': pages,
            'total_burn': total_burn,
        })
        print(f"Checkpoint сохранён. Запусти снова для продолжения.")

    daily_list, hourly_list = merge_into_existing(existing, daily_acc, hourly_acc)

    output = {
        'daily': daily_list,
        'hourly': hourly_list,
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'bootstrap_done': done,
        'total_days': len(daily_list),
    }

    os.makedirs(os.path.dirname(HISTORY_PATH), exist_ok=True)
    open(HISTORY_PATH, 'w').write(json.dumps(output, separators=(',', ':')))
    print(f"Сохранено: {len(daily_list)} дней, {len(hourly_list)} часов, burn={total_burn/1e6:.1f}M LUNC")

    if done and os.path.exists(CHECKPOINT_PATH):
        os.remove(CHECKPOINT_PATH)
        print("Bootstrap завершён!")

if __name__ == '__main__':
    main()
