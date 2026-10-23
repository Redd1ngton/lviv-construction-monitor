"""Local progress snapshots and optional GitHub status publication."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone

import requests

STATUS_PATH = Path(os.environ.get('PARSER_STATUS_PATH', '/tmp/construction-parser-status.json'))


def snapshot(stage, **fields):
    previous = json.loads(STATUS_PATH.read_text()) if STATUS_PATH.exists() else {}
    now = datetime.now(timezone.utc).isoformat(timespec='seconds')
    previous.update(fields, stage=stage, updated_at=now)
    previous.setdefault('started_at', now)
    previous['run_id'] = os.environ.get('GITHUB_RUN_ID', 'local')
    previous['run_attempt'] = os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_PATH.with_suffix('.tmp')
    temporary.write_text(json.dumps(previous, ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, STATUS_PATH)
    return previous


def publish():
    token, repo = os.environ.get('GH_TOKEN'), os.environ.get('GITHUB_REPOSITORY')
    if not token or not repo or not STATUS_PATH.exists():
        return
    api = f'https://api.github.com/repos/{repo}'
    headers = {'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json'}
    # A separate branch prevents heartbeat commits from rebuilding the website.
    with requests.Session() as session:
        session.headers.update(headers)
        response = session.get(f'{api}/git/ref/heads/parser-status', timeout=20)
        if response.status_code == 404:
            response = session.post(f'{api}/git/refs', json={
                'ref': 'refs/heads/parser-status', 'sha': os.environ['GITHUB_SHA']}, timeout=20)
        response.raise_for_status()
        response = session.get(f'{api}/contents/status.json', params={'ref': 'parser-status'}, timeout=20)
        if response.status_code not in (200, 404):
            response.raise_for_status()
        payload = {'branch': 'parser-status', 'message': 'status: parser heartbeat',
                   'content': base64.b64encode(STATUS_PATH.read_bytes()).decode()}
        if response.status_code == 200:
            payload['sha'] = response.json()['sha']
        session.put(f'{api}/contents/status.json', json=payload, timeout=20).raise_for_status()


def safe_publish():
    try:
        publish()
    except requests.RequestException as error:
        # Keep parser working even if the optional progress channel is unavailable.
        code = error.response.status_code if error.response is not None else 'network'
        print(f'::warning::Progress publication unavailable ({code})', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--finish', choices=['success', 'failure', 'cancelled'])
    args = parser.parse_args()
    if args.finish:
        snapshot(args.finish)
        safe_publish()
        return
    STATUS_PATH.unlink(missing_ok=True)
    snapshot('starting', processed=0, accepted=0, page=0)
    safe_publish()
    child = subprocess.Popen([sys.executable, '-u', str(Path(__file__).with_name('scrape.py')),
                              '--days', '30', '--max-pages', '1000'])
    last_publish = time.monotonic()
    while child.poll() is None:
        time.sleep(2)
        if time.monotonic() - last_publish >= 60:
            safe_publish()
            last_publish = time.monotonic()
    if child.returncode:
        snapshot('failure', message='Помилка збору. Попередні дані збережені; подробиці у журналі запуску.')
    else:
        snapshot('publishing')
    safe_publish()
    raise SystemExit(child.returncode)


if __name__ == '__main__':
    main()
