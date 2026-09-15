import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateSettings,loadSettings,connectionKey} from '../lib/settings.mjs';
import {sshTarget,sftpQuote} from '../lib/ssh.mjs';

const config={sshHost:'build-mac',sshConfigFile:'',port:0,projects:[]};
test('SSH aliases cannot inject options and transfer paths cannot inject batch commands',()=>{
  for(const s of ['-oProxyCommand=evil','user@host','host\nother','$(command)',''])assert.throws(()=>sshTarget(s));
  assert.equal(sshTarget('my-mac.local'),'my-mac.local');
  assert.equal(sftpQuote('C:\\My Apps\\source.tar.gz'),'"C:/My Apps/source.tar.gz"');
  assert.throws(()=>sftpQuote('safe\n!command'));
});
test('settings whitelist fields and host changes invalidate historical remote references',()=>{
  const clean=validateSettings({...config,keychainPassword:'never-save',unexpected:'discard'});
  assert.deepEqual(clean,config);
  assert.throws(()=>validateSettings({...config,sshHost:'-invalid'}));
  assert.throws(()=>validateSettings({...config,sshConfigFile:'relative/path'}));
  assert.notEqual(connectionKey(config),connectionKey({...config,sshHost:'another-mac'}));
});
test('first run creates isolated empty configuration and preserves later user edits',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orchard-settings-'));
  try{
    const template=path.join(root,'example.json'),data=path.join(root,'user');
    await fs.writeFile(template,JSON.stringify({...config,sshHost:''}));
    assert.equal((await loadSettings(data,template)).projects.length,0);
    await fs.writeFile(path.join(data,'config.json'),JSON.stringify(config));
    assert.equal((await loadSettings(data,template)).sshHost,'build-mac');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
