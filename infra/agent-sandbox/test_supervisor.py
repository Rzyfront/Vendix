"""Offline contracts ONLY. No Docker, Deno, subprocess, network or host cgroups.

Run this exact file serially with Python stdlib unittest, not discover/all tests.
These fixtures do not certify isolation. Linux adversarial QA is a separate gate.
"""
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, Mock, patch

SPEC = importlib.util.spec_from_file_location("vendix_sandbox_supervisor", Path(__file__).with_name("supervisor.py"))
supervisor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(supervisor)

POLICY = "sha256:" + "a" * 64
RUNTIME = "sha256:" + "b" * 64


def start_frame():
    return {
        "type": "start", "execution_id": "execution-qa", "nonce": "n" * 64,
        "source": "return 6 * 7;", "language": "javascript", "tools": ["get_products"],
        "limits": dict(supervisor.MAXIMUM_LIMITS), "policy_digest": POLICY, "runtime_digest": RUNTIME,
    }


class StartContractTests(unittest.TestCase):
    def validate(self, value):
        return supervisor.validate_start(value, POLICY, RUNTIME)

    def test_accepts_bounded_javascript(self):
        self.assertEqual(self.validate(start_frame())["source"], "return 6 * 7;")

    def test_typescript_is_explicit_js_valid_subset(self):
        frame = start_frame()
        frame["language"] = "typescript"
        frame["source"] = "/** @type {number} */ const n = 6; return n * 7;"
        self.assertEqual(self.validate(frame)["language"], "typescript")

    def test_source_normalization_matches_host_audit(self):
        frame = start_frame()
        frame["source"] = 'const label = "cafe\u0301";\r\nreturn label;\r'
        self.assertEqual(self.validate(frame)["source"], 'const label = "café";\nreturn label;\n')

    def test_rejects_all_increased_or_boolean_limits(self):
        for key, maximum in supervisor.MAXIMUM_LIMITS.items():
            for value in [maximum + 1, 0, -1, True, 1.5, "1"]:
                with self.subTest(key=key, value=value), self.assertRaises(supervisor.SandboxDenied):
                    frame = start_frame()
                    frame["limits"][key] = value
                    self.validate(frame)

    def test_rejects_digests_language_nonce_and_extra_context(self):
        for key, value in [("policy_digest", RUNTIME), ("runtime_digest", POLICY),
                           ("language", "python"), ("nonce", "short"), ("nonce", "x" * 32 + "\n")]:
            with self.subTest(key=key), self.assertRaises(supervisor.SandboxDenied):
                frame = start_frame()
                frame[key] = value
                self.validate(frame)
        frame = start_frame()
        frame["context"] = {"store_id": 999}
        with self.assertRaises(supervisor.SandboxDenied):
            self.validate(frame)

    def test_rejects_source_over_utf8_budget(self):
        frame = start_frame()
        frame["source"] = "💣" * 9000
        with self.assertRaises(supervisor.SandboxDenied):
            self.validate(frame)

    def test_rejects_duplicate_or_unsafe_tool_names(self):
        for tools in [["get_products", "get_products"], ["../tool"], ["x\n"], ["__proto__"], [8]]:
            frame = start_frame()
            frame["tools"] = tools
            with self.subTest(tools=tools), self.assertRaises(supervisor.SandboxDenied):
                self.validate(frame)

    def test_rejects_parallel_limit_over_calls(self):
        frame = start_frame()
        frame["limits"]["calls"] = 1
        with self.assertRaises(supervisor.SandboxDenied):
            self.validate(frame)


