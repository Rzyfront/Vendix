"""Offline contracts ONLY: subprocess.Popen, os.killpg are mocked. No generated or
adversarial code runs here. Run: python3 -m unittest -v test_handler test_runner
These tests do not certify isolation; certify/ against the real Lambda does."""
import copy
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
        ]
        self.killpg = patches[2].start()
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


if __name__ == "__main__":
    unittest.main()
