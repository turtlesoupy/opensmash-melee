"""Import, fit and build an existing OpenSmash character as a Melee costume."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.__main__ import ROOT, import_character, dump
from tools.fit_mario_profile import fit
from tools.stage_costume import stage
from opensmash_melee.multi_fighter import TARGETS as STABLE_TARGETS, load_target, fit as fit_target
from opensmash_melee.retarget_probe import TARGETS as ROSTER_TARGETS
TARGETS = {slug:(code,kind,slug) for slug,code,kind in ROSTER_TARGETS}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path,help='Original generation directory with rigged.glb and presentation assets')
    p.add_argument('--id',required=True,help='New local character identifier')
    p.add_argument('--stage',action='store_true',help='Also create a separate bootable game directory')
    p.add_argument('--target',choices=TARGETS,default='mario',help='Melee moveset to use in the actual game')
    p.add_argument('--head-style',choices=['source','uniform'],default='source')
    a=p.parse_args()
    if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',a.id):p.error('Use a lowercase identifier, at most 64 characters')
    imported=ROOT/'assets/characters'/a.id;out=ROOT/'build/characters'/a.id
    if imported.exists() or out.exists():p.error('Identifier already exists; choose a new revision identifier')
    filename=f'Pl{TARGETS[a.target][0]}Nr.dat'
    costume=ROOT/'assets/game/files'/filename
    if not costume.exists():p.error('Prepare the validated game first')
    if a.target!='mario' and a.head_style!='source':
        p.error('Other fighters currently use source head proportions')
    import_character(a.source,imported)
    from opensmash_melee.glb import GLB
    from opensmash_melee.archive import Archive
    from opensmash_melee.skeleton import joints
    from opensmash_melee.retarget import conform
    from tools.validate_shape import shape_metrics
    mesh=GLB(imported/'rigged.glb').mesh()
    if a.target=='mario':
        profile=fit(imported,costume,a.head_style)
    elif a.target not in STABLE_TARGETS:
        from opensmash_melee.roster_fit import profile_for
        from opensmash_melee.__main__ import digest
        profile=profile_for(mesh, ROOT/'assets/game/files', a.target)
        profile.update(costume_sha256=digest(costume),source_glb_sha256=digest(imported/'rigged.glb'),status='requires_gameplay_review')
    else:
        from opensmash_melee.__main__ import digest
        target=load_target(ROOT/'assets/game/files',a.target)
        profile=fit_target(mesh,target)
        profile.update(symbol=target['symbol'],costume_sha256=digest(costume),
                       source_glb_sha256=digest(imported/'rigged.glb'),
                       mesh_joint=0,mesh_dobj=0,
                       head_style='source',fit_version=6,
                       status='requires_gameplay_review')
    skeleton=joints(Archive.read(costume),profile['symbol'])
    shape=shape_metrics(mesh,conform(mesh,skeleton,profile),profile,skeleton)
    dump(out/'shape.json',shape)
    if not profile.get('ball_fit') and (shape['head_anisotropy']>1.03 or shape['similarity_max_relative_error']>.025
        or (a.head_style=='source' and shape['head_fraction_relative_error']>.05)):
        p.error('Source-shape check needs manual review; see '+str(out/'shape.json'))
    dump(out/'profile.json',profile)
    subprocess.run([sys.executable,'-m','opensmash_melee','convert',str(imported),
                    '--costume',str(costume),'--profile',str(out/'profile.json'),
                    '--out',str(out/filename)],cwd=ROOT,check=True)
    if a.stage:
        dol=ROOT/'build/engine-linux/build/GALE01/main.dol'
        stage(ROOT/'assets/game',out/filename,out/'game',filename,dol)
        print('Launch: python3 tools/launch_dolphin.py '+str(out/'game/sys/main.dol'))
    print('Built experimental character: '+str(out))
    print('This build requires in-game review; build success is not a parity certificate.')


if __name__=='__main__':main()
