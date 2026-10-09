import unittest

from utils.content import ProjectInfo


class ProjectCardInfoTests(unittest.TestCase):
    def test_thumbnail_aspect_ratio_follows_sprite_frames_not_hero(self) -> None:
        project = ProjectInfo(
            slug="went-to-japan-forgot-to-use-my-camera",
            name="Went to Japan. Forgot to use my camera.",
            video_link="https://example.com/master.m3u8",
            thumbnail_link="https://example.com/thumb.webp",
            sprite_sheet_link="https://example.com/sprite.jpg",
            frames=60,
            columns=5,
            rows=12,
            frame_width=320,
            frame_height=180,
            video_width=1216,
            video_height=2160,
        )

        card = project.to_card()

        self.assertAlmostEqual(card.thumbnail_aspect_ratio or 0, 320 / 180)
        self.assertAlmostEqual(card.sprite_aspect_ratio or 0, 320 / 180)
        self.assertAlmostEqual(card.hero_aspect_ratio or 0, 1216 / 2160)
        self.assertAlmostEqual(card.primary_aspect_ratio or 0, 1216 / 2160)

    def test_thumbnail_aspect_ratio_falls_back_to_hero_ratio_without_sprite_metadata(self) -> None:
        project = ProjectInfo(
            slug="portrait-without-sprite",
            name="Portrait without sprite",
            video_link="https://example.com/master.m3u8",
            thumbnail_link="https://example.com/thumb.webp",
            video_width=1216,
            video_height=2160,
        )

        card = project.to_card()

        self.assertAlmostEqual(card.thumbnail_aspect_ratio or 0, 1216 / 2160)

    def test_card_defaults_sprite_animation_without_manufacturing_frame_dimensions(self) -> None:
        project = ProjectInfo(
            slug="portrait-with-sprite-url-only",
            name="Portrait with sprite URL only",
            sprite_sheet_link="https://example.com/sprite.jpg",
            video_width=1216,
            video_height=2160,
        )

        card = project.to_card()

        self.assertTrue(card.has_sprite_animation)
        self.assertEqual(card.frames, 60)
        self.assertEqual(card.columns, 5)
        self.assertEqual(card.rows, 12)
        self.assertIsNone(card.frame_width)
        self.assertIsNone(card.frame_height)
        self.assertIsNone(card.sprite_aspect_ratio)
        # Generated sprites are crop-to-fill 320x180 frames.
        self.assertAlmostEqual(card.thumbnail_aspect_ratio or 0, 16 / 9)
        self.assertAlmostEqual(card.hero_aspect_ratio or 0, 1216 / 2160)


if __name__ == "__main__":
    unittest.main()
