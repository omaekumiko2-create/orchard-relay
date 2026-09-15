import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

export const validId = s=>typeof s==='string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(s);
export function relativePath(p) {
  if(typeof p!=='string'||!p||p.includes('\\')||p.includes('\0')||p.startsWith('-')||p.includes(':')||p.split('/').some(s=>!s||s==='..'||s==='.')||path.posix.isAbsolute(p)) throw new Error('请填写不含 .. 的相对路径：'+p);
  return p;
}
export function validateProject(p) {
  if(!p||!validId(p.id)) throw new Error('项目 ID 只支持小写英文、数字和连字符。');
  for(const k of ['name','localRoot','remoteRoot','projectPath','scheme','bundleId','configuration'])
    if(typeof p[k]!=='string'||!p[k].trim()||p[k].length>1024||/[\x00-\x1f]/.test(p[k])) throw new Error('项目缺少有效的 '+k);
  if(!path.isAbsolute(p.localRoot)) throw new Error('Windows 源码目录必须是绝对路径。');
  if(!p.remoteRoot.startsWith('~/')&&!p.remoteRoot.startsWith('/')) throw new Error('Mac 原仓库目录应以 ~/ 或 / 开头。');
  relativePath(p.projectPath);
  if(!/\.(xcodeproj|xcworkspace)$/.test(p.projectPath)) throw new Error('请选择 .xcodeproj 或 .xcworkspace 工程。');
  if(!['Debug','Release'].includes(p.configuration)) throw new Error('构建配置必须为 Debug 或 Release。');
  if(typeof p.team!=='string'||(p.team&&!/^[A-Z0-9]{10}$/.test(p.team))) throw new Error('Team ID 应为 10 位大写英文或数字，或留空。');
  if(!/^[A-Za-z0-9.-]+$/.test(p.bundleId)) throw new Error('Bundle ID 格式不正确。');
  if(!Array.isArray(p.includePaths)||!p.includePaths.length||p.includePaths.length>30) throw new Error('至少填写一个同步目录。');
  p.includePaths.forEach(relativePath);
  if(!p.includePaths.some(x=>p.projectPath===x||p.projectPath.startsWith(x+'/'))) throw new Error('同步目录必须包含 Xcode 工程。');
  if(!Array.isArray(p.macConfigFiles)||p.macConfigFiles.length>30) throw new Error('Mac 配置文件列表无效。');
  p.macConfigFiles.forEach(x=>{relativePath(x);if(!x.endsWith('.xcconfig')) throw new Error('Mac 本地配置仅支持 .xcconfig 文件。');});
  return Object.fromEntries(['id','name','description','localRoot','remoteRoot','projectPath','scheme','bundleId','configuration','team','includePaths','macConfigFiles'].map(k=>[k,p[k]??'']));
}
export async function execFile(executable,args,{cwd,timeout=120000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout=[],stderr=[],size=0;
    const timer=setTimeout(()=>{child.kill();reject(new Error(executable+' 执行超时'));},timeout);
    child.stdout.on('data',b=>{size+=b.length;if(size>40*1024*1024){child.kill();return;}stdout.push(b);});
    child.stderr.on('data',b=>stderr.push(b));
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);const out=Buffer.concat(stdout);code===0?resolve(out):reject(new Error(Buffer.concat(stderr).toString('utf8')||`${executable} 退出码 ${code}`));});
  });
}
export function excludedFile(p,project) {
  return p.split('/').some(s=>['.git','node_modules','DerivedData','build','xcuserdata','.DS_Store','Screenshots'].includes(s))
    || /(^|\/)(\.env($|\.)|Secrets\.xcconfig$|Config\.local\.xcconfig$)/i.test(p)
    || /\.(p12|p8|pem|key|mobileprovision)$/i.test(p)
    || project.macConfigFiles.includes(p);
}
export async function snapshot(project,jobDir,log=()=>{}) {
  validateProject(project);
  const root=await fs.realpath(project.localRoot);
  const filesRaw=await execFile('git',['ls-files','-z','--cached','--others','--exclude-standard','--',...project.includePaths],{cwd:root});
  const files=[...new Set(filesRaw.toString('utf8').split('\0').filter(Boolean))].sort();
  const dest=path.join(jobDir,'snapshot'); await fs.mkdir(dest,{recursive:true});
  let total=0,count=0;const manifest=[];
  for(const file of files) {
    relativePath(file);if(excludedFile(file,project)) continue;
    const src=path.join(root,file); let stat;try{stat=await fs.lstat(src);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(stat.isSymbolicLink())throw new Error('同步目录中存在符号链接，请先改为普通文件：'+file);
    if(!stat.isFile())throw new Error('同步目录含子模块或非普通文件，请为它单独配置同步：'+file);
    const real=await fs.realpath(src);if(!real.startsWith(root+path.sep))throw new Error('文件越过源码根目录：'+file);
    total+=stat.size;if(total>1024**3)throw new Error('源码快照超过 1 GB，请缩小同步目录。');
    const target=path.join(dest,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(src,target);
    const after=await fs.stat(src);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('源码正在写入，请保存完成后重试：'+file);
    const hash=createHash('sha256').update(await fs.readFile(target)).digest('hex');
    manifest.push({path:file,sha256:hash,size:stat.size});count++;
  }
  if(!count)throw new Error('同步目录没有可构建的 Git 源文件。');
  await fs.access(path.join(dest,project.projectPath));
  const commit=(await execFile('git',['rev-parse','--short','HEAD'],{cwd:root})).toString().trim();
  const branch=(await execFile('git',['branch','--show-current'],{cwd:root})).toString().trim()||'detached';
  const status=(await execFile('git',['status','--porcelain','--untracked-files=normal','--',...project.includePaths],{cwd:root})).toString();
  const source={commit,branch,dirty:Boolean(status.trim()),files:count,bytes:total,sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
  await fs.writeFile(path.join(jobDir,'manifest.json'),JSON.stringify({source,files:manifest},null,2));
  const archive=path.join(jobDir,'source.tar.gz');
  await execFile('tar',['-czf',archive,'-C',dest,'.'],{timeout:180000});
  log(`源码快照：${count} 个文件 · ${(total/1024/1024).toFixed(1)} MB · ${branch}@${commit}${source.dirty?'（含未提交修改）':''}`);
  return {archive,source};
}
const writes=new Map();
export async function atomicJson(file,data) {
  const encoded=JSON.stringify(data,null,2);
  const next=(writes.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
    const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,encoded);
    try{for(let i=0;;i++){try{await fs.rename(temp,file);break;}catch(e){if(i>=8||!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;await new Promise(r=>setTimeout(r,25*(i+1)));}}}
    catch(e){await fs.rm(temp,{force:true});throw e;}
  });
  writes.set(file,next);
  try{await next;}finally{if(writes.get(file)===next)writes.delete(file);}
}
