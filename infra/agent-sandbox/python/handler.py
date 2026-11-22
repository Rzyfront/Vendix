"""AWS Lambda entrypoint of the Vex analysis sandbox (protocol vendix.analysis/v1).

Contract mirrored from apps/backend/src/ai-engine/sandbox/interfaces/
analysis-protocol.interface.ts. Containment is the Lambda itself: VPC without
egress, empty execution role, no secrets, read-only code. On top of it, EVERY
execution gets a private /tmp dir and a NEW child process in its own session
with rlimits; the whole process group, and then every other task of the guest
uid (kill(-1)), is SIGKILLed afterwards and /tmp wiped, because the execution
environment is reused between invocations.

Never log source, inputs or outputs.
"""
import ctypes
import ctypes.util
import errno
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

import runner

PROTOCOL = "vendix.analysis/v1"
TMP_ROOT = "/tmp"
RUNNER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.py")
TMP_PREFIX = "analysis-"

# Hard maxima baked in: request limits above these are clamped, never trusted.
HARD_LIMITS = {
    "wall_ms": 25_000, "cpu_s": 15, "memory_mb": 768,
    "source_bytes": 32 * 1024, "input_bytes": 2 * 1024 * 1024,
    "input_tables": 5, "input_rows": 5_000, "input_columns": 50,
    "output_bytes": 256 * 1024, "output_tables": 5, "output_series": 6,
    "output_figures": 20, "output_rows": 1_000, "output_points": 1_000,
}
NPROC_LIMIT = 64
# The host aborts at exactly wall_ms. The child gets wall_ms minus this reserve
# so kill, reap and /tmp removal still reply in time: a timed-out run must reach
# the host as ANALYSIS_TIMEOUT, not as an expired call (T53: ~0.7 s teardown).
TEARDOWN_RESERVE_MS = 2_000
FSIZE_SLACK = 1024 * 1024
LOG_READ_BYTES = 4096

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_NONCE_RE = re.compile(r"^[0-9a-f]{64}$")
_EXEC_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_PR_SET_DUMPABLE = 4


def _valid_runtime_digest():
    digest = os.environ.get("ANALYSIS_RUNTIME_DIGEST", "")
    if not _DIGEST_RE.match(digest) or digest == "sha256:" + "0" * 64:
        return None
    return digest


def _kernel_marked_non_dumpable():
    """True when the kernel already treats this process as non-dumpable.

    The /proc/<pid> inodes of a non-dumpable task are owned by root, so a
    process whose effective uid is not root but whose /proc/self/environ belongs
    to uid 0 is non-dumpable.
    """
    try:
        return os.geteuid() != 0 and os.stat("/proc/self/environ").st_uid == 0
    except OSError:
        return False


def _harden_parent_dumpable():
    """On Linux, make the parent non-dumpable so the same-uid child cannot read
    /proc/<ppid>/{environ,mem,maps,fd}, use process_vm_readv or ptrace it.

    AWS Lambda's seccomp profile denies every prctl with EPERM (T53). There the
    interpreter is execute-only (Dockerfile: chmod 0711), and exec'ing an
    unreadable binary already made this process non-dumpable. The EPERM is
    accepted ONLY under that proof; anything else fails closed.
    """
    if not sys.platform.startswith("linux"):
        return
    libc_name = ctypes.util.find_library("c") or "libc.so.6"
    libc = ctypes.CDLL(libc_name, use_errno=True)
    if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) == 0:
        return
    err = ctypes.get_errno()
    if err == errno.EPERM and _kernel_marked_non_dumpable():
        return
    raise OSError(err, "prctl(PR_SET_DUMPABLE, 0) failed")


class RequestError(Exception):
    pass


def _reject_constant(token):
    raise ValueError("non-finite number")


def _strict_cell(value):
    if value is None or isinstance(value, (str, bool, int)):
        return True
    if isinstance(value, float):
        return value == value and value not in (float("inf"), float("-inf"))
    return False


