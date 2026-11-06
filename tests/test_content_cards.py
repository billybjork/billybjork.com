import unittest

from cms.projects import ProjectInfo, ProjectVideo


class ProjectCardTests(unittest.TestCase):
    def test_thumbnail_takes_the_video_shape_over_the_sprite_shape(self) -> None:
        card = ProjectInfo(
            slug="portrait",
            video=ProjectVideo(
                hls="https://example.com/master.m3u8",
                sprite_sheet="https://example.com/sprite.jpg",
                frames=60,
                columns=5,
                rows=12,
                frame_width=320,
                frame_height=180,
                video_width=1216,
                video_height=2160,
            ),
        ).to_card()

        self.assertAlmostEqual(card.hero_aspect_ratio or 0, 1216 / 2160)
        self.assertAlmostEqual(card.sprite_aspect_ratio or 0, 320 / 180)

    def test_thumbnail_falls_back_to_the_sprite_shape_without_video_dimensions(self) -> None:
        card = ProjectInfo(
            slug="sprite-only",
            video=ProjectVideo(
                sprite_sheet="https://example.com/sprite.jpg", frame_width=320, frame_height=240
            ),
        ).to_card()

        self.assertAlmostEqual(card.hero_aspect_ratio or 0, 320 / 240)

    def test_sprite_url_alone_gets_default_layout_without_inventing_frame_size(self) -> None:
        card = ProjectInfo(
            slug="sprite-url-only",
            video=ProjectVideo(sprite_sheet="https://example.com/sprite.jpg"),
        ).to_card()

        self.assertTrue(card.has_sprite_animation)
        self.assertEqual((card.frames, card.columns, card.rows), (60, 5, 12))
        self.assertIsNone(card.sprite_aspect_ratio)

    def test_no_sprite_means_no_animation(self) -> None:
        card = ProjectInfo(slug="plain").to_card()
        self.assertFalse(card.has_sprite_animation)
        self.assertIsNone(card.frames)


if __name__ == "__main__":
    unittest.main()
