import {desktop} from '@/lib/desktop';
export default function Controls() {
 const native=!!desktop();
 const rows=[['Move',native?'WASD':'WASD / arrow keys'],['Attack / confirm','J'],['Special / back','K'],['Jump',native?'U / I / Space':'I / Space'],['Shield','Q / E'],['Grab',native?'O':'U'],['Start / pause','Enter'],...(native?[['Smash attack (C-stick)','Arrow keys']]:[])];
 return <>
 <p>Assign your keyboard or Gamepad 1–4 in Players & rules before launching. Click the game window to give it keyboard focus.</p>
 <dl className="controls-list">{rows.map(([action,key])=><div key={action}><dt>{action}</dt><dd>{key}</dd></div>)}</dl>
 <p>{native?'PS5: left stick moves, × attacks / confirms, ○ uses specials / goes back, □ / △ jump, L2 / R2 shield, R1 grabs, right stick performs smash attacks, Options starts / pauses.':'Gamepads: left stick moves, A attacks, B uses specials, X/Y jump. Touch controls appear on touch devices.'}</p>
 </>;
}
