"""Transactional, local-only installation of the user's verified game disc."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import uuid
from .__main__ import atomic_write

ISO_SIZE = 1459978240
ISO_SHA256 = '0de05981a34156b9cedcef73c73d4244ac05cf6149ab3c9cfed917698819e464'
DOL_SHA256 = 'dc21504513424350bda17a7c65e82371b45112a5dfc1e9f2749a8b7ab0eff646'

class GameSetup:
    def __init__(self, root):
        self.root = Path(root)
        self.game = self.root / 'assets/game'
        self.cache = self.root / 'build/web-game'
        self.cache.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.state = {'state': 'missing', 'message': 'Choose your Melee USA 1.02 ISO or GCM to get started.'}
        self.ready = False

    def status(self):
        return {**self.state, 'ready': self.ready}

    def progress(self, state, message, progress=None):
        self.state = {'state': state, 'message': message, 'progress': progress}

    def verify_files(self, manifest):
        files = manifest['files']
        if manifest['iso_sha256'] != ISO_SHA256 or not files:
            raise ValueError('Saved game verification is invalid. Choose your ISO again.')
        for name, digest in files.items():
            path = (self.game / name).resolve()
            if not path.is_relative_to(self.game.resolve()):
                raise ValueError('Saved game paths are invalid.')
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise ValueError('Saved game files changed. Choose your ISO to repair them.')
        return files

    def restore(self):
        receipt = self.cache / 'verified.json'
        if not receipt.exists():
            return
        with self.lock:
            self.ready = False
            self.progress('checking', 'Checking your saved game…')
            try:
                self.verify_files(json.loads(receipt.read_text()))
                self.ready = True
                self.progress('ready', 'Melee USA 1.02 is ready.')
            except Exception:
                self.progress('error', 'Saved game files are missing or changed. Choose your ISO to repair them.')

    def use_existing(self, iso):
        """CLI setup still verifies the complete original image before serving."""
        with Path(iso).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != ISO_SHA256:
                raise ValueError('Game image does not match the known USA 1.02 hash.')
        if hashlib.sha256((self.game / 'sys/main.dol').read_bytes()).hexdigest() != DOL_SHA256:
            raise ValueError('Extracted game executable does not match the runtime.')
        self.ready = True
        self.progress('ready', 'Melee USA 1.02 is ready.')

    def receive(self, stream, size):
        if size != ISO_SIZE:
            raise ValueError('Choose a full, unmodified Melee USA 1.02 ISO or GCM (1,459,978,240 bytes). RVZ, ZIP and patched images are not supported.')
        if shutil.disk_usage(self.cache).free < size * 2:
            raise ValueError('Not enough free disk space. Free at least 3 GB for disc setup and try again.')
        if not self.lock.acquire(blocking=False):
            raise ValueError('Game setup is already in progress.')
        try:
            self.progress('receiving', 'Copying your disc to this computer…', 0)
            with tempfile.NamedTemporaryFile(dir=self.cache, suffix='.iso', delete=False) as output:
                path = Path(output.name)
                digest = hashlib.sha256()
                remaining = size
                try:
                    while remaining:
                        chunk = stream.read(min(8 << 20, remaining))
                        if not chunk:
                            raise ValueError('The transfer was interrupted. Choose the file and try again.')
                        output.write(chunk)
                        digest.update(chunk)
                        remaining -= len(chunk)
                        self.progress('receiving', 'Copying and verifying your disc…', (size-remaining)/size)
                    if digest.hexdigest() != ISO_SHA256:
                        raise ValueError('This disc does not match unmodified Melee USA 1.02. Choose the original ISO or GCM; your current setup has not been replaced.')
                except Exception:
                    output.close()
                    path.unlink(missing_ok=True)
                    raise
            self.progress('installing', 'Preparing game files. You can leave this page open…')
            threading.Thread(target=self.install, args=(path,), daemon=True).start()
        except Exception as error:
            self.progress('error', str(error))
            self.lock.release()
            raise

    def install(self, iso):
        staging = None
        try:
            self.game.parent.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix='.web-game-', dir=self.game.parent))
            tool = self.root / ('melee/build/tools/dtk.exe' if os.name == 'nt' else 'melee/build/tools/dtk')
            command=[str(tool), 'disc', 'extract', '--quiet', str(iso), str(staging)]
            if os.environ.get('OPENSMASH_RUNTIME'):
                tool=Path(os.environ['OPENSMASH_RUNTIME'])/('dolrecomp.exe' if os.name=='nt' else 'dolrecomp')
                command=[str(tool),'extract',str(iso),str(staging)]
            if not tool.is_file():raise ValueError('The local installation is missing the disc extractor. Install the complete release tools and try again.')
            result = subprocess.run(command, capture_output=True, text=True, timeout=300)
            if result.returncode:
                raise ValueError('Disc extraction failed. Check free disk space and try again.')
            if hashlib.sha256((staging/'sys/main.dol').read_bytes()).hexdigest() != DOL_SHA256:
                raise ValueError('Extracted executable failed verification.')
            files = {}
            for path in staging.rglob('*'):
                if path.is_file():
                    with path.open('rb') as stream:
                        files[path.relative_to(staging).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
            # Keep the previous installation until extraction and verification succeed.
            backup = self.cache / ('previous-' + uuid.uuid4().hex)
            if self.game.exists():
                self.game.rename(backup)
            try:
                staging.rename(self.game)
                atomic_write(self.cache/'verified.json', json.dumps({'iso_sha256': ISO_SHA256, 'files': files}).encode())
            except Exception:
                if self.game.exists():
                    shutil.rmtree(self.game)
                if backup.exists():
                    backup.rename(self.game)
                raise
            if backup.exists():
                shutil.rmtree(backup)
            self.ready = True
            self.progress('ready', 'Melee USA 1.02 is ready. Choose a mode and fighter.')
        except Exception as error:
            self.progress('error', str(error) if isinstance(error, ValueError) else 'Could not prepare the game. Check disk space and try again.')
        finally:
            iso.unlink(missing_ok=True)
            if staging and staging.exists():
                shutil.rmtree(staging)
            self.lock.release()