def validate_request(event):
    """Return (execution_id, nonce, source, inputs, limits) or raise RequestError."""
    if not isinstance(event, dict):
        raise RequestError("request must be an object")
    if event.get("protocol") != PROTOCOL:
        raise RequestError("unsupported protocol")
    if not isinstance(event.get("execution_id"), str) or not _EXEC_ID_RE.match(event["execution_id"]):
        raise RequestError("invalid execution_id")
    if not isinstance(event.get("nonce"), str) or not _NONCE_RE.match(event["nonce"]):
        raise RequestError("invalid nonce")
    if event.get("language") != "python":
        raise RequestError("unsupported language")

    raw_limits = event.get("limits")
    if not isinstance(raw_limits, dict):
        raise RequestError("limits missing")
    limits = {}
    for key, hard in HARD_LIMITS.items():
        value = raw_limits.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise RequestError("invalid limit %s" % key)
        limits[key] = min(value, hard)

    source = event.get("source")
    if not isinstance(source, str) or not source.strip():
        raise RequestError("source must be a non-empty string")
    if len(source.encode("utf-8")) > limits["source_bytes"]:
        raise RequestError("source exceeds %d bytes" % limits["source_bytes"])
    if "\x00" in source:
        raise RequestError("source contains NUL")

    inputs = event.get("inputs")
    if not isinstance(inputs, list) or len(inputs) > limits["input_tables"]:
        raise RequestError("too many input tables")
    seen = set()
    for table in inputs:
        if not isinstance(table, dict):
            raise RequestError("input must be an object")
        name = table.get("name")
        if not isinstance(name, str) or not _NAME_RE.match(name) or name in seen:
            raise RequestError("invalid input name")
        seen.add(name)
        columns, rows = table.get("columns"), table.get("rows")
        if not isinstance(columns, list) or not columns or len(columns) > limits["input_columns"]:
            raise RequestError("invalid input columns")
        if any(not isinstance(c, str) or not c or len(c) > 64 for c in columns) or len(set(columns)) != len(columns):
            raise RequestError("invalid input column name")
        if not isinstance(rows, list) or len(rows) > limits["input_rows"]:
            raise RequestError("too many input rows")
        for row in rows:
            if not isinstance(row, list) or len(row) != len(columns) or not all(_strict_cell(c) for c in row):
                raise RequestError("invalid input row")
    try:
        size = len(json.dumps(inputs, allow_nan=False, separators=(",", ":")).encode("utf-8"))
    except ValueError:
        raise RequestError("inputs contain non-finite numbers")
    if size > limits["input_bytes"]:
        raise RequestError("inputs exceed %d bytes" % limits["input_bytes"])
    return event["execution_id"], event["nonce"], source, inputs, limits


def _rm(path):
    def onerror(func, p, _exc):
        try:
            os.chmod(os.path.dirname(p) or ".", 0o700)
            os.chmod(p, 0o700)
            func(p)
        except OSError:
            pass
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path, onerror=onerror)
    else:
        try:
            os.unlink(path)
        except OSError:
            pass


def wipe_tmp():
    """Remove everything under TMP_ROOT (one invocation at a time per environment)."""
    try:
        entries = os.listdir(TMP_ROOT)
    except OSError:
        return
    for entry in entries:
        _rm(os.path.join(TMP_ROOT, entry))


def _write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(data)


def _child_env(tmpdir):
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C.UTF-8",
        "HOME": tmpdir,
        "TMPDIR": tmpdir,
        "PYTHONDONTWRITEBYTECODE": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
    }
    assert not any(k.startswith("AWS_") for k in env)
    return env


def _limit_child(limits):
    def apply():
        import resource
        mem = limits["memory_mb"] * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (limits["cpu_s"], limits["cpu_s"] + 1))
        resource.setrlimit(resource.RLIMIT_NPROC, (NPROC_LIMIT, NPROC_LIMIT))
        fsize = limits["output_bytes"] + FSIZE_SLACK
        resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    return apply


