"""Build a versioned native payload independently of the Electron launcher."""
import argparse,hashlib,json,os,platform,shutil,subprocess,sys,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def run(*args):subprocess.run(list(map(str,args)),check=True)
def build(inputs,out):
    source=ROOT/'build/desktop-runtime-source';source.mkdir(parents=True,exist_ok=True)
    with tarfile.open(inputs) as archive:archive.extractall(source,filter='data')
    manifest=json.loads((source/'inputs.json').read_text())
    for name,digest in manifest['sha256'].items():
        path=(source/name).resolve()
        if not path.is_relative_to(source.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise ValueError('Build input integrity failure: '+name)
    runtime=source/'runtime';host=ROOT/'build/desktop-runtime-host';module=ROOT/'build/desktop-runtime-module'
    flags=['-DCMAKE_BUILD_TYPE=Release','-DUSE_SYSTEM_LIBS=OFF','-DENABLE_QT=OFF','-DENABLE_TESTS=OFF','-DUSE_DISCORD_PRESENCE=OFF','-DUSE_MGBA=OFF','-DUSE_RETRO_ACHIEVEMENTS=OFF','-DENABLE_AUTOUPDATE=OFF','-DENABLE_ANALYTICS=OFF','-DUSE_UPNP=OFF','-DMODERNGEKKO_GAMECUBE_CONTROLLERS=ON','-DMODERNGEKKO_APP_BUNDLE=OFF','-DOPENSMASH_NATIVE_SOURCE='+str(ROOT/'runtime'),'-DOPENSMASH_DESKTOP_SOURCE='+str(ROOT/'desktop')]
    if sys.platform=='darwin':flags+=['-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0','-DENABLE_VULKAN=OFF']
    run('cmake','-S',runtime,'-B',host,'-G','Ninja',*flags)
    jobs=str(min(os.cpu_count() or 2,8))
    run('cmake','--build',host,'--target','moderngekko-run','dolrecomp','opensmash-launch','opensmash-controllers','-j',jobs)
    run('cmake','-S',runtime/'vendor/dolphin/module-template','-B',module,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DGAME_ID=GALE01','-DGENERATED_DIR='+str(source/'generated'),'-DRECOMPCORE_MODULE_ENABLE_IPO=OFF',*(['-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0'] if sys.platform=='darwin' else []))
    run('cmake','--build',module,'-j',jobs)
    out.mkdir(parents=True,exist_ok=True);(out/'Mods').mkdir(exist_ok=True)
    exe='.exe' if os.name=='nt' else '';lib='.dll' if os.name=='nt' else '.dylib' if sys.platform=='darwin' else '.so'
    paths={'runner':'moderngekko-run'+exe,'module':'gGALE01_recomp'+lib,'controllers':'opensmash-controllers'+exe}
    for name in [paths['runner'],paths['controllers']]:shutil.copy2(host/name,out/name)
    shutil.copy2(module/paths['module'],out/paths['module'])
    dol=next(p for p in host.rglob('dolrecomp'+exe) if p.is_file());shutil.copy2(dol,out/('dolrecomp'+exe))
    mod=next(host.glob('opensmash_launch.mgm.*'));shutil.copy2(mod,out/'Mods'/mod.name)
    shutil.copytree(host/'Sys',out/'Sys',dirs_exist_ok=True)
    if os.name=='nt':
        for p in host.rglob('*.dll'):shutil.copy2(p,out/p.name)
    if sys.platform=='darwin':
        for p in [out/paths['runner'],out/paths['module'],out/paths['controllers'],out/('dolrecomp'+exe),out/'Mods'/mod.name]:run('codesign','--force','--sign','-',p)
    hashes={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name!='runtime.json'}
    (out/'runtime.json').write_text(json.dumps({'protocol':1,'platform':sys.platform,'architecture':platform.machine(),'sha256':hashes,**paths},indent=2)+'\n')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('inputs',type=Path);p.add_argument('--output',type=Path,default=ROOT/'build/desktop-runtime');a=p.parse_args();build(a.inputs,a.output)
