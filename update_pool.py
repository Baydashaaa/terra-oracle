import json, os
from datetime import datetime, timezone

d = json.loads(open('/tmp/balance.json').read())
bals = d.get('balances', [])
lunc = next((b for b in bals if b['denom'] == 'uluna'), None)
ustc = next((b for b in bals if b['denom'] == 'uusd'), None)
lunc_val = int(lunc['amount']) / 1e6 if lunc else 0
ustc_val = int(ustc['amount']) / 1e6 if ustc else 0
now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

path = 'assets/data/oracle-pool.json'
existing = {}
if os.path.exists(path):
    try:
        existing = json.loads(open(path).read())
    except:
        existing = {}

history = existing.get('history', [])
history = [h for h in history if h.get('date') != today]
history.append({'date': today, 'lunc': lunc_val, 'ustc': ustc_val})
history = sorted(history, key=lambda x: x['date'])
if len(history) > 400:
    history = history[-400:]

output = {'lunc': lunc_val, 'ustc': ustc_val, 'updated': now, 'history': history}
open(path, 'w').write(json.dumps(output, separators=(',', ':')))
print(f"Done: lunc={lunc_val:.0f} ustc={ustc_val:.0f} history={len(history)}d")
