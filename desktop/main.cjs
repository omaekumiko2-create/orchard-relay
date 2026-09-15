const {app,BrowserWindow,Menu,Tray,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {pathToFileURL}=require('node:url');

app.setName('Orchard Relay');
app.setAppUserModelId('io.github.omaekumiko2create.orchardrelay');
if(process.env.ORCHARD_DATA_DIR)app.setPath('userData',path.resolve(process.env.ORCHARD_DATA_DIR));
const locked=app.requestSingleInstanceLock();
let window,tray,service,runtime,quitting=false;
const icon=path.join(__dirname,'../public/icon.png');
function show(){if(window){window.show();if(window.isMinimized())window.restore();window.focus();}}
async function quit(){
  if(service?.activity()){
    const result=await dialog.showMessageBox(window,{type:'question',title:'Orchard Relay',message:'退出后台服务？',detail:'已经在 Mac 上启动的任务会继续。上传中的任务可能需要重试；再次打开应用会恢复读取构建进度。',buttons:['继续在后台运行','退出应用'],defaultId:0,cancelId:0});
    if(result.response===0)return;
  }
  quitting=true;app.quit();
}
if(!locked){app.quit();}
else {
  app.on('second-instance',show);
  app.on('activate',show);
  app.on('before-quit',()=>{quitting=true;service?.shutdown();});
  app.whenReady().then(async()=>{
    process.env.ORCHARD_DATA_DIR=app.getPath('userData');
    process.env.ORCHARD_PORT='0';
    service=await import(pathToFileURL(path.join(__dirname,'../server.mjs')).href);
    runtime=await service.ready;
    const origin=new URL(runtime.url).origin;
    window=new BrowserWindow({width:1340,height:950,minWidth:880,minHeight:640,title:'Orchard Relay',backgroundColor:'#f6f7f9',icon,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.webContents.session.setPermissionCheckHandler(()=>false);
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
    window.on('close',event=>{if(!quitting){event.preventDefault();window.hide();}});
    window.once('ready-to-show',show);
    const menu=[
      {label:'Orchard Relay',submenu:[{label:'显示窗口',click:show},{label:'打开数据目录',click:()=>shell.openPath(app.getPath('userData'))},{type:'separator'},{label:'退出应用',accelerator:'Alt+F4',click:quit}]},
      {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
      {label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]},
      {label:'帮助',submenu:[{label:'GitHub · 使用说明',click:()=>shell.openExternal('https://github.com/omaekumiko2-create/orchard-relay')},{label:'关于 Orchard Relay',click:()=>dialog.showMessageBox(window,{title:'Orchard Relay',message:'Orchard Relay '+app.getVersion(),detail:'Windows 发起 · Mac 编译\nMIT License · SSH only'})}]}
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    tray=new Tray(icon);tray.setToolTip('Orchard Relay · iOS remote builds');
    tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Orchard Relay',click:show},{type:'separator'},{label:'退出应用',click:quit}]));
    tray.on('double-click',show);
    await window.loadURL(runtime.url);
    await fs.writeFile(path.join(app.getPath('userData'),'desktop-status.json'),JSON.stringify({version:app.getVersion(),pid:process.pid,title:window.getTitle(),loaded:true,packaged:app.isPackaged,security:{sandbox:true,contextIsolation:true,nodeIntegration:false}},null,2));
  }).catch(error=>{dialog.showErrorBox('Orchard Relay 启动失败',error.message);quitting=true;app.quit();});
}
