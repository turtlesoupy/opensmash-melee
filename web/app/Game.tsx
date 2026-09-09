import {useEffect,useRef,useState} from 'react';
import {plan,schema,type Settings} from '@/lib/launch';
import type {Fighter} from './page';
import {names} from './page';
import {connectAudio,unlockAudio} from '@/lib/audio';
import {claimMelee,releaseMelee} from '@/lib/melee-session';
const keyboard:Record<string,number>={KeyJ:0x100,KeyK:0x200,KeyI:0x400,Space:0x400,KeyU:0x10,KeyQ:0x40,KeyE:0x20,Enter:0x1000};
export default function Game({fighter,settings,roster,onClose}:{fighter:Fighter;settings:Settings;roster:Fighter[];onClose:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),[status,setStatus]=useState('Preparing '+fighter.name+'…'),[error,setError]=useState(''),[fps,setFps]=useState<number|null>(null),[attempt,setAttempt]=useState(0);
 const gameWorker=useRef<Worker|undefined>(undefined);
 const touch=useRef(new Set<string>());
 useEffect(()=>{
  let worker:Worker|undefined,audioNode:AudioWorkletNode|undefined,raf=0,closed=false;const abort=new AbortController(),keys=new Set<string>(),requestedAt=Date.now();
  let running=false,firstFrame=true,selectionAcknowledged=false,fullBootVisible=false,frameSamples:number[]=[],launchPlan:any;
  const skin=new URLSearchParams(location.search).get('skin')==='gx'?'gx':'host';
  const send=(schedule=true)=>{
   if(worker&&running){
    for(let port=0;port<4;port++){
    const device=launchPlan?.ports[port]?.device;
    if(device==='off'||device==='cpu') {worker.postMessage({type:'pad',values:[port,0,0x80808080,0,0]});continue;}
    const held=(code:string)=>!document.querySelector('dialog[open]')&&device==='keyboard'&&(keys.has(code)||touch.current.has(code));
    let buttons=0;for(const [key,bit] of Object.entries(keyboard))if(held(key))buttons|=bit;
    let x=128+((held('KeyD')||held('ArrowRight')?1:0)-(held('KeyA')||held('ArrowLeft')?1:0))*100;
    let y=128+((held('KeyW')||held('ArrowUp')?1:0)-(held('KeyS')||held('ArrowDown')?1:0))*100;
    let cx=128,cy=128,l=0,r=0;
    const pad=device?.startsWith('gamepad')?navigator.getGamepads()[Number(device.slice(-1))]:null;
    if(pad){
     const axis=(n:number)=>Math.abs(pad.axes[n]||0)>.15?pad.axes[n]:0;
     x=Math.round(128+axis(0)*100);y=Math.round(128-axis(1)*100);cx=Math.round(128+axis(2)*100);cy=Math.round(128-axis(3)*100);
     const mapping=[0x100,0x200,0x400,0x800,0x40,0x20,0x40,0x20,0x10,0x1000,0,0,8,4,1,2];
     pad.buttons.forEach((b,i)=>{if(b.pressed)buttons|=mapping[i]||0;});l=Math.round((pad.buttons[6]?.value||0)*255);r=Math.round((pad.buttons[7]?.value||0)*255);
    }
    worker.postMessage({type:'pad',values:[port,buttons,(x|(y<<8)|(cx<<16)|(cy<<24))>>>0,l|(r<<8),device==='keyboard'||!!pad?1:0]});
    }
   }if(schedule)raf=requestAnimationFrame(()=>send());
  };
  const code=(e:KeyboardEvent)=>e.code||(/^[a-z]$/i.test(e.key)?'Key'+e.key.toUpperCase():e.key===' '?'Space':e.key);
  const keydown=(e:KeyboardEvent)=>{if(document.querySelector('dialog[open]')||(e.target instanceof HTMLElement&&e.target.matches('input,select,textarea,[contenteditable=true]')))return;const key=code(e);if(keyboard[key]||['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)){e.preventDefault();keys.add(key);send(false);}};
  const keyup=(e:KeyboardEvent)=>{keys.delete(code(e));send(false);};
  const blur=()=>{keys.clear();touch.current.clear();for(let port=0;port<4;port++)worker?.postMessage({type:'pad',values:[port,0,0x80808080,0,launchPlan?.ports[port]?.device==='keyboard'?1:0]});};
  window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
  async function start(){try{
   if(!crossOriginIsolated||!canvas.current?.transferControlToOffscreen)throw Error('This browser needs shared memory and OffscreenCanvas support. Open the local game in Chrome.');
   const session=claimMelee();worker=session.worker;gameWorker.current=worker;
   launchPlan=plan(settings,fighter,roster);
   if(new URLSearchParams(location.search).get('benchmark')==='1') {
    launchPlan.packedPorts=launchPlan.packedPorts.map((p:number,i:number)=>i<2?(p&~0xff00)|256:p);
    launchPlan.stocks=20;
   }
   const costumes=await Promise.all(launchPlan.costumes.map(async (entry:any)=>{
    const response=await fetch('/api/prepare/'+encodeURIComponent(entry.character)+'?color='+entry.color+(skin==='host'?'&skin=host':''),{method:'POST',signal:abort.signal});
    const costume=await response.json();if(!response.ok)throw Error(costume.error||'The character could not be prepared.');
    const asset=await fetch(costume.url,{signal:abort.signal});if(!asset.ok)throw Error('The costume could not load.');
    return {filename:costume.filename,blob:await asset.blob()};
   }));
   setStatus('Loading Melee…');if(closed)return;
   const audio=session.audio;
   connectAudio(audio).then(node=>{if(closed)node.disconnect();else audioNode=node;}).catch(()=>{});
   worker.onerror=e=>{if(!closed)setError(e.message||'The game worker stopped.');};
   worker.onmessage=({data})=>{
    if(closed)return;
    if(data.type==='frame'){canvas.current?.getContext('bitmaprenderer')?.transferFromImageBitmap(data.bitmap);if(firstFrame){firstFrame=false;canvas.current?.focus();}}
    if(data.type==='session' && data.launch)selectionAcknowledged=true;
    if(data.type==='frame' && settings.mode===4 && selectionAcknowledged && !fullBootVisible){fullBootVisible=true;setStatus('');}
    if(data.type==='status' && !fullBootVisible)setStatus(data.message);
    if(data.type==='started'){running=true;}
    if(data.type==='error'){setError(previous=>previous||data.message);running=false;}
    if(data.type==='log'){console.log('[Melee]',data.text);if(data.text.includes('[opensmash] destination ready'))setStatus('');}
    if(data.type==='metrics'){
     setFps(data.combatFrames>0?data.fps:null);frameSamples.push(...data.frameTimes);if(frameSamples.length>36000)frameSamples=frameSamples.slice(-36000);
     (window as any).meleePerformance={frames:data.frames,fps:data.fps,frameTimes:frameSamples};
    }
   };
   await session.ready;if(closed)return;running=true;
   worker.postMessage({type:'select',requestedAt,warmReadyBeforeClick:session.readyAt<=requestedAt,character:fighter.slug,skin,fighter:launchPlan.ports[0].fighter,launch:launchPlan,costumes});
   raf=requestAnimationFrame(()=>send());
  }catch(e){if(!closed)setError((e as Error).message);}}
  start();
  return()=>{closed=true;abort.abort();cancelAnimationFrame(raf);if(worker)releaseMelee(worker);audioNode?.disconnect();window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);touch.current.clear();};
 },[fighter,settings,roster,attempt]);
 const control=(label:string,code:string)=><button key={code} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);touch.current.add(code);}} onPointerUp={()=>touch.current.delete(code)} onPointerCancel={()=>touch.current.delete(code)}>{label}</button>;
 return <div className="game-overlay" role="region" aria-label={'Play as '+fighter.name}><section className="game-panel"><header><div><h2>{fighter.name}</h2><p>{names[fighter.target]} moveset · {schema.modes.find(m=>m.id===settings.mode)?.label}</p></div><span className="fps" data-slow={fps!==null&&fps<58.5} title="Target: sustained 60 FPS in combat">{fps===null?'':Math.round(fps)+' FPS'}</span><button onClick={()=>{const panel=canvas.current?.closest('.intro-video-frame');if(document.fullscreenElement)void document.exitFullscreen();else void panel?.requestFullscreen();}} aria-label="Toggle fullscreen">⛶</button><button onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();onClose();}} aria-label="Return to roster">✕</button></header><div className="game-screen"><canvas id="canvas" key={attempt} ref={canvas} width={960} height={720} tabIndex={0}/>{status&&!error&&<p className="game-message" role="status">{status}</p>}{error&&<div className="game-message" role="alert"><p>{error}</p><button onClick={()=>{setError('');setStatus('Preparing…');setFps(null);setAttempt(n=>n+1);}}>Try again</button></div>}</div><button className="sound-game" onClick={()=>void unlockAudio()}>Enable sound</button><button className="confirm-game" onClick={()=>gameWorker.current?.postMessage({type:'confirm'})}>Confirm · A</button><p className="game-help">WASD / arrows move · J attack · K special · I / Space jump · Q / E shield · U grab · Enter start / pause<br/>Assign gamepads to player ports in Launch settings. Press J to confirm any first-run memory card prompt.</p><div className="touch-controls">{control('←','KeyA')}{control('↑','KeyW')}{control('↓','KeyS')}{control('→','KeyD')}{control('Attack','KeyJ')}{control('Special','KeyK')}{control('Jump','Space')}{control('Shield','KeyQ')}{control('Start','Enter')}</div></section></div>;
}
