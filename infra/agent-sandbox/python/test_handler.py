"""Offline contracts ONLY: subprocess.Popen, os.killpg, os.kill, os.getppid,
libc.prctl, the System V IPC syscalls and setrlimit are mocked (kill(-1) must
never reach the developer machine, nor a limit change this test process).
No generated or adversarial code runs here.
Run: python3 -m unittest -v test_handler test_runner
These tests do not certify isolation; T53 against the real Lambda does."""
import copy
import errno
import json
import os
import resource
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
OK_PAYLOAD = {"status": "ok", "output": VALID_OUTPUT}


class FakeClock:
    """time.monotonic() for the handler: advances `tick` per read, plus waits."""

    def __init__(self, start=1000.0, tick=0.0):
        self.now, self.tick = start, tick

    def __call__(self):
        self.now += self.tick
        return self.now

    def advance(self, seconds):
        self.now += seconds


def hanging_proc(clock, pid=777):
    """A child that never exits on its own; every wait() consumes its timeout."""
    proc = MagicMock(pid=pid, returncode=None)

    def wait(timeout=None):
        clock.advance(timeout or 0)
        raise subprocess.TimeoutExpired("x", timeout)
    proc.wait.side_effect = wait
    return proc


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


class HandlerFixture(unittest.TestCase):
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
            patch.object(handler, "_tmp_free_inodes", return_value=10**9),
            patch.object(handler, "_tmp_free_bytes", return_value=10**15),
        ]
        self.killpg = patches[2].start()
        self.kill = patches[3].start()
        self.getppid = patches[4].start()
        self.free_inodes = patches[5].start()
        self.free_bytes = patches[6].start()
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


class ExecutionTests(HandlerFixture):
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
        clock = FakeClock()
        proc = hanging_proc(clock)
        with patch.object(handler.subprocess, "Popen", return_value=proc), \
                patch.object(handler.time, "monotonic", clock):
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
            clock = FakeClock()
            proc = hanging_proc(clock)
            killed_at = []
            self.killpg.side_effect = lambda pid, sig: killed_at.append(clock.now - 1000.0)
            with patch.object(handler.subprocess, "Popen", return_value=proc), \
                    patch.object(handler.time, "monotonic", clock):
                res = handler.handler(request(limits=dict(handler.HARD_LIMITS, wall_ms=wall_ms)))
            self.assertEqual(res["error_code"], "ANALYSIS_TIMEOUT")
            self.assertAlmostEqual(killed_at[0], child_s, places=6)
            for call in proc.wait.call_args_list[:-1]:  # the watch polls, never one long wait
                self.assertLessEqual(call.kwargs["timeout"], handler.WATCH_INTERVAL_S)
            self.assertLessEqual(res["usage"]["duration_ms"], wall_ms)
        self.killpg.side_effect = None

    def test_strays_are_reaped_even_if_killing_the_group_fails(self):
        factory, _ = self.popen_writing({"status": "ok", "output": VALID_OUTPUT})
        self.killpg.side_effect = OSError(errno.EIO, "unexpected")
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            res = handler.handler(request())
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")
        self.assertEqual(self.kill.call_count, 2)
        self.assertEqual(os.listdir(self.root), [])

    def test_strays_are_reaped_after_a_timeout(self):
        clock = FakeClock()
        proc = hanging_proc(clock, pid=778)
        with patch.object(handler.subprocess, "Popen", return_value=proc), \
                patch.object(handler.time, "monotonic", clock):
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


GUEST_UID = 993


