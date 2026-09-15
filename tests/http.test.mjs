import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

test('fresh server enforces local authentication and persists only validated settings',async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'orchard-http-'));
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,ORCHARD_DATA_DIR:data,ORCHARD_PORT:'0'},stdio:'pipe',windowsHide:true});
  let output='';child.stderr.on('data',b=>output+=b);child.stdout.resume();
  try{
    let runtime;
    for(let i=0;i<100;i++){try{runtime=JSON.parse(await fs.readFile(path.join(data,'runtime.json'),'utf8'));break;}catch{if(child.exitCode!==null)throw new Error(output);await delay(50);}}
    assert.ok(runtime,'server started');
    const url=new URL(runtime.url),base=url.origin,headers={'x-orchard-token':url.hash.slice(1)};
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/state',{headers:{'x-orchard-token':'é'.repeat(64)}})).status,401);
    assert.equal((await fetch(base+'/api/state',{headers:{...headers,Origin:'https://example.org'}})).status,403);
    const raw=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{...headers,Host:'localhost:'+url.port}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
    assert.equal(raw,403);
    const state=await (await fetch(base+'/api/state',{headers})).json();
    assert.deepEqual(state.config.projects,[]);assert.equal(state.config.sshHost,'');
    const post=body=>fetch(base+'/api/settings',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({sshHost:'-bad',sshConfigFile:''})).status,400);
    assert.equal((await post({sshHost:'build-mac',sshConfigFile:'',keychainPassword:'not-persisted'})).status,200);
    const saved=await fs.readFile(path.join(data,'config.json'),'utf8');assert.doesNotMatch(saved,/not-persisted|keychainPassword/);
    assert.equal(JSON.parse(saved).sshHost,'build-mac');
  }finally{
    const exited=once(child,'exit');child.kill();if(child.exitCode===null)await exited;
    await fs.rm(data,{recursive:true,force:true});
  }
});
