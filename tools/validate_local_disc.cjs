/* Headed, isolated Chrome test. ISO bytes must never cross the network.
 * NODE_PATH=/path/to/node_modules node tools/validate_local_disc.cjs ISO [OUTPUT] [PLAYERS]
 */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const iso=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]||'build/local-disc-validation');
 const passes=w=>w.fps>=58.5&&w.p95<=20&&w.p99<=33.34&&w.audioUnderrunSamples===0&&w.audioRenderedSamples>=w.durationMs*48*.95;
 const players=Number(process.argv[4]||2),events=[],requests=[],errors=[],samples=[];
 fs.mkdirSync(output,{recursive:true});
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{channel:'chrome',headless:false,viewport:{width:1200,height:900},ignoreDefaultArgs:['--mute-audio']});
 const page=context.pages()[0],cdp=process.env.MELEE_TRACE?await context.newCDPSession(context.pages()[0]):null;
 let tracing=false;
 await page.exposeFunction('recordMeleeEvent',data=>events.push({...data,receivedAt:Date.now()}));
 await page.addInitScript(({players,lineup})=>{
  window.testAudioContexts=[];
  const AudioBase=window.AudioContext;
  window.AudioContext=class extends AudioBase {constructor(...args){super(...args);window.testAudioContexts.push(this);}};
  const WorkerBase=window.Worker;
  window.Worker=class extends WorkerBase {constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(!['frame','metrics','pad'].includes(data.type))window.recordMeleeEvent(data);});}};
  localStorage.setItem('melee-launch-v1',JSON.stringify({mode:0,stage:31,level:9,stocks:20,minutes:8,ports:[{device:'keyboard',character:'selected'},{device:'cpu',character:lineup==='custom'?'donaldtrump':'vanilla:2'}, {device:players===4?'cpu':'off',character:lineup!=='stock'?'abrahamlincoln':'vanilla:9'},{device:players===4?'cpu':'off',character:lineup!=='stock'?'barackobama':'vanilla:12'}]}));
 },{players,lineup:process.env.MELEE_LINEUP||'stock'});
 await page.route('**/api/game{,/**}',route=>{errors.push('Forbidden game request: '+route.request().url());return route.abort();});
 await page.route('**/api/setup{,/**}',route=>{errors.push('Forbidden setup request: '+route.request().url());return route.abort();});
 page.on('request',r=>requests.push({url:r.url(),method:r.method(),bytes:r.postDataBuffer()?.length||0}));
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.MELEE_TEST_URL||'http://127.0.0.1:5174/?benchmark=1');await page.bringToFront();
  if(process.env.MELEE_CHECK_INVALID){
   const input=page.getByLabel('Choose Melee ISO or GCM');
   await input.setInputFiles({name:'short.iso',mimeType:'application/octet-stream',buffer:Buffer.alloc(32)});
   await page.getByRole('alert').filter({hasText:'full, unmodified'}).waitFor();
   const invalid=path.join(output,'invalid.iso'),fd=fs.openSync(invalid,'w'),original=fs.openSync(iso,'r'),header=Buffer.alloc(0x440);
   fs.readSync(original,header,0,header.length,0);fs.closeSync(original);
   fs.writeSync(fd,header);fs.ftruncateSync(fd,1459978240);fs.closeSync(fd);
   try{await input.setInputFiles(invalid);await page.getByRole('alert').filter({hasText:'known USA 1.02 Melee disc hash'}).waitFor({timeout:120000});}
   finally{fs.unlinkSync(invalid);}
  }
  await page.getByLabel('Choose Melee ISO or GCM').setInputFiles(iso);
  await page.waitForFunction(()=>document.querySelector('.boot-disc [role="status"]')?.textContent==='Ready to play.',null,{timeout:120000});
  if(process.env.MELEE_SETUP_ONLY){if(errors.length)throw Error(errors.join('\n'));console.log(process.env.MELEE_CHECK_INVALID?'Invalid disc rejection and valid local disc recovery passed.':'Local disc setup passed.');return;}
  const runStarted=events.length;
  await page.getByRole('button',{name:'Play as Alan Turing, Mario moveset',exact:true}).click();
  const deadline=Date.now()+250000;let captured=false;
  while(Date.now()<deadline){
   await page.waitForTimeout(1000);
   samples.push(await page.evaluate(()=>({time:Date.now(),visible:document.visibilityState,focused:document.hasFocus(),fps:window.meleePerformance?.fps,audio:window.testAudioContexts.map(c=>({state:c.state,time:c.currentTime}))})));
   const alert=await page.locator('.game-message[role="alert"]').allTextContents();
   if(alert.length)throw Error(alert.join(' '));
   if(events.slice(runStarted).some(e=>e.type==='error'))throw Error(events.slice(runStarted).find(e=>e.type==='error').message);
   const windows=events.filter(e=>e.type==='combat-performance');
   if(!captured&&await page.locator('.fps').textContent()) {captured=true;await page.getByRole('button',{name:'Enable sound',exact:true}).click();await page.screenshot({path:path.join(output,'first-playable.png')});}
   if(!captured)await page.getByRole('button',{name:'Confirm · A',exact:true}).click();
   if(captured&&cdp&&!tracing){tracing=true;await cdp.send('Tracing.start',{categories:'v8,disabled-by-default-v8.cpu_profiler',transferMode:'ReturnAsStream'});}
   if(cdp?windows.length>=1:windows.length>=3&&windows.slice(-3).every(passes))break;
  }
  await page.screenshot({path:path.join(output,'combat.png')});
  if(cdp&&tracing){
   const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await complete;let trace='';
   for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}
   fs.writeFileSync(path.join(output,'trace.json'),trace);
   const worker=page.workers().find(w=>w.url().includes('engine-worker'));
   fs.writeFileSync(path.join(output,'phases.csv'),await worker.evaluate(()=>engine.FS.readFile('/tmp/frame-phases.csv',{encoding:'utf8'})));
   fs.copyFileSync(path.join(process.env.MELEE_BROWSER_BUILD||'build/moderngekko-wasm','opensmash-web.js.symbols'),path.join(output,'opensmash-web.js.symbols'));
  }
  const windows=events.filter(e=>e.type==='combat-performance');
  console.log(JSON.stringify({players,windows,errors},null,2));
  if(cdp)return;
  if(windows.length<3)throw Error('Missing three combat windows');
  if(errors.length)throw Error(errors.join('\n'));
   if(process.env.MELEE_REPLAY){
   const checked=events.filter(e=>e.type==='status'&&e.message==='Checking your game… 4%').length;
   await page.getByRole('button',{name:'Return to roster',exact:true}).click();
   await page.getByRole('button',{name:'Play as Alan Turing, Mario moveset',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('.fps')?.textContent,null,{timeout:120000});
   if(events.filter(e=>e.type==='status'&&e.message==='Checking your game… 4%').length!==checked)throw Error('Same immutable File was rehashed');
   await page.screenshot({path:path.join(output,'replay.png')});
  }
  if(!windows.slice(-3).every(passes))throw Error('60 FPS gate failed');
 }finally{
  fs.writeFileSync(path.join(output,'events.json'),JSON.stringify(events,null,2));
  fs.writeFileSync(path.join(output,'network.json'),JSON.stringify(requests,null,2));
  fs.writeFileSync(path.join(output,'samples.json'),JSON.stringify(samples,null,2));
  fs.writeFileSync(path.join(output,'errors.json'),JSON.stringify(errors,null,2));
  await context.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
