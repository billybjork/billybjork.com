import unittest

from utils.video import sprite_frame_size


class SpriteFrameSizeTests(unittest.TestCase):
    def test_landscape_keeps_long_edge_width(self) -> None:
        self.assertEqual(sprite_frame_size(1920, 1080), (320, 180))
        self.assertEqual(sprite_frame_size(1440, 1080), (320, 240))

    def test_portrait_keeps_long_edge_height(self) -> None:
        width, height = sprite_frame_size(1216, 2160)
        self.assertEqual(height, 320)
        self.assertEqual(width % 2, 0)
        self.assertAlmostEqual(width / height, 1216 / 2160, delta=0.01)

    def test_unknown_dimensions_fall_back_to_16_by_9(self) -> None:
        self.assertEqual(sprite_frame_size(0, 0), (320, 180))


if __name__ == "__main__":
    unittest.main()
