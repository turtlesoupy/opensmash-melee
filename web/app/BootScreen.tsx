import {useEffect,useRef,useState} from 'react';
import {schema,type Settings} from '@/lib/launch';
type Setup={state:string;ready:boolean;message:string;progress?:number};
const descriptions:Record<number,string>={0:'Jump straight into a match with your chosen rules.',1:'Open the VS menu to choose how to play.',2:'Choose your fighters and stage inside Melee.',3:'Choose a fighter for Classic mode.',4:'Start at the original title screen. Navigate to Adventure, All-Star, Training, Events and other modes in-game.'};
export default function BootScreen({settings,onChange,onReady,onSettings}:{settings:Settings;onChange:(s:Settings)=>void;onReady:(ready:boolean)=>void;onSettings:()=>void}) {
 const [setup,setSetup]=useState<Setup>({state:'checking',ready:false,message:'Checking local game setup…'});
 const [error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[transfer,setTransfer]=useState<number|null>(null);
 const input=useRef<HTMLInputElement>(null),request=useRef<XMLHttpRequest|null>(null),ready=useRef(onReady);ready.current=onReady;
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{const response=await fetch('/api/setup',{signal:controller.signal});if(!response.ok)throw Error('Start the local Melee server to load your game.');
    const status:Setup=await response.json();setSetup(status);ready.current(status.ready&&!['receiving','installing'].includes(status.state));setConnectionError('');
   }catch(e){if(!controller.signal.aborted){setConnectionError('Cannot reach the local Melee server. Start it, then retry.');ready.current(false);}}
   if(!controller.signal.aborted)timer=setTimeout(poll,2000);
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);request.current?.abort();};
 },[]);
 async function select(file?:File){
  if(!file)return;
  if(!/\.(iso|gcm)$/i.test(file.name)||file.size!==1459978240){setError('Choose a full, unmodified Melee USA 1.02 ISO or GCM (1,459,978,240 bytes). RVZ, ZIP and patched images are not supported.');return;}
  try {
   const header=await file.slice(0,0x440).arrayBuffer(),view=new DataView(header);
   if(new TextDecoder().decode(new Uint8Array(header,0,6))!=='GALE01'||view.getUint8(7)!==2||view.getUint32(0x1c)!==0xc2339f3d)throw Error('This is not Melee USA 1.02 (GALE01 revision 2). Choose the correct disc.');
  } catch(e){setError((e as Error).message);return;}
  setError('');setTransfer(0);ready.current(false);
  const xhr=new XMLHttpRequest();request.current=xhr;
  xhr.open('POST','/api/setup/disc');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.timeout=600000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable)setTransfer(e.loaded/e.total);};
  xhr.onload=()=>{setTransfer(null);try{const result=JSON.parse(xhr.responseText);if(xhr.status!==202)throw Error(result.error||'Disc setup failed.');setSetup(result);}catch(e){setError((e as Error).message);}};
  xhr.onerror=()=>{setTransfer(null);setError('Transfer interrupted. Check that the local server is running and choose the file again.');};
  xhr.ontimeout=()=>{setTransfer(null);setError('Transfer timed out. Choose the file and try again.');};
  xhr.onabort=()=>{setTransfer(null);setError('Transfer cancelled. You can choose a file again.');};
  xhr.send(file);
 }
 const busy=transfer!==null||['receiving','installing','checking'].includes(setup.state);
 return <section className="boot-screen launch-settings" aria-label="Game setup and launch mode">
  <div className="boot-heading"><h2>How do you want to play?</h2><button className="retro-site-link" onClick={onSettings}>Players & rules</button></div>
  <label>Start in<select aria-label="Start in" value={settings.mode} onChange={e=>onChange({...settings,mode:+e.target.value})}>{schema.modes.map(m=><option key={m.id} value={m.id}>{m.id===3?'Classic character select':m.id===4?'Original title & all modes':m.label}</option>)}</select></label>
  <p>{descriptions[settings.mode]} Choose a character below to launch.</p>
  <div className="boot-disc">
   <p role="status">{transfer!==null?`Copying and checking disc… ${Math.round(transfer*100)}%`:setup.message}</p>
   {busy&&<progress aria-label="Disc setup progress" {...(transfer!==null?{value:transfer,max:1}:{})}/>}
   {(error||connectionError)&&<p role="alert">{error||connectionError}</p>}
   <input ref={input} type="file" accept=".iso,.gcm" aria-label="Choose Melee ISO or GCM" hidden onChange={e=>{select(e.target.files?.[0]);e.target.value='';}}/>
   <button className="boot-action" disabled={busy&&transfer===null&&!error&&!connectionError||transfer!==null} onClick={()=>input.current?.click()}>{setup.ready?'Choose another disc':'Choose Melee ISO / GCM'}</button>
   {transfer!==null&&<button className="retro-site-link" onClick={()=>request.current?.abort()}>Cancel transfer</button>}
   <small>Your disc stays on this computer. We check the complete USA 1.02 hash before preparing it, then remember the verified game for next time.</small>
  </div>
 </section>;
}