class FakeSysvKernel:
    """/proc/sysvipc/{shm,msg,sem} plus the IPC_RMID syscalls, in a temp dir.

    Real header layout of Linux (columns are located by name, not position)."""

    HEADERS = {
        "shm": "       key      shmid perms                  size  cpid  lpid nattch   uid   gid  cuid  cgid",
        "msg": "       key      msqid perms      cbytes       qnum lspid lrpid   uid   gid  cuid  cgid",
        "sem": "       key      semid perms      nsems   uid   gid  cuid  cgid",
    }

    def __init__(self, root):
        self.root = root
        self.objects = {}  # (kind, id) -> {"uid", "cuid", "linger"}
        self.next_id = 100
        self.refuse = set()
        self.rmid_calls = []
        self.errno = 0
        self.write()

    def plant(self, kind, uid=GUEST_UID, cuid=GUEST_UID, linger=0):
        self.next_id += 1
        self.objects[(kind, self.next_id)] = {"uid": uid, "cuid": cuid, "linger": linger, "removed": False}
        self.write()
        return self.next_id

    def write(self):
        for kind, header in self.HEADERS.items():
            rows = [header]
            for (k, ident), o in sorted(self.objects.items()):
                if k != kind:
                    continue
                if kind == "shm":
                    rows.append("  1234 %10d   666  4096 10 10 0 %5d %5d %5d %5d" % (ident, o["uid"], 990, o["cuid"], 990))
                elif kind == "msg":
                    rows.append("  1234 %10d   666  64 1 10 10 %5d %5d %5d %5d" % (ident, o["uid"], 990, o["cuid"], 990))
                else:
                    rows.append("  1234 %10d   666  1 %5d %5d %5d %5d" % (ident, o["uid"], 990, o["cuid"], 990))
            with open(os.path.join(self.root, kind), "w", encoding="ascii") as fh:
                fh.write("\n".join(rows) + "\n")

    def _rmid(self, kind, ident):
        self.rmid_calls.append((kind, ident))
        o = self.objects.get((kind, ident))
        if o is None or o["removed"] and o["linger"] <= 0:
            self.errno = errno.EINVAL
            return -1
        if (kind, ident) in self.refuse:
            self.errno = errno.EPERM
            return -1
        o["removed"] = True
        if o["linger"] <= 0:
            del self.objects[(kind, ident)]
        self.write()
        return 0

    def settle(self):
        """A removed shm segment stays listed until its attacher finishes exiting."""
        for key, o in list(self.objects.items()):
            if o["removed"]:
                o["linger"] -= 1
                if o["linger"] <= 0:
                    del self.objects[key]
        self.write()

    def libc(self):
        libc = MagicMock()
        libc.shmctl.side_effect = lambda ident, cmd, buf: self._rmid("shm", ident)
        libc.msgctl.side_effect = lambda ident, cmd, buf: self._rmid("msg", ident)
        libc.semctl.side_effect = lambda ident, num, cmd, arg: self._rmid("sem", ident)
        return libc

    def markers_of(self, uid=GUEST_UID):
        return sorted(k for k, o in self.objects.items() if uid in (o["uid"], o["cuid"]))


