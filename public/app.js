const $=s=>document.querySelector(s);
const token=location.hash.slice(1)||sessionStorage.getItem('orchard-token')||'';
if(token){sessionStorage.setItem('orchard-token',token);history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{if(/^#[a-f0-9]{64}$/.test(location.hash))location.reload();});
let state=null,selectedJob=null,checking=false,polling=false,lastLog='',deviceSelection=localStorage.getItem('orchard-device')||'';
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
const statusNames={queued:'排队中',syncing:'同步源码',preparing:'准备构建',building:'编译中',packaging:'保存产物',installing:'安装中',launching:'启动中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=v=>new Date(v).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
async function api(url,body,raw=false){
  const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'x-orchard-token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok){let e;try{e=await r.json();}catch{}throw new Error(e?.error||'无法连接本机编译服务');}
  return raw?r:r.json();
}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=!text;}
function renderProjects(){
  const existing=new Map([...document.querySelectorAll('[data-config]')].map(e=>[e.dataset.config,e.value]));
  $('#project-count').textContent=String(state.config.projects.length).padStart(2,'0');
  $('#projects').innerHTML=state.config.projects.length?state.config.projects.map((p,i)=>{
    const last=state.jobs.find(j=>j.projectId===p.id);const cfg=existing.get(p.id)||p.configuration;
    return `<article class="project-card"><div class="project-top"><div class="app-icon ${i%2?'purple':''}">${escapeHtml(p.name[0].toUpperCase())}<span></span></div><div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||'原生 iOS 项目')}</p></div><button class="text-button" data-edit="${p.id}" title="编辑项目" aria-label="编辑 ${escapeHtml(p.name)}">⋯</button></div><div class="project-path" title="${escapeHtml(p.localRoot)}">⌁ <span>${escapeHtml(p.localRoot)}</span></div><div class="project-spec"><span>SCHEME <b>${escapeHtml(p.scheme)}</b></span><span>·</span><select aria-label="${escapeHtml(p.name)} 构建配置" data-config="${p.id}"><option ${cfg==='Debug'?'selected':''}>Debug</option><option ${cfg==='Release'?'selected':''}>Release</option></select><span>· iOS 真机</span></div><div class="project-actions"><button class="button primary" data-build="${p.id}" data-action="build-install">▷ 编译并安装到手机 <span>↗</span></button><button class="button secondary" data-build="${p.id}" data-action="build">仅编译</button></div><div class="project-last">${last?`${escapeHtml(fmtDate(last.createdAt))} · ${statusNames[last.status]||escapeHtml(last.status)}`:'尚无构建记录 · 准备开始'}</div></article>`;
  }).join(''):'<div class="empty-projects"><b>准备好你的第一个 iOS 项目</b><p>先设置 SSH 连接，再点击右上角「添加项目」。</p><small>支持 .xcodeproj 与 .xcworkspace · 同步已保存的 Git 源码</small></div>';
}
function renderHealth(){
  const h=state.health;$('#host-name').textContent=state.config.sshHost;$('#side-host').textContent=state.config.sshHost;
  const ok=h?.ok;
  $('#host-state').textContent=ok?'已连接':h?'连接异常':'未检查';$('#host-state').className='badge '+(ok?'online':h?'error':'');
  $('#side-status').textContent=ok?'Mac 已连接':h?'连接异常':'等待连接';$('#side-dot').className=ok?'online':'';
  $('#host-info').textContent=ok?`${h.xcode.replace('\n',' · ')}  /  macOS ${h.macOS}`:'通过 SSH 连接你的 Mac 构建主机';
  const devices=h?.devices||[];
  if(!devices.find(d=>d.id===deviceSelection)&&devices.length===1)deviceSelection=devices[0].id;
  $('#device').innerHTML=devices.length?devices.map(d=>`<option value="${escapeHtml(d.id)}" ${d.id===deviceSelection?'selected':''}>${escapeHtml(d.name)} · ${escapeHtml(d.model)}${d.available===false?'（未连接）':d.paired?'':'（未配对）'}</option>`).join(''):'<option value="">尚未发现设备</option>';
  deviceSelection=$('#device').value;const d=devices.find(d=>d.id===deviceSelection);
  $('#device-note').textContent=d?`iOS ${d.os} · ${d.available===false?'请连接并解锁手机':d.transport==='wired'?'USB 连接':d.transport==='localNetwork'?'无线连接':'等待设备连接'} · ${d.developerMode==='enabled'?'开发者模式已开启':'请开启开发者模式'}`:'手机接在 Mac · 已信任 · 已开启开发者模式';
}
function renderJobs(){
  if(!selectedJob&&state.jobs.length)selectedJob=state.jobs[0].id;
  const count=state.jobs.filter(j=>!terminal.has(j.status)).length;$('#queue-info').textContent=count?`${count} 项进行中 / 排队中`:'所有任务';
  $('#history').innerHTML=state.jobs.length?state.jobs.map(j=>`<button class="history-item ${selectedJob===j.id?'selected':''}" data-job="${j.id}"><div class="history-item-top"><b>${escapeHtml(j.projectName)}</b><span class="status-label ${escapeHtml(j.status)}">${statusNames[j.status]||escapeHtml(j.status)}</span></div><p>${fmtDate(j.createdAt)} · ${j.action==='install'?'安装已有版本':j.action==='build-install'?'编译 + 安装':'仅编译'}</p></button>`).join(''):'<div class="empty-history"><strong>◷</strong>构建记录会出现在这里</div>';
  const j=state.jobs.find(j=>j.id===selectedJob);if(!j)return;
  $('#log-title').textContent=j.projectName;$('#log-status').textContent=statusNames[j.status];$('#log-status').className='status-label '+j.status;
  $('#job-detail').textContent=j.connectionError?'正在重连 Mac：'+j.connectionError:j.error?failureHint(j):j.source?`${j.source.branch}@${j.source.commit}${j.source.dirty?' · 含未提交修改':''} · ${j.source.files} 个文件 · SHA ${j.source.sha256.slice(0,10)}`:'正在准备源码快照';
  $('#download-log').disabled=false;$('#cancel-job').hidden=terminal.has(j.status);$('#cancel-job').textContent=j.cancelRequested?'取消中…':'取消任务';$('#cancel-job').disabled=!!j.cancelRequested;
  $('#retry-job').hidden=!terminal.has(j.status);
  $('#install-version').hidden=!terminal.has(j.status)||!j.remoteState?.artifact;
  $('#download-artifact').hidden=!j.artifact&&!j.remoteState?.artifact;
  $('#download-artifact').textContent=j.artifact?'下载 .app.zip ↓':'重新取回产物 ↓';
  $('#log-meta').textContent=j.remoteState?.launched?'已安装并在手机启动':j.remoteState?.installed?'已安装到手机':j.remoteState?.built?'签名构建已完成':terminal.has(j.status)?'完整日志已保存在本机':'每 2.5 秒更新一次';
}
function failureHint(j){
  const combined=j.error+' '+lastLog;
  if(/locked|unlock|device.*locked/i.test(combined))return '请解锁 iPhone 并保持连接，再重新构建。'+j.error;
  if(/provision|signing|codesign|certificate|keychain|User interaction/i.test(combined))return '签名检查未通过，请查看日志中的 Team、描述文件或钥匙串错误。'+j.error;
  return j.error;
}
let projectFingerprint='',healthFingerprint='';
async function refresh(){
  if(polling)return;polling=true;
  try{
    state=await api('/api/state');
    const pf=JSON.stringify([state.config.projects,state.jobs.map(j=>[j.projectId,j.status,j.createdAt])]);
    if(pf!==projectFingerprint){renderProjects();projectFingerprint=pf;}
    const hf=JSON.stringify([state.config.sshHost,state.health]);if(hf!==healthFingerprint){renderHealth();healthFingerprint=hf;}
    renderJobs();
    if(selectedJob){const id=selectedJob;const text=await (await api(`/api/jobs/${id}/log`,undefined,true)).text();if(id===selectedJob&&text!==lastLog){const el=$('#log'),atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<70;el.textContent=text;lastLog=text;if(atBottom)el.scrollTop=el.scrollHeight;}}
  }catch(e){notice(e.message);}finally{polling=false;}
}
async function checkHealth(){
  if(checking)return;checking=true;$('#refresh').disabled=true;$('#refresh').textContent='连接中…';
  try{const h=await api('/api/health',{});notice(h.ok?(h.devices.length?'':'Mac 已连接。请把 iPhone 插在 Mac 上，解锁并点击“信任”，然后重新检查连接。'):h.error);await refresh();}
  catch(e){notice(e.message);}finally{checking=false;$('#refresh').disabled=false;$('#refresh').textContent='↻ 检查连接';}
}
async function enqueue(projectId,action,configuration,sourceJobId){
  if(action!=='build'&&!$('#device').value){notice('请先检查连接并选择一台连接到 Mac 的 iPhone。');return;}
  try{const j=await api('/api/jobs',{projectId,action,configuration,sourceJobId,deviceId:$('#device').value,keychainPassword:action==='install'?'':$('#keychain-password').value});if(action!=='install')$('#keychain-password').value='';selectedJob=j.id;lastLog='';$('#log').textContent='已加入队列…';notice('');await refresh();}
  catch(e){notice(e.message);}
}
$('#projects').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit]');if(edit){openProject(state.config.projects.find(p=>p.id===edit.dataset.edit));return;}
  const b=e.target.closest('[data-build]');if(!b)return;b.disabled=true;
  try{await enqueue(b.dataset.build,b.dataset.action,document.querySelector(`[data-config="${b.dataset.build}"]`).value);}finally{b.disabled=false;}
});
$('#history').addEventListener('click',e=>{const b=e.target.closest('[data-job]');if(b){selectedJob=b.dataset.job;lastLog='';$('#log').textContent='加载日志…';void refresh();}});
$('#device').addEventListener('change',()=>{deviceSelection=$('#device').value;localStorage.setItem('orchard-device',deviceSelection);renderHealth();});
$('#refresh').onclick=checkHealth;
$('#cancel-job').onclick=async()=>{try{await api(`/api/jobs/${selectedJob}/cancel`,{});await refresh();}catch(e){notice(e.message);}};
$('#retry-job').onclick=()=>{const j=state.jobs.find(j=>j.id===selectedJob);void enqueue(j.projectId,j.action,j.configuration||state.config.projects.find(p=>p.id===j.projectId)?.configuration,j.sourceJobId);};
$('#install-version').onclick=()=>{const j=state.jobs.find(j=>j.id===selectedJob);void enqueue(j.projectId,'install',j.configuration,j.id);};
async function download(url,name){const r=await api(url,undefined,true),blob=await r.blob(),a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}
$('#download-log').onclick=()=>download(`/api/jobs/${selectedJob}/log?full=1`,'orchard-'+selectedJob+'.log').catch(e=>notice(e.message));
$('#download-artifact').onclick=async()=>{try{let j=state.jobs.find(j=>j.id===selectedJob);if(!j.artifact){j=await api(`/api/jobs/${j.id}/download`,{});await refresh();}if(!j.artifact)throw new Error(j.artifactError||'构建产物尚不可用');await download(`/api/jobs/${j.id}/artifact`,j.artifact);}catch(e){notice(e.message);}};
function openProject(p){
  const f=$('#project-form');f.reset();$('#project-error').textContent='';$('#project-dialog-title').textContent=p?'编辑项目':'添加项目';
  f.elements.id.readOnly=!!p;
  if(p)for(const [k,v] of Object.entries(p)){if(f.elements.namedItem(k))f.elements.namedItem(k).value=Array.isArray(v)?v.join('\n'):v;}
  $('#project-dialog').showModal();
}
$('#add-project').onclick=()=>openProject();
for(const b of document.querySelectorAll('.close-dialog'))b.onclick=()=>b.closest('dialog').close();
$('#project-form').onsubmit=async e=>{
  e.preventDefault();const b=e.target.querySelector('[type="submit"]');b.disabled=true;
  try{const p=Object.fromEntries(new FormData(e.target));for(const k of ['includePaths','macConfigFiles'])p[k]=p[k].split('\n').map(x=>x.trim()).filter(Boolean);p.description=state.config.projects.find(x=>x.id===p.id)?.description||'原生 iOS 项目';await api('/api/projects',p);$('#project-dialog').close();await refresh();}
  catch(e){$('#project-error').textContent=e.message;}finally{b.disabled=false;}
};
$('#settings-open').onclick=()=>{if(!state)return;$('#settings-error').textContent='';const f=$('#settings-form');f.elements.sshHost.value=state.config.sshHost;f.elements.sshConfigFile.value=state.config.sshConfigFile;$('#settings-dialog').showModal();};
$('#settings-form').onsubmit=async e=>{e.preventDefault();try{await api('/api/settings',Object.fromEntries(new FormData(e.target)));$('#settings-dialog').close();await refresh();void checkHealth();}catch(e){$('#settings-error').textContent=e.message;}};
$('#nav-build').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
void refresh().then(()=>{if(state?.config.sshHost)void checkHealth();else notice('欢迎使用 Orchard Relay。请先在「连接设置」中填写 SSH 主机别名。');});setInterval(refresh,2500);
