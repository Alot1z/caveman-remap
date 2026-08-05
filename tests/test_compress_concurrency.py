"""Tests for the cross-session compress lock (concurrency corruption bug).

Two Claude Code sessions running caveman-compress against the same
CLAUDE.md concurrently used to interleave reads/writes with no coordination:
one session's finished edit could get silently clobbered by the other's
in-flight compression pass. `file_lock` serializes access per resolved
target path so only one compress run touches a given file at a time.
"""

import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "skills" / "caveman-compress"))

from scripts import compress as compress_mod  # noqa: E402


class LockPathTests(unittest.TestCase):
    def test_same_resolved_path_yields_same_lock_path(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                p = Path("/tmp/some/dir/task.md")
                self.assertEqual(compress_mod.lock_path_for(p), compress_mod.lock_path_for(p))

    def test_same_basename_different_dirs_yields_different_lock_paths(self):
        # Two repos each with their own CLAUDE.md must never contend for the
        # same lock — only two runs against the *same* file should.
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                a = compress_mod.lock_path_for(Path("/repo-a/CLAUDE.md"))
                b = compress_mod.lock_path_for(Path("/repo-b/CLAUDE.md"))
                self.assertNotEqual(a, b)


class FileLockTests(unittest.TestCase):
    def test_second_acquire_waits_until_first_releases(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                target = Path("/tmp/whatever/CLAUDE.md")
                acquired_second_at = []
                released_first_at = []

                def hold_first():
                    with compress_mod.file_lock(target):
                        time.sleep(0.3)
                        released_first_at.append(time.monotonic())

                def try_second():
                    time.sleep(0.05)  # let the first thread acquire first
                    with mock.patch.object(compress_mod, "LOCK_POLL_INTERVAL", 0.02):
                        with compress_mod.file_lock(target):
                            acquired_second_at.append(time.monotonic())

                t1 = threading.Thread(target=hold_first)
                t2 = threading.Thread(target=try_second)
                t1.start()
                t2.start()
                t1.join(timeout=5)
                t2.join(timeout=5)

                self.assertEqual(len(released_first_at), 1)
                self.assertEqual(len(acquired_second_at), 1)
                # The second lock must not be acquired before the first is released —
                # this is the exact race that let two sessions interleave writes.
                self.assertGreaterEqual(acquired_second_at[0], released_first_at[0])

    def test_lock_file_removed_after_release(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                target = Path("/tmp/whatever/CLAUDE.md")
                lock_path = compress_mod.lock_path_for(target)
                with compress_mod.file_lock(target):
                    self.assertTrue(lock_path.exists())
                self.assertFalse(lock_path.exists())

    def test_stale_lock_reclaimed_without_waiting_full_timeout(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                target = Path("/tmp/whatever/CLAUDE.md")
                lock_path = compress_mod.lock_path_for(target)
                lock_path.write_text("99999 0")
                stale_mtime = time.time() - (compress_mod.LOCK_STALE_SECONDS + 5)
                os.utime(lock_path, (stale_mtime, stale_mtime))

                start = time.monotonic()
                with mock.patch.object(compress_mod, "LOCK_WAIT_SECONDS", 30):
                    with compress_mod.file_lock(target):
                        pass
                elapsed = time.monotonic() - start
                # Should reclaim near-instantly, not wait anywhere close to the
                # (mocked, still generous) 30s wait budget.
                self.assertLess(elapsed, 2)

    def test_fresh_lock_not_stolen_and_times_out(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                target = Path("/tmp/whatever/CLAUDE.md")
                lock_path = compress_mod.lock_path_for(target)
                lock_path.write_text(f"{os.getpid()} {time.time()}")

                with mock.patch.object(compress_mod, "LOCK_WAIT_SECONDS", 0.2), \
                     mock.patch.object(compress_mod, "LOCK_POLL_INTERVAL", 0.02):
                    with self.assertRaises(compress_mod.LockTimeoutError):
                        with compress_mod.file_lock(target):
                            pass  # pragma: no cover - must never be reached

    def test_lock_released_on_exception_inside_block(self):
        with tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                target = Path("/tmp/whatever/CLAUDE.md")
                lock_path = compress_mod.lock_path_for(target)
                with self.assertRaises(ValueError):
                    with compress_mod.file_lock(target):
                        raise ValueError("boom")
                self.assertFalse(lock_path.exists())


class CompressFileLockIntegrationTests(unittest.TestCase):
    def test_concurrent_compress_calls_serialize_instead_of_interleaving(self):
        # Two threads calling compress_file on the SAME file concurrently used
        # to interleave reads/writes with no coordination. With the lock, the
        # second call only starts once the first has fully finished (backup
        # written, target written, lock released) — so it deterministically
        # hits the existing "backup already exists" guard instead of racing
        # the first call's in-flight write. Neither outcome is corruption;
        # what matters is there's exactly one call_claude invocation (no
        # overlap) and the target ends up with the first call's clean output.
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as data_home:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": data_home, "LOCALAPPDATA": data_home}):
                original = "# Heading\n\nProse to compress, long enough to pass the identity check here.\n"
                compressed = "# Heading\n\nProse.\n"
                path = Path(tmp) / "task.md"
                path.write_text(original, encoding="utf-8")

                lock_path = compress_mod.lock_path_for(path.resolve())
                call_starts = []

                def slow_claude(prompt):
                    call_starts.append(time.monotonic())
                    time.sleep(0.2)
                    return compressed

                valid = mock.Mock(is_valid=True, errors=[], warnings=[])
                results = []

                def run():
                    with mock.patch.object(compress_mod, "call_claude", side_effect=slow_claude), \
                         mock.patch.object(compress_mod, "validate", return_value=valid):
                        results.append(compress_mod.compress_file(path))

                t1 = threading.Thread(target=run)
                t2 = threading.Thread(target=run)
                t1.start()
                time.sleep(0.05)  # ensure t1 acquires the lock first
                t2.start()
                t1.join(timeout=10)
                t2.join(timeout=10)

                # Exactly one compression ever ran — the lock prevented the
                # second thread from ever reading/writing the file while the
                # first was mid-flight. That's what closes the actual race.
                self.assertEqual(len(call_starts), 1)
                self.assertEqual(len(results), 2)
                self.assertEqual(sorted(results), [False, True])
                self.assertEqual(path.read_text(encoding="utf-8"), compressed)
                self.assertFalse(lock_path.exists())


if __name__ == "__main__":
    unittest.main()
