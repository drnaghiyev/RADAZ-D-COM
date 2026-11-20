"""New-instance journal for a workstation explicitly assigned to a clinic."""
import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from private_network_routing import clinic_zone, matching_rule

QUIET_SECONDS = 60


@contextmanager
def journal(client):
    client.root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(client.root / 'sync.sqlite3', timeout=4)
    db.row_factory = sqlite3.Row
    try:
        with db:
            db.execute("""CREATE TABLE IF NOT EXISTS observations(
                clinic TEXT, study TEXT, sop TEXT, modality TEXT, source TEXT, ae TEXT,
                device TEXT, seen INTEGER, queued INTEGER DEFAULT 0, PRIMARY KEY(clinic,sop))""")
            db.execute('CREATE INDEX IF NOT EXISTS eligible ON observations(clinic,queued,seen)')
            yield db
    finally:
        db.close()


def observe(client, study, sop, modality, source, ae, device):
    cfg = client.settings()
    clinic = cfg.get('syncClinic')
    if not cfg.get('enabled') or not clinic or source not in ('archive','pacs'):
        return
    with journal(client) as db:
        db.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?,?,0)',
                   (clinic,study,sop,modality,source,ae,device,int(time.time())))


def poll(client, now=None):
    cfg = client.settings()
    clinic = cfg.get('syncClinic')
    if not clinic or not cfg.get('enabled') or not (client.root / 'sync.sqlite3').exists():
        return
    now = time.time() if now is None else now
    with journal(client) as db:
        groups = db.execute("""SELECT study,source,ae,device,modality,MAX(seen) AS latest
          FROM observations WHERE clinic=? AND queued=0
          GROUP BY study,source,ae,device,modality HAVING latest<=?""",(clinic,now-QUIET_SECONDS)).fetchall()
    if not groups:
        return
    state = client.rpc('state',{'clinic':clinic})
    policy = state.get('policy') or {}
    if not policy.get('autoEnabled'):
        return
    for group in groups:
        study = group['study']
        # A network download never enters this journal. New locally acquired
        # series can legitimately share the Study UID of a previous download.
        payload = {'clinic':clinic,'study':study,'source':group['source'],'aeTitle':group['ae'],
                   'device':group['device'],'modality':group['modality'],'mode':'auto'}
        at = datetime.fromtimestamp(now, timezone.utc).astimezone(clinic_zone(policy.get('timezone')))
        if matching_rule(policy,payload,at) is None:
            continue
        with journal(client) as db:
            rows = db.execute("""SELECT sop,seen FROM observations WHERE clinic=? AND study=?
              AND source=? AND ae=? AND device=? AND modality=? AND queued=0 ORDER BY sop""",
              (clinic,study,group['source'],group['ae'],group['device'],group['modality'])).fetchall()
        if not rows or max(r['seen'] for r in rows)>now-QUIET_SECONDS:
            continue
        ids=[r['sop'] for r in rows]
        request_id=hashlib.sha256(json.dumps([clinic,study,ids]).encode()).hexdigest()
        client.send(dict(payload,requestId=request_id,onlyUids=ids))
        with journal(client) as db:
            db.executemany('UPDATE observations SET queued=1 WHERE clinic=? AND sop=?',[(clinic,uid) for uid in ids])