class SysvIpcTests(HandlerFixture):
    """T53 run 3, finding 4: a tenant read the previous tenant's marker through
    shm/msg in 99/100 runs. The handler now removes every IPC object of the
    guest uid before each tenant and after each run, and fails closed."""

    def setUp(self):
        super().setUp()
        self.ipc_root = tempfile.mkdtemp(prefix="sysvipc-")
        self.addCleanup(shutil.rmtree, self.ipc_root, True)
        self.kernel = FakeSysvKernel(self.ipc_root)
        patches = [
            patch.object(handler.sys, "platform", "linux"),
            patch.object(handler, "SYSVIPC_ROOT", self.ipc_root),
            patch.object(handler, "_libc", side_effect=self.kernel.libc),
            patch.object(handler.ctypes, "get_errno", side_effect=lambda: self.kernel.errno),
            patch.object(handler.os, "geteuid", return_value=GUEST_UID),
            patch.object(handler, "_harden_parent_dumpable"),
            patch.object(handler.time, "sleep", side_effect=lambda s: self.kernel.settle()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tenant(self, plant=(), expect_clean=True):
        seen = {}

        def spawn(args, **kwargs):
            seen["at_spawn"] = self.kernel.markers_of()
            for kind, kw in plant:  # what the guest leaves behind
                self.kernel.plant(kind, **kw)
            with open(os.path.join(kwargs["cwd"], "result.json"), "w") as fh:
                json.dump(OK_PAYLOAD, fh)
            proc = MagicMock(pid=4242, returncode=0)
            proc.wait.return_value = 0
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=spawn) as popen:
            res = handler.handler(request())
        return res, seen, popen

    def test_marker_planted_by_one_tenant_never_reaches_the_next(self):
        plant = (("shm", {}), ("msg", {}), ("sem", {}),
                 ("shm", {"uid": 0}),  # IPC_SET gave it away; the creator uid still identifies it
                 ("msg", {"linger": 2}))  # still attached while the guest finishes exiting
        res_a, seen_a, _ = self.tenant(plant=plant)
        self.assertEqual(res_a["status"], "ok")
        self.assertEqual(self.kernel.markers_of(), [], "removed after the run of tenant A")
        # Belt and braces: even if A's objects were still there, B starts clean.
        for kind, kw in plant:
            self.kernel.plant(kind, **kw)
        res_b, seen_b, _ = self.tenant()
        self.assertEqual(res_b["status"], "ok")
        self.assertEqual(seen_b["at_spawn"], [], "tenant B must not see any object of tenant A")
        self.assertEqual(self.kernel.markers_of(), [])

    def test_objects_of_other_users_are_left_alone(self):
        foreign = self.kernel.plant("shm", uid=0, cuid=0)
        res, seen, _ = self.tenant()
        self.assertEqual(res["status"], "ok")
        self.assertIn(("shm", foreign), self.kernel.objects)
        self.assertNotIn(("shm", foreign), self.kernel.rmid_calls)

    def test_unreadable_listing_fails_closed_without_spawning(self):
        os.unlink(os.path.join(self.ipc_root, "msg"))
        res, _, popen = self.tenant()
        popen.assert_not_called()
        self.assertEqual((res["status"], res["error_code"], res["error_message"]),
                         ("error", "ANALYSIS_RUNTIME", "sandbox error: SysvIpcError"))

    def test_object_that_cannot_be_removed_fails_closed_without_spawning(self):
        ident = self.kernel.plant("shm")
        self.kernel.refuse.add(("shm", ident))
        res, _, popen = self.tenant()
        popen.assert_not_called()
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")

    def test_object_that_never_disappears_fails_closed(self):
        self.kernel.plant("shm", linger=10**6)
        res, _, popen = self.tenant()
        popen.assert_not_called()
        self.assertEqual(res["error_code"], "ANALYSIS_RUNTIME")

    def test_failed_removal_after_the_run_turns_the_result_into_an_error(self):
        def spawn(args, **kwargs):
            ident = self.kernel.plant("msg")
            self.kernel.refuse.add(("msg", ident))
            with open(os.path.join(kwargs["cwd"], "result.json"), "w") as fh:
                json.dump(OK_PAYLOAD, fh)
            proc = MagicMock(pid=4242, returncode=0)
            proc.wait.return_value = 0
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=spawn):
            res = handler.handler(request())
        self.assertEqual((res["status"], res["error_code"]), ("error", "ANALYSIS_RUNTIME"))
        self.assertNotIn("output", res)

    def test_header_columns_are_located_by_name(self):
        with open(os.path.join(self.ipc_root, "sem"), "w") as fh:
            fh.write("key semid perms nsems cuid cgid uid gid\n1 55 666 1 993 990 0 0\n")
        self.assertIn(("sem", 55, 0, GUEST_UID), handler._sysvipc_objects())


class FakeLimits:
    """getrlimit/setrlimit with kernel rules: soft <= hard, hard only goes down."""

    def __init__(self):
        self.table = {getattr(resource, n): resource.getrlimit(getattr(resource, n))
                      for n in dir(resource) if n.startswith("RLIMIT_")}

    def getrlimit(self, res):
        return self.table[res]

    def setrlimit(self, res, value):
        soft, hard = value
        cur_hard = self.table[res][1]
        unlimited = resource.RLIM_INFINITY

        def gt(a, b):
            if a == unlimited:
                return b != unlimited
            return b != unlimited and a > b
        if gt(soft, hard) or gt(hard, cur_hard):
            raise ValueError("not allowed to raise maximum limit")
        self.table[res] = (soft, hard)

    def prlimit_from_guest(self, res, soft=None, hard=None):
        cur_soft, cur_hard = self.table[res]
        self.table[res] = (cur_soft if soft is None else soft, cur_hard if hard is None else hard)


class RuntimeRestart(BaseException):
    pass


