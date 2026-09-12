"""Exercise preparation concurrency through the actual HTTP endpoint."""
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request, urlopen

from tools import serve_melee as server


class ParallelPreparation(unittest.TestCase):
    def test_independent_builds_overlap_and_duplicates_reuse_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            catalog = {slug: {'target': 'fox'} for slug in ('first', 'second', 'third', 'fourth', 'fifth')}
            for slug in catalog:
                source = root / 'library' / slug
                source.mkdir(parents=True)
                (source / 'rigged.glb').touch()
            barrier = threading.Barrier(4, timeout=5)
            guard = threading.Lock()
            builds = []
            active = 0
            peak = 0

            def build(args, **kwargs):
                nonlocal active, peak
                ident = args[args.index('--id') + 1]
                with guard:
                    builds.append(ident)
                    active += 1
                    peak = max(peak, active)
                    ordinal = len(builds)
                # The first four builds must overlap; a global lock times out.
                if ordinal <= 4:
                    barrier.wait()
                output = root / 'build/characters' / ident
                output.mkdir(parents=True)
                (output / 'PlFxNr.dat').write_bytes(b'fixture')
                with guard:
                    active -= 1
                return SimpleNamespace(returncode=0, stdout='ok')

            with patch.multiple(server, ROOT=root, CHARACTERS=root/'library',
                                CATALOG=catalog, TOKEN='', SETUP=SimpleNamespace(ready=True),
                                PREPARATION_LOCKS={}, PREPARATION_SLOTS=threading.BoundedSemaphore(4)), \
                 patch.object(server.subprocess, 'run', side_effect=build), \
                 patch('tools.upgrade_character_surfaces.upgrade'), \
                 patch.object(server, 'upgrade_cached_lighting', side_effect=lambda raw: raw):
                http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
                thread = threading.Thread(target=http.serve_forever, daemon=True)
                thread.start()
                try:
                    def prepare(slug):
                        request = Request(f'http://127.0.0.1:{http.server_port}/api/prepare/{slug}',
                                          data=b'{}', method='POST')
                        with urlopen(request, timeout=10) as response:
                            return json.load(response)
                    with ThreadPoolExecutor(max_workers=10) as pool:
                        results = list(pool.map(prepare, [slug for slug in catalog for _ in range(2)]))
                    self.assertEqual(len(results), 10)
                    self.assertCountEqual(builds, [server.cache_id(slug, 'fox', 'fox') for slug in catalog])
                    self.assertEqual(peak, 4)
                finally:
                    http.shutdown()
                    http.server_close()
                    thread.join()
