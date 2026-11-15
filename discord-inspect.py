"""Read-only Discord inventory through existing OpenClaw bot accounts. Never prints tokens."""
import json
from pathlib import Path
import urllib.request
import urllib.error

config = json.loads((Path.home() / '.openclaw/openclaw.json').read_text())
accounts = config.get('channels', {}).get('discord', {}).get('accounts', {})
for name, account in accounts.items():
    token = account.get('token')
    if not token or account.get('enabled') is False:
        continue
    req = urllib.request.Request('https://discord.com/api/v10/users/@me/guilds',
                                 headers={'Authorization': 'Bot ' + token, 'User-Agent': 'BLNTMonitor/1'})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            guilds = json.load(response)
        print(json.dumps({'account': name, 'guilds': [
            {'id': g['id'], 'name': g['name'],
             'canManageChannels': bool(int(g.get('permissions', 0)) & (8 | 16)),
             'canManageWebhooks': bool(int(g.get('permissions', 0)) & (8 | (1 << 29)))}
            for g in guilds]}))
    except urllib.error.HTTPError as error:
        print(json.dumps({'account': name, 'httpStatus': error.code}))
    except Exception:
        print(json.dumps({'account': name, 'error': 'Discord inventory unavailable'}))
