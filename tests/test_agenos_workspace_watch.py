import importlib.machinery
import importlib.util
import pathlib
import unittest


SCRIPT = (
    pathlib.Path(__file__).parents[1]
    / "build/live-build/config/includes.chroot/usr/local/bin/agenos-workspace-watch"
)
LOADER = importlib.machinery.SourceFileLoader("agenos_workspace_watch", str(SCRIPT))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
WATCHER = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(WATCHER)


def snapshot(focused="2:app", views=(), windows=None):
    return WATCHER.WorkspaceSnapshot(
        focused_workspace=focused,
        workspaces_with_views=frozenset(views),
        window_workspaces=windows or {},
    )


class WorkspaceWatcherDecisionTests(unittest.TestCase):
    def test_user_navigation_to_an_empty_workspace_never_returns_home(self):
        actions = WATCHER.decide_actions(
            {"change": "focus", "current": {"name": "2:app"}, "old": {"name": "1:home"}},
            snapshot(focused="1:home"),
        )

        self.assertEqual(
            actions,
            (
                {"type": WATCHER.ACTION_RECORD_FOCUS, "workspace": "2:app"},
                {"type": WATCHER.ACTION_CANCEL_EMPTY_CHECK},
            ),
        )
        self.assertNotIn(WATCHER.ACTION_RETURN_HOME, [action["type"] for action in actions])

    def test_closing_a_window_in_the_focused_app_workspace_schedules_a_check(self):
        actions = WATCHER.decide_actions(
            {"change": "close", "container": {"id": 42, "focused": True}},
            snapshot(views={"2:app"}, windows={42: "2:app"}),
        )

        self.assertEqual(
            actions,
            ({"type": WATCHER.ACTION_SCHEDULE_EMPTY_CHECK, "workspace": "2:app"},),
        )

    def test_closing_a_background_window_does_not_eject_an_intentionally_empty_workspace(self):
        actions = WATCHER.decide_actions(
            {"change": "close", "container": {"id": 77, "focused": False}},
            snapshot(focused="2:app", windows={77: "3:web"}),
        )

        self.assertEqual(actions, ())

    def test_empty_check_returns_home_only_if_target_is_still_focused_and_empty(self):
        event = {"change": "empty-check", "workspace": "4:media"}

        self.assertEqual(
            WATCHER.decide_actions(event, snapshot(focused="4:media")),
            ({"type": WATCHER.ACTION_RETURN_HOME},),
        )
        self.assertEqual(
            WATCHER.decide_actions(event, snapshot(focused="4:media", views={"4:media"})),
            (),
        )
        self.assertEqual(WATCHER.decide_actions(event, snapshot(focused="1:home")), ())

    def test_tree_snapshot_tracks_tiled_and_floating_windows_by_workspace(self):
        tree = {
            "type": "root",
            "nodes": [
                {
                    "type": "workspace",
                    "name": "2:app",
                    "focused": True,
                    "nodes": [{"type": "con", "id": 10, "app_id": "org.example.App", "nodes": []}],
                    "floating_nodes": [{"type": "floating_con", "id": 11, "pid": 123, "nodes": []}],
                }
            ],
        }

        result = WATCHER.snapshot_from_tree(tree)

        self.assertEqual(result.focused_workspace, "2:app")
        self.assertEqual(result.workspaces_with_views, frozenset({"2:app"}))
        self.assertEqual(result.window_workspaces, {10: "2:app", 11: "2:app"})

    def test_status_explains_an_empty_workspace_and_the_home_shortcut(self):
        text = WATCHER.workspace_status_text("3:web")

        self.assertIn("Web", text)
        self.assertIn("vacio", text)
        self.assertIn("Ctrl+Alt+1", text)


if __name__ == "__main__":
    unittest.main()
