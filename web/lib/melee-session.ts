/** One initialized engine waits at the game boundary while the roster is open. */
type Session={worker:Worker;audio:SharedArrayBuffer;ready:Promise<void>;readyAt:number;cancel:()=>void};
let standby:Session|undefined;
const sessions=new WeakMap<Worker,Session>();

export function warmMelee(){
 if(standby||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined')return;
 const worker=new Worker('/engine/engine-worker.js'),audio=new SharedArrayBuffer(16+8192*2*4);
 let resolve!:()=>void,reject!:(reason:Error)=>void;
 const ready=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail;});
 void ready.catch(()=>{});
 const session={worker,audio,ready,readyAt:0,cancel:()=>reject(Error('Game closed'))};
 standby=session;sessions.set(worker,session);
 worker.addEventListener('message',({data})=>{
  if(data.type==='ready-for-selection'){session.readyAt=Date.now();resolve();}
  if(data.type==='error')reject(Error(data.message));
  if(data.type==='frame'&&!worker.onmessage)data.bitmap.close();
 });
 worker.addEventListener('error',e=>reject(Error(e.message||'The engine could not start.')));
 const query=new URLSearchParams(location.search);
 worker.postMessage({type:'start',warm:true,character:'pending',skin:'host',localGame:true,
  profile:query.get('profile'),benchmark:query.get('benchmark'),audio});
}

export function claimMelee():Session{
 warmMelee();
 if(!standby)throw Error('This browser needs shared memory support.');
 const session=standby;standby=undefined;return session;
}

export function releaseMelee(worker:Worker){
 sessions.get(worker)?.cancel();sessions.delete(worker);worker.terminate();
 warmMelee();
}

if((import.meta as any).hot)(import.meta as any).hot.dispose(()=>{
 standby?.cancel();standby?.worker.terminate();standby=undefined;
});
