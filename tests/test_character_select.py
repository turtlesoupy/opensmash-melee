import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
import wave

import numpy as np
from PIL import Image
from opensmash_melee.archive import Archive
from opensmash_melee.character_select import (catalog_identities, dsp_clip,
    extend_menu, extend_sound_bank, SYMBOL, SAMPLE_BASE)

ROOT = Path(__file__).resolve().parents[1]


class CharacterSelectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name)
        (self.source / 'character.json').write_text(json.dumps({'display': 'Test Fighter', 'short': 'TEST'}))
        Image.new('RGBA', (80, 100), 'red').save(self.source / 'portrait_raw.png')
        self.samples = (np.sin(np.arange(3200) * .12) * 12000).astype('<i2')
        with wave.open(str(self.source / 'announcer.wav'), 'wb') as wav:
            wav.setparams((1, 2, 32000, 0, 'NONE', 'not compressed'))
            wav.writeframes(self.samples.tobytes())

    def test_announcer_roundtrip_preserves_duration_rate_and_signal(self):
        raw, rate, count, coefficients = dsp_clip(self.source / 'announcer.wav')
        decoded, h1, h2 = [], 0, 0
        for start in range(0, len(raw), 8):
            block = raw[start:start + 8]
            c1, c2 = coefficients[block[0] >> 4]
            scale = 1 << (block[0] & 15)
            for byte in block[1:]:
                for n in (byte >> 4, byte & 15):
                    if n >= 8: n -= 16
                    value = max(-32768, min(32767, ((c1 * h1 + c2 * h2 + 1024) >> 11) + n * scale))
                    decoded.append(value)
                    h2, h1 = h1, value
        self.assertEqual((rate, count), (32000, len(self.samples)))
        error = np.mean((np.array(decoded[:count]) - self.samples.astype(float)) ** 2)
        self.assertGreater(10 * np.log10(np.mean(self.samples.astype(float) ** 2) / error), 35)

    def test_sound_bank_preserves_existing_entries_and_samples(self):
        header = bytes(72)
        samples = bytes(range(32))
        original = struct.pack('>4I', 72, 32, 1, 100) + header + bytes(8) + samples
        raw, ids = extend_sound_bank(original, [self.source, self.source])
        size, sample_size, count, base = struct.unpack_from('>4I', raw)
        self.assertEqual(ids, [SAMPLE_BASE + 1, SAMPLE_BASE + 2])
        self.assertEqual((count, base), (3, SAMPLE_BASE))
        self.assertEqual(raw[16:88], header)
        start = (size + 16 + 31) & ~31
        self.assertEqual(raw[start:start + 32], samples)
        self.assertEqual(start + sample_size, len(raw))
        for index in range(2):
            entry = 16 + 72 * (index + 1)
            self.assertEqual(struct.unpack_from('>II', raw, entry), (1, 32000))
            loop, end, current = struct.unpack_from('>III', raw, entry + 12)
            self.assertEqual(loop, current)
            self.assertLess(current, end)
            self.assertLess(end, sample_size * 2)

    @unittest.skipUnless((ROOT / 'assets/game/files/MnSlChr.usd').exists(), 'Requires local verified game')
    def test_menu_relocation_pages_and_original_joint_indices(self):
        from opensmash_melee.skeleton import joints
        original = (ROOT / 'assets/game/files/MnSlChr.usd').read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        raw = extend_menu(original, [(8, 1, self.source), (8, 2, self.source), (2, 0, self.source)], [318, 319, 320])
        a, old = Archive(raw), Archive(original)
        record = a.roots()[SYMBOL]
        self.assertEqual(a.unpack('4I', record), (0x4F534353, 1, 3, 3))
        self.assertEqual([a.u32(record + 16 + i * 32 + 8) for i in range(3)], [1, 2, 1])
        for offset in (64, 112):
            for archive in (a, old):
                archive.public.append((archive.ptr(offset), len(archive.strings)))
                archive.strings += b'test_root\0'
            before, after = joints(old, 'test_root'), joints(a, 'test_root')
            self.assertEqual([j['offset'] for j in before], [j['offset'] for j in after[:-2]])
            self.assertEqual([j['position'][0] for j in after[-2:]], [-27, 27])
        self.assertEqual(hashlib.sha256(original).hexdigest(), digest)
        with self.assertRaisesRegex(ValueError, 'original menu'):
            extend_menu(raw, [], [])

    @unittest.skipUnless((ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include/moderngekko/mod_abi.h').exists(), 'Requires runtime headers')
    def test_actual_runtime_callbacks(self):
        import shutil
        import subprocess
        compiler = shutil.which('clang') or shutil.which('cc')
        if not compiler: self.skipTest('Requires a C compiler')
        executable = self.source / 'css-test'
        subprocess.run([compiler, '-std=c11', '-I', str(ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'),
                        str(ROOT / 'tests/character_select_runtime.c'), '-lm', '-o', str(executable)], check=True, capture_output=True)
        subprocess.run([str(executable)], check=True, capture_output=True)

    def test_native_rejects_old_runtime_before_staging_rebased_audio(self):
        import threading
        from types import SimpleNamespace
        from unittest.mock import patch
        from opensmash_melee.native_service import NativeService
        service = NativeService.__new__(NativeService)
        service.lock = threading.Lock()
        service.manifest = {}
        service.cancelled = set()
        service.setup = SimpleNamespace(ready=True)
        service.process = None
        service.validate = lambda plan: ([], [(self.source, 'PlMrNr.dat')])
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'Update the desktop runtime'):
                service.launch({'session': '00000000-0000-0000-0000-000000000001'})

    def test_catalog_rejects_ambiguous_slots_and_wrong_movesets(self):
        catalog = {'test': {'slug': 'test', 'target': 'mario'}}
        entry = {'character': 'test', 'fighter': 8, 'color': 1, 'filename': 'PlMrYe.dat'}
        self.assertEqual(catalog_identities(self.source, catalog, [entry])[0][:2], (8, 1))
        for entries in ([entry, entry], [{**entry, 'fighter': 2}], [{**entry, 'color': True}], [{**entry, 'filename': '../x'}]):
            with self.assertRaises(ValueError): catalog_identities(self.source, catalog, entries)


if __name__ == '__main__': unittest.main()
