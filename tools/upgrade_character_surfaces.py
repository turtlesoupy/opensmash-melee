"""Atomically rebuild cached custom costumes with current surface corrections."""
import argparse
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.__main__ import ROOT, atomic_write, digest
from opensmash_melee.surfaces import SURFACE_VERSION, refine_profile


def upgrade(ident):
    from opensmash_melee.archive import Archive
    from opensmash_melee.glb import GLB
    from opensmash_melee.skeleton import joints
    from opensmash_melee.retarget import conform
    from opensmash_melee.gx import replace_costume
    from PIL import Image
    if not ident or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in ident):
        raise ValueError('Invalid character identifier')
    output=ROOT/'build/characters'/ident;profile_path=output/'profile.json'
    old=json.loads(profile_path.read_text())
    if old.get('surface_version',0)>=SURFACE_VERSION:return False
    source=ROOT/'assets/characters'/ident/'rigged.glb'
    if old.get('source_glb_sha256')!=digest(source):raise ValueError('Cached source hash mismatch')
    native=list(output.glob('Pl*Nr.dat'))
    if len(native)!=1:raise ValueError('Expected one neutral native costume')
    original=ROOT/'assets/game/files'/native[0].name
    if old['costume_sha256']!=digest(original):raise ValueError('Original costume hash mismatch')
    archive=Archive.read(original);skeleton=joints(archive,old['symbol']);mesh=GLB(source).mesh()
    profile=refine_profile(mesh,skeleton,old);fitted=conform(mesh,skeleton,profile)
    fitted['image']=fitted['image'].resize((profile['texture_size'],)*2,Image.Resampling.LANCZOS)
    profile_bytes=(json.dumps(profile,indent=2)+'\n').encode()
    import hashlib
    replacements={profile_path:profile_bytes}
    for browser in (False,True):
        path=output/('browser' if browser else '')/native[0].name
        if browser and not path.exists():continue
        if browser:
            from opensmash_melee.browser_skin import build_costume
            raw,stats=build_costume(original.read_bytes(),fitted,skeleton,profile)
        else:
            a=Archive.read(original)
            stats=replace_costume(a,fitted,skeleton,profile);raw=a.serialize()
        stats.update(output_sha256=hashlib.sha256(raw).hexdigest(),output_bytes=len(raw),
                     source_costume_sha256=digest(original),source_glb_sha256=digest(source),
                     profile_sha256=hashlib.sha256(profile_bytes).hexdigest(),surface_version=SURFACE_VERSION,
                     status='requires_gameplay_review')
        replacements[path]=raw
        replacements[path.with_suffix('.dat.json')]=(json.dumps(stats,indent=2)+'\n').encode()
    backup=output/'previous-surfaces'/digest(profile_path)[:16]
    for path in replacements:
        if path.exists():
            saved=backup/path.relative_to(output);saved.parent.mkdir(parents=True,exist_ok=True)
            if not saved.exists():shutil.copy2(path,saved)
    # Commit the profile last. A retry after interruption rebuilds all files.
    for path,raw in replacements.items():
        if path!=profile_path:atomic_write(path,raw)
    atomic_write(profile_path,profile_bytes)
    return True

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('id')
    args=p.parse_args();print('upgraded' if upgrade(args.id) else 'current')
