import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planLaunch} from '../runtime/web/launch-options.mjs';
const schema=JSON.parse(readFileSync(new URL('../runtime/launch-options.json',import.meta.url)));
const roster=[{slug:'alan',target:'mario'},{slug:'einstein',target:'mario'},{slug:'fox',target:'fox'}];
const fresh=()=>structuredClone(schema.defaults);
test('all five modes preserve numeric launch contract',()=>{
 for(const mode of schema.modes){const s=fresh();s.mode=mode.id;const p=planLaunch(schema,s,roster[0],roster);assert.equal(p.mode,mode.id);assert.deepEqual(p.packedPorts,[8,268,770,777]);}
});
test('custom fighters sharing a moveset get distinct costume exports',()=>{
 const s=fresh();s.ports[1].character='einstein';s.ports[2]={device:'cpu',character:'vanilla:8'};s.ports[3]={device:'cpu',character:'alan'};
 const p=planLaunch(schema,s,roster[0],roster);assert.deepEqual(p.ports.map(x=>x.color),[1,2,0,1]);assert.deepEqual(p.costumes.map(x=>x.filename),['PlMrYe.dat','PlMrBk.dat']);
});
test('reject duplicate controllers, invalid settings and one-player FFA',()=>{
 const s=fresh();s.ports[1].device='keyboard';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/only one/);
 s.ports[1].device='off';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/at least two/);
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
