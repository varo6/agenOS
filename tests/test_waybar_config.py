import json
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).parents[1]
SWAY_CONFIG = ROOT / "build/live-build/config/includes.chroot/etc/agenos/sway/config"
WAYBAR_CONFIG = ROOT / "build/live-build/config/includes.chroot/etc/agenos/waybar/config.json"
WAYBAR_STYLE = ROOT / "build/live-build/config/includes.chroot/etc/agenos/waybar/style.css"
DESKTOP_PACKAGES = ROOT / "build/live-build/config/package-lists/desktop-installer.list.chroot"


class WaybarConfigTests(unittest.TestCase):
    def setUp(self):
        self.sway = SWAY_CONFIG.read_text(encoding="utf-8")
        self.waybar = json.loads(WAYBAR_CONFIG.read_text(encoding="utf-8"))

    def test_sway_starts_one_bar_with_waybar_as_its_renderer(self):
        self.assertEqual(len(re.findall(r"^bar \{", self.sway, re.MULTILINE)), 1)
        self.assertIn("swaybar_command waybar", self.sway)

    def test_clock_is_the_only_center_module(self):
        self.assertTrue(self.waybar["fixed-center"])
        self.assertEqual(self.waybar["modules-center"], ["clock"])
        self.assertEqual(self.waybar["clock"]["format"], "{:%H:%M}")
        self.assertEqual(self.waybar["clock"]["interval"], 60)

    def test_existing_workspace_controls_and_status_remain_in_the_same_bar(self):
        self.assertEqual(self.waybar["modules-left"], ["sway/workspaces"])
        self.assertEqual(self.waybar["modules-right"], ["custom/workspace-status"])
        self.assertEqual(
            self.waybar["custom/workspace-status"]["exec"],
            "/usr/local/bin/agenos-workspace-watch --status",
        )

    def test_live_image_contains_waybar_and_stable_clock_digits(self):
        packages = DESKTOP_PACKAGES.read_text(encoding="utf-8").splitlines()
        self.assertIn("waybar", packages)
        self.assertIn('font-feature-settings: "tnum"', WAYBAR_STYLE.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
