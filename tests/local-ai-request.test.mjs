import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localAiRequest} from '../scripts/local-ai-request.mjs';
const request=()=>({method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:5173',origin:'http://localhost:5173','content-type':'application/json'}});
test('saved API credentials accept only local same-origin app requests',()=>{
 assert.equal(localAiRequest(request()),true);
 for(const changes of [{origin:'https://evil.example'},{origin:'http://localhost:5174'},{origin:undefined},{host:'evil.example'},{'content-type':'text/plain'}]){
  const req=request();Object.assign(req.headers,changes);assert.equal(localAiRequest(req),false);
 }
 const remote=request();remote.socket.remoteAddress='192.168.1.2';assert.equal(localAiRequest(remote),false);
 const get=request();get.method='GET';delete get.headers.origin;assert.equal(localAiRequest(get),true);
 get.method='DELETE';assert.equal(localAiRequest(get),false);
});
