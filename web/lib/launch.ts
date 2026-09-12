import {preferences} from '@/lib/desktop';
import schema from '../../runtime/launch-options.json';
import {planLaunch} from '../../runtime/web/launch-options.mjs';
import type {Fighter} from '../app/page';
export {schema};
export type Settings=typeof schema.defaults;
export const defaults=()=>structuredClone(schema.defaults);
// The alpha shipped with a single Peach CPU as the default lineup; saved copies of that
// lineup follow the new random default rather than pinning players to the old one.
const legacyPorts=JSON.stringify([{device:'keyboard',character:'selected'},{device:'cpu',character:'vanilla:12'},{device:'off',character:'vanilla:2'},{device:'off',character:'vanilla:9'}]);
export function loadSettings():Settings {try{
 const saved=JSON.parse(preferences.getItem('melee-launch-v1')||'{}');
 if(JSON.stringify(saved.ports)===legacyPorts)delete saved.ports;
 return {...defaults(),...saved};
}catch{return defaults();}}
export function plan(settings:Settings,selected:Fighter,roster:Fighter[]){return planLaunch(schema,settings,selected,roster);}
