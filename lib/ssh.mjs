import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function sshTarget(host){
  if(typeof host!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(host))throw new Error('Configure an SSH host alias first / 请先设置 SSH 主机别名');
  return host;
}
export function sftpQuote(value){
  if(typeof value!=='string'||/[\r\n\x00]/.test(value))throw new Error('Unsafe transfer path');
  return '"'+value.replaceAll('\\','/').replaceAll('"','\\"')+'"';
}
function remotePath(value){
  if(!/^\.local\/share\/orchard-relay\/[a-zA-Z0-9/_.-]+$/.test(value)||value.split('/').includes('..'))throw new Error('Unsafe remote transfer path');
  return value;
}

// Passwords are never collected here. OpenSSH uses the user's SSH config and agent.
export class SshClient {
  constructor(host,configFile=''){this.host=host;this.configFile=configFile;this.children=new Set();}
  async run(exe,args,stdin,timeout=90000){
    return new Promise((resolve,reject)=>{
      const p=spawn(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});this.children.add(p);
      let stdout='',stderr='',failure;
      const timer=setTimeout(()=>{failure=new Error('SSH timed out / SSH 连接超时');p.kill();},timeout);
      p.stdout.on('data',b=>{stdout+=b;if(stdout.length>16*1024*1024){failure=new Error('SSH response too large');p.kill();}});
      p.stderr.on('data',b=>stderr=(stderr+b).slice(-12000));
      p.stdin.on('error',()=>{});
      p.on('error',e=>{failure=e;});
      p.on('close',code=>{clearTimeout(timer);this.children.delete(p);failure?reject(failure):resolve({exitCode:code,stdout,stderr});});
      p.stdin.end(stdin||'');
    });
  }
  async ssh(item,command,stdin=null,timeoutSeconds=45){
    const r=await this.call('ssh_run',{command,stdin,timeoutSeconds});
    if(r.exitCode!==0)throw new Error(r.stderr||r.stdout||'SSH failed');
    return r.stdout;
  }
  async call(name,args,timeout){
    const host=sshTarget(this.host);
    const options=[...(this.configFile?['-F',this.configFile]:[]),'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15'];
    if(name==='ssh_run'){
      return this.run('ssh',[...options,'--',host,args.command],args.stdin,timeout||(args.timeoutSeconds+20)*1000);
    }
    if(!['ssh_upload','ssh_download'].includes(name))throw new Error('Unsupported SSH operation');
    const local=path.resolve(args.localPath),remote=remotePath(args.remotePath);
    if(name==='ssh_download')await fs.mkdir(path.dirname(local),{recursive:true});
    const batch=name==='ssh_upload'?`put ${sftpQuote(local)} ${sftpQuote(remote)}\n`:`get ${sftpQuote(remote)} ${sftpQuote(local)}\n`;
    const r=await this.run('sftp',[...options,'-b','-','--',host],batch,timeout||320000);
    if(r.exitCode!==0)throw new Error(r.stderr||r.stdout||'SFTP failed');
    return {ok:true};
  }
  close(){for(const child of this.children)child.kill();this.children.clear();}
}