class FrameContractTests(unittest.TestCase):
    def setUp(self):
        self.start = start_frame()
        self.capsule = supervisor.Capsule({}, self.start)
        self.capsule.read_metrics = Mock()

    def call(self, **kwargs):
        value = {"type": "call", "execution_id": self.start["execution_id"], "nonce": self.start["nonce"],
                 "seq": 1, "tool": "get_products", "args": {"page": 1}}
        value.update(kwargs)
        return value

    def reply(self, **kwargs):
        value = {"type": "reply", "execution_id": self.start["execution_id"], "nonce": self.start["nonce"],
                 "seq": 1, "result": {"outcome": "success", "data": []}}
        value.update(kwargs)
        return value

    def test_round_trip_requires_monotonic_sequence_and_one_reply(self):
        self.assertFalse(self.capsule.guest_frame(self.call()))
        self.assertEqual(self.capsule.pending, {1})
        self.capsule.host_frame(self.reply())
        self.assertEqual(self.capsule.pending, set())
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.host_frame(self.reply())
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.guest_frame(self.call())

    def test_guest_cannot_spoof_ready_or_reply_or_foreign_call(self):
        for frame in [self.call(type="ready"), self.reply(), self.call(nonce="x" * 64),
                      self.call(execution_id="other"), self.call(tool="run_readonly_script"),
                      self.call(seq=2), self.call(seq=True), self.call(args=[]), self.call(context={})]:
            with self.subTest(frame=frame), self.assertRaises(supervisor.SandboxDenied):
                self.capsule.guest_frame(frame)

    def test_call_concurrency_budget_is_independent_of_sdk(self):
        for seq in [1, 2, 3]:
            self.capsule.guest_frame(self.call(seq=seq))
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.guest_frame(self.call(seq=4))

    def test_calls_budget_is_cumulative_after_replies(self):
        self.capsule.start["limits"]["calls"] = 1
        self.capsule.guest_frame(self.call())
        self.capsule.host_frame(self.reply())
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.guest_frame(self.call(seq=2))

    def test_only_generic_denial_or_exact_result_reply(self):
        self.capsule.guest_frame(self.call())
        for reply in [self.reply(seq=9), self.reply(error="debug source"), self.reply(context={}),
                      self.reply(nonce="n" * 32), self.reply(seq=True)]:
            with self.subTest(reply=reply), self.assertRaises(supervisor.SandboxDenied):
                self.capsule.host_frame(reply)
        denial = self.reply()
        denial.pop("result")
        denial["error"] = "SANDBOX_DENIED"
        self.capsule.host_frame(denial)

    def test_result_waits_for_pending_and_final_metrics(self):
        frame = {"type": "result", "execution_id": self.start["execution_id"],
                 "nonce": self.start["nonce"], "value": 42}
        self.capsule.guest_frame(self.call())
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.guest_frame(frame)
        self.capsule.host_frame(self.reply())
        self.assertTrue(self.capsule.guest_frame(frame))
        self.capsule.read_metrics.assert_called_once_with()

    def test_cancel_is_bound_and_never_forwarded_to_guest(self):
        frame = {"type": "cancel", "execution_id": self.start["execution_id"], "nonce": self.start["nonce"]}
        with self.assertRaises(supervisor.SandboxDenied):
            self.capsule.host_frame(frame)

    def test_deny_json_duplicate_keys_and_nonfinite_numbers(self):
        for data in [b'{"seq":1,"seq":2}', b'{"value":NaN}', b'{"value":Infinity}', b'{"value":1e999}', b'\xff']:
            with self.subTest(data=data), self.assertRaises((supervisor.SandboxDenied, ValueError)):
                supervisor.parse_json(data)


