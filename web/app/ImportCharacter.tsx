import {preferences} from '@/lib/desktop';
import {useEffect,useRef,useState} from 'react';
import type {Fighter} from './page';
import {names} from './page';
type ImportJob={id:string;state:'queued'|'working'|'complete'|'failed';message:string;fighter?:Fighter};
const pendingKey='melee-pending-import-v1';
export default function ImportCharacter({onImported,onPlay}:{onImported:(f:Fighter)=>void;onPlay:(f:Fighter)=>void}) {
 const [url,setUrl]=useState(''),[target,setTarget]=useState('mario'),[error,setError]=useState('');
 const [job,setJob]=useState<ImportJob|null>(null),[starting,setStarting]=useState(false);
 const [id,setId]=useState(()=>preferences.getItem(pendingKey)||'');
 const imported=useRef(onImported);imported.current=onImported;
 const busy=starting || !!id && (!job || ['queued','working'].includes(job.state));
 useEffect(()=>{
  if(!id)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try {
    const response=await fetch('/api/imports/'+encodeURIComponent(id),{signal:controller.signal});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not check your import.');
    setJob(result);
    if(result.state==='complete'){preferences.removeItem(pendingKey);imported.current(result.fighter);}
    else if(result.state==='failed'){preferences.removeItem(pendingKey);setError(result.message);}
    else timer=setTimeout(poll,1000);
   }catch(e){if(!controller.signal.aborted){setError((e as Error).message);setId('');preferences.removeItem(pendingKey);}}
  };
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[id]);
 async function start(event:React.FormEvent) {
  event.preventDefault();setError('');setStarting(true);setId('');setJob(null);
  try {
   const response=await fetch('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.trim(),target})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Could not start the import.');
   setJob(result);preferences.setItem(pendingKey,result.id);setId(result.id);
  }catch(e){setError((e as Error).message);}finally{setStarting(false);}
 }
 return <section className="launch-settings">
  <p>Bring over a character you created in OpenSmash. Open its download panel, choose <strong>Copy Melee import URL</strong>, then paste it here.</p>
  <form onSubmit={start}>
   <label>Character URL<input aria-label="Character URL" type="url" required maxLength={4096} value={url} disabled={busy} onChange={e=>setUrl(e.target.value)} placeholder="https://smash.fun/engine/character-source/…/manifest.json" autoComplete="off" spellCheck={false}/></label>
   <label>Melee moveset<select aria-label="Melee moveset" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}>{Object.entries(names).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <button className="retro-site-link" type="submit" disabled={busy||!url.trim()}>{busy?'Importing…':'Import character'}</button>
  </form>
  <p>The first import downloads and retargets the mesh. It stays in your local roster for future matches. Your Melee ROM stays on your computer.</p>
  {(starting||job)&&<p role="status" aria-live="polite">{starting?'Starting import…':job?.message}</p>}
  {error&&<p role="alert">{error}</p>}
  {job?.state==='complete'&&job.fighter&&<button className="retro-site-link" onClick={()=>onPlay(job.fighter!)}>Play as {job.fighter.name}</button>}
 </section>;
}
