import unittest
import numpy as np
from PIL import Image
from opensmash_melee.gx import rgba8


class TexturePackingTests(unittest.TestCase):
    def test_matches_gx_tile_and_channel_order(self):
        rng = np.random.default_rng(42)
        for width, height in ((4, 4), (8, 12), (64, 56), (160, 192), (512, 512)):
            with self.subTest(size=(width, height)):
                pixels = rng.integers(0, 256, (height, width, 4), dtype=np.uint8)
                expected = bytearray()
                for y in range(0, height, 4):
                    for x in range(0, width, 4):
                        tile = pixels[y:y+4, x:x+4].reshape(16, 4)
                        expected.extend(tile[:, [3, 0]].tobytes())
                        expected.extend(tile[:, [1, 2]].tobytes())
                self.assertEqual(rgba8(Image.fromarray(pixels)), bytes(expected))
