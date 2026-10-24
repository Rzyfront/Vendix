#!/usr/bin/python3 -I
"""Trusted Linux-only local stdio adapter. No guest execution outside runsc.

Operator installation, root-owned config/review/seccomp, cgroup v2 and an already
present immutable guest image are prerequisites. No auto-pull, setup or fallback.
The guest is adversarial; ready is emitted here, never accepted from the guest.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import selectors
import select
import signal
import stat
import subprocess
import sys
import threading
import time
import unicodedata
import uuid

MAXIMUM_LIMITS = {
    "wall_ms": 30000, "cpu_ms": 2000, "memory_mb": 256, "calls": 20,
    "concurrency": 3, "pages": 10, "rows": 5000, "input_bytes": 2097152,
    "output_bytes": 65536, "source_bytes": 32768,
}
GUEST_ARGS = [
    "run", "--no-prompt", "--cached-only", "--frozen", "--no-npm", "--no-remote",
    "--no-code-cache", "--deny-read", "--deny-write", "--deny-net", "--deny-env",
    "--deny-run", "--deny-ffi", "--deny-sys", "--deny-import",
    "--config=/runtime/deno.json", "--lock=/runtime/deno.lock", "/runtime/runner.ts",
]
GUEST_ENV = sorted([
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt", "DENO_USE_CGROUPS=1",
    "DENO_DIR=/deno-dir/", "DENO_INSTALL_ROOT=/usr/local", "DENO_VERSION=2.9.7",
    "DENO_NO_UPDATE_CHECK=1", "DENO_NO_PROMPT=1", "NO_COLOR=1",
])
HOST_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"}
DOCKER = ["/usr/bin/docker", "--host=unix:///var/run/docker.sock"]
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
NAME = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
TOOL = re.compile(r"[a-z][a-z0-9_]{0,99}\Z")
INTERRUPTED = threading.Event()


class SandboxDenied(Exception):
    pass


def require(condition):
    if not condition:
        raise SandboxDenied()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def parse_json(data):
    def invalid_constant(_):
        raise SandboxDenied()
    def finite_float(value):
        number = float(value)
        require(math.isfinite(number))
        return number
    return json.loads(data.decode("utf-8", errors="strict"),
                      object_pairs_hook=unique_object, parse_constant=invalid_constant,
                      parse_float=finite_float)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def secure_file(path, maximum=131072):
    """Only immutable-to-nonroot operator files, with no symlink components."""
    path = Path(path)
    require(path.is_absolute() and ".." not in path.parts)
    for component in [path, *path.parents]:
        info = component.lstat()
        require(not stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and
                not (info.st_mode & 0o022))
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_size <= maximum)
    with path.open("rb") as stream:
        data = stream.read(maximum + 1)
    require(len(data) <= maximum)
    return data


def sha256(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def validate_security_options(options, seccomp_profile):
    """Docker CLI serializes seccomp file contents into HostConfig.SecurityOpt."""
    require(isinstance(options, list) and len(options) == 2)
    no_privileges = [value for value in options if value in (
        "no-new-privileges", "no-new-privileges:true", "no-new-privileges=true",
    )]
    profiles = [value[len("seccomp="):] for value in options
                if isinstance(value, str) and value.startswith("seccomp=")]
    require(len(no_privileges) == 1 and len(profiles) == 1)
    require(parse_json(profiles[0].encode("utf-8")) == seccomp_profile)


def validate_start(frame, policy_digest, runtime_digest):
    require(isinstance(frame, dict) and set(frame) == {
        "type", "execution_id", "nonce", "source", "language", "tools", "limits",
        "policy_digest", "runtime_digest",
    })
    require(frame["type"] == "start" and isinstance(frame["execution_id"], str) and
            NAME.fullmatch(frame["execution_id"]) and isinstance(frame["nonce"], str) and
            32 <= len(frame["nonce"]) <= 128 and NAME.fullmatch(frame["nonce"]))
    require(frame["policy_digest"] == policy_digest and
            frame["runtime_digest"] == runtime_digest and
            frame["language"] in ("javascript", "typescript"))
    limits = frame["limits"]
    require(isinstance(limits, dict) and set(limits) == set(MAXIMUM_LIMITS))
    for key, maximum in MAXIMUM_LIMITS.items():
        require(type(limits[key]) is int and 0 < limits[key] <= maximum)
    require(limits["concurrency"] <= limits["calls"])
    require(isinstance(frame["source"], str))
    source = unicodedata.normalize("NFC", frame["source"].replace("\r\n", "\n").replace("\r", "\n"))
    require(len(source.encode("utf-8")) <= limits["source_bytes"])
    frame["source"] = source
    tools = frame["tools"]
    require(isinstance(tools, list) and len(tools) <= 20 and
            all(isinstance(tool, str) and TOOL.fullmatch(tool) for tool in tools) and
            len(set(tools)) == len(tools))
    return frame


def load_config(path):
    require(platform.system() == "Linux" and platform.machine() == "x86_64")
    config = parse_json(secure_file(path))
    require(isinstance(config, dict) and set(config) == {"image", "runtime_digest", "policy_path", "policy_digest",
                            "seccomp_path", "seccomp_digest", "runsc_path", "runsc_digest",
                            "review_path", "review_digest"})
    for key in ("runtime_digest", "policy_digest", "seccomp_digest", "runsc_digest", "review_digest"):
        require(isinstance(config[key], str) and DIGEST.fullmatch(config[key]))
    require(isinstance(config["image"], str) and
            re.fullmatch(r"[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}", config["image"]) and
            config["image"].endswith("@" + config["runtime_digest"]))
    policy = secure_file(config["policy_path"])
    require(sha256(policy) == config["policy_digest"] and
            parse_json(policy)["maximum_limits"] == MAXIMUM_LIMITS)
    seccomp = secure_file(config["seccomp_path"])
    require(sha256(seccomp) == config["seccomp_digest"])
    seccomp_profile = parse_json(seccomp)
    require(isinstance(seccomp_profile, dict) and seccomp_profile.get("defaultAction") == "SCMP_ACT_ERRNO" and
            isinstance(seccomp_profile.get("syscalls"), list) and bool(seccomp_profile["syscalls"]))
    require(sha256(secure_file(config["runsc_path"], 256 * 1024 * 1024)) == config["runsc_digest"])
    review_data = secure_file(config["review_path"])
    require(sha256(review_data) == config["review_digest"])
    review = parse_json(review_data)
    require(isinstance(review, dict) and review.get("isolation_validated") is True and
            review.get("independent_review_approved") is True and
            isinstance(review.get("environment_id"), str) and bool(review["environment_id"]) and
            review.get("runtime_digest") == config["runtime_digest"] and
            review.get("policy_digest") == config["policy_digest"] and
            review.get("seccomp_digest") == config["seccomp_digest"] and
            review.get("runsc_digest") == config["runsc_digest"] and
            review.get("supervisor_digest") == sha256(secure_file(__file__)))
    return config


class Capsule:
    def __init__(self, config, start):
        self.config = config
        self.start = start
        self.name = "vendix-sandbox-" + uuid.uuid4().hex
        self.deadline = time.monotonic() + start["limits"]["wall_ms"] / 1000
        self.dead = threading.Event()
        self.cleanup_lock = threading.Lock()
        self.cleanup_deadline = None
        self.cleanup_confirmed = False
        self.kernel_kill_requested = False
        self.cgroup = None
        self.attach = None
        self.watchdog_thread = None
        self.cpu_max_usec = start["limits"]["cpu_ms"] * 1000
        self.last_sequence = 0
        self.pending = set()
        self.input_bytes = 0
        self.output_bytes = 0

    def docker(self, args, timeout=None):
        require(not self.dead.is_set() and not INTERRUPTED.is_set())
        remaining = self.deadline - time.monotonic()
        require(remaining > 0)
        response = subprocess.run(DOCKER + args, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  timeout=min(remaining, timeout or 3), env=HOST_ENV,
                                  check=True, start_new_session=True)
        require(len(response.stdout) <= 1048576)
        return response.stdout

    def destroy(self):
        # Name chosen BEFORE create: also cleans a container whose CLI timed out.
        # No docker --rm race and no PID-only kill that would leave workers alive.
        self.dead.set()
        with self.cleanup_lock:
            if self.cleanup_confirmed:
                return True
            if self.cleanup_deadline is None:
                self.cleanup_deadline = time.monotonic() + 8
            if time.monotonic() >= self.cleanup_deadline:
                return False
            # Independent of Docker daemon responsiveness. This cgroup was resolved
            # from the running capsule PID and verified as a non-root descendant.
            if self.cgroup is not None:
                try:
                    (self.cgroup / "cgroup.kill").write_text("1")
                    self.kernel_kill_requested = True
                except OSError:
                    pass
            for command in (["kill", "--signal=KILL", self.name], ["rm", "--force", self.name]):
                try:
                    subprocess.run(DOCKER + command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=max(0.001, min(2, self.cleanup_deadline - time.monotonic())),
                                   env=HOST_ENV, start_new_session=True, check=False)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            # A failed inspect is ambiguous (not-found OR daemon unavailable).
            # Successful ps with an exact random-name filter and no row is proof
            # of removal; without it even a result cannot become exit0.
            container_absent = False
            try:
                listed = subprocess.run(
                    DOCKER + ["ps", "--all", "--filter", "name=^/" + self.name + "$", "--format", "{{.ID}}"],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    timeout=max(0.001, min(2, self.cleanup_deadline - time.monotonic())),
                    env=HOST_ENV, start_new_session=True, check=False,
                )
                container_absent = listed.returncode == 0 and not listed.stdout.strip()
            except (OSError, subprocess.TimeoutExpired):
                pass
            if self.attach and self.attach.poll() is None:
                try:
                    os.killpg(self.attach.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                try:
                    self.attach.wait(timeout=max(0.001, min(1, self.cleanup_deadline - time.monotonic())))
                except subprocess.TimeoutExpired:
                    pass
            empty = False
            # Kernel kill completion is observed, not assumed from a write/exit0.
            while self.cgroup is not None and time.monotonic() < self.cleanup_deadline:
                try:
                    events = dict(line.split() for line in (self.cgroup / "cgroup.events").read_text().splitlines())
                    empty = events.get("populated") == "0"
                except FileNotFoundError:
                    empty = True  # Deleted, previously verified cgroup cannot hold tasks.
                except (OSError, ValueError):
                    break
                if empty:
                    break
                time.sleep(0.02)
            self.cleanup_confirmed = bool(self.kernel_kill_requested and empty and container_absent and
                                          (self.attach is None or self.attach.poll() is not None))
            return self.cleanup_confirmed

    def read_metrics(self):
        require(self.cgroup is not None)
        cpu = dict(line.split() for line in (self.cgroup / "cpu.stat").read_text().splitlines())
        memory = dict(line.split() for line in (self.cgroup / "memory.events").read_text().splitlines())
        pids = dict(line.split() for line in (self.cgroup / "pids.events").read_text().splitlines())
        require(int(cpu["usage_usec"]) < self.cpu_max_usec and
                int(memory.get("oom", "0")) == 0 and int(memory.get("oom_kill", "0")) == 0 and
                int(pids.get("max", "0")) == 0)

    def watchdog(self):
        while not self.dead.wait(0.02):
            try:
                require(not INTERRUPTED.is_set() and time.monotonic() < self.deadline)
                if self.cgroup is not None:
                    self.read_metrics()
            except (SandboxDenied, OSError, ValueError, KeyError):
                self.destroy()
                return

    def launch(self):
        self.watchdog_thread = threading.Thread(target=self.watchdog, daemon=True)
        self.watchdog_thread.start()
        info = parse_json(self.docker(["info", "--format", "{{json .}}"] ))
        require(info.get("OSType") == "linux" and str(info.get("CgroupVersion")) == "2" and
                info.get("Runtimes", {}).get("runsc", {}).get("path") == self.config["runsc_path"])
        image = parse_json(self.docker(["image", "inspect", self.config["image"]]))[0]
        require(self.config["image"] in (image.get("RepoDigests") or []) and
                image.get("Os") == "linux" and image.get("Architecture") == "amd64" and
                image["Config"].get("Entrypoint") == ["/bin/deno"] and
                image["Config"].get("Cmd") == GUEST_ARGS and
                sorted(image["Config"].get("Env") or []) == GUEST_ENV and
                image["Config"].get("User") == "65532:65532" and
                not image["Config"].get("Volumes") and not image["Config"].get("Healthcheck"))
        limits = self.start["limits"]
        memory = limits["memory_mb"] * 1024 * 1024
        cpu_seconds = max(1, math.ceil(limits["cpu_ms"] / 1000))
        security = ["no-new-privileges:true", "seccomp=" + self.config["seccomp_path"]]
        args = [
            "create", "--pull=never", "--name=" + self.name, "--runtime=runsc", "--interactive",
            "--network=none", "--read-only", "--cap-drop=ALL", "--user=65532:65532",
            "--pids-limit=64", "--cpus=1", "--memory=" + str(memory),
            "--memory-swap=" + str(memory), "--ulimit=cpu=" + str(cpu_seconds) + ":" + str(cpu_seconds),
            "--ulimit=nproc=64:64", "--ulimit=nofile=64:64", "--ipc=none", "--cgroupns=private",
            "--hostname=sandbox", "--workdir=/runtime", "--log-driver=none", "--stop-timeout=1",
        ]
        for option in security:
            args += ["--security-opt=" + option]
        args += [self.config["image"]]
        self.docker(args)
        self.attach = subprocess.Popen(DOCKER + ["start", "--attach", "--interactive", self.name],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, env=HOST_ENV, start_new_session=True)
        while True:
            inspect = parse_json(self.docker(["inspect", self.name]))[0]
            if inspect["State"].get("Running"):
                break
            require(self.attach.poll() is None)
            time.sleep(0.02)
        host = inspect["HostConfig"]
        require(inspect["Image"] == image["Id"] and inspect["Config"].get("Image") == self.config["image"] and
                inspect["Config"].get("User") == "65532:65532" and
                inspect["Config"].get("Entrypoint") == ["/bin/deno"] and
                inspect["Config"].get("Cmd") == GUEST_ARGS and
                sorted(inspect["Config"].get("Env") or []) == GUEST_ENV and
                not inspect.get("Mounts") and host.get("Runtime") == "runsc" and
                host.get("NetworkMode") == "none" and host.get("ReadonlyRootfs") is True and
                host.get("Privileged") is False and host.get("CapDrop") == ["ALL"] and
                not host.get("CapAdd") and
                host.get("PidsLimit") == 64 and host.get("NanoCpus") == 1000000000 and
                host.get("Memory") == memory and host.get("MemorySwap") == memory and
                host.get("IpcMode") == "none" and host.get("CgroupnsMode") == "private" and
                not host.get("PidMode") and not host.get("Binds") and not host.get("Tmpfs") and
                not host.get("Devices") and not host.get("DeviceRequests") and
                not host.get("PortBindings") and not host.get("PublishAllPorts") and
                host.get("LogConfig", {}).get("Type") == "none")
        validate_security_options(host.get("SecurityOpt"),
                                  parse_json(secure_file(self.config["seccomp_path"])))
        pid = inspect["State"].get("Pid")
        require(type(pid) is int and pid > 0)
        cgroups = Path("/proc", str(pid), "cgroup").read_text().splitlines()
        require(len(cgroups) == 1 and cgroups[0].startswith("0::/"))
        root = Path("/sys/fs/cgroup").resolve()
        cgroup = (root / cgroups[0][4:]).resolve()
        require(cgroup != root and root in cgroup.parents)
        require(int((cgroup / "memory.max").read_text().strip()) == memory and
                int((cgroup / "memory.swap.max").read_text().strip()) == 0 and
                int((cgroup / "pids.max").read_text().strip()) == 64)
        quota, period = map(int, (cgroup / "cpu.max").read_text().split())
        require(quota > 0 and quota == period)
        require((cgroup / "cgroup.kill").is_file() and os.access(cgroup / "cgroup.kill", os.W_OK))
        self.cgroup = cgroup
        self.read_metrics()
        require(not self.dead.is_set())

    def send(self, descriptor, data):
        offset = 0
        while offset < len(data):
            require(not self.dead.is_set() and not INTERRUPTED.is_set() and
                    time.monotonic() < self.deadline)
            _, ready, _ = select.select([], [descriptor], [], 0.02)
            if ready:
                try:
                    offset += os.write(descriptor, data[offset:])
                except BlockingIOError:
                    pass

    def validate_identity(self, frame):
        require(isinstance(frame, dict) and frame.get("execution_id") == self.start["execution_id"] and
                frame.get("nonce") == self.start["nonce"])

    def guest_frame(self, frame):
        self.validate_identity(frame)
        base = {"type", "execution_id", "nonce"}
        if frame.get("type") == "call":
            require(set(frame) == base | {"seq", "tool", "args"} and
                    type(frame["seq"]) is int and frame["seq"] == self.last_sequence + 1 and
                    frame["seq"] <= self.start["limits"]["calls"] and
                    isinstance(frame["tool"], str) and frame["tool"] in self.start["tools"] and
                    isinstance(frame["args"], dict) and
                    len(self.pending) < self.start["limits"]["concurrency"])
            self.last_sequence = frame["seq"]
            self.pending.add(frame["seq"])
            return False
        require(frame.get("type") == "result" and set(frame) == base | {"value"} and not self.pending)
        self.read_metrics()
        return True

    def host_frame(self, frame):
        self.validate_identity(frame)
        base = {"type", "execution_id", "nonce"}
        if frame.get("type") == "cancel":
            require(set(frame) == base)
            raise SandboxDenied()
        require(frame.get("type") == "reply" and type(frame.get("seq")) is int and
                frame["seq"] in self.pending and
                (set(frame) == base | {"seq", "result"} or
                 (set(frame) == base | {"seq", "error"} and frame["error"] == "SANDBOX_DENIED")))
        self.pending.remove(frame["seq"])

    def relay(self):
        limits = self.start["limits"]
        output = sys.stdout.fileno()
        guest_input = self.attach.stdin.fileno()
        os.set_blocking(output, False)
        os.set_blocking(guest_input, False)
        self.send(output, json_bytes({
            "type": "ready", "execution_id": self.start["execution_id"], "nonce": self.start["nonce"],
            "policy_digest": self.config["policy_digest"], "runtime_digest": self.config["runtime_digest"],
            "isolation": "gvisor",
        }))
        # The generated source reaches the capsule ONLY AFTER launch verification.
        self.send(guest_input, json_bytes(self.start))
        selector = selectors.DefaultSelector()
        buffers = {"host": bytearray(), "guest": bytearray()}
        for descriptor, label in [(sys.stdin.fileno(), "host"),
                                  (self.attach.stdout.fileno(), "guest"),
                                  (self.attach.stderr.fileno(), "stderr")]:
            os.set_blocking(descriptor, False)
            selector.register(descriptor, selectors.EVENT_READ, label)
        try:
            while not self.dead.is_set():
                require(not INTERRUPTED.is_set() and time.monotonic() < self.deadline)
                for event, _ in selector.select(0.02):
                    label = event.data
                    chunk = os.read(event.fd, 8192)
                    require(bool(chunk))  # EOF is cancellation/failure, never a result.
                    require(label != "stderr")  # Never relay runtime/source diagnostics.
                    if label == "guest":
                        self.output_bytes += len(chunk)
                        require(self.output_bytes <= limits["output_bytes"])
                    else:
                        self.input_bytes += len(chunk)
                        require(self.input_bytes <= limits["input_bytes"])
                    buffer = buffers[label]
                    buffer.extend(chunk)
                    cap = limits["output_bytes"] if label == "guest" else limits["input_bytes"]
                    require(len(buffer) <= cap)
                    while b"\n" in buffer:
                        line, _, remainder = buffer.partition(b"\n")
                        buffer[:] = remainder
                        frame = parse_json(bytes(line))
                        if label == "guest":
                            terminal = self.guest_frame(frame)
                            # Duplicate/late frames in the same read cannot hide behind result.
                            require(not terminal or not buffer)
                            self.send(output, json_bytes(frame))
                            if terminal:
                                return
                        else:
                            self.host_frame(frame)
                            self.send(guest_input, json_bytes(frame))
            raise SandboxDenied()
        finally:
            selector.close()


def read_start():
    descriptor = sys.stdin.fileno()
    os.set_blocking(descriptor, False)
    deadline = time.monotonic() + 5
    buffer = bytearray()
    while time.monotonic() < deadline and not INTERRUPTED.is_set():
        readable, _, _ = select.select([descriptor], [], [], 0.05)
        if readable:
            chunk = os.read(descriptor, 8192)
            require(bool(chunk))
            buffer.extend(chunk)
            require(len(buffer) <= 131072)
            if b"\n" in buffer:
                line, _, remaining = buffer.partition(b"\n")
                require(not remaining)
                return parse_json(bytes(line))
    raise SandboxDenied()


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: INTERRUPTED.set())
    signal.signal(signal.SIGINT, lambda *_: INTERRUPTED.set())
    capsule = None
    success = False
    cleaned = False
    try:
        config = load_config(args.config)
        start = validate_start(read_start(), config["policy_digest"], config["runtime_digest"])
        capsule = Capsule(config, start)
        capsule.launch()
        capsule.relay()
        success = True
    except (SandboxDenied, OSError, ValueError, KeyError, TypeError, IndexError,
            RecursionError, subprocess.SubprocessError):
        # Stable, non-sensitive category only. Backend audit owns detailed reason.
        sys.stderr.write("SANDBOX_UNAVAILABLE_OR_DENIED\n")
    finally:
        if capsule:
            cleaned = capsule.destroy()
            if capsule.watchdog_thread:
                capsule.watchdog_thread.join(timeout=5)
    if success and not cleaned:
        sys.stderr.write("SANDBOX_UNAVAILABLE_OR_DENIED\n")
    return 0 if success and cleaned else 1


if __name__ == "__main__":
    sys.exit(main())
