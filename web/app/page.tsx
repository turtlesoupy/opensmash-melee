import {useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import Game from './Game';
import LaunchSettings from './LaunchSettings';
import {loadSettings} from '@/lib/launch';
import {unlockAudio} from '@/lib/audio';
import {warmMelee} from '@/lib/melee-session';
export type Fighter={slug:string;name:string;short:string;target:string;review?:boolean};
export const names:Record<string,string>={mario:'Mario',luigi:'Luigi','captain-falcon':'Captain Falcon',fox:'Fox',marth:'Marth',link:'Link'};
export default function Home(){
 const [settings,setSettings]=useState(loadSettings);
 useEffect(()=>localStorage.setItem('melee-launch-v1',JSON.stringify(settings)),[settings]);
 const [roster,setRoster]=useState<Fighter[]>([]),[query,setQuery]=useState(''),[target,setTarget]=useState('all'),[selected,setSelected]=useState<Fighter|null>(null),[limit,setLimit]=useState(120),[error,setError]=useState('');
 useEffect(()=>{warmMelee();},[]);
 useEffect(()=>{const abort=new AbortController();fetch('/catalog.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw Error('The roster could not load.');return r.json();}).then(setRoster).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[]);
 const choose=(fighter:Fighter)=>{void unlockAudio().catch(()=>{});setSelected(fighter);};
 const filtered=useMemo(()=>roster.filter(f=>(target==='all'||f.target===target)&&(f.name+' '+names[f.target]).toLowerCase().includes(query.toLowerCase())),[roster,query,target]);
 return <main className="roster-shell"><header className="masthead"><img src="/brand/smash-the-weights-logo.png" alt="Smash.fun" width="400" height="134"/><span className="edition">MELEE</span></header>
 <div className="roster-bar"><div><h1>CHOOSE YOUR FIGHTER</h1><p>{roster.length?roster.length.toLocaleString():'Loading'} characters · 6 Melee fighters</p></div><Button className="fire-button" disabled={!roster.length} onClick={()=>choose(roster[Math.floor(Math.random()*roster.length)])}>Random fighter</Button></div>
 <div className="search-bar"><Input aria-label="Find a fighter" placeholder="Find a fighter…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(120);}}/><select aria-label="Filter by Melee fighter" value={target} onChange={e=>{setTarget(e.target.value);setLimit(120);}}><option value="all">All Melee fighters</option>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select><span>{filtered.length.toLocaleString()} fighters</span></div>
 <LaunchSettings value={settings} onChange={setSettings} roster={roster}/>
 <p className="roster-note">Pick a character. Play Melee.</p>
 <div className="fighter-grid">{filtered.slice(0,limit).map(f=><button key={f.slug} className="fighter-tile" onClick={()=>choose(f)} aria-label={`Play as ${f.name}, ${names[f.target]} moveset`}><img src={`/portraits/${f.slug}.webp`} alt="" loading="lazy" width="256" height="256"/><span className="fighter-name">{f.short}</span><span className="fighter-target">{names[f.target]}</span></button>)}</div>
 {filtered.length>limit&&<Button className="more-button" onClick={()=>setLimit(n=>n+120)}>More fighters · {filtered.length-limit} remaining</Button>}
 {!filtered.length&&roster.length>0&&<p className="empty">No fighters found. Try another name.</p>}{error&&<p className="empty" role="alert">{error}</p>}
 <footer>Local development · OpenSmash Melee</footer>
 {selected&&<Game key={selected.slug} fighter={selected} settings={settings} roster={roster} onClose={()=>setSelected(null)}/>}
 </main>;
}
