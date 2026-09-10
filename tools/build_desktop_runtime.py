"""Build a versioned native payload independently of the Electron launcher."""
import argparse,hashlib,json,os,platform,plistlib,shutil,subprocess,sys,tarfile
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
    # Apple SDKs before Xcode 26 lack std::jthread. Keep identical cooperative
    # shutdown with C++11 thread/atomic primitives on every supported compiler.
    runner_source=runtime/'tools/moderngekko_run.cpp'
    text=runner_source.read_text()
    text=text.replace('#include <thread>', '#include <thread>\n#include <atomic>')
    text=text.replace('std::jthread signal_watcher([&](std::stop_token stop_token) {', 'std::atomic<bool> stop_watcher{false};\n  std::thread signal_watcher([&]() {')
    text=text.replace('!stop_token.stop_requested()', '!stop_watcher.load()')
    text=text.replace('signal_watcher.request_stop();', 'stop_watcher.store(true);\n  signal_watcher.join();')
    runner_source.write_text(text)
    if sys.platform.startswith('linux'):
        cmake=runtime/'CMakeLists.txt'
        cmake.write_text(cmake.read_text().replace('set(ENABLE_CUBEB OFF CACHE BOOL "" FORCE)', 'set(ENABLE_CUBEB ON CACHE BOOL "" FORCE)'))
    flags=['-DCMAKE_BUILD_TYPE=Release','-DUSE_SYSTEM_LIBS=OFF','-DENABLE_QT=OFF','-DENABLE_TESTS=OFF','-DUSE_DISCORD_PRESENCE=OFF','-DUSE_MGBA=OFF','-DUSE_RETRO_ACHIEVEMENTS=OFF','-DENABLE_AUTOUPDATE=OFF','-DENABLE_ANALYTICS=OFF','-DUSE_UPNP=OFF','-DMODERNGEKKO_GAMECUBE_CONTROLLERS=ON','-DMODERNGEKKO_APP_BUNDLE=OFF','-DOPENSMASH_NATIVE_SOURCE='+str(ROOT/'runtime'),'-DOPENSMASH_DESKTOP_SOURCE='+str(ROOT/'desktop')]
    if os.name=='nt':flags+=['-DCMAKE_CXX_FLAGS=-Wno-microsoft-include']
    if sys.platform=='darwin':flags+=['-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0','-DENABLE_VULKAN=OFF','-DMODERNGEKKO_APP_BUNDLE=ON']
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
        app=out/'Melee Engine.app';mac=app/'Contents/MacOS';mac.mkdir(parents=True,exist_ok=True)
        shutil.move(out/paths['runner'],mac/'MeleeRunner')
        shutil.copytree(out/'Sys',app/'Contents/Resources/Sys',dirs_exist_ok=True)
        paths['runner']='Melee Engine.app/Contents/MacOS/MeleeRunner'
        (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable':'MeleeRunner','CFBundleIdentifier':'fun.smash.melee.engine','CFBundleName':'Melee Engine','CFBundlePackageType':'APPL','CFBundleVersion':'1','LSMinimumSystemVersion':'14.0','NSHighResolutionCapable':True}))
        for p in [out/paths['runner'],out/paths['module'],out/paths['controllers'],out/('dolrecomp'+exe),out/'Mods'/mod.name]:run('codesign','--force','--sign','-',p)
        run('codesign','--force','--sign','-',app)
    hashes={p.relative_to(out).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file() and p.name!='runtime.json'}
    (out/'runtime.json').write_text(json.dumps({'protocol':1,'platform':sys.platform,'architecture':platform.machine(),'sha256':hashes,**paths},indent=2)+'\n')
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('inputs',type=Path);p.add_argument('--output',type=Path,default=ROOT/'build/desktop-runtime');a=p.parse_args();build(a.inputs,a.output)
