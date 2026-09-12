import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planLaunch} from '../runtime/web/launch-options.mjs';
const schema=JSON.parse(readFileSync(new URL('../runtime/launch-options.json',import.meta.url)));
const roster=[{slug:'alan',target:'mario'},{slug:'einstein',target:'mario'},{slug:'fox',target:'fox'}];
const fresh=()=>structuredClone(schema.defaults);
test('all five modes preserve numeric launch contract',()=>{
 for(const mode of schema.modes){const s=fresh();s.mode=mode.id;s.ports[1].character='vanilla:12';s.ports[2]={device:'off',character:'vanilla:2'};s.ports[3]={device:'off',character:'vanilla:9'};const p=planLaunch(schema,s,roster[0],roster);assert.equal(p.mode,mode.id);assert.deepEqual(p.packedPorts,[8,268,770,777]);}
});
test('default lineup is the pick, a random Melee fighter and two random custom opponents',()=>{
 const s=fresh();assert.deepEqual(s.ports.map(p=>p.character),['selected','random:vanilla','random','random']);
 const p=planLaunch(schema,s,roster[0],roster,()=>0);
 assert.deepEqual(p.ports.map(x=>x.character),['alan','vanilla:0','einstein','fox']);
 assert.deepEqual(p.ports.map(x=>x.device),['keyboard','cpu','cpu','cpu']);
 assert.deepEqual(p.packedPorts,[8,256,8|256|(1<<16),2|256]);
 assert.deepEqual(p.costumes.map(x=>x.character),['alan','einstein','fox']);
});
test('random opponents never duplicate the player or each other while the roster allows',()=>{
 const wide=[...roster,{slug:'ada',target:'fox'},{slug:'bob',target:'link'}];
 for(let i=0;i<50;i++){const p=planLaunch(schema,fresh(),wide[0],wide,()=>i/50);const slugs=p.ports.filter(x=>x.custom).map(x=>x.character);assert.equal(new Set(slugs).size,slugs.length);assert(schema.fighters.some(f=>'vanilla:'+f.id===p.ports[1].character));}
 // A one-character roster still launches: the random picks fall back to the only fighter.
 const lone=[roster[0]];const p=planLaunch(schema,fresh(),lone[0],lone,()=>0);assert.deepEqual(p.ports.map(x=>x.character),['alan','vanilla:0','alan','alan']);
});
test('random picks on an unused port do not consume costumes',()=>{
 const s=fresh();s.ports[2].device='off';s.ports[3].device='off';
 const p=planLaunch(schema,s,roster[0],roster,()=>0);assert.deepEqual(p.costumes.map(x=>x.character),['alan']);
});
test('custom fighters sharing a moveset get distinct costume exports',()=>{
 const s=fresh();s.ports[1].character='einstein';s.ports[2]={device:'cpu',character:'vanilla:8'};s.ports[3]={device:'cpu',character:'alan'};
 const p=planLaunch(schema,s,roster[0],roster);assert.deepEqual(p.ports.map(x=>x.color),[1,2,0,1]);assert.deepEqual(p.costumes.map(x=>x.filename),['PlMrYe.dat','PlMrBk.dat']);
});
test('reject duplicate controllers, invalid settings and one-player FFA',()=>{
 const s=fresh();s.ports[1].device='keyboard';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/only one/);
 for(const port of s.ports.slice(1))port.device='off';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/at least two/);
 s.ports[1].device='cpu';s.stage=21;assert.throws(()=>planLaunch(schema,s,roster[0],roster),/Invalid/);
 s.stage=31;s.level=10;assert.throws(()=>planLaunch(schema,s,roster[0],roster),/Invalid/);
});
test('random stage never selects unused stage IDs',()=>{
 const s=fresh();assert.equal(s.stage,-1);
 for(let i=0;i<100;i++){const p=planLaunch(schema,s,roster[0],roster,()=>i/100);assert(schema.stages.some(x=>x.id===p.stage));assert(![-1,21,26].includes(p.stage));}
});

test('an explicitly saved stage overrides the random default',()=>{
 const s={...fresh(),stage:31};
 assert.equal(planLaunch(schema,s,roster[0],roster,()=>0).stage,31);
});
