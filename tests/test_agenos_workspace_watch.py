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

    def test_closing_an_untracked_window_still_returns_home(self):
        # El arbol puede no tener aun la ventana mapeada (nacio y murio entre dos
        # lecturas). Sin esta red, el usuario se queda mirando un escritorio
        # vacio sin saber como volver.
        actions = WATCHER.decide_actions(
            {"change": "close", "container": {"id": 99, "focused": False}},
            snapshot(focused="4:media", views={"4:media"}, windows={}),
        )

        self.assertEqual(
            actions,
            ({"type": WATCHER.ACTION_SCHEDULE_EMPTY_CHECK, "workspace": "4:media"},),
        )

    def test_closing_an_untracked_window_does_not_eject_an_empty_workspace(self):
        actions = WATCHER.decide_actions(
            {"change": "close", "container": {"id": 99, "focused": False}},
            snapshot(focused="2:app", views={"3:web"}, windows={}),
        )

        self.assertEqual(actions, ())

    def test_moving_the_last_window_out_of_the_visible_workspace_schedules_a_check(self):
        actions = WATCHER.decide_actions(
            {"change": "move", "container": {"id": 42}},
            snapshot(focused="3:web", views={"3:web"}, windows={42: "3:web"}),
        )

        self.assertEqual(
            actions,
            (
                {"type": WATCHER.ACTION_REFRESH_TREE},
                {"type": WATCHER.ACTION_SCHEDULE_EMPTY_CHECK, "workspace": "3:web"},
            ),
        )

    def test_moving_a_window_that_was_not_here_only_refreshes_the_tree(self):
        actions = WATCHER.decide_actions(
            {"change": "move", "container": {"id": 42}},
            snapshot(focused="3:web", views={"1:home"}, windows={42: "1:home"}),
        )

        self.assertEqual(actions, ({"type": WATCHER.ACTION_REFRESH_TREE},))

    def test_another_open_app_in_the_same_workspace_keeps_the_user_there(self):
        # Caso que NO debe disparar el retorno: se cierra una ventana pero el
        # escritorio sigue teniendo otra aplicacion abierta.
        scheduled = WATCHER.decide_actions(
            {"change": "close", "container": {"id": 42, "focused": True}},
            snapshot(focused="4:media", views={"4:media"}, windows={42: "4:media", 43: "4:media"}),
        )
        self.assertEqual(
            scheduled,
            ({"type": WATCHER.ACTION_SCHEDULE_EMPTY_CHECK, "workspace": "4:media"},),
        )

        settled = WATCHER.decide_actions(
            {"change": "empty-check", "workspace": "4:media"},
            snapshot(focused="4:media", views={"4:media"}, windows={43: "4:media"}),
        )
        self.assertEqual(settled, ())

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
