import schema from '../../runtime/launch-options.json';
import {planLaunch} from '../../runtime/web/launch-options.mjs';
import type {Fighter} from '../app/page';
export {schema};
export type Settings=typeof schema.defaults;
export const defaults=()=>structuredClone(schema.defaults);
export function loadSettings():Settings {try{return {...defaults(),...JSON.parse(localStorage.getItem('melee-launch-v1')||'{}')};}catch{return defaults();}}
export function plan(settings:Settings,selected:Fighter,roster:Fighter[]){return planLaunch(schema,settings,selected,roster);}
