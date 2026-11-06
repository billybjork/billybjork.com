"""Which code may depend on which. A failure means a dependency points the wrong way."""
import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Each layer may import itself and anything to its right.
LAYERS = [
    {"main"},
    {"experiments", "routers", "middleware"},
    {"edit_auth", "analytics", "templating", "client_address"},
    {"cms", "media"},
    {"object_storage", "config"},
]


def _layer_of(module: str) -> int | None:
    for index, names in enumerate(LAYERS):
        if module.split(".")[0] in names:
            return index
    return None


def _app_imports(path: Path) -> set[str]:
    imports: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            imports.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            imports.add(node.module)
    return {name for name in imports if _layer_of(name) is not None}


class PythonDependencyTests(unittest.TestCase):
    def _source_files(self):
        for path in ROOT.glob("*.py"):
            yield path
        for folder in ("cms", "media", "routers", "middleware", "experiments"):
            yield from (ROOT / folder).rglob("*.py")

    def test_imports_point_down_the_layers(self) -> None:
        for path in self._source_files():
            relative = path.relative_to(ROOT)
            if relative.parts[0] == "experiments" and relative.parts[-2] == "tools":
                continue
            own_layer = _layer_of(relative.with_suffix("").as_posix().replace("/", "."))
            for name in _app_imports(path):
                self.assertGreaterEqual(_layer_of(name), own_layer, f"{relative} imports {name}")

    def test_only_main_knows_the_point_cloud_experiment(self) -> None:
        for path in self._source_files():
            relative = path.relative_to(ROOT)
            if relative.parts[0] in {"experiments"} or relative.name == "main.py":
                continue
            self.assertFalse(
                any(name.startswith("experiments") for name in _app_imports(path)),
                f"{relative} imports the experiment",
            )


class FrontendDependencyTests(unittest.TestCase):
    def test_core_does_not_import_any_feature(self) -> None:
        for path in (ROOT / "static/ts/core").rglob("*.ts"):
            imports = re.findall(r"""from\s+['"]([^'"]+)['"]""", path.read_text(encoding="utf-8"))
            for target in imports:
                self.assertNotRegex(target, r"(^|/)(edit|homepage|project)/", f"{path.name} imports {target}")


if __name__ == "__main__":
    unittest.main()
