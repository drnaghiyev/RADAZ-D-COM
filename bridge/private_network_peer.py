"""Send sealed objects to a reachable, coordinator-approved peer, falling back to relay."""
import hashlib
import hmac
import http.client
import ipaddress
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


MAX_BUFFER = 48 * 1024 * 1024
PATH = re.compile(r'/object/([A-Za-z0-9_-]{1,128})/([0-9a-f]{64})')


def mac(proof, message):
    return hmac.new(bytes.fromhex(proof), message.encode('ascii'), hashlib.sha256).hexdigest()


class Peer:
    def __init__(self, client):
        self.client = client
        self.pending = {}
        self.lock = threading.Lock()
        self.budget = threading.BoundedSemaphore(2)
        self.offered = 0
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_PUT(self):
                if not owner.budget.acquire(blocking=False):
                    self.send_error(503)
                    return
                try:
                    self.connection.settimeout(5)
                    owner.receive(self)
                except (ValueError, KeyError, OSError, PermissionError):
                    self.send_error(403)
                finally:
                    owner.budget.release()
        # A loopback authority is a laptop-only installation.
        host = urlsplit(client.settings().get('url','')).hostname
        bind = '127.0.0.1' if host in ('localhost','127.0.0.1','::1') else '0.0.0.0'
        self.server = ThreadingHTTPServer((bind,0),Handler)
        threading.Thread(target=self.server.serve_forever,daemon=True).start()

    def refresh(self):
        if time.monotonic()-self.offered < 25:
            return
        self.client.rpc('peer_offer',{'port':self.server.server_port})
        self.offered = time.monotonic()
        with self.lock:
            self.expire()

    def expire(self):
        now=time.monotonic()
        for key,(_,expires) in list(self.pending.items()):
            if expires<now:
                del self.pending[key]

    def receive(self, handler):
        match = PATH.fullmatch(handler.path)
        if not match or not self.client.settings().get('enabled'):
            raise PermissionError
        delivery, digest = match.groups()
        length = int(handler.headers.get('Content-Length','0'))
        if not 34 < length <= MAX_BUFFER:
            raise ValueError
        grant = self.client.rpc('peer_check',{'delivery':delivery,'sha256':digest})
        sealed_hash = handler.headers.get('X-Sealed-Digest','')
        if grant['role']!='recipient' or not re.fullmatch('[0-9a-f]{64}',sealed_hash):
            raise PermissionError
        if not hmac.compare_digest(mac(grant['peerProof'], sealed_hash),handler.headers.get('X-Object-MAC','')):
            raise PermissionError
        if not grant['size'] < length <= grant['size']+2048:
            raise ValueError
        with self.lock:
            self.expire()
            if sum(len(blob) for blob,_ in self.pending.values()) + length > MAX_BUFFER:
                handler.send_error(503)
                return
            blob = handler.rfile.read(length)
            if len(blob)!=length or not hmac.compare_digest(hashlib.sha256(blob).hexdigest(),sealed_hash):
                raise ValueError
            self.pending[(delivery,digest)] = (blob,time.monotonic()+60)
        handler.send_response(204)
        handler.end_headers()

    def publish(self, item, device, digest, blob):
        if len(blob)>MAX_BUFFER:
            return False
        connection = None
        try:
            grant=self.client.rpc('peer_check',{'delivery':item['id'],'sha256':digest})
            if grant['role']!='sender' or grant['recipientDevice']!=device or not grant.get('peerHost'):
                return False
            address=ipaddress.ip_address(grant['peerHost'])
            if address.is_unspecified or address.is_multicast or not 1024<=int(grant['peerPort'])<=65535:
                return False
            sealed_hash=hashlib.sha256(blob).hexdigest()
            connection=http.client.HTTPConnection(str(address),grant['peerPort'],timeout=2)
            connection.request('PUT','/object/'+item['id']+'/'+digest,blob,
                               {'X-Sealed-Digest':sealed_hash,'X-Object-MAC':mac(grant['peerProof'],sealed_hash)})
            return connection.getresponse().status==204
        except (OSError,ValueError,KeyError,http.client.HTTPException,ConnectionError):
            return False
        finally:
            if connection:
                connection.close()

    def take(self,item,digest):
        with self.lock:
            self.expire()
            result=self.pending.pop((item['id'],digest),None)
        if not result:
            return None
        # Download or device approval may have been revoked since the PUT.
        # Fail closed and discard the buffered object even when the hub is offline.
        grant = self.client.rpc('peer_check', {'delivery':item['id'], 'sha256':digest})
        if grant['role'] != 'recipient' or not self.client.settings().get('enabled'):
            raise PermissionError('Görüntünü qəbul etmək üçün icazə yoxdur.')
        return result[0]

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        with self.lock:
            self.pending.clear()


def start(client):
    return getattr(client,"peer",None) or Peer(client)
