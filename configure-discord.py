"""Import a channel-specific webhook without printing its credential or sending messages."""
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

def main():
    source = Path(sys.argv[1])
    destination = Path.home() / 'blnt-alert-monitor'
    target = json.loads((destination / 'discord-target.json').read_text())
    credential = source.read_text().strip()
    if not re.fullmatch(r'https://discord\.com/api/webhooks/\d+/[A-Za-z0-9_-]+', credential):
        raise ValueError('Invalid Discord webhook credential format')
    # Metadata retrieval verifies routing without publishing a test message.
    request = urllib.request.Request(credential, headers={'User-Agent': 'BLNTMonitor/1'})
    with urllib.request.urlopen(request, timeout=20) as response:
        hook = json.load(response)
    if (hook.get('channel_id') != target['channelId'] or hook.get('guild_id') != target['guildId']
            or hook.get('name') != target['webhookName'] or hook.get('type') != 1):
        raise ValueError('Webhook destination does not match the private alert channel')
    secret_dir = destination / 'secrets'
    secret_dir.mkdir(mode=0o700, exist_ok=True)
    secret_dir.chmod(0o700)
    secret_file = secret_dir / 'discord_webhook'
    fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(credential + '\n')
    secret_file.chmod(0o600)
    source.unlink()
    source.parent.rmdir()
    print(json.dumps({'stored': True, 'credentialMode': oct(secret_file.stat().st_mode & 0o777),
                      'guildId': hook['guild_id'], 'channelId': hook['channel_id'],
                      'webhookId': hook['id'], 'name': hook['name'], 'messagesSent': 0}))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # urllib exceptions may contain the credential-bearing URL. Never print them.
        print(json.dumps({'stored': False, 'errorType': type(error).__name__,
                          'reason': 'Webhook import or destination validation failed; credential not displayed'}))
        sys.exit(1)
