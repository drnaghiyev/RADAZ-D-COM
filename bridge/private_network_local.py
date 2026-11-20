"""Explicit single-workstation coordinator. It binds only to Windows loopback."""
import threading
from private_network_authority import Authority, make_server, identifier, string

_guard = threading.RLock()
_running = {}

def _serve(client, port):
    authority = Authority(client.root/'coordinator'/'metadata.sqlite3')
    server = make_server(authority, '127.0.0.1', port)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name='RADAZ Private DICOM coordinator')
    try:
        thread.start()
    except Exception:
        server.server_close()
        raise
    _running[str(client.root.resolve())] = server
    return authority, server

def stop(client):
    with _guard:
        server = _running.pop(str(client.root.resolve()), None)
        if server:
            server.shutdown()
            server.server_close()

def restore(client):
    cfg=client.settings()
    if not cfg.get('localCoordinator') or not cfg.get('enabled'):
        return
    port=cfg.get('localPort')
    if not isinstance(port,int) or not 1024<=port<=65535 or cfg.get('url')!=f'http://127.0.0.1:{port}':
        raise ValueError('Lokal koordinatorun ünvanı etibarsızdır')
    with _guard:
        if str(client.root.resolve()) not in _running:
            if not (client.root/'coordinator'/'metadata.sqlite3').is_file():
                raise ValueError('Lokal koordinatorun məlumat bazası tapılmadı')
            try:
                _serve(client,port)
            except OSError as error:
                raise ValueError('Lokal koordinatorun portu tutulub. Bağlantı dayandırıldı.') from error

def setup(client,p):
    with client.lock, _guard:
        cfg=client.settings()
        if cfg.get('localCoordinator'):
            if not cfg.get('enabled'):
                client.save({'enabled':True})
            restore(client)
            return client.local_state()
        if cfg.get('token'):
            raise ValueError('Bu cihaz artıq başqa şəbəkəyə bağlıdır')
        user=identifier(p.get('user'))
        name=string(p.get('name'))
        identity=client.device()
        port=0
        authority,server=_serve(client,port)
        try:
            port=server.server_address[1]
            # Finish bootstrap after an interrupted first setup; only the owning
            # Windows profile (module DB and DPAPI identity) authorizes recovery.
            with authority.transaction() as db:
                superuser=db.execute('SELECT id FROM users WHERE super=1 AND active=1').fetchone()
                if superuser:
                    if superuser[0]!=user:
                        raise ValueError('Mövcud lokal super administrator fərqlidir')
                    old_devices=db.execute('SELECT id,publicKey FROM devices WHERE user=? AND active=1',(user,)).fetchall()
                    if any(d['publicKey']!=identity['publicKey'] for d in old_devices):
                        raise ValueError('Mövcud cihaz açarı fərqlidir')
                    for old in old_devices:
                        db.execute('UPDATE devices SET active=0 WHERE id=?',(old['id'],))
                    invite=authority.invite(db,user,'')['invite']
                else:
                    invite=None
            if invite is None:
                invite=authority.bootstrap(user,name)['invite']
            result=authority.rpc('register',{'invite':invite,'name':name,'publicKey':identity['publicKey']})
            client.save({'url':f'http://127.0.0.1:{port}','localCoordinator':True,'localPort':port,
                         'enabled':True,'deviceId':result['device'],'token':result['token']})
        except Exception:
            stop(client)
            raise
    client.start()
    return client.local_state()
