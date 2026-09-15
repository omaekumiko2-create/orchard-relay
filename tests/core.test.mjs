import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {relativePath,validateProject,excludedFile,snapshot,execFile,atomicJson} from '../lib/core.mjs';

const config={id:'test-app',name:'Test',localRoot:path.resolve('.'),remoteRoot:'~/repo',projectPath:'ios/Test.xcodeproj',scheme:'Test',bundleId:'com.example.test',configuration:'Debug',team:'',includePaths:['ios'],macConfigFiles:['ios/Test/Config.local.xcconfig']};
test('reject traversal, shell-option paths, invalid signing overrides and uncovered projects',()=>{
  for(const p of ['../x','/tmp/x','ios/../../x','C:/x','ios\\x','-C','ios//x'])assert.throws(()=>relativePath(p));
  assert.equal(relativePath('ios/My App.xcodeproj'),'ios/My App.xcodeproj');
  assert.throws(()=>validateProject({...config,team:'ABC;echo x'}));
  assert.throws(()=>validateProject({...config,includePaths:['shared']}));
  assert.throws(()=>validateProject({...config,macConfigFiles:['secret.pem']}));
});
test('exclude private config, signing files and generated Xcode data',()=>{
  for(const p of ['ios/.env','ios/.env.local','ios/cert.p12','ios/key.p8','ios/Test/Config.local.xcconfig','ios/Test/Secrets.xcconfig','ios/A.xcodeproj/xcuserdata/a.xcuserstate'])assert.ok(excludedFile(p,config),p);
  assert.equal(excludedFile('ios/Test/Config.xcconfig',config),false);
  assert.equal(excludedFile('ios/Test/Assets.xcassets/a.png',config),false);
});
test('snapshot captures saved uncommitted edits and new files, skips deleted and ignored files',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orchard-snapshot-'));
  try{
    await fs.mkdir(path.join(root,'repo/ios/Test.xcodeproj'),{recursive:true});
    const repo=path.join(root,'repo'), job=path.join(root,'job');
    await fs.writeFile(path.join(repo,'ios/Test.xcodeproj/project.pbxproj'),'project');
    await fs.writeFile(path.join(repo,'ios/Main.swift'),'original');
    await fs.writeFile(path.join(repo,'ios/Delete.swift'),'deleted later');
    await fs.writeFile(path.join(repo,'.gitignore'),'ios/ignored.txt\n');
    await execFile('git',['init'],{cwd:repo});await execFile('git',['add','.'],{cwd:repo});
    await execFile('git',['-c','user.name=Orchard Test','-c','user.email=test@localhost','commit','-m','fixture'],{cwd:repo});
    await fs.writeFile(path.join(repo,'ios/Main.swift'),'saved current version');
    await fs.writeFile(path.join(repo,'ios/New.swift'),'new file');
    await fs.writeFile(path.join(repo,'ios/ignored.txt'),'ignored');
    await fs.writeFile(path.join(repo,'ios/Secrets.xcconfig'),'local-only');
    await fs.rm(path.join(repo,'ios/Delete.swift'));
    const result=await snapshot({...config,localRoot:repo},job);
    assert.equal(result.source.files,3);assert.equal(result.source.dirty,true);
    assert.equal(await fs.readFile(path.join(job,'snapshot/ios/Main.swift'),'utf8'),'saved current version');
    assert.equal(await fs.readFile(path.join(job,'snapshot/ios/New.swift'),'utf8'),'new file');
    for(const f of ['Secrets.xcconfig','ignored.txt','Delete.swift'])await assert.rejects(fs.access(path.join(job,'snapshot/ios',f)));
    const listing=(await execFile('tar',['-tzf',result.archive])).toString();assert.match(listing,/New.swift/);assert.doesNotMatch(listing,/Secrets|ignored|Delete/);
  }finally{const resolved=await fs.realpath(root);assert.ok(resolved.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(resolved,{recursive:true,force:true});}
});
test('concurrent JSON persistence never leaves a partially written file',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'orchard-atomic-'));
  try{const f=path.join(root,'state.json');await Promise.all(Array.from({length:12},(_,i)=>atomicJson(f,{i})));assert.equal(typeof JSON.parse(await fs.readFile(f,'utf8')).i,'number');}
  finally{await fs.rm(root,{recursive:true,force:true});}
});
