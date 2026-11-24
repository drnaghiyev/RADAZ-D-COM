"""Device-addressed invitations on the shared, tenant-isolated RADAZ coordinator."""
import json
import os
from pathlib import Path
import re
import time

from private_network_authority import Authority, Fault, digest, make_server, new_id, require, string


class InternetAuthority(Authority):
    def __init__(self, path):
        super().__init__(path)
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workstations(
                    device TEXT PRIMARY KEY, user TEXT UNIQUE NOT NULL, enrolled INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS owned_clinics(
                    device TEXT PRIMARY KEY, clinic TEXT UNIQUE NOT NULL);
                CREATE TABLE IF NOT EXISTS doctor_invites(
                    id TEXT PRIMARY KEY, clinic TEXT NOT NULL, target TEXT NOT NULL,
                    sender TEXT NOT NULL, doctor TEXT NOT NULL, expires INTEGER NOT NULL,
                    UNIQUE(clinic,target));
                CREATE INDEX IF NOT EXISTS doctor_inbox ON doctor_invites(target,expires);
                CREATE INDEX IF NOT EXISTS workstation_enrollment ON workstations(enrolled);
            """)

    def rpc(self, action, p, token='', peer_host=None):
        # Public workstations can acquire clinic privileges only by creating their
        # own tenant or accepting an invitation addressed to their exact device.
        if action in {'register','link_clinic','invite','member','create_member','create_clinic'}:
            raise Fault(403, 'İnternet şəbəkəsində həkimi cihaz ID-si ilə dəvət edin.')
        if action not in {'enroll_pc','open_clinic','invite_pc','answer_invite','cancel_invite'}:
            return super().rpc(action,p,token,peer_host)
        require(isinstance(p,dict),400)
        with self.transaction() as db:
            db.execute('BEGIN IMMEDIATE')
            now=int(time.time())
            if action=='enroll_pc':
                require(isinstance(token,str) and re.fullmatch(r'[0-9a-f]{96}',token),400)
                key=string(p.get('publicKey','').replace('\n',' ').replace('\r',''),4096)
                require(key.startswith('-----BEGIN PUBLIC KEY-----') and key.endswith('-----END PUBLIC KEY-----'),400)
                current=db.execute('SELECT id,active,publicKey FROM devices WHERE token=?',(digest(token),)).fetchone()
                if current:
                    require(current['active'] and current['publicKey']==p['publicKey'])
                    return {'device':current['id']}
                require(db.execute('SELECT count(*) FROM workstations WHERE enrolled>?',(now-3600,)).fetchone()[0]<400,429,'Qeydiyyat həddinə çatılıb. Daha sonra yenidən cəhd edin.')
                name=string(p.get('name'))
                device,user=new_id(),new_id()
                db.execute('INSERT INTO users(id,name) VALUES(?,?)',(user,name))
                db.execute('INSERT INTO devices(id,user,name,token,publicKey) VALUES(?,?,?,?,?)',
                           (device,user,name,digest(token),p['publicKey']))
                db.execute('INSERT INTO workstations VALUES(?,?,?)',(device,user,now))
                return {'device':device}
            a=self.auth(db,token)
            if action=='open_clinic':
                name=string(p.get('name'))
                old=db.execute('SELECT clinic FROM owned_clinics WHERE device=?',(a['device'],)).fetchone()
                if old:return {'clinic':old[0]}
                clinic=new_id()
                db.execute('INSERT INTO clinics(id,name) VALUES(?,?)',(clinic,name))
                db.execute('INSERT INTO owned_clinics VALUES(?,?)',(a['device'],clinic))
                db.execute("INSERT INTO members VALUES(?,?,'admin',?,1)",(clinic,a['id'],json.dumps(['send','view_status','manage_schedule'])))
                db.execute('INSERT INTO approvals VALUES(?,?,1)',(clinic,a['device']))
                self.audit(db,clinic,a['id'],action)
                return {'clinic':clinic}
            db.execute('DELETE FROM doctor_invites WHERE expires<=?',(now,))
            if action in ('invite_pc','cancel_invite'):
                clinic=p.get('clinic','')
                manager=self.access(db,clinic,a)
                require(manager['role']=='admin')
                if action=='cancel_invite':
                    db.execute('DELETE FROM doctor_invites WHERE clinic=? AND id=?',(clinic,string(p.get('id'))))
                    return {'ok':True}
                target=string(p.get('target')).replace('-','').lower()
                if target.startswith('rd'):target=target[2:]
                require(re.fullmatch(r'[a-f0-9]{32}',target) and target!=a['device'],400,'Həkimin kompüterində göstərilən RADAZ ID-sini daxil edin.')
                doctor=string(p.get('name'))
                found=db.execute('SELECT d.user FROM devices d JOIN users u ON d.user=u.id WHERE d.id=? AND d.active=1 AND u.active=1',(target,)).fetchone()
                require(found,404,'Bu ID ilə internet şəbəkəsinə qoşulmuş RADAZ tapılmadı.')
                require(not db.execute('SELECT 1 FROM members WHERE clinic=? AND user=?',(clinic,found[0])).fetchone(),409,'Bu həkim artıq klinikada qeydiyyatdadır. Siyahıdan icazələrini yoxlayın.')
                existing=db.execute('SELECT id FROM doctor_invites WHERE clinic=? AND target=?',(clinic,target)).fetchone()
                if existing:return {'id':existing[0]}
                require(db.execute('SELECT count(*) FROM doctor_invites WHERE clinic=? OR target=?',(clinic,target)).fetchone()[0]<128,429,'Gözləyən dəvətlər həddinə çatılıb.')
                invite=new_id()
                db.execute('INSERT INTO doctor_invites VALUES(?,?,?,?,?,?)',(invite,clinic,target,a['id'],doctor,now+86400))
                self.audit(db,clinic,a['id'],action,target)
                return {'id':invite}
            invite=db.execute('SELECT * FROM doctor_invites WHERE id=? AND target=?',(string(p.get('id')),a['device'])).fetchone()
            require(invite,404,'Dəvət bitib və ya başqa kompüterə aiddir.')
            clinic=invite['clinic']
            require(type(p.get('accept')) is bool,400)
            if p['accept']:
                inviter=self.member(db,clinic,invite['sender'])
                require(inviter and inviter['role']=='admin' and db.execute(
                    'SELECT 1 FROM approvals a JOIN devices d ON d.id=a.device WHERE a.clinic=? AND d.user=? AND a.active=1 AND d.active=1',
                    (clinic,invite['sender'])).fetchone())
                require(not db.execute('SELECT 1 FROM members WHERE clinic=? AND user=?',(clinic,a['id'])).fetchone(),409)
                db.execute("INSERT INTO members VALUES(?,?,'radiologist',?,1)",(clinic,a['id'],json.dumps(['receive','download'])))
                db.execute('INSERT INTO member_names VALUES(?,?,?)',(clinic,a['id'],invite['doctor']))
                db.execute('INSERT INTO approvals VALUES(?,?,1)',(clinic,a['device']))
            db.execute('DELETE FROM doctor_invites WHERE id=?',(invite['id'],))
            self.audit(db,clinic,a['id'],'join_clinic' if p['accept'] else 'decline_invite',a['device'])
            return {'clinic':clinic}

    def state(self,db,c,a):
        out=super().state(db,c,a)
        now=int(time.time())
        out['internet']=True
        out['ownsClinic']=bool(db.execute('SELECT 1 FROM owned_clinics WHERE device=?',(a['device'],)).fetchone())
        out['invitations']=[dict(r) for r in db.execute('SELECT i.id,c.name AS clinic,u.name AS sender,i.doctor,i.expires FROM doctor_invites i JOIN clinics c ON c.id=i.clinic JOIN users u ON u.id=i.sender WHERE i.target=? AND i.expires>? ORDER BY i.expires',(a['device'],now))]
        if c and out['membership'] and out['membership']['role']=='admin':
            out['outgoingInvites']=[dict(r) for r in db.execute('SELECT id,doctor,target,expires FROM doctor_invites WHERE clinic=? AND expires>? ORDER BY expires',(c,now))]
        return out


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--db',required=True)
    parser.add_argument('--socket',required=True)
    args=parser.parse_args()
    socket_path=Path(args.socket)
    if socket_path.is_socket():
        socket_path.unlink()
    with make_server(InternetAuthority(args.db),'127.0.0.1',0,unix_path=args.socket) as server:
        os.chmod(args.socket,0o660)
        try:
            server.serve_forever()
        finally:
            if socket_path.is_socket():socket_path.unlink()
