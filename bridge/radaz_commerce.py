"""Only the issuer's signed, public commerce policy can change client pricing/trials."""
import base64
import hashlib
import hmac
import json
import re
import time
from urllib.parse import urlsplit

POLICY_URL = 'https://raw.githubusercontent.com/drnaghiyev/RADAZ-D-COM/main/commerce.json'

def verify_policy(envelope, public):
    token = envelope.get('policy') if isinstance(envelope, dict) else None
    if not isinstance(token, str) or len(token) > 32768: raise ValueError('Invalid commerce policy')
    parts = token.split('.')
    if len(parts) != 3 or parts[0] != 'RADAZPOLICY1': raise ValueError('Invalid policy type')
    def decode(value):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', value): raise ValueError('Invalid encoding')
        return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    n, e = int.from_bytes(decode(public['n']), 'big'), int.from_bytes(decode(public['e']), 'big')
    size = (n.bit_length()+7)//8; signature = decode(parts[2])
    if size < 256 or len(signature) != size or int.from_bytes(signature,'big') >= n: raise ValueError('Invalid signature')
    digest = bytes.fromhex('3031300d060960864801650304020105000420') + hashlib.sha256((parts[0]+'.'+parts[1]).encode()).digest()
    expected = b'\x00\x01'+b'\xff'*(size-len(digest)-3)+b'\x00'+digest
    if not hmac.compare_digest(pow(int.from_bytes(signature,'big'),e,n).to_bytes(size,'big'),expected): raise ValueError('Invalid policy signature')
    data = json.loads(decode(parts[1]))
    if data.get('v') != 1 or data.get('product') != 'RADAZ' or type(data.get('revision')) is not int or not 0 < data['revision'] <= time.time()*1000+300000: raise ValueError('Invalid policy revision')
    if type(data.get('trialDays')) is not int or not 0 <= data['trialDays'] <= 365: raise ValueError('Invalid trial duration')
    if data.get('baseCurrency') not in ('AZN','USD') or type(data.get('monthlyMinor')) is not int or not 1 <= data['monthlyMinor'] <= 100000000: raise ValueError('Invalid price')
    billing=data.get('billingUrl','')
    if billing:
        url=urlsplit(billing)
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'): raise ValueError('Invalid billing URL')
    modules=data.get('modules'); ids=set()
    if not isinstance(modules,list) or len(modules)>50: raise ValueError('Invalid modules')
    for item in modules:
        identifier=item.get('id','')
        if not re.fullmatch(r'[a-z][a-z0-9-]{1,47}',identifier) or identifier=='base' or identifier in ids or not isinstance(item.get('name'),str) or not 1<=len(item['name'])<=100 or type(item.get('monthlyMinor')) is not int or not 1<=item['monthlyMinor']<=100000000 or type(item.get('enabled')) is not bool: raise ValueError('Invalid module')
        ids.add(identifier)
    return data