class ProcessStateTests(HandlerFixture):
    """T53 run 3, finding 5: the guest lowered the handler's soft RLIMIT_NOFILE
    with prlimit and every later invocation of the environment failed with
    "sandbox error: OSError" for 15-19 min. Now the handler restores what it
    can after killing the guest, or restarts the runtime inside the attacker's
    own invocation; the next tenant always runs."""

    def setUp(self):
        super().setUp()
        self.limits = FakeLimits()
        patches = [
            patch.object(handler.resource, "getrlimit", side_effect=self.limits.getrlimit),
            patch.object(handler.resource, "setrlimit", side_effect=self.limits.setrlimit),
            patch.object(handler, "_BASELINE_STATE", handler._process_state()),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        # Baseline from the fake table (identical to the real one at this point).
        handler._BASELINE_STATE = handler._process_state()
        self.exit = patch.object(handler.os, "_exit", side_effect=RuntimeRestart).start()
        self.addCleanup(patch.stopall)

    def run_tenant(self, guest=None):
        def spawn(args, **kwargs):
            if guest:
                guest()
            with open(os.path.join(kwargs["cwd"], "result.json"), "w") as fh:
                json.dump(OK_PAYLOAD, fh)
            proc = MagicMock(pid=4242, returncode=0)
            proc.wait.return_value = 0
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=spawn):
            return handler.handler(request())

    def test_lowered_soft_limits_are_restored_and_the_next_tenant_runs(self):
        lowered = ("RLIMIT_NOFILE", "RLIMIT_AS", "RLIMIT_NPROC", "RLIMIT_FSIZE", "RLIMIT_CPU")

        def attacker():
            for name in lowered:
                if hasattr(resource, name):
                    self.limits.prlimit_from_guest(getattr(resource, name), soft=4)
        self.run_tenant(attacker)
        self.exit.assert_not_called()
        self.assertEqual(handler._process_state(), handler._BASELINE_STATE)
        victim = self.run_tenant()
        self.assertEqual(victim["status"], "ok")
        self.exit.assert_not_called()

    def test_lowered_hard_limit_restarts_the_runtime_inside_the_attackers_invocation(self):
        nofile = resource.RLIMIT_NOFILE
        with self.assertRaises(RuntimeRestart):
            self.run_tenant(lambda: self.limits.prlimit_from_guest(nofile, soft=4, hard=4))
        self.exit.assert_called_once_with(70)

    def test_state_altered_before_an_invocation_is_handled_before_anything_else(self):
        self.limits.prlimit_from_guest(resource.RLIMIT_NOFILE, soft=4)
        with patch.object(handler.subprocess, "Popen") as popen:
            popen.side_effect = AssertionError("must not get here unrestored")
            handler._guard_process_state()
        self.assertEqual(handler._process_state(), handler._BASELINE_STATE)
        with patch.object(handler, "validate_request", side_effect=AssertionError("too late")):
            self.limits.prlimit_from_guest(resource.RLIMIT_NOFILE, soft=4, hard=4)
            with self.assertRaises(RuntimeRestart):
                handler.handler(request())

    def test_unchanged_state_is_a_no_op(self):
        with patch.object(handler.resource, "setrlimit") as setr:
            self.assertEqual(self.run_tenant()["status"], "ok")
        setr.assert_not_called()
        self.exit.assert_not_called()


def make_chain(root, depth, name="d"):
    """A directory chain deeper than the recursion limit and PATH_MAX."""
    fd = os.open(root, os.O_RDONLY)
    try:
        for _ in range(depth):
            os.mkdir(name, dir_fd=fd)
            nfd = os.open(name, os.O_RDONLY, dir_fd=fd)
            os.close(fd)
            fd = nfd
    finally:
        os.close(fd)


