"""Crop-window location on synthetic stacked captures. No checkpoint or park photos needed."""
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from .crop import locate_crop, mark_crop

TOP, BOTTOM = [0, 64, 4096, 3200], [0, 3264, 4096, 6336]


def scene(seed):
    """A bottom-panel sized greyscale picture with enough corners and blobs to match on."""
    rng = np.random.default_rng(seed)
    image = cv2.resize(rng.integers(60, 190, (96, 128), dtype=np.uint8), (4096, 3072), interpolation=cv2.INTER_CUBIC)
    for _ in range(500):
        x, y = int(rng.integers(0, 4096)), int(rng.integers(0, 3072))
        size, shade = int(rng.integers(30, 220)), int(rng.integers(0, 256))
        if rng.random() < 0.5:
            cv2.rectangle(image, (x, y), (x + size, y + size // 2), shade, -1)
        else:
            cv2.circle(image, (x, y), size // 2, shade, -1)
    return image


class CropTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wide = scene(1)

    def capture(self, top_panel):
        """Write a 4096 x 6336 capture whose top panel is `top_panel` stretched to the panel size."""
        image = np.full((6336, 4096), 128, np.uint8)
        image[64:3200] = cv2.resize(top_panel, (4096, 3136), interpolation=cv2.INTER_CUBIC)
        image[3264:6336] = self.wide
        path = Path(self.enterContext(tempfile.TemporaryDirectory())) / "image"
        cv2.imencode(".jpg", image)[1].tofile(path)
        return path

    def window(self, x1, y1, x2, y2):
        return self.capture(self.wide[y1 - 3264:y2 - 3264, x1:x2])

    def test_uniform_and_edge_cut_windows(self):
        # The second window is cut short by the bottom edge, so it is stretched vertically only.
        for expected in ([800, 4164, 3296, 6075], [1100, 4864, 3596, 6336]):
            with self.subTest(expected=expected):
                path = self.window(*expected)
                found = locate_crop(path, TOP, BOTTOM)
                self.assertIsNotNone(found)
                self.assertLess(max(abs(a - b) for a, b in zip(found, expected)), 6)
                self.assertTrue(BOTTOM[0] <= found[0] < found[2] <= BOTTOM[2]
                                and BOTTOM[1] <= found[1] < found[3] <= BOTTOM[3])
                panels = [dict(id="top", box=TOP), dict(id="bottom", box=BOTTOM)]
                mark_crop(panels, path)
                self.assertEqual((panels[0]["crop_of"], panels[0]["source_box"]), ("bottom", found))
                self.assertEqual(panels[1], dict(id="bottom", box=BOTTOM))

    def test_unrelated_panels_and_other_layouts_stay_unmarked(self):
        path = self.capture(scene(2))
        self.assertIsNone(locate_crop(path, TOP, BOTTOM))
        panels = [dict(id="top", box=TOP), dict(id="bottom", box=BOTTOM)]
        mark_crop(panels, path)
        self.assertEqual(panels, [dict(id="top", box=TOP), dict(id="bottom", box=BOTTOM)])
        single = [dict(id="single", box=[0, 64, 4096, 3136])]
        mark_crop(single, None)
        self.assertEqual(single, [dict(id="single", box=[0, 64, 4096, 3136])])


if __name__ == "__main__":
    unittest.main()