def _kill_group(pid):
    # start_new_session=True makes the child its own group leader (pgid == pid).
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _reap_strays():
    """SIGKILL every task this process may signal, except itself and init.

    killpg cannot reach a guest that double-forked and called setsid: such a
    daemon survived and read the next tenant's data from /tmp (T53). Inside
    Lambda the handler is the top task of its PID namespace (ppid 0) and shares
    its uid only with guest processes (no layers/extensions), so kill(-1)
    removes every guest survivor. The kernel applies it under the tasklist lock
    (no race with fork) and SIGKILL cannot be caught. Outside that namespace
    (a developer machine) it refuses and fails closed.
    """
    if os.getppid() != 0:
        raise OSError(errno.EPERM, "refusing kill(-1) outside the Lambda PID namespace")
    try:
        os.kill(-1, signal.SIGKILL)
    except ProcessLookupError:  # ESRCH: nothing else alive in the namespace
        pass


def _read_stream(fh, limit=LOG_READ_BYTES):
    try:
        fh.flush()
        fh.seek(0)
        return fh.read(limit).decode("utf-8", "replace")
    except OSError:
        return ""


def _read_result(tmpdir, limits):
    path = os.path.join(tmpdir, "result.json")
    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        return None
    except OSError:
        raise runner.OutputError("result file cannot be opened safely")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise runner.OutputError("result file is not a regular file")
        if st.st_size > limits["output_bytes"] + 1024:
            raise runner.OutputError("output exceeds %d bytes" % limits["output_bytes"])
        with os.fdopen(fd, "rb") as fh:
            fd = -1
            data = fh.read(limits["output_bytes"] + 1025)
    finally:
        if fd >= 0:
            os.close(fd)
    if len(data) > limits["output_bytes"] + 1024:
        raise runner.OutputError("output exceeds %d bytes" % limits["output_bytes"])
    try:
        return json.loads(data.decode("utf-8"), parse_constant=_reject_constant)
    except ValueError:
        raise runner.OutputError("result file is not valid JSON")


def _execute(tmpdir, source, inputs, limits):
    """Run one child. Returns (code, message, output); code None means ok."""
    os.mkdir(os.path.join(tmpdir, "in"), 0o700)
    for table in inputs:
        _write_private(os.path.join(tmpdir, "in", table["name"] + ".json"),
                       json.dumps({"columns": table["columns"], "rows": table["rows"]}, allow_nan=False))
    _write_private(os.path.join(tmpdir, "source.py"), source)
    _write_private(os.path.join(tmpdir, "limits.json"), json.dumps(limits))

    timed_out = False
    err_tail = ""
    # Anonymous unlinked descriptors in TMP_ROOT: the child cannot unlink,
    # symlink or replace them with a FIFO inside tmpdir.
    with tempfile.TemporaryFile(dir=TMP_ROOT) as fo, tempfile.TemporaryFile(dir=TMP_ROOT) as fe:
        proc = subprocess.Popen(
            [sys.executable, "-I", RUNNER_PATH, tmpdir],
            cwd=tmpdir, env=_child_env(tmpdir), stdin=subprocess.DEVNULL,
            stdout=fo, stderr=fe, close_fds=True, start_new_session=True,
            preexec_fn=_limit_child(limits),
        )
        try:
            proc.wait(timeout=max(1, limits["wall_ms"] - TEARDOWN_RESERVE_MS) / 1000.0)
        except subprocess.TimeoutExpired:
            timed_out = True
        finally:
            try:
                _kill_group(proc.pid)
            finally:
                _reap_strays()  # also what escaped the group (double fork + setsid)
        if timed_out:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        else:
            err_tail = _read_stream(fe)
    if timed_out:
        return "ANALYSIS_TIMEOUT", "wall time limit exceeded", None

    try:
        payload = _read_result(tmpdir, limits)
    except runner.OutputError as exc:
        return "ANALYSIS_OUTPUT", str(exc), None
    rc = proc.returncode
    if payload is None:
        if rc is not None and rc < 0:
            sig = -rc
            if sig == signal.SIGXCPU:
                return "ANALYSIS_TIMEOUT", "cpu time limit exceeded", None
            if sig in (signal.SIGKILL, signal.SIGSEGV, signal.SIGABRT, signal.SIGBUS):
                return "ANALYSIS_MEMORY", "process killed (memory limit)", None
        tail = runner.sanitize_message(err_tail) or "child exited without a result"
        return "ANALYSIS_RUNTIME", tail, None
    if not isinstance(payload, dict):
        return "ANALYSIS_OUTPUT", "result file malformed", None
    if payload.get("status") == "error":
        code = payload.get("error_code")
        if code not in runner.ERROR_CODES:
            code = "ANALYSIS_RUNTIME"
        return code, runner.sanitize_message(payload.get("error_message") or "analysis failed"), None
    try:
        output = runner.validate_output(payload.get("output"), limits)
    except runner.OutputError as exc:
        return "ANALYSIS_OUTPUT", runner.sanitize_message(str(exc)), None
    return None, None, output