class TmpInodeTests(HandlerFixture):
    """T53 run 3, finding 6: filling /tmp with directories (mkdir needs no
    descriptor) ended in Sandbox.Timedout at 30 s. The guest is now stopped
    past TMP_INODE_CAP, the wipe is iterative and stops at the reply deadline,
    and a run never starts on top of an unfinished wipe."""

    def count_entries(self):
        n = 0
        for _dirpath, dirnames, filenames in os.walk(self.root):
            n += len(dirnames) + len(filenames)
        return n

    def test_guest_creating_too_many_inodes_is_stopped_and_cleaned_in_budget(self):
        clock = FakeClock()
        proc = hanging_proc(clock)
        self.free_inodes.side_effect = lambda: 10**6 - self.count_entries()

        def spawn(args, **kwargs):
            for i in range(60):  # the guest keeps creating directories
                os.mkdir(os.path.join(self.root, "junk-%d" % i))
            make_chain(kwargs["cwd"], 80)
            return proc

        with patch.object(handler, "TMP_INODE_CAP", 50), \
                patch.object(handler.subprocess, "Popen", side_effect=spawn), \
                patch.object(handler.time, "monotonic", clock):
            res = handler.handler(request())
        self.assertEqual((res["status"], res["error_code"], res["error_message"]),
                         ("error", "ANALYSIS_RUNTIME", "too many files or directories created in the sandbox"))
        # first watch (50 ms) + the 1 s grace wait for the killed child; wall_ms would be 23 s
        self.assertLess(res["usage"]["duration_ms"], 1_200, "stopped at the first watch, not at wall_ms")
        self.kill.assert_called_with(-1, signal.SIGKILL)
        self.assertEqual(os.listdir(self.root), [])

    def test_chain_deeper_than_the_recursion_limit_with_locked_dirs_is_wiped(self):
        make_chain(self.root, sys.getrecursionlimit() + 200)
        os.chmod(os.path.join(self.root, "d", "d", "d"), 0)  # chmod 000 by the guest
        os.chmod(os.path.join(self.root, "d"), 0o500)  # and a read-only parent
        os.symlink("/etc/passwd", os.path.join(self.root, "link"))
        self.assertTrue(handler.wipe_tmp(float("inf")))
        self.assertEqual(os.listdir(self.root), [])
        self.assertTrue(os.path.exists("/etc/passwd"))

    def test_worst_case_replies_inside_the_budget_and_the_next_run_waits_for_a_clean_tmp(self):
        # Every clock read costs 5 ms: wiping thousands of entries cannot fit,
        # yet the reply must come with the handler's envelope before wall_ms.
        clock = FakeClock(tick=0.005)
        proc = hanging_proc(clock)
        tenant_marker = "TENANT-A-SECRET"

        def spawn(args, **kwargs):
            for i in range(3000):
                os.mkdir(os.path.join(self.root, "junk-%d" % i))
            return proc

        ev = request()
        ev["inputs"][0]["rows"] = [[tenant_marker, 1]]
        with patch.object(handler.subprocess, "Popen", side_effect=spawn), \
                patch.object(handler.time, "monotonic", clock):
            res = handler.handler(ev)
        self.assertEqual(res["error_code"], "ANALYSIS_TIMEOUT")
        self.assertLessEqual(res["usage"]["duration_ms"], 25_000 - handler.RESPONSE_MARGIN_MS + 10)
        left = self.count_entries()
        self.assertGreater(left, 0, "the wipe stopped at the reply deadline")
        for dirpath, _dirs, files in os.walk(self.root):  # tenant data went first
            for f in files:
                with open(os.path.join(dirpath, f), errors="replace") as fh:
                    self.assertNotIn(tenant_marker, fh.read())

        # Next invocation: the wipe cannot finish in time -> refused, never spawned, in budget.
        slow = FakeClock(tick=0.05)
        with patch.object(handler.subprocess, "Popen") as popen, \
                patch.object(handler.time, "monotonic", slow):
            busy = handler.handler(request())
        popen.assert_not_called()
        self.assertEqual((busy["status"], busy["error_code"]), ("error", "ANALYSIS_RUNTIME"))
        self.assertTrue(busy["error_message"].startswith("sandbox busy"))
        self.assertLessEqual(busy["usage"]["duration_ms"], 25_000)

        # With normal time the wipe finishes first and the guest sees an empty /tmp.
        factory, _ = self.popen_writing(OK_PAYLOAD)

        def spawn_clean(args, **kwargs):
            self.assertEqual(os.listdir(self.root), [os.path.basename(kwargs["cwd"])])
            return factory(args, **kwargs)

        with patch.object(handler.subprocess, "Popen", side_effect=spawn_clean):
            self.assertEqual(handler.handler(request())["status"], "ok")
        self.assertEqual(os.listdir(self.root), [])


