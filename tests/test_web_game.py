import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from opensmash_melee.web_game import GameSetup, ISO_SHA256

class WebGameTests(unittest.TestCase):
    def test_wrong_size_does_not_start_or_touch_game(self):
        with tempfile.TemporaryDirectory() as d:
            setup=GameSetup(d)
            with self.assertRaisesRegex(ValueError,'full, unmodified'):
                setup.receive(io.BytesIO(b'bad'),3)
            self.assertEqual(setup.status()['state'],'missing')
            self.assertFalse(setup.lock.locked())

    def test_interrupted_and_bad_hash_uploads_clean_up_and_allow_retry(self):
        with tempfile.TemporaryDirectory() as d, patch('opensmash_melee.web_game.ISO_SIZE',4):
            setup=GameSetup(d)
            setup.game.mkdir(parents=True)
            (setup.game/'keep').write_text('old game')
            for raw in [b'x',b'nope']:
                with self.assertRaises(ValueError):setup.receive(io.BytesIO(raw),4)
                self.assertFalse(setup.lock.locked())
                self.assertEqual(list(setup.cache.glob('*.iso')),[])
                self.assertEqual((setup.game/'keep').read_text(),'old game')

    def test_restore_checks_all_saved_files(self):
        with tempfile.TemporaryDirectory() as d:
            setup=GameSetup(d);setup.game.mkdir(parents=True)
            asset=setup.game/'data';asset.write_bytes(b'good')
            (setup.cache/'verified.json').write_text(json.dumps({'iso_sha256':ISO_SHA256,'files':{'data':hashlib.sha256(b'good').hexdigest()}}))
            setup.restore();self.assertTrue(setup.ready)
            asset.write_bytes(b'changed')
            reopened=GameSetup(d);reopened.restore()
            self.assertFalse(reopened.ready);self.assertEqual(reopened.state['state'],'error')

    def test_failed_extraction_preserves_previous_game(self):
        with tempfile.TemporaryDirectory() as d:
            setup=GameSetup(d);setup.game.mkdir(parents=True)
            (setup.game/'keep').write_text('old game')
            iso=setup.cache/'test.iso';iso.write_bytes(b'fake')
            setup.lock.acquire();setup.install(iso)
            self.assertFalse(setup.lock.locked());self.assertFalse(iso.exists())
            self.assertEqual((setup.game/'keep').read_text(),'old game')
            self.assertEqual(setup.state['state'],'error')
