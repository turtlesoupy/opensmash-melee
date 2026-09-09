/* One runtime per worker. Terminating it releases the game, threads and canvas. */
let engine;
const sessionId=crypto.randomUUID();
let audioPeak=0,audioBlocks=0,audioIndices;
let pulseUntil = 0;
const lastButtons=new Uint16Array(4),rawButtons=new Uint16Array(4);
const buttonUntil = new Float64Array(64);
const buttonUntilFrame = new Uint32Array(64);
let phase = 'worker startup';
let skinVerificationComplete = false;
let combatReached = false, startupReported = false;
const costumeSizes=new Map();
let runtimeBuild, startOptions, activeSelection, readyForSelection = false;
const report = (type, data) => {
  postMessage({type, sessionId, ...data});
  if (type !== 'metrics') fetch('/api/debug', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({time:Date.now(),type,sessionId,...data})}).catch(()=>{});
};
self.onmessage = async ({data}) => {
  if (data.type === 'select') {
    try {
      if (!engine || !readyForSelection) throw Error('The engine is not ready for a selection.');
      const {costumeSlot,COSTUME_SLOTS} = await import('./local-files.mjs');
      if (!Array.isArray(data.costumes)||!data.launch?.packedPorts||data.launch.packedPorts.length!==4) throw Error('Invalid launch selection.');
      activeSelection=data;readyForSelection=false;
      for(const costume of data.costumes) {
        if(!COSTUME_SLOTS.includes(costume.filename)) throw Error('Invalid fighter costume.');
        const bytes=new Uint8Array(await costume.blob.arrayBuffer());
        const padded=costumeSlot(bytes);new DataView(padded.buffer).setUint32(0,bytes.length);
        engine.FS.writeFile('/game/files/'+costume.filename,padded);costumeSizes.set(costume.filename,bytes.length);
      }
      report('session',{build:runtimeBuild,mode:startOptions.benchmark==='1'?'cpu-benchmark':'human',
        skin:data.skin||'host',character:data.character,fighter:data.fighter,profile:startOptions.profile||'0',
        resolution:[960,720],warm:true,launch:data.launch});
      report('status',{message:'Opening Melee…'});
      COSTUME_SLOTS.forEach((name,i)=>engine._opensmash_costume_size(i,costumeSizes.get(name)));
      const s=data.launch;
      engine._opensmash_configure_launch(s.mode,s.stage,s.level,s.stocks,s.minutes,...s.packedPorts);
    } catch(error) { report('error',{message:error.message||String(error)}); }
    return;
  }
  if (data.type === 'confirm') {
    pulseUntil=performance.now()+150;
    engine?._opensmash_set_pad(0, 0x100, 0x80808080, 0, 1);
    return;
  }
  if (data.type === 'pad') {
    const now=performance.now(), raw=data.values[1],port=data.values[0];
    if(!Number.isInteger(port)||port<0||port>3)return;
    for(let bit=0;bit<16;bit++){
      const mask=1<<bit;
      if((raw&mask)&&!(rawButtons[port]&mask)){
        buttonUntil[port*16+bit]=now+32;
        buttonUntilFrame[port*16+bit]=(engine?._opensmash_frame_count()||0)+2;
      }
      if(now<buttonUntil[port*16+bit]||(engine?._opensmash_frame_count()||0)<buttonUntilFrame[port*16+bit])data.values[1]|=mask;
    }
    rawButtons[port]=raw;
    if(port===0&&now<pulseUntil)data.values[1]|=0x100;
    if (engine) {
      engine._opensmash_set_pad(...data.values);
      if (data.values[1] !== lastButtons[port]) report('pad', {port,buttons:data.values[1]});
      lastButtons[port]=data.values[1];
    }
    return;
  }
  if (data.type !== 'start' || engine) return;
  try {
    const buildResponse=await fetch('./opensmash-web-build.json');
    if(!buildResponse.ok)throw Error('The local engine build is incomplete. Finish the browser build first.');
    const build=await buildResponse.json();
    runtimeBuild=build;startOptions=data;
    report('session',{build,mode:data.warm?'warming':data.benchmark==='1'?'cpu-benchmark':'human',skin:data.skin||'gx',character:data.character,fighter:data.fighter,profile:data.profile||'0',resolution:[960,720]});
    const {inspectDisc, ISO_SHA256} = await import('./disc.mjs');
    const {mountSizedFile, mountSystemBundle, costumeSlot, COSTUME_SLOTS} = await import('./local-files.mjs');
    report('status', {message: 'Loading Melee…'});
    importScripts('./opensmash-web.js');
    phase = 'loading WebAssembly and threads';
    engine = await createMelee({
      canvas: new OffscreenCanvas(960, 720),
      onFrame: bitmap => {
        postMessage({type: "frame", bitmap}, [bitmap]);
        if (combatReached && !startupReported) {
          startupReported = true;
          const selected=activeSelection||data;
          report('startup-performance', {character:selected.character, build:build.id,warm:!!data.warm,
            warmReadyBeforeClick:!!selected.warmReadyBeforeClick,
            clickToMatchMs:Number.isFinite(selected.requestedAt)?Date.now()-selected.requestedAt:null});
        }
      },
      mainScriptUrlOrBlob: new URL('./opensmash-web.js', self.location.href).href,
      locateFile: path => new URL(path, self.location.href).href,
      print: text => report('log', {text}),
      printErr: text => {
        report('log', {text});
        if (text.includes('[opensmash] ready for character selection')) {
          readyForSelection=true;report('ready-for-selection',{});
        }
        if (text.includes('[opensmash] combat started')) combatReached = true;
        if (data.profile === 'dispatch' && text.includes('[opensmash] combat started') && engine?.FS.analyzePath('/tmp/dispatch.csv').exists) {
          report('startup-dispatch', {csv:engine.FS.readFile('/tmp/dispatch.csv',{encoding:'utf8'}).slice(-45000)});
        }
        if (/skin oracle pose=1200 /.test(text)) {
          skinVerificationComplete = true;
          report('skin-verified', {message:'All scheduled live matrix comparisons passed.'});
        }
        if (/Failed to initialize video backend|guest assert|\[browser-stack\]|Aborted\(/.test(text))
          report('error', {message: text});
      },
      onExit: code => report('error', {message: `The game exited (code ${code}).`}),
      onAbort: reason => report('error', {message: `Melee stopped: ${reason}`}),
      onVerifyProgress: bytes => report('status', {message: `Checking your game… ${Math.floor(bytes / data.iso.size * 100)}%`}),
    });
    phase = 'mounting game files';
    report('status', {message: 'Preparing game files…'});
    const {FS, WORKERFS} = engine;
    if (data.localGame) {
      const response = await fetch('/api/game');
      if (!response.ok) throw Error('The local game is unavailable.');
      const game = await response.json();
      if (!game.verified) throw Error('The local game has not been verified.');
      FS.mkdir('/game');
      if (data.warm) {
        FS.mkdirTree('/game/files');
        await Promise.all(COSTUME_SLOTS.map(async filename=>{
          const response=await fetch('/api/game/files/'+filename);
          if (!response.ok) throw Error('Could not prepare a fighter slot.');
          const bytes=new Uint8Array(await response.arrayBuffer()),padded=costumeSlot(bytes);
          new DataView(padded.buffer).setUint32(0,bytes.length);costumeSizes.set(filename,bytes.length);
          FS.writeFile('/game/files/'+filename,padded);
        }));
      }
      for (const name of game.files) {
        const slash = name.lastIndexOf('/');
        const parent = '/game/' + name.slice(0, slash);
        FS.mkdirTree(parent);
        if (data.warm && COSTUME_SLOTS.some(filename=>name===`files/${filename}`)) {
          continue;
        } else if (data.costume && name === `files/${data.costume.filename}`) {
          FS.writeFile('/game/' + name, new Uint8Array(await data.costume.blob.arrayBuffer()));
        } else {
          mountSizedFile(FS, parent, name.slice(slash + 1), new URL('/api/game/' + name, self.location.href).href, game.sizes[name]);
        }
      }
    } else {
    FS.mkdir('/disc');
    FS.mount(WORKERFS, {blobs: [{name: 'game.iso', data: data.iso}]}, '/disc');
    report('status', {message: 'Checking your game…'});
    const hash = engine.ccall('opensmash_hash_file', 'string', ['string'], ['/disc/game.iso']);
    if (hash !== ISO_SHA256) throw Error('This image does not match the known USA 1.02 Melee disc hash.');
    const {blobs} = await inspectDisc(data.iso);
    if (data.costume) {
      if (!/^Pl[A-Za-z0-9]+\.dat$/.test(data.costume.filename)) throw Error('Invalid costume filename.');
      const entry = blobs.find(entry => entry.name === `files/${data.costume.filename}`);
      if (!entry) throw Error('The selected costume slot does not exist.');
      entry.data = data.costume.blob;
    }
    FS.mkdir('/game');
    FS.mount(WORKERFS, {blobs}, '/game');
    }
    FS.mkdir('/user');
    FS.mount(engine.IDBFS, {autoPersist:true}, '/user');
    await new Promise((resolve,reject)=>FS.syncfs(true,error=>error?reject(error):resolve()));
    FS.mkdir('/sys');
    phase = 'loading system resources';
    report('status', {message: 'Loading system resources…'});
    const bundleResponse = await fetch('./sys-bundle.bin');
    if (!bundleResponse.ok) throw Error('Melee resources could not load.');
    mountSystemBundle(FS, await bundleResponse.arrayBuffer());
    engine._opensmash_set_pad(0, 0, 0x80808080, 0, 1);
    report('status', {message: 'Starting match…'});
    const identityBytes = new TextEncoder().encode(ISO_SHA256 + (data.warm?'warm-slots-v3':data.costume ?
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await data.costume.blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') : ''));
    const identity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', identityBytes)), b => b.toString(16).padStart(2, '0')).join('');
    engine.callMain(['/game', data.renderer || 'OGL', '/user', String(data.fighter ?? 8), identity, data.profile || '0',data.benchmark||'0',data.warm?'1':'0']);
    report('started', {});
    if (data.audio) {
      const indices = new Int32Array(data.audio, 0, 4), ring = new Float32Array(data.audio, 16);
      const capacity = ring.length / 2;
      audioIndices=indices;
      setInterval(() => {
        let write = Atomics.load(indices, 0), read = Atomics.load(indices, 1);
        while (((write-read+capacity)%capacity) < 1536) {
          const pointer = engine._opensmash_audio_mix() >>> 1;
          for(let i=0;i<512;i++)for(let channel=0;channel<2;channel++)
            ring[((write+i)%capacity)*2+channel] = engine.HEAP16[pointer+i*2+channel]/32768;
          for(let i=0;i<1024;i++)audioPeak=Math.max(audioPeak,Math.abs(engine.HEAP16[pointer+i]));
          audioBlocks++;
          write=(write+512)%capacity;
          Atomics.store(indices,0,write);
          read=Atomics.load(indices,1);
        }
      }, 10);
    }
    let lastFrame = 0, lastTime = performance.now(), batchStart = lastTime, samples = [];
    let combatStart=0,combatFirstFrame=0,lastCombat=0,combatSamples=[],combatUnderruns=0,combatAudioSamples=0,combatProfile=data.profile||'0';
    setInterval(() => {
      const count = engine._opensmash_frame_count(), now = performance.now();
      const combatFrames=engine._opensmash_combat_frames?.()||0;
      // The skin oracle runs only on draws 1, 120, 600 and 1200. Start a fresh
      // measurement window after its final check; never mix that work into FPS.
      const activeProfile=data.profile==='skin'&&skinVerificationComplete?'0':data.profile||'0';
      const frameTimes = [];
      for (let i = Math.max(lastFrame, count - 4096); i < count; i++) frameTimes.push(engine._opensmash_frame_interval(i) / 1000);
      report('metrics', {combatFrames:engine._opensmash_combat_frames?.() || 0,frames: count, fps: (count - lastFrame) * 1000 / (now - lastTime), frameTimes});
      samples.push(...frameTimes);
      if(combatFrames===lastCombat&&combatStart){combatStart=0;combatSamples=[];}
      if(combatFrames>lastCombat&&(!combatStart||activeProfile!==combatProfile)){
        // Skip the interval spanning loading and the first combat frame.
        combatStart=now;combatFirstFrame=count;
        combatSamples=[];combatProfile=activeProfile;
        combatUnderruns=audioIndices?Atomics.load(audioIndices,2):0;
        combatAudioSamples=audioIndices?Atomics.load(audioIndices,3):0;
      }else if(combatFrames>lastCombat&&combatStart){
        combatSamples.push(...frameTimes);
        if(now-combatStart>=30000){
          const ordered=[...combatSamples].sort((a,b)=>a-b), durationMs=now-combatStart;
          const fps=(count-combatFirstFrame)*1000/durationMs;
          const p95=ordered[Math.floor(ordered.length*.95)]||0,p99=ordered[Math.floor(ordered.length*.99)]||0;
          const underruns=audioIndices?Atomics.load(audioIndices,2):0;
          const renderedAudioSamples=audioIndices?Atomics.load(audioIndices,3):0;
          report('combat-performance',{profile:combatProfile,frames:count-combatFirstFrame,
            combatFrames,durationMs,fps,p95,p99,over33ms:combatSamples.filter(n=>n>33.34).length,
            audioPeak,audioUnderrunSamples:underruns-combatUnderruns,
            audioRenderedSamples:renderedAudioSamples-combatAudioSamples,
            targetFps:60,passes:fps>=58.5&&p95<=20&&p99<=33.34});
          combatSamples=[];combatStart=now;combatFirstFrame=count;combatUnderruns=underruns;combatAudioSamples=renderedAudioSamples;
        }
      }
      lastCombat=combatFrames;
      if (now - batchStart >= 30000) {
        if (data.profile === 'dispatch' && FS.analyzePath('/tmp/dispatch.csv').exists) {
          const rows=FS.readFile('/tmp/dispatch.csv',{encoding:'utf8'}).trim().split('\n').slice(-30000);
          const entries=new Map();
          for(const row of rows){
            const [frame,,pc,host,clock]=row.split(',');
            if(!/^[0-9a-f]{8}$/.test(pc))continue;
            const value=entries.get(pc)||{pc,count:0,hostNs:0,netNs:0};
            value.count++;value.hostNs+=Number(host);value.netNs+=Math.max(0,Number(host)-Number(clock));
            entries.set(pc,value);
          }
          report('dispatch-profile',{fromFrame:rows[0]?.split(',')[0],toFrame:rows.at(-1)?.split(',')[0],
            samples:rows.length,entries:[...entries.values()].sort((a,b)=>b.netNs-a.netNs).slice(0,100)});
        }
        const ordered = [...samples].sort((a,b) => a-b), total = samples.reduce((a,b) => a+b,0);
        report('performance', {combatFrames:engine._opensmash_combat_frames?.() || 0,audioPeak,audioBlocks,audioUnderrunSamples:audioIndices?Atomics.load(audioIndices,2):0,frames: samples.length, fps: total ? samples.length*1000/total : 0,
          p95: ordered[Math.floor(ordered.length*.95)] || 0, p99: ordered[Math.floor(ordered.length*.99)] || 0,
          over33ms: samples.filter(n=>n>33.34).length, durationMs: now-batchStart,
          phases: FS.analyzePath('/tmp/frame-phases.csv').exists ? FS.readFile('/tmp/frame-phases.csv',{encoding:'utf8'}).split('\n').slice(-65).join('\n') : ''});
        samples = []; batchStart = now;
      }
      lastFrame = count; lastTime = now;
    }, 1000);
  } catch (error) {
    report('error', {message: `${phase}: ${error.message || String(error)}`, stack: error.stack});
  }
};
