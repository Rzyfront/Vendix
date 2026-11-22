"""Offline contracts ONLY: subprocess.Popen, os.killpg, os.kill, os.getppid and
libc.prctl are mocked (kill(-1) must never reach the developer machine).
No generated or adversarial code runs here.
Run: python3 -m unittest -v test_handler test_runner
These tests do not certify isolation; T53 against the real Lambda does."""
import copy
import errno
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import handler  # noqa: E402

DIGEST = "sha256:" + "c" * 64


VALID_OUTPUT = {"figures": [{"label": "n", "value": 1}]}


def request(**over):
    base = {
        "protocol": "vendix.analysis/v1", "execution_id": "exec-1", "nonce": "a" * 64,
        "language": "python", "source": "result = {'figures': [{'label': 'n', 'value': 1}]}",
        "inputs": [{"name": "sales", "columns": ["m", "v"], "rows": [["2026-01", 10], ["2026-02", 12]]}],
        "limits": dict(handler.HARD_LIMITS),
    }
    base.update(over)
    return base


class ValidationTests(unittest.TestCase):
    def assert_rejected(self, event):
        with self.assertRaises(handler.RequestError):
            handler.validate_request(event)

    def test_valid_request_passes_and_clamps_limits(self):
        limits = dict(handler.HARD_LIMITS, memory_mb=10_000, cpu_s=2)
        _, _, _, _, eff = handler.validate_request(request(limits=limits))
        self.assertEqual(eff["memory_mb"], 768)
        self.assertEqual(eff["cpu_s"], 2)

    def test_rejects_bad_protocol(self):
        self.assert_rejected(request(protocol="vendix.analysis/v2"))

    def test_rejects_bad_nonce(self):
        self.assert_rejected(request(nonce="A" * 64))
        self.assert_rejected(request(nonce="a" * 63))

    def test_rejects_oversized_source(self):
        self.assert_rejected(request(source="x" * (handler.HARD_LIMITS["source_bytes"] + 1)))

    def test_rejects_bad_input_name(self):
        for name in ("Sales", "1sales", "a-b", "a" * 41):
            ev = request()
            ev["inputs"][0]["name"] = name
            self.assert_rejected(ev)

    def test_rejects_too_many_rows(self):
        ev = request()
        ev["inputs"][0]["rows"] = [["m", 1]] * (handler.HARD_LIMITS["input_rows"] + 1)
        self.assert_rejected(ev)

    def test_rejects_ragged_row_and_non_finite(self):
        ev = request()
        ev["inputs"][0]["rows"] = [["m"]]
        self.assert_rejected(ev)
        ev = request()
        ev["inputs"][0]["rows"] = [["m", float("nan")]]
        self.assert_rejected(ev)

    def test_rejects_wrong_language_and_missing_limits(self):
        self.assert_rejected(request(language="javascript"))
        ev = request()
        del ev["limits"]["cpu_s"]
        self.assert_rejected(ev)

    def test_rejects_long_or_duplicate_input_columns(self):
        ev = request()
        ev["inputs"][0]["columns"] = ["a" * 65, "v"]
        self.assert_rejected(ev)
        ev = request()
        ev["inputs"][0]["columns"] = ["m", "m"]
        self.assert_rejected(ev)

    def test_invalid_request_echoes_ids_with_input_error_and_no_popen(self):
        with patch.dict(os.environ, {"ANALYSIS_RUNTIME_DIGEST": DIGEST}), \
                patch.object(handler.subprocess, "Popen") as popen:
            res = handler.handler(request(protocol="nope"))
        popen.assert_not_called()
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_INPUT"))
        self.assertEqual((res["execution_id"], res["nonce"]), ("exec-1", "a" * 64))


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="handler-test-")
        self.addCleanup(shutil.rmtree, self.root, True)
        patches = [
            patch.object(handler, "TMP_ROOT", self.root),
            patch.dict(os.environ, {"ANALYSIS_RUNTIME_DIGEST": DIGEST, "AWS_SECRET_ACCESS_KEY": "s3cr3t",
                                    "AWS_SESSION_TOKEN": "tok"}),
            patch.object(handler.os, "killpg"),  # never signal a real group in tests
            patch.object(handler.os, "kill"),  # never kill(-1) the developer machine
            patch.object(handler.os, "getppid", return_value=0),  # as inside Lambda's PID namespace
        ]
        self.killpg = patches[2].start()
        self.kill = patches[3].start()
        self.getppid = patches[4].start()
        patches[0].start(); patches[1].start()
        for p in patches:
            self.addCleanup(p.stop)

    def popen_writing(self, payload, returncode=0):
        captured = {}

        def factory(args, **kwargs):
            captured["args"], captured["kwargs"] = args, kwargs
            if payload is not None:
                with open(os.path.join(kwargs["cwd"], "result.json"), "w") as fh:
                    json.dump(payload, fh)
            proc = MagicMock(pid=4242, returncode=returncode)
            proc.wait.return_value = returncode
            return proc
        return factory, captured

    def test_ok_echoes_ids_digest_and_cleans_tmp(self):
        factory, captured = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            res = handler.handler(request())
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["output"], VALID_OUTPUT)
        self.assertEqual((res["execution_id"], res["nonce"], res["runtime_digest"]), ("exec-1", "a" * 64, DIGEST))
        self.assertEqual(os.listdir(self.root), [])
        self.killpg.assert_called_with(4242, signal.SIGKILL)

    def test_child_spawn_contract_and_env_has_no_aws_keys(self):
        factory, captured = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            handler.handler(request())
        kw = captured["kwargs"]
        self.assertFalse([k for k in kw["env"] if k.startswith("AWS_")])
        self.assertNotIn("s3cr3t", json.dumps(kw["env"]))
        self.assertTrue(kw["start_new_session"])
        self.assertTrue(kw["env"]["HOME"].startswith(self.root))
        self.assertEqual(kw["cwd"], kw["env"]["HOME"])
        self.assertIn("-I", captured["args"])
        self.assertTrue(callable(kw["preexec_fn"]))

    def test_timeout_kills_process_group(self):
        proc = MagicMock(pid=777, returncode=None)
        proc.wait.side_effect = [subprocess.TimeoutExpired("x", 1), 0]
        with patch.object(handler.subprocess, "Popen", return_value=proc):
            res = handler.handler(request())
        self.killpg.assert_called_with(777, signal.SIGKILL)
        self.assertEqual(res["error_code"], "ANALYSIS_TIMEOUT")
        self.assertEqual(os.listdir(self.root), [])

    def test_tmp_removed_even_when_spawn_fails(self):
        with patch.object(handler.subprocess, "Popen", side_effect=OSError("boom /secret/path")):
            res = handler.handler(request())
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")
        self.assertNotIn("secret", res["error_message"])
        self.assertEqual(os.listdir(self.root), [])

    def test_residue_in_tmp_root_is_wiped(self):
        open(os.path.join(self.root, "leftover.bin"), "w").close()
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            handler.handler(request())
        self.assertEqual(os.listdir(self.root), [])

    def test_child_error_codes_map_and_paths_are_stripped(self):
        payload = {"status": "error", "error_code": "ANALYSIS_RUNTIME",
                   "error_message": "KeyError: 'x' in /var/task/secret/file.py"}
        factory, _ = self.popen_writing(payload)
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            res = handler.handler(request())
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")
        self.assertNotIn("/var/task", res["error_message"])
        self.assertLessEqual(len(res["error_message"]), 500)

    def test_signal_exit_without_result_maps_memory_and_cpu(self):
        for sig, code in ((signal.SIGKILL, "ANALYSIS_MEMORY"), (signal.SIGXCPU, "ANALYSIS_TIMEOUT")):
            factory, _ = self.popen_writing(None, returncode=-sig)
            with patch.object(handler.subprocess, "Popen", side_effect=factory):
                self.assertEqual(handler.handler(request())["error_code"], code)

    def test_invalid_child_output_is_rejected_by_parent(self):
        for bad in ({"tables": "nope"}, {"notes": ["only"]}, {"tables": []}):
            factory, _ = self.popen_writing({"status": "ok", "output": bad})
            with patch.object(handler.subprocess, "Popen", side_effect=factory):
                self.assertEqual(handler.handler(request())["error_code"], "ANALYSIS_OUTPUT")

    def test_missing_digest_is_runtime_error_without_spawning(self):
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.dict(os.environ, {"ANALYSIS_RUNTIME_DIGEST": ""}), \
                patch.object(handler.subprocess, "Popen", side_effect=factory) as popen:
            res = handler.handler(request())
        popen.assert_not_called()
        self.assertEqual((res["status"], res["error_code"], res["error_message"]),
                         ("error", "ANALYSIS_RUNTIME", "runtime digest missing"))

    def test_result_symlink_is_rejected(self):
        outside = tempfile.mkdtemp(prefix="handler-outside-")
        self.addCleanup(shutil.rmtree, outside, True)
        secret = os.path.join(outside, "secret.json")
        with open(secret, "w", encoding="utf-8") as fh:
            fh.write('{"status":"ok","output":{"figures":[{"label":"leak","value":1}]}}')

        def symlink_result(cmd, **kwargs):
            tmpdir = cmd[3]
            os.symlink(secret, os.path.join(tmpdir, "result.json"))
            proc = MagicMock(pid=7777, returncode=0)
            proc.wait.return_value = 0
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=symlink_result):
            res = handler.handler(request())
        self.assertTrue(os.path.exists(secret))
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_OUTPUT"))
        self.assertNotIn("leak", json.dumps(res))

    def test_result_fifo_is_rejected_without_blocking(self):
        def fifo_result(cmd, **kwargs):
            tmpdir = cmd[3]
            os.mkfifo(os.path.join(tmpdir, "result.json"))
            proc = MagicMock(pid=7778, returncode=0)
            proc.wait.return_value = 0
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=fifo_result):
            res = handler.handler(request())
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_OUTPUT"))
        self.assertEqual(os.listdir(self.root), [])

    def test_stderr_symlink_outside_tmp_does_not_leak(self):
        outside = tempfile.mkdtemp(prefix="handler-outside-")
        self.addCleanup(shutil.rmtree, outside, True)
        secret = os.path.join(outside, "environ")
        with open(secret, "wb") as fh:
            fh.write(
                b"AWS_ACCESS_KEY_ID=ASIAEXAMPLEKEY\x00"
                b"AWS_SECRET_ACCESS_KEY=SuperSecretValue123\x00"
                b"AWS_SESSION_TOKEN=TokXYZ\x00"
            )

        def symlink_stderr(cmd, **kwargs):
            tmpdir = cmd[3]
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "stderr.log")))
            self.assertFalse(os.path.exists(os.path.join(tmpdir, "stdout.log")))
            os.symlink(secret, os.path.join(tmpdir, "stderr.log"))
            proc = MagicMock(pid=7779, returncode=1)
            proc.wait.return_value = 1
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=symlink_stderr):
            res = handler.handler(request())
        self.assertTrue(os.path.exists(secret))
        self.assertEqual(
            (res["status"], res["error_code"], res["error_message"]),
            ("error", "ANALYSIS_RUNTIME", "child exited without a result"),
        )
        serialized = json.dumps(res)
        self.assertNotIn("AWS_ACCESS_KEY_ID", serialized)
        self.assertNotIn("SuperSecretValue123", serialized)
        self.assertNotIn("TokXYZ", serialized)
        self.assertEqual(os.listdir(self.root), [])

    def test_stderr_fifo_does_not_block(self):
        def fifo_stderr(cmd, **kwargs):
            tmpdir = cmd[3]
            os.mkfifo(os.path.join(tmpdir, "stderr.log"))
            proc = MagicMock(pid=7780, returncode=1)
            proc.wait.return_value = 1
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=fifo_stderr):
            res = handler.handler(request())
        self.assertEqual(
            (res["status"], res["error_code"], res["error_message"]),
            ("error", "ANALYSIS_RUNTIME", "child exited without a result"),
        )
        self.assertEqual(os.listdir(self.root), [])

    def test_stderr_from_anonymous_fd_is_sanitized(self):
        def write_stderr(cmd, **kwargs):
            kwargs["stderr"].write(b"Traceback\nRuntimeError: boom in /var/task/secret.py\n")
            proc = MagicMock(pid=7781, returncode=1)
            proc.wait.return_value = 1
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=write_stderr):
            res = handler.handler(request())
        self.assertEqual(
            (res["status"], res["error_code"], res["error_message"]),
            ("error", "ANALYSIS_RUNTIME", "RuntimeError: boom in <path>"),
        )
        self.assertNotIn("/var/task", res["error_message"])

    def test_strays_are_reaped_before_tenant_data_and_after_the_child(self):
        # killpg cannot reach a guest daemon that double-forked + setsid (T53).
        open(os.path.join(self.root, "leftover.bin"), "w").close()
        seen = []
        self.kill.side_effect = lambda pid, sig: seen.append((pid, sig, sorted(os.listdir(self.root))))
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})

        def spawn(args, **kwargs):
            self.assertEqual(len(seen), 1, "strays must be reaped before the child starts")
            return factory(args, **kwargs)

        with patch.object(handler.subprocess, "Popen", side_effect=spawn):
            res = handler.handler(request())
        self.assertEqual(res["status"], "ok")
        self.assertEqual([(p, s) for p, s, _ in seen], [(-1, signal.SIGKILL), (-1, signal.SIGKILL)])
        # First reap: before /tmp is wiped and before any data of this tenant exists.
        self.assertEqual(seen[0][2], ["leftover.bin"])
        self.assertTrue(any(e.startswith(handler.TMP_PREFIX) for e in seen[1][2]))
        self.killpg.assert_called_with(4242, signal.SIGKILL)

    def test_child_wall_leaves_a_teardown_reserve_inside_the_host_budget(self):
        # The host aborts at exactly wall_ms; the reply (kill, reap, rm) must land before it.
        for wall_ms, child_s in ((25_000, 23.0), (10_000, 8.0), (1_500, 0.001)):
            proc = MagicMock(pid=779, returncode=None)
            proc.wait.side_effect = [subprocess.TimeoutExpired("x", 1), 0]
            with patch.object(handler.subprocess, "Popen", return_value=proc):
                res = handler.handler(request(limits=dict(handler.HARD_LIMITS, wall_ms=wall_ms)))
            self.assertEqual(res["error_code"], "ANALYSIS_TIMEOUT")
            self.assertEqual(proc.wait.call_args_list[0].kwargs, {"timeout": child_s})

    def test_strays_are_reaped_even_if_killing_the_group_fails(self):
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        self.killpg.side_effect = OSError(errno.EIO, "unexpected")
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            res = handler.handler(request())
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")
        self.assertEqual(self.kill.call_count, 2)
        self.assertEqual(os.listdir(self.root), [])

    def test_strays_are_reaped_after_a_timeout(self):
        proc = MagicMock(pid=778, returncode=None)
        proc.wait.side_effect = [subprocess.TimeoutExpired("x", 1), 0]
        with patch.object(handler.subprocess, "Popen", return_value=proc):
            res = handler.handler(request())
        self.assertEqual(res["error_code"], "ANALYSIS_TIMEOUT")
        self.assertEqual(self.kill.call_count, 2)
        self.kill.assert_called_with(-1, signal.SIGKILL)

    def test_reaper_refuses_outside_the_lambda_pid_namespace(self):
        self.getppid.return_value = 4321  # a developer machine: kill(-1) would hit everything
        with patch.object(handler.subprocess, "Popen") as popen:
            res = handler.handler(request())
        popen.assert_not_called()
        self.kill.assert_not_called()
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_RUNTIME"))
        self.assertEqual(os.listdir(self.root), [])

    def test_reaper_without_other_processes_continues(self):
        self.kill.side_effect = ProcessLookupError(errno.ESRCH, "no process")
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            res = handler.handler(request())
        self.assertEqual(res["status"], "ok")

    def test_reaper_failure_fails_closed_before_tenant_data(self):
        self.kill.side_effect = PermissionError(errno.EPERM, "denied")
        with patch.object(handler.subprocess, "Popen") as popen, \
                patch.object(handler, "_write_private") as write:
            res = handler.handler(request())
        popen.assert_not_called()
        write.assert_not_called()
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_RUNTIME"))

    def test_linux_dumpable_failure_fails_closed_without_spawning(self):
        with patch.object(handler, "_harden_parent_dumpable", side_effect=OSError("prctl failed")), \
                patch.object(handler.subprocess, "Popen") as popen:
            res = handler.handler(request())
        popen.assert_not_called()
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_RUNTIME"))

    def test_never_prints_payloads(self):
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        with patch.object(handler.subprocess, "Popen", side_effect=factory), \
                patch("builtins.print") as printed:
            handler.handler(request(source="result = {'figures': [{'label': 'TOPSECRET', 'value': 1}]}"))
        printed.assert_not_called()


