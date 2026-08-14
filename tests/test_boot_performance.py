import pathlib
import unittest


ROOT = pathlib.Path(__file__).parents[1]
SYSTEMD_DIR = ROOT / "build/live-build/config/includes.chroot/etc/systemd/system"
BUILD_UI = ROOT / "scripts/build-ui.sh"


class BootCriticalPathTests(unittest.TestCase):
    def test_broker_does_not_wait_for_network_manager(self):
        unit = (SYSTEMD_DIR / "agenos-agent-api.service").read_text()

        self.assertNotIn("After=dbus.service NetworkManager.service", unit)
        self.assertNotIn("Wants=NetworkManager.service", unit)

    def test_worker_starts_with_broker_but_at_lower_priority(self):
        unit = (SYSTEMD_DIR / "agenos-openclaw.service").read_text()

        self.assertIn("Wants=agenos-agent-api.service", unit)
        self.assertNotIn("After=agenos-agent-api.service", unit)
        self.assertIn("Nice=10", unit)
        self.assertIn("CPUWeight=20", unit)
        self.assertIn("IOWeight=20", unit)

    def test_electron_is_not_gated_on_the_development_broker_fallback(self):
        script = BUILD_UI.read_text()

        background_start = script.index("  'start_api &' \\")
        electron_exec = script.index("  'exec flock -n")
        self.assertLess(background_start, electron_exec)
        self.assertIn("systemctl is-enabled --quiet agenos-agent-api.service", script)
        self.assertIn("systemctl is-failed --quiet agenos-agent-api.service", script)
        self.assertIn('while [ "${attempts}" -lt 12 ]', script)
        self.assertNotIn("  'start_api || true' \\", script)


if __name__ == "__main__":
    unittest.main()