class HostIsolationContractTests(unittest.TestCase):
    def image_fixture(self):
        return {
            "RepoDigests": ["registry/guest@" + RUNTIME], "Id": "sha256:" + "c" * 64,
            "Os": "linux", "Architecture": "amd64",
            "Config": {"Entrypoint": ["/bin/deno"], "Cmd": list(supervisor.GUEST_ARGS),
                       "Env": list(supervisor.GUEST_ENV), "User": "65532:65532"},
        }

    def test_launch_refuses_fallback_runtime_before_creating_any_capsule(self):
        config = {"runsc_path": "/usr/local/bin/runsc", "image": "registry/guest@" + RUNTIME}
        capsule = supervisor.Capsule(config, start_frame())
        capsule.docker = Mock(return_value=supervisor.json_bytes({
            "OSType": "linux", "CgroupVersion": "2", "Runtimes": {"runc": {"path": "/usr/bin/runc"}},
        }))
        with patch.object(supervisor.threading, "Thread"), \
             patch.object(supervisor.subprocess, "Popen") as spawn:
            with self.assertRaises(supervisor.SandboxDenied):
                capsule.launch()
            self.assertEqual(capsule.docker.call_count, 1)
            spawn.assert_not_called()

    def test_launch_refuses_mutable_image_unsafe_env_or_relaxed_command(self):
        config = {"runsc_path": "/usr/local/bin/runsc", "image": "registry/guest@" + RUNTIME}
        info = {"OSType": "linux", "CgroupVersion": "2",
                "Runtimes": {"runsc": {"path": config["runsc_path"]}}}
        for change in ["digest", "broker", "command", "root"]:
            with self.subTest(change=change):
                image = self.image_fixture()
                if change == "digest":
                    image["RepoDigests"] = ["registry/guest:latest"]
                elif change == "broker":
                    image["Config"]["Env"].append("DENO_PERMISSION_BROKER_PATH=/permission.sock")
                elif change == "command":
                    image["Config"]["Cmd"] = ["run", "-A", "/runtime/runner.ts"]
                else:
                    image["Config"]["User"] = "0"
                capsule = supervisor.Capsule(config, start_frame())
                capsule.docker = Mock(side_effect=[supervisor.json_bytes(info), supervisor.json_bytes([image])])
                with patch.object(supervisor.threading, "Thread"), \
                     patch.object(supervisor.subprocess, "Popen") as spawn:
                    with self.assertRaises(supervisor.SandboxDenied):
                        capsule.launch()
                    self.assertEqual(capsule.docker.call_count, 2)
                    spawn.assert_not_called()

    def test_create_uses_no_network_mount_privilege_or_mutable_pull(self):
        config = {"runsc_path": "/usr/local/bin/runsc", "image": "registry/guest@" + RUNTIME,
                  "seccomp_path": "/etc/vendix-sandbox/seccomp.json"}
        capsule = supervisor.Capsule(config, start_frame())
        info = {"OSType": "linux", "CgroupVersion": "2",
                "Runtimes": {"runsc": {"path": config["runsc_path"]}}}
        capsule.docker = Mock(side_effect=[supervisor.json_bytes(info),
                                          supervisor.json_bytes([self.image_fixture()]), b"created-id"])
        with patch.object(supervisor.threading, "Thread"), \
             patch.object(supervisor.subprocess, "Popen", side_effect=OSError("mock attach unavailable")):
            with self.assertRaises(OSError):
                capsule.launch()
        command = capsule.docker.call_args_list[2].args[0]
        for flag in ["--pull=never", "--runtime=runsc", "--network=none", "--read-only",
                     "--cap-drop=ALL", "--user=65532:65532", "--pids-limit=64", "--cpus=1",
                     "--cgroupns=private", "--ipc=none", "--log-driver=none",
                     "--security-opt=no-new-privileges:true", "--ulimit=cpu=2:2"]:
            self.assertIn(flag, command)
        self.assertTrue(all(not flag.startswith(("--mount", "--volume", "--env", "--privileged"))
                            for flag in command))
        self.assertEqual(command[-1], config["image"])

    def test_nonlinux_does_not_read_config_or_spawn(self):
        with patch.object(supervisor.platform, "system", return_value="Darwin"), \
             patch.object(supervisor, "secure_file") as read, \
             patch.object(supervisor.subprocess, "run") as spawn:
            with self.assertRaises(supervisor.SandboxDenied):
                supervisor.load_config("/not-used")
            read.assert_not_called()
            spawn.assert_not_called()

    def test_no_host_environment_or_permission_broker_reaches_guest(self):
        self.assertEqual(supervisor.HOST_ENV, {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"})
        self.assertEqual(supervisor.DOCKER, ["/usr/bin/docker", "--host=unix:///var/run/docker.sock"])
        self.assertTrue(all("DENO_PERMISSION_BROKER_PATH=" not in item for item in supervisor.GUEST_ENV))

    def test_destroy_kills_whole_capsule_and_removes_it_without_sensitive_stdio(self):
        capsule = supervisor.Capsule({}, start_frame())
        with patch.object(supervisor.subprocess, "run") as spawn:
            capsule.destroy()
            self.assertTrue(capsule.dead.is_set())
            self.assertEqual([call.args[0][-3:] for call in spawn.call_args_list[:2]],
                             [["kill", "--signal=KILL", capsule.name],
                              ["rm", "--force", capsule.name]])
            self.assertTrue(all(call.kwargs["stderr"] == supervisor.subprocess.DEVNULL
                                for call in spawn.call_args_list))
            self.assertIn("ps", spawn.call_args_list[2].args[0])

    def test_dead_capsule_does_not_spawn_docker_commands(self):
        capsule = supervisor.Capsule({}, start_frame())
        capsule.dead.set()
        with patch.object(supervisor.subprocess, "run") as spawn:
            with self.assertRaises(supervisor.SandboxDenied):
                capsule.docker(["start", "anything"])
            spawn.assert_not_called()

    def test_kernel_cgroup_kill_precedes_daemon_cleanup(self):
        capsule = supervisor.Capsule({}, start_frame())
        capsule.cgroup = MagicMock()
        kill_file = Mock(write_text=Mock())
        events_file = Mock(read_text=Mock(return_value="populated 0\nfrozen 0"))
        capsule.cgroup.__truediv__.side_effect = lambda name: kill_file if name == "cgroup.kill" else events_file
        completed = supervisor.subprocess.CompletedProcess([], 0, stdout=b"")
        with patch.object(supervisor.subprocess, "run", return_value=completed) as spawn:
            self.assertTrue(capsule.destroy())
            kill_file.write_text.assert_called_once_with("1")
            self.assertEqual(spawn.call_count, 3)

    def test_kill_failure_does_not_ack_success_even_if_docker_says_removed(self):
        capsule = supervisor.Capsule({}, start_frame())
        capsule.cgroup = MagicMock()
        kill_file = Mock(write_text=Mock(side_effect=OSError("not writable")))
        events_file = Mock(read_text=Mock(return_value="populated 0"))
        capsule.cgroup.__truediv__.side_effect = lambda name: kill_file if name == "cgroup.kill" else events_file
        completed = supervisor.subprocess.CompletedProcess([], 0, stdout=b"")
        with patch.object(supervisor.subprocess, "run", return_value=completed):
            self.assertFalse(capsule.destroy())
            self.assertFalse(capsule.cleanup_confirmed)

    def test_daemon_failure_is_not_misread_as_container_absent(self):
        capsule = supervisor.Capsule({}, start_frame())
        capsule.cgroup = MagicMock()
        capsule.cgroup.__truediv__.return_value = Mock(read_text=Mock(return_value="populated 0"))
        failed = supervisor.subprocess.CompletedProcess([], 1, stdout=b"")
        with patch.object(supervisor.subprocess, "run", return_value=failed):
            self.assertFalse(capsule.destroy())

    def test_main_result_requires_confirmed_cleanup_before_exit_zero(self):
        for cleaned in [False, True]:
            with self.subTest(cleaned=cleaned):
                capsule = Mock(watchdog_thread=None)
                capsule.destroy.return_value = cleaned
                with patch.object(supervisor.sys, "argv", ["supervisor.py", "--config", "/not-used"]), \
                     patch.object(supervisor.sys, "stderr", io.StringIO()), \
                     patch.object(supervisor.signal, "signal"), \
                     patch.object(supervisor, "load_config", return_value={"policy_digest": POLICY, "runtime_digest": RUNTIME}), \
                     patch.object(supervisor, "read_start", return_value=start_frame()), \
                     patch.object(supervisor, "Capsule", return_value=capsule):
                    self.assertEqual(supervisor.main(), 0 if cleaned else 1)
                    capsule.relay.assert_called_once_with()
                    capsule.destroy.assert_called_once_with()

    def test_cumulative_cpu_memory_and_pids_events_fail_closed(self):
        capsule = supervisor.Capsule({}, start_frame())
        for cpu, memory, pids in [
            ("usage_usec 2000000", "oom 0\noom_kill 0", "max 0"),
            ("usage_usec 1", "oom 1\noom_kill 0", "max 0"),
            ("usage_usec 1", "oom 0\noom_kill 1", "max 0"),
            ("usage_usec 1", "oom 0\noom_kill 0", "max 1"),
        ]:
            with self.subTest(cpu=cpu, memory=memory, pids=pids):
                capsule.cgroup = MagicMock()
                files = {"cpu.stat": cpu, "memory.events": memory, "pids.events": pids}
                capsule.cgroup.__truediv__.side_effect = lambda name: Mock(read_text=Mock(return_value=files[name]))
                with self.assertRaises(supervisor.SandboxDenied):
                    capsule.read_metrics()

    def test_expired_watchdog_kills_capsule_even_without_guest_frames(self):
        capsule = supervisor.Capsule({}, start_frame())
        capsule.deadline = 0
        capsule.destroy = Mock()
        capsule.watchdog()
        capsule.destroy.assert_called_once_with()

    def test_guest_cli_has_all_deny_flags_and_no_import_graph_from_source(self):
        for permission in ["read", "write", "net", "env", "run", "ffi", "sys", "import"]:
            self.assertIn("--deny-" + permission, supervisor.GUEST_ARGS)
        for flag in ["--no-prompt", "--cached-only", "--frozen", "--no-npm", "--no-remote"]:
            self.assertIn(flag, supervisor.GUEST_ARGS)
        self.assertEqual(supervisor.GUEST_ARGS[-1], "/runtime/runner.ts")
        self.assertNotIn("eval", supervisor.GUEST_ARGS)

    def test_inspect_seccomp_checks_serialized_profile_not_filepath(self):
        profile = {"defaultAction": "SCMP_ACT_ERRNO", "syscalls": []}
        supervisor.validate_security_options([
            "no-new-privileges:true", "seccomp=" + json.dumps(profile),
        ], profile)
        for value in ["unconfined", "/etc/seccomp.json", '{"defaultAction":"SCMP_ACT_ALLOW"}']:
            with self.subTest(value=value), self.assertRaises((supervisor.SandboxDenied, ValueError)):
                supervisor.validate_security_options(["no-new-privileges:true", "seccomp=" + value], profile)

    def test_policy_caps_match_supervisor_and_dockerfile_cli(self):
        root = Path(__file__).parent
        self.assertEqual(json.loads((root / "security-policy.json").read_text())["maximum_limits"],
                         supervisor.MAXIMUM_LIMITS)
        dockerfile = (root / "Dockerfile").read_text()
        command = next(line[4:] for line in dockerfile.splitlines() if line.startswith("CMD "))
        self.assertEqual(json.loads(command), supervisor.GUEST_ARGS)
        self.assertIn("@sha256:", dockerfile)
        self.assertNotIn("RUN ", dockerfile)


if __name__ == "__main__":
    unittest.main()
