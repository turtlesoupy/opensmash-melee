// Shared numeric protocol for the browser worker and GALE01 launch mod.
export function planLaunch(schema, settings, selected, roster, random = Math.random) {
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!schema.modes.some(m => m.id === settings.mode) ||
      !schema.stages.some(s => s.id === settings.stage) ||
      !integer(settings.level, 1, 9) || !integer(settings.stocks, 1, 99) || !integer(settings.minutes, 0, 99) ||
      !Array.isArray(settings.ports) || settings.ports.length !== 4) throw Error('Invalid launch settings.');
  const kinds = {'captain-falcon':0, fox:2, link:6, luigi:7, mario:8, marth:9};
  const devices = new Set(), used = new Map(), costumes = [];
  const ports = settings.ports.map(p => {
    if (!['keyboard','gamepad0','gamepad1','gamepad2','gamepad3','cpu','off'].includes(p.device)) throw Error('Invalid input device.');
    if (!['cpu','off'].includes(p.device)) {
      if (devices.has(p.device)) throw Error('Assign each keyboard or gamepad to only one player.');
      devices.add(p.device);
    }
    const character = p.character === 'selected' ? selected.slug : p.character;
    const row = roster.find(f => f.slug === character);
    const fighter = character.startsWith('vanilla:') ? Number(character.slice(8)) : kinds[row?.target];
    if (!integer(fighter, 0, 25)) throw Error('Choose a valid fighter for every player.');
    return {device:p.device, character, fighter, color:0, custom:!!row && p.device !== 'off'};
  });
  // Keep the unmodified first costume available when the lineup uses a stock fighter.
  for (const p of ports) if (!p.custom && p.device !== 'off') used.set(p.fighter, new Map([['vanilla',0]]));
  for (const p of ports) if (p.custom) {
    const slots = used.get(p.fighter) || new Map();used.set(p.fighter, slots);
    if (!slots.has(p.character)) {
      const color = slots.size, costume = schema.costumes[p.fighter]?.[color];
      if (!costume) throw Error('This lineup has more custom characters than available costumes.');
      slots.set(p.character, color);costumes.push({character:p.character,fighter:p.fighter,color,filename:costume.filename});
    }
    p.color = slots.get(p.character);
  }
  if (settings.mode === 0 && ports.filter(p => p.device !== 'off').length < 2) throw Error('Free-for-All needs at least two active players.');
  if (settings.mode === 3 && ['cpu','off'].includes(ports[0].device)) throw Error('1P Character Select needs a human on player 1.');
  const stages = schema.stages.filter(s => s.id !== -1);
  const stage = settings.stage === -1 ? stages[Math.min(stages.length-1,Math.floor(random()*stages.length))].id : settings.stage;
  return {...settings,stage,ports,costumes,packedPorts:ports.map(p => p.fighter | ((p.device==='off'?3:p.device==='cpu'?1:0)<<8) | (p.color<<16))};
}
