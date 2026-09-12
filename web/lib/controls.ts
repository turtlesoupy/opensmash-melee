import {preferences} from '@/lib/desktop';

// GameCube controls the game reads, in the order the Controls screen lists them.
export const actions=[
 {id:'up',label:'Move up',group:'stick'},
 {id:'down',label:'Move down',group:'stick'},
 {id:'left',label:'Move left',group:'stick'},
 {id:'right',label:'Move right',group:'stick'},
 {id:'a',label:'Attack / confirm',group:'button'},
 {id:'b',label:'Special / back',group:'button'},
 {id:'x',label:'Jump',group:'button'},
 {id:'y',label:'Jump (alternate)',group:'button'},
 {id:'z',label:'Grab',group:'button'},
 {id:'l',label:'Shield',group:'button'},
 {id:'r',label:'Shield (alternate)',group:'button'},
 {id:'start',label:'Start / pause',group:'button'},
 {id:'cup',label:'Smash attack up',group:'cstick'},
 {id:'cdown',label:'Smash attack down',group:'cstick'},
 {id:'cleft',label:'Smash attack left',group:'cstick'},
 {id:'cright',label:'Smash attack right',group:'cstick'},
] as const;
export type Action=(typeof actions)[number]['id'];
export type ButtonAction='a'|'b'|'x'|'y'|'z'|'l'|'r'|'start';
export const buttonActions:ButtonAction[]=['a','b','x','y','z','l','r','start'];
export type Bindings={keyboard:Record<Action,string>;gamepad:Record<ButtonAction,number>};

// Physical DOM key codes: the right-hand cluster stays under the fingers on every layout.
export const defaultKeyboard:Record<Action,string>={
 up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',
 a:'KeyJ',b:'KeyK',x:'Space',y:'KeyI',z:'KeyU',l:'KeyQ',r:'KeyE',start:'Enter',
 cup:'ArrowUp',cdown:'ArrowDown',cleft:'ArrowLeft',cright:'ArrowRight',
};
// Standard-mapping gamepad button indexes (W3C layout: 0 = bottom face button).
export const defaultGamepad:Record<ButtonAction,number>={a:0,b:1,x:2,y:3,z:5,l:6,r:7,start:9};
export const defaults=():Bindings=>({keyboard:{...defaultKeyboard},gamepad:{...defaultGamepad}});

// Keys every input backend (browser, Electron surface, Dolphin's Quartz / DInput / XInput2) can name.
export const bindableKeys=new Set([
 ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c=>'Key'+c),
 ...'0123456789'.split('').map(c=>'Digit'+c),
 'Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
]);
export const maxGamepadButton=16;

const STORAGE='melee-controls-v1';
let current:Bindings|null=null;
const listeners=new Set<()=>void>();
export function loadBindings():Bindings {
 if(current)return current;
 const b=defaults();
 try{
  const saved=JSON.parse(preferences.getItem(STORAGE)||'{}');
  for(const action of actions){const code=saved?.keyboard?.[action.id];if(typeof code==='string'&&bindableKeys.has(code))b.keyboard[action.id]=code;}
  for(const action of buttonActions){const index=saved?.gamepad?.[action];if(Number.isInteger(index)&&index>=0&&index<maxGamepadButton)b.gamepad[action]=index;}
 }catch{}
 return current=b;
}
export function saveBindings(b:Bindings){
 current=b;
 try{preferences.setItem(STORAGE,JSON.stringify(b));}catch{}
 for(const listener of listeners)listener();
}
export function subscribeBindings(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}