def _response(execution_id, nonce, status, started, code=None, message=None, output=None):
    digest = _valid_runtime_digest()
    if digest is None:
        status, code, message, output = "error", "ANALYSIS_RUNTIME", "runtime digest missing", None
        digest = "sha256:" + "0" * 64  # shape-valid placeholder; the host rejects it
    body = {
        "protocol": PROTOCOL, "execution_id": execution_id, "nonce": nonce,
        "runtime_digest": digest, "status": status,
        "usage": {"duration_ms": int((time.monotonic() - started) * 1000)},
    }
    if status == "ok":
        body["output"] = output
    else:
        body["error_code"], body["error_message"] = code, (message or "")[:500]
    return body


def handler(event, context=None):
    started = time.monotonic()
    echo_id = event.get("execution_id") if isinstance(event, dict) else None
    echo_nonce = event.get("nonce") if isinstance(event, dict) else None
    echo_id = echo_id if isinstance(echo_id, str) and _EXEC_ID_RE.match(echo_id) else ""
    echo_nonce = echo_nonce if isinstance(echo_nonce, str) and _NONCE_RE.match(echo_nonce) else ""
    if _valid_runtime_digest() is None:
        return _response(echo_id, echo_nonce, "error", started, "ANALYSIS_RUNTIME", "runtime digest missing")
    try:
        execution_id, nonce, source, inputs, limits = validate_request(event)
    except RequestError as exc:
        return _response(echo_id, echo_nonce, "error", started, "ANALYSIS_INPUT", str(exc))

    # Both run BEFORE /tmp is wiped and before any data of this tenant exists:
    # no survivor of a previous run may see it, and the guest must not be able
    # to read the parent. Either failing stops the run without spawning.
    try:
        _harden_parent_dumpable()
        _reap_strays()
    except Exception as exc:
        return _response(execution_id, nonce, "error", started, "ANALYSIS_RUNTIME",
                         "sandbox error: %s" % type(exc).__name__)
    wipe_tmp()
    tmpdir = tempfile.mkdtemp(prefix=TMP_PREFIX, dir=TMP_ROOT)
    os.chmod(tmpdir, 0o700)
    try:
        code, message, output = _execute(tmpdir, source, inputs, limits)
    except Exception as exc:  # infrastructure failure; never echo guest data
        code, message, output = "ANALYSIS_RUNTIME", "sandbox error: %s" % type(exc).__name__, None
    finally:
        _rm(tmpdir)
        wipe_tmp()
    if code is None:
        return _response(execution_id, nonce, "ok", started, output=output)
    return _response(execution_id, nonce, "error", started, code, message)
