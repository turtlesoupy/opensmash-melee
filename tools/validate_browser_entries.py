"""Differential-test the actual browser game archive against retained originals."""
import argparse
import hashlib
import json
import os
import subprocess

from build_recomp_browser import BUILD, EMSDK, ROOT, SOURCE, build
from specialize_browser_math import GENERATED


def validate(skip_build=False):
    if not skip_build:
        build(target='opensmash-game')
    output = ROOT / 'build/moderngekko-validation'
    output.mkdir(parents=True, exist_ok=True)
    archive = BUILD / 'libopensmash-game.a'
    executable = output / 'browser-entries-test.js'
    gx = SOURCE / 'vendor/dolphin/GXRuntime'
    command = [str(EMSDK / 'upstream/emscripten/emcc'), '-O3', '-pthread',
               '-ffp-contract=off', '-fno-fast-math',
               '-I' + str(GENERATED), '-I' + str(gx / 'include'),
               str(ROOT / 'tests/browser_entries.c'), str(archive),
               '-sENVIRONMENT=node', '-sSTACK_SIZE=2097152', '-o', str(executable)]
    subprocess.run(command, env=os.environ | {'EM_CONFIG': str(EMSDK / '.emscripten')},
                   check=True)
    result = subprocess.run(['node', str(executable)], capture_output=True,
                            text=True, check=True)
    report = json.loads(result.stdout)
    with archive.open('rb') as stream:
        report['archiveSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    report['specialization'] = json.loads((GENERATED / 'opensmash_entries.json').read_text())
    text = json.dumps(report, indent=2) + '\n'
    (output / 'browser-entries-wasm.json').write_text(text)
    print(text, end='')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true',
                        help='Test the existing archive without reconfiguring or rebuilding')
    validate(parser.parse_args().skip_build)