// Assign a key to an action; a key already used elsewhere swaps places so nothing is left unbound.
export function rebindKey(b:Bindings,action:Action,code:string):Bindings {
 if(!bindableKeys.has(code))return b;
 const keyboard={...b.keyboard};
 const other=(Object.keys(keyboard) as Action[]).find(id=>keyboard[id]===code&&id!==action);
 if(other)keyboard[other]=keyboard[action];
 keyboard[action]=code;
 return {...b,keyboard};
}
export function rebindButton(b:Bindings,action:ButtonAction,index:number):Bindings {
 if(!Number.isInteger(index)||index<0||index>=maxGamepadButton)return b;
 const gamepad={...b.gamepad};
 const other=buttonActions.find(id=>gamepad[id]===index&&id!==action);
 if(other)gamepad[other]=gamepad[action];
 gamepad[action]=index;
 return {...b,gamepad};
}

export function keyLabel(code:string):string {
 if(code.startsWith('Key'))return code.slice(3);
 if(code.startsWith('Digit'))return code.slice(5);
 return {Space:'Space',Enter:'Enter',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[code]||code;
}

// Face-button captions per controller family; sticks and triggers read the same everywhere.
export type PadFamily='xbox'|'playstation'|'switch'|'gamecube'|'generic';
const padLabels:Record<PadFamily,string[]>={
 xbox:['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS','D-Up','D-Down','D-Left','D-Right'],
 playstation:['✕','○','□','△','L1','R1','L2','R2','Share','Options','L3','R3','D-Up','D-Down','D-Left','D-Right'],
 switch:['B','A','Y','X','L','R','ZL','ZR','−','+','LS','RS','D-Up','D-Down','D-Left','D-Right'],
 gamecube:['A','X','B','Y','Z','R','L','Z','','Start','','','D-Up','D-Down','D-Left','D-Right'],
 generic:['1','2','3','4','L1','R1','L2','R2','Select','Start','L3','R3','D-Up','D-Down','D-Left','D-Right'],
};
export function padFamily(id:string):PadFamily {
 if(/dualsense|dualshock|playstation|sony|054c/i.test(id))return 'playstation';
 if(/nintendo|switch|joy-con|pro controller|057e/i.test(id))return 'switch';
 if(/xbox|xinput|microsoft|045e/i.test(id))return 'xbox';
 if(/gamecube|mayflash|wii u|wup-028/i.test(id))return 'gamecube';
 return 'generic';
}
export const familyNames:Record<PadFamily,string>={xbox:'Xbox',playstation:'PlayStation',switch:'Nintendo Switch',gamecube:'GameCube',generic:'gamepad'};
export function padLabel(index:number,family:PadFamily='xbox'):string {return padLabels[family][index]||'Button '+(index+1);}

export function connectedGamepads():Gamepad[] {
 try{return [...(navigator.getGamepads?.()||[])].filter((p):p is Gamepad=>!!p&&p.connected);}catch{return [];}
}
export const stickThreshold=0.5;
// Which actions a gamepad currently holds, for the Controls screen's live highlight.
export function padActions(pad:Gamepad,gamepad:Record<ButtonAction,number>):Set<Action> {
 const active=new Set<Action>();
 for(const action of buttonActions){const b=pad.buttons[gamepad[action]];if(b&&(b.pressed||b.value>0.5))active.add(action);}
 const axis=(n:number)=>pad.axes[n]||0;
 if(axis(1)<-stickThreshold)active.add('up');if(axis(1)>stickThreshold)active.add('down');
 if(axis(0)<-stickThreshold)active.add('left');if(axis(0)>stickThreshold)active.add('right');
 if(axis(3)<-stickThreshold)active.add('cup');if(axis(3)>stickThreshold)active.add('cdown');
 if(axis(2)<-stickThreshold)active.add('cleft');if(axis(2)>stickThreshold)active.add('cright');
 return active;
}
// Normalise a keyboard event to a physical code, including browsers that only report the key.
export function eventCode(e:KeyboardEvent):string {
 if(e.code)return e.code;
 if(/^[a-z]$/i.test(e.key))return 'Key'+e.key.toUpperCase();
 if(/^[0-9]$/.test(e.key))return 'Digit'+e.key;
 return e.key===' '?'Space':e.key;
}
