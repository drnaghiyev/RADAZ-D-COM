/** The saved paid API credential may only be used from this computer's app. */
export function localAiRequest(req) {
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  try {
    const url = new URL('http://' + req.headers.host);
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return false;
    if (req.headers.origin && req.headers.origin !== url.origin) return false;
    return req.method === 'GET' || (req.method === 'POST' && req.headers.origin === url.origin && req.headers['content-type']?.split(';')[0] === 'application/json');
  } catch { return false; }
}
