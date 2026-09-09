"""Build a private Apple Silicon app from a verified, user-selected Melee ROM."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from prepare_moderngekko import CHECKOUT, prepare

ISO_BYTES = 1459978240
ISO_SHA256 = '0de05981a34156b9cedcef73c73d4244ac05cf6149ab3c9cfed917698819e464'
DOL_SHA256 = 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646'


def digest(path):
    hash = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hash.update(block)
    return hash.hexdigest()


def verify_rom(path):
    path = Path(path).expanduser().resolve()
    if not path.is_file() or path.stat().st_size != ISO_BYTES:
        raise ValueError('Choose an unmodified USA v1.02 ISO/GCM (1,459,978,240 bytes).')
    if digest(path) != ISO_SHA256:
        raise ValueError('ROM hash does not match the known USA v1.02 image. Nothing was built.')
    return path


def prompt_rom():
    if platform.system() == 'Darwin':
        result = subprocess.run(['osascript', '-e',
            'POSIX path of (choose file with prompt "Choose your unmodified Melee USA v1.02 ISO or GCM")'],
            capture_output=True, text=True)
        if result.returncode:
            raise ValueError('ROM selection cancelled.')
        return Path(result.stdout.strip())
    return Path(input('Path to your unmodified Melee USA v1.02 ISO/GCM: ').strip().strip('"'))


def run(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=ROOT)


def package(output, character_id=None):
    if output.exists():
        raise ValueError(f'Output already exists; choose another --output: {output}')
    runtime = CHECKOUT / 'ref/ModernGekko'
    for patch in sorted((ROOT / 'runtime/patches/native').glob('*.patch')):
        already = subprocess.run(['git','apply','--reverse','--check',str(patch)],cwd=runtime,capture_output=True)
        if already.returncode:
            subprocess.run(['git','apply','--check',str(patch)],cwd=runtime,check=True)
            subprocess.run(['git','apply',str(patch)],cwd=runtime,check=True)
    build = runtime / 'build-desktop-tools-meleepad'
    app_build = ROOT / 'build/moderngekko-native'
    run('cmake', '-S', runtime, '-B', app_build, '-G', 'Ninja',
        '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0',
        '-DMODERNGEKKO_APP_BUNDLE=ON', '-DMODERNGEKKO_GAMECUBE_CONTROLLERS=ON',
        '-DUSE_SYSTEM_LIBS=OFF', '-DENABLE_VULKAN=OFF', '-DENABLE_QT=OFF',
        '-DENABLE_TESTS=OFF', '-DUSE_DISCORD_PRESENCE=OFF', '-DUSE_MGBA=OFF',
        '-DUSE_RETRO_ACHIEVEMENTS=OFF', '-DENABLE_AUTOUPDATE=OFF',
        '-DENABLE_ANALYTICS=OFF', '-DUSE_UPNP=OFF')
    run('cmake', '--build', app_build, '--target', 'moderngekko-run', '-j', '8')
    template = CHECKOUT / 'ref/ModernGekko-Template'
    pointer = template / 'build/modules-macos14-r2/GALE01/active-module.txt'
    module = Path(pointer.read_text().strip())
    if not module.is_absolute():
        module = template / module
    manifest = (module.parent / 'manifest.txt').read_text().splitlines()
    if f'dol_sha256={DOL_SHA256}' not in manifest:
        raise ValueError('Generated native module does not match the verified executable.')
    extracted = template / 'extracted/Super-Smash-Bros-Melee-GALE01-r2/sys/main.dol'
    if digest(extracted) != DOL_SHA256:
        raise ValueError('Native extraction has the wrong executable.')
    for binary in (app_build / 'moderngekko-run', build / 'dolrecomp', module):
        dependencies = subprocess.check_output(['otool', '-L', str(binary)], text=True)
        if '/opt/homebrew' in dependencies or '/usr/local' in dependencies:
            raise ValueError(f'Nonportable library dependency in {binary}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='native-package-', dir=output.parent) as temporary:
        app = Path(temporary) / output.name
        mac = app / 'Contents/MacOS'; resources = app / 'Contents/Resources'
        mac.mkdir(parents=True); resources.mkdir()
        for source, name in [(app_build / 'moderngekko-run', 'MeleeRunner'),
                             (build / 'dolrecomp', 'dolrecomp'), (module, 'game-module.dylib')]:
            shutil.copy2(source, mac / name)
        # App-bundle runtime resolves resources through CFBundle, independently
        # of the launcher's working directory. No extracted game data is copied.
        shutil.copytree(app_build / 'Sys', resources / 'Sys')
        engine_app = app / 'Contents/Helpers/Melee Engine.app'
        engine_mac = engine_app / 'Contents/MacOS'; engine_mac.mkdir(parents=True)
        engine_resources = engine_app / 'Contents/Resources'; engine_resources.mkdir()
        shutil.move(mac / 'MeleeRunner', engine_mac / 'MeleeRunner')
        shutil.copytree(app_build / 'Sys', engine_resources / 'Sys')
        (engine_app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleExecutable':'MeleeRunner', 'CFBundleIdentifier':'local.opensmash.melee.engine',
            'CFBundleName':'Melee Engine', 'CFBundlePackageType':'APPL', 'CFBundleVersion':'1',
            'LSMinimumSystemVersion':'14.0', 'NSHighResolutionCapable':True}))
        mods = resources / 'Mods'; mods.mkdir()
        run('xcrun', 'clang', '-dynamiclib', '-O2', '-std=c11', '-mmacosx-version-min=14.0',
            '-I', runtime / 'include', ROOT / 'runtime/mods/launch_match.c',
            '-o', mods / 'opensmash_launch.mgm.dylib')
        info = {'isoSha256': ISO_SHA256, 'isoBytes': ISO_BYTES, 'dolSha256': DOL_SHA256,
                'moduleSha256': digest(module), 'fighter': 8, 'costume': '', 'costumeSha256': '',
                'character': 'Mario', 'privateBuild': True,
                'upstream': json.loads((ROOT / 'runtime/upstream.json').read_text())}
        if character_id:
            if not character_id.replace('-', '').replace('_', '').isalnum():
                raise ValueError('Invalid character identifier.')
            folder = ROOT / 'build/characters' / character_id
            candidates = list(folder.glob('Pl*Nr.dat'))
            if len(candidates) != 1:
                raise ValueError('Build the native character first with tools/build_character.py.')
            costume = candidates[0]
            kinds = {'PlMrNr.dat':8, 'PlLgNr.dat':7, 'PlCaNr.dat':0,
                     'PlFxNr.dat':2, 'PlMsNr.dat':9, 'PlLkNr.dat':6}
            if costume.name not in kinds:
                raise ValueError('Unsupported native costume slot.')
            sys.path.insert(0, str(ROOT))
            from opensmash_melee.archive import Archive
            Archive.read(costume)
            shutil.copy2(costume, resources / costume.name)
            info.update(fighter=kinds[costume.name], costume=costume.name,
                        costumeSha256=digest(costume), character=character_id)
        shutil.copy2(ROOT / 'runtime/launch-options.json', resources / 'launch-options.json')
        sys.path.insert(0, str(ROOT))
        from opensmash_melee.costume_variant import costume_variant, SCHEMA
        catalog_path = ROOT / 'web/public/catalog.json'
        catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else []
        characters = []
        ids = {('web-v1-' + hashlib.sha256(r['slug'].encode()).hexdigest()[:16]): r for r in catalog}
        folders = sorted((ROOT / 'build/characters').glob('web-v1-*'))
        if character_id and ROOT / 'build/characters' / character_id not in folders:
            folders.append(ROOT / 'build/characters' / character_id)
        kinds = {slots[0]['filename']:int(k) for k, slots in SCHEMA['costumes'].items()}
        for folder in folders:
            candidates = list(folder.glob('Pl*Nr.dat'))
            if len(candidates) != 1 or candidates[0].name not in kinds: continue
            source = candidates[0]; fighter = kinds[source.name]
            row = ids.get(folder.name, {'slug':folder.name, 'name':folder.name})
            variants = []
            for color, slot in enumerate(SCHEMA['costumes'][str(fighter)]):
                name = 'Characters/' + folder.name + '/' + slot['filename']
                target = resources / name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(costume_variant(source.read_bytes(), fighter, color))
                variants.append({'filename':slot['filename'], 'path':name, 'sha256':digest(target)})
            characters.append({'slug':row['slug'], 'name':row['name'], 'fighter':fighter, 'costumes':variants})
        info['characters'] = characters
        info['selected'] = ids.get(character_id, {}).get('slug', character_id) if character_id else 'vanilla:8'
        # All lineups start from the verified, unmodified imported game.
        info.update(costume='', costumeSha256='')
        shutil.copy2(CHECKOUT / 'apple/macos/default-GCPadNew.ini', resources / 'GCPadNew.ini')
        run('xcrun', 'swiftc', '-O', '-target', 'arm64-apple-macos14.0',
            *[ROOT / 'runtime/native' / name for name in ('main.swift','LaunchOptions.swift','Controllers.swift','Launcher.swift')], '-o', mac / 'OpenSmashMelee')
        # Signing changes Mach-O bytes. Record the final signed module, then sign
        # the enclosing bundle without rewriting its nested binaries again.
        for binary in (engine_mac / 'MeleeRunner', mac / 'dolrecomp', mac / 'game-module.dylib',
                       mac / 'OpenSmashMelee', mods / 'opensmash_launch.mgm.dylib'):
            run('codesign', '--force', '--sign', '-', binary)
        run('codesign', '--force', '--sign', '-', engine_app)
        info['moduleSha256'] = digest(mac / 'game-module.dylib')
        (resources / 'build.json').write_text(json.dumps(info, indent=2) + '\n')
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleExecutable':'OpenSmashMelee', 'CFBundleIdentifier':'local.opensmash.melee',
            'CFBundleName':'OpenSmash Melee', 'CFBundleDisplayName':'OpenSmash Melee',
            'CFBundlePackageType':'APPL', 'CFBundleVersion':'1', 'CFBundleShortVersionString':'0.1',
            'LSMinimumSystemVersion':'14.0', 'NSHighResolutionCapable':True}))
        notices = resources / 'Source Notices'; notices.mkdir()
        for source, name in [(runtime / 'LICENSE', 'ModernGekko-LICENSE'),
                             (CHECKOUT / 'LICENSE', 'MeleePad-LICENSE')]:
            if source.is_file(): shutil.copy2(source, notices / name)
        (notices / 'BUILD.txt').write_text(
            'Private local build from a user-supplied Melee ROM.\n'
            'Share the build scripts, not this generated game module or costume archive.\n'
            'Pinned source revisions are in ../build.json.\n')
        run('codesign', '--force', '--sign', '-', app)
        run('codesign', '--verify', '--deep', '--strict', app)
        app.rename(output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rom', type=Path, help='Omit to open the ROM picker before any build work.')
    parser.add_argument('--output', type=Path, default=ROOT / 'build/native/OpenSmash Melee.app')
    parser.add_argument('--character-id', help='Optional existing native character build identifier.')
    parser.add_argument('--reuse-build', action='store_true', help='Package an already prepared, hash-checked native module.')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    try:
        rom = verify_rom(args.rom or prompt_rom())
        print('Verified Melee USA v1.02 SHA-256.', flush=True)
        if args.verify_only: return
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise ValueError('This native build currently supports Apple Silicon macOS 14+. Windows/Linux are not validated.')
        for command in ('git', 'cmake', 'ninja', 'xcrun', 'codesign'):
            if not shutil.which(command): raise ValueError(f'Install the build dependency: {command}')
        if not args.reuse_build: prepare(rom)
        print(package(args.output.expanduser().resolve(), args.character_id))
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
