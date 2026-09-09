import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import build_native


class NativeROMTests(unittest.TestCase):
    def test_wrong_size_is_rejected_before_hashing(self):
        with tempfile.TemporaryDirectory() as folder:
            rom = Path(folder) / 'wrong.iso'
            rom.write_bytes(b'not a game')
            with patch.object(build_native, 'digest') as digest:
                with self.assertRaisesRegex(ValueError, 'unmodified USA'):
                    build_native.verify_rom(rom)
                digest.assert_not_called()

    def test_full_contents_required_even_when_size_matches(self):
        with tempfile.TemporaryDirectory() as folder:
            rom = Path(folder) / 'game with spaces.gcm'
            rom.write_bytes(b'known')
            with patch.object(build_native, 'ISO_BYTES', 5), patch.object(
                    build_native, 'ISO_SHA256', hashlib.sha256(b'known').hexdigest()):
                self.assertEqual(build_native.verify_rom(rom), rom.resolve())
                rom.write_bytes(b'wrong')
                with self.assertRaisesRegex(ValueError, 'hash does not match'):
                    build_native.verify_rom(rom)

    def test_picker_cancellation_does_not_start_a_build(self):
        with patch.object(build_native.platform, 'system', return_value='Darwin'), patch.object(
                build_native.subprocess, 'run') as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, 'cancelled'):
                build_native.prompt_rom()
            self.assertEqual(run.call_count, 1)


if __name__ == '__main__':
    unittest.main()
