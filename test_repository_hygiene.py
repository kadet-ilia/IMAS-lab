"""Reject generated and obsolete files in the tracked Git tree."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


@unittest.skipUnless((ROOT / ".git").exists(), "Git checkout is required")
class RepositoryHygieneTest(unittest.TestCase):
    def git(self, *args):
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, check=False)

    def test_only_one_readme_and_no_artifacts(self):
        result = self.git("ls-files", "-z")
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        tracked = [p for p in result.stdout.decode("utf-8").split("\0") if p]
        self.assertEqual([p for p in tracked if p == "README.md" or p.endswith("/README.md")], ["README.md"])
        forbidden_dirs = (".idea/", "__pycache__/", "cache/", "runs/", "results/", "gui/node_modules/", "gui/dist/", "gui/.verify-runtime/")
        forbidden_files = ("MANIFEST_SHA256.txt", "gui/verification.json", "RESEARCH_2027.md", "VALIDATION.md", "ENCODING_VALIDATION.md")
        bad = [p for p in tracked if p.startswith(forbidden_dirs) or p in forbidden_files or p.startswith("CHANGELOG_") or (p.startswith("gui/") and p.endswith(".png"))]
        self.assertFalse(bad, f"Unexpected Git artifacts: {bad[:20]}")
        self.assertIn(".gitignore", tracked)
        self.assertIn("gui/package-lock.json", tracked)
        self.assertIn("config.json", tracked)

    def test_ignore_rules(self):
        samples = (".venv/lib/site-packages/numpy/__init__.py", ".idea/modules.xml", "__pycache__/experiment.pyc", "gui/node_modules/react/index.js", "gui/dist/index.html", "gui/.verify-runtime/chromium", "gui/dashboard.png", "gui/research2027.png", "gui/verification.json", "cache/abc.checkpoint.json", "runs/run_example.json", "results/plot.png")
        for name in samples:
            with self.subTest(path=name):
                result = self.git("check-ignore", "--no-index", "-q", name)
                self.assertEqual(result.returncode, 0, f"{name} is not ignored")


if __name__ == "__main__":
    unittest.main()
