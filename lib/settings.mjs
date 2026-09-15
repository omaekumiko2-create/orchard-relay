import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson, validateProject} from './core.mjs';

export function validateSettings(value) {
  const p={...value};
  p.sshHost=String(p.sshHost||'').trim();
  p.sshConfigFile=String(p.sshConfigFile||'').trim();
  if(p.sshHost && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(p.sshHost))throw new Error('Use a host alias from your SSH config / 请填写 SSH 配置中的主机别名');
  if(p.sshConfigFile&&(!path.isAbsolute(p.sshConfigFile)||/[\x00-\x1f]/.test(p.sshConfigFile)))throw new Error('SSH config requires an absolute path');
  if(!Number.isInteger(p.port)||p.port<0||p.port>65535)throw new Error('Invalid local port');
  if(!Array.isArray(p.projects))throw new Error('Invalid project list');
  p.projects=p.projects.map(validateProject);
  return Object.fromEntries(['sshHost','sshConfigFile','port','projects'].map(k=>[k,p[k]]));
}

export async function loadSettings(dataDirectory, exampleFile) {
  await fs.mkdir(dataDirectory,{recursive:true});
  const file=path.join(dataDirectory,'config.json');
  let source;
  try {source=await fs.readFile(file,'utf8');}
  catch(e){if(e.code!=='ENOENT')throw e;source=await fs.readFile(exampleFile,'utf8');await atomicJson(file,validateSettings(JSON.parse(source)));}
  return validateSettings(JSON.parse(source));
}

export function connectionKey(config){
  return JSON.stringify(['ssh',config.sshHost,config.sshConfigFile]);
}