class TmpEntryTests(HandlerFixture):
    """T53 run 4, finding 7: hard links (link() creates directory entries, not
    inodes or descriptors) flooded /tmp past the inode cap; the wipe needed
    ~2 min and the next 6 invocations got "sandbox busy". The parent now caps
    the directory blocks the guest consumes and the wipe unlinks in place."""

    DIRENT = 16  # bytes of directory block per entry, as in ext4 with short names

    def setUp(self):
        super().setUp()
        self.free_bytes.side_effect = self.modelled_free_bytes

    def modelled_free_bytes(self):
        """/tmp as ext4 sees it: entries cost directory bytes, each inode its blocks once."""
        entries, data, seen = 0, 0, set()
        for dirpath, dirnames, filenames in os.walk(self.root):
            entries += len(dirnames) + len(filenames)
            for name in filenames:
                st = os.lstat(os.path.join(dirpath, name))
                if st.st_ino not in seen:
                    seen.add(st.st_ino)
                    data += st.st_blocks * 512
        return 10**12 - entries * self.DIRENT - data

    def flood_links(self, where, inodes, links):
        os.makedirs(where, exist_ok=True)
        for i in range(inodes):
            base = os.path.join(where, "f%d" % i)
            os.mkfifo(base)
            for j in range(links):
                os.link(base, "%s-%d" % (base, j))

    def test_hard_links_over_many_inodes_are_stopped_in_under_2s_and_the_next_tenant_runs(self):
        clock = FakeClock()
        proc = hanging_proc(clock)

        def spawn(args, **kwargs):  # 4 inodes x 4 500 links (~288 KiB of entries), some in /tmp itself
            self.flood_links(os.path.join(kwargs["cwd"], "x"), 4, 4_000)
            self.flood_links(self.root, 1, 2_000)
            return proc

        rename = MagicMock(wraps=os.rename)
        with patch.object(handler.subprocess, "Popen", side_effect=spawn), \
                patch.object(handler.time, "monotonic", clock), \
                patch.object(handler.os, "rename", rename):
            res = handler.handler(request())
        self.assertEqual((res["status"], res["error_code"], res["error_message"]),
                         ("error", "ANALYSIS_RUNTIME", "too many files or directories created in the sandbox"))
        self.assertLess(res["usage"]["duration_ms"], 2_000, "stopped at the first watch, not at wall_ms")
        self.kill.assert_called_with(-1, signal.SIGKILL)
        self.assertEqual(os.listdir(self.root), [], "/tmp restored before the reply")
        rename.assert_not_called()  # entries removed in place: no directory grows

        factory, _ = self.popen_writing(OK_PAYLOAD)
        with patch.object(handler.subprocess, "Popen", side_effect=factory):
            self.assertEqual(handler.handler(request(execution_id="exec-2"))["status"], "ok")
        self.assertEqual(os.listdir(self.root), [])

    def test_blocks_freed_from_tenant_files_do_not_hide_entries(self):
        clock = FakeClock()
        proc = hanging_proc(clock)
        ev = request()
        ev["inputs"][0]["rows"] = [["x" * 60, i] for i in range(4_000)]  # ~300 KB of input

        def spawn(args, **kwargs):  # frees the input's blocks, then adds ~270 KiB of entries
            os.truncate(os.path.join(kwargs["cwd"], "in", "sales.json"), 0)
            self.flood_links(os.path.join(kwargs["cwd"], "x"), 4, 4_250)
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=spawn), \
                patch.object(handler.time, "monotonic", clock):
            res = handler.handler(ev)
        self.assertEqual((res["error_code"], res["error_message"]),
                         ("ANALYSIS_RUNTIME", "too many files or directories created in the sandbox"))
        self.assertEqual(os.listdir(self.root), [])

    def test_a_large_legitimate_result_is_not_mistaken_for_entries(self):
        clock = FakeClock()
        output = {"tables": [{"title": "t", "columns": ["a", "b"],
                              "rows": [["y" * 200, i] for i in range(1_000)]}]}
        proc = MagicMock(pid=4242, returncode=0)
        waits = []

        def wait(timeout=None):  # alive at the first watch, with its ~210 KB result written
            waits.append(timeout)
            if len(waits) == 1:
                clock.advance(timeout or 0)
                raise subprocess.TimeoutExpired("x", timeout)
            return 0
        proc.wait.side_effect = wait

        def spawn(args, **kwargs):
            with open(os.path.join(kwargs["cwd"], "result.json.part"), "w") as fh:
                json.dump({"status": "ok", "output": output}, fh)
            os.replace(os.path.join(kwargs["cwd"], "result.json.part"), os.path.join(kwargs["cwd"], "result.json"))
            return proc

        with patch.object(handler.subprocess, "Popen", side_effect=spawn), \
                patch.object(handler.time, "monotonic", clock):
            res = handler.handler(request())
        self.assertEqual(res["status"], "ok", res.get("error_message"))
        self.assertGreater(len(waits), 1, "the watch ran while the child was alive")


if __name__ == "__main__":
    unittest.main()