class FakeStat:
    def __init__(self, uid):
        self.st_uid = uid


class DumpableTests(unittest.TestCase):
    """_harden_parent_dumpable under a simulated Linux libc. AWS Lambda's seccomp
    denies every prctl with EPERM (T53); that EPERM is accepted ONLY when the
    kernel already made the process non-dumpable (/proc/self owned by root)."""

    def harden(self, prctl_rc=-1, err=errno.EPERM, uid=993, environ_uid=0, stat_error=None, real_uid=993):
        libc = MagicMock()
        libc.prctl.return_value = prctl_rc
        stat = MagicMock(side_effect=stat_error) if stat_error else MagicMock(return_value=FakeStat(environ_uid))
        with patch.object(handler.sys, "platform", "linux"), \
                patch.object(handler.ctypes.util, "find_library", return_value="libc.so.6"), \
                patch.object(handler.ctypes, "CDLL", return_value=libc), \
                patch.object(handler.ctypes, "get_errno", return_value=err), \
                patch.object(handler.os, "geteuid", return_value=uid), \
                patch.object(handler.os, "getuid", return_value=real_uid), \
                patch.object(handler.os, "stat", stat):
            handler._harden_parent_dumpable()
        return libc, stat

    def test_prctl_success_needs_no_proof(self):
        libc, stat = self.harden(prctl_rc=0)
        libc.prctl.assert_called_once_with(4, 0, 0, 0, 0)
        stat.assert_not_called()

    def test_eperm_accepted_when_kernel_already_marked_non_dumpable(self):
        _, stat = self.harden()
        stat.assert_called_once_with("/proc/self/environ")

    def test_eperm_rejected_when_proc_self_is_still_ours(self):
        with self.assertRaises(OSError) as ctx:
            self.harden(environ_uid=993)
        self.assertEqual(ctx.exception.errno, errno.EPERM)

    def test_eperm_rejected_when_running_as_root(self):
        with self.assertRaises(OSError):
            self.harden(uid=0, environ_uid=0)

    def test_eperm_rejected_when_effective_uid_is_root(self):
        # /proc ownership follows the effective uid, not the real one.
        with self.assertRaises(OSError):
            self.harden(uid=0, real_uid=993, environ_uid=0)

    def test_eperm_rejected_when_proof_cannot_be_read(self):
        with self.assertRaises(OSError):
            self.harden(stat_error=PermissionError(errno.EACCES, "denied"))

    def test_any_other_errno_fails_closed_without_proof(self):
        for err in (errno.EINVAL, errno.ENOSYS, errno.EACCES):
            with self.assertRaises(OSError) as ctx:
                self.harden(err=err)
            self.assertEqual(ctx.exception.errno, err)


if __name__ == "__main__":
    unittest.main()
