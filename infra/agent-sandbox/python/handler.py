"""AWS Lambda entrypoint of the Vex analysis sandbox (protocol vendix.analysis/v1).

Contract mirrored from apps/backend/src/ai-engine/sandbox/interfaces/
analysis-protocol.interface.ts. Containment is the Lambda itself: VPC without
egress, empty execution role, no secrets, read-only code. On top of it, EVERY
execution gets a private /tmp dir and a NEW child process in its own session
with rlimits; right before the guest code runs, runner.py seals descriptor
creation (RLIMIT_NOFILE=0) so the guest cannot open a socket to the Lambda
Runtime API; the whole process group, and then every other task of the guest
uid (kill(-1)), is SIGKILLed afterwards and /tmp wiped, because the execution
environment is reused between invocations. Three channels need no descriptor
and are closed here (T53 run 3): System V IPC objects of the guest uid are
removed before each tenant and after each run; limits/nice/affinity the guest
changed in this process with prlimit & co. are restored or the runtime is
restarted inside the attacker's own invocation; inodes AND directory entries
(hard links create entries without inodes, T53 run 4) the guest creates in
/tmp are capped while it runs, and the wipe unlinks in place, iteratively and
deadline-bound, without growing any directory.

The guest shares the handler's uid, so it can SIGSTOP or kill it; nothing in
Lambda prevents that (no second uid, seccomp() and prctl() denied). The
handler bounds what follows instead (independent audit, B1; T53 run 6):
survivors die (kill(-1)) at INIT and before anything else in each
invocation, the process state is compared with a fixed table of Lambda's
values (never an import-time snapshot) at every watch and after every run,
/tmp itself is checked before every guest, and leftovers of a run whose
watcher was stopped are wiped at INIT and then in short, bounded slices that
answer "sandbox busy" quickly. The residual availability cost is measured in
CERTIFICACION-T53.md.

Never log source, inputs or outputs.
"""
import ctypes
import errno
import json
import os
import re
import resource
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
# The reply (validation, serialization) must leave the handler this long before
# the host aborts at wall_ms; the /tmp wipe after a run stops at that point.
RESPONSE_MARGIN_MS = 500
# Time the child needs at least (exec + pandas import) once the /tmp wipe of a
# previous run finished; with less left the run is refused, never started.
MIN_CHILD_MS = 3_000
# mkdir/symlink/link/mknod create inodes without descriptors, so the seal does
# not stop them (T53 run 3: 3 500 mkdir/s until /tmp ran out of inodes and the
# cleanup blew the budget). The parent watches the inodes the guest consumes
# and kills it past this cap, so the wipe always fits in the reserve.
TMP_INODE_CAP = 10_000
# link() adds a directory entry to an existing inode: no inode, no descriptor
# (T53 run 4: 963 000 hard links on 32 inodes in 15 s; the wipe needed ~2 min
# and every later tenant got "sandbox busy"). Directory entries live in
# directory blocks, so the parent also caps the /tmp blocks the guest consumes
# beyond the data it may legitimately write (stdout, stderr, result file):
# 256 KiB is ~16 000 entries or ~64 directories, far below what the wipe
# removes inside the teardown reserve, and a real analysis creates none.
TMP_DIR_BYTES_CAP = 256 * 1024
# /tmp itself is the one directory that outlives every run (ext4 never shrinks
# it). Entries the guest puts there reuse the free slots earlier runs left in
# its blocks without consuming new ones, so the block cap above cannot see
# them and each attack could fill more slots than the last (T53 run 5). The
# guest has no business in /tmp itself: the parent counts its entries, up to
# this many beyond the baseline, at every watch.
TMP_ROOT_ENTRY_CAP = 64
WATCH_INTERVAL_S = 0.05
# A guest that SIGSTOPs the handler blinds every watch until Lambda's 30 s
# timeout resets the environment; /tmp survives the reset (independent audit,
# B1; T53 run 6). Leftovers are wiped at INIT, before the first invocation of
# the new runtime, for up to INIT_WIPE_MS (Lambda allows 10 s of INIT), and
# then for at most PRE_RUN_WIPE_MS per invocation: a tenant gets a quick
# "sandbox busy" instead of waiting 7-9 s for an attacker's mess.
INIT_WIPE_MS = 7_000
PRE_RUN_WIPE_MS = 2_000
# /tmp itself belongs to root in Lambda (T53 run 6: 041777, uid 0, gid 0, no
# xattrs; chmod/chown/utime/setxattr from the guest -> EPERM). Checked before
# every guest: anything else fails closed, the handler cannot restore it.
TMP_ROOT_MODE = 0o1777
TMP_ROOT_UID = 0
# System V IPC objects are kernel objects identified by ids, not descriptors:
# they survive the guest, kill(-1) and the /tmp wipe (T53 run 3: a tenant read
# the previous tenant's marker through shm/msg in 99/100 runs).
SYSVIPC_ROOT = "/proc/sysvipc"
SYSVIPC_KINDS = (("shm", "shmid"), ("msg", "msqid"), ("sem", "semid"))
IPC_RMID = 0
IPC_SETTLE_ATTEMPTS = 25
IPC_SETTLE_S = 0.02

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


def _libc():
    """libc through the global symbol scope (dlopen(NULL)): no file lookup.

    ctypes.util.find_library runs ldconfig/gcc in a subprocess on Linux, which
    is pointless inside the image and broke the offline tests on Linux, where
    subprocess.Popen is mocked (independent audit, observation 5).
    """
    return ctypes.CDLL(None, use_errno=True)


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
    libc = _libc()
    if libc.prctl(_PR_SET_DUMPABLE, 0, 0, 0, 0) == 0:
        return
    err = ctypes.get_errno()
    if err == errno.EPERM and _kernel_marked_non_dumpable():
        return
    raise OSError(err, "prctl(PR_SET_DUMPABLE, 0) failed")


def _process_state():
    """Every attribute of THIS process a same-uid guest can change from outside.

    prlimit64(ppid) lets the guest lower the handler's limits (T53 run 3: soft
    RLIMIT_NOFILE 1024 -> 4 made every later invocation of the environment fail
    for 15-19 min); setpriority/sched_setaffinity/sched_setscheduler reach it
    the same way and are inherited by every later child.
    """
    state = {}
    for name in sorted(dir(resource)):
        if name.startswith("RLIMIT_"):
            try:
                state[name] = resource.getrlimit(getattr(resource, name))
            except (OSError, ValueError):
                pass
    try:
        state["nice"] = os.getpriority(os.PRIO_PROCESS, 0)
    except (AttributeError, OSError):
        pass
    if hasattr(os, "sched_getaffinity"):
        try:
            state["affinity"] = frozenset(os.sched_getaffinity(0))
        except OSError:
            pass
    if hasattr(os, "sched_getscheduler"):
        try:
            state["scheduler"] = os.sched_getscheduler(0)
        except OSError:
            pass
    return state


_INF = resource.RLIM_INFINITY
# What Lambda gives the runtime process (T53 run 6: read with prlimit64,
# getpriority and sched_get* from a guest on the certified image; arm64,
# 1024 MB, 2 vCPU). The guard compares against these fixed values, never
# against what this process saw at import: a survivor of an earlier runtime
# could have lowered limits or raised nice before the first kill(-1), and an
# import-time snapshot would then make the poisoned state the reference
# (independent audit, B1). Some follow the function's configuration
# (SIGPENDING scales with memory, the CPU count with it too): changing
# template.json re-opens T53 anyway. If Lambda ever lowers one of them, every
# invocation fails closed with Runtime.ExitError until this table is updated.
EXPECTED_RLIMITS = {
    "RLIMIT_AS": (_INF, _INF), "RLIMIT_CORE": (10737418240, 10737418240),
    "RLIMIT_CPU": (_INF, _INF), "RLIMIT_DATA": (_INF, _INF), "RLIMIT_FSIZE": (_INF, _INF),
    "RLIMIT_MEMLOCK": (65536, 65536), "RLIMIT_MSGQUEUE": (819200, 819200),
    "RLIMIT_NICE": (0, 0), "RLIMIT_NOFILE": (1024, 1024), "RLIMIT_OFILE": (1024, 1024),
    "RLIMIT_NPROC": (1024, 1024), "RLIMIT_RSS": (_INF, _INF), "RLIMIT_RTPRIO": (0, 0),
    "RLIMIT_RTTIME": (_INF, _INF), "RLIMIT_SIGPENDING": (4609, 4609),
    "RLIMIT_STACK": (8388608, _INF),
}
EXPECTED_NICE = 0
EXPECTED_SCHEDULER = 0  # SCHED_OTHER


def _expected_state():
    """The fixed reference for _guard_process_state. Reads nothing the guest
    can change: the online CPU count comes from sysconf, not the affinity."""
    state = {name: value for name, value in EXPECTED_RLIMITS.items() if hasattr(resource, name)}
    state["nice"] = EXPECTED_NICE
    if hasattr(os, "sched_getaffinity"):
        state["affinity"] = frozenset(range(os.cpu_count() or 1))
    if hasattr(os, "sched_getscheduler"):
        state["scheduler"] = EXPECTED_SCHEDULER
    return state


# Only inside Lambda: off it (developer machine, CI) the table above does not
# describe the process and the offline tests install their own reference.
_IN_LAMBDA = sys.platform.startswith("linux") and "AWS_LAMBDA_RUNTIME_API" in os.environ
EXPECTED_STATE = _expected_state() if _IN_LAMBDA else None


def _restore_attribute(name, value):
    if name.startswith("RLIMIT_"):
        resource.setrlimit(getattr(resource, name), value)
    elif name == "nice":
        os.setpriority(os.PRIO_PROCESS, 0, value)
    elif name == "affinity":
        os.sched_setaffinity(0, value)
    elif name == "scheduler":
        os.sched_setscheduler(0, value, os.sched_param(0))


def _restart_runtime():
    """Lambda restarts a runtime that exits; the reply of THIS invocation is lost
    (Runtime.ExitError, fails closed) and the next one starts clean."""
    try:
        os.write(2, b"analysis sandbox: handler process state was altered; restarting the runtime\n")
    finally:
        os._exit(70)


def _state_drift(expected):
    current = _process_state()
    return {name: value for name, value in expected.items() if current.get(name) != value}


def _guard_process_state():
    """Put this process back to EXPECTED_STATE, or restart the runtime.

    A lowered soft limit, a raised nice or a narrowed affinity can be restored
    without privileges (and a value above the reference can always be
    lowered); a lowered hard limit or a raised nice cannot, and then the only
    safe outcome is a fresh runtime. Runs after kill(-1) at the start of every
    invocation, at every watch while the guest runs and after it was killed.
    """
    expected = EXPECTED_STATE
    if expected is None:
        return
    drift = _state_drift(expected)
    if not drift:
        return
    for name, value in drift.items():
        try:
            _restore_attribute(name, value)
        except (OSError, ValueError, AttributeError):
            pass
    if _state_drift(expected):
        _restart_runtime()


class SysvIpcError(Exception):
    """A System V IPC object of the guest uid could not be listed or removed."""




def _sysvipc_objects():
    """[(kind, id, uid, cuid)] from /proc/sysvipc; columns located by header."""
    objects = []
    for kind, id_column in SYSVIPC_KINDS:
        try:
            with open(os.path.join(SYSVIPC_ROOT, kind), encoding="ascii") as fh:
                lines = fh.read().splitlines()
        except OSError as exc:
            raise SysvIpcError("cannot list %s: %s" % (kind, errno.errorcode.get(exc.errno, exc.errno)))
        if not lines:
            raise SysvIpcError("empty %s listing" % kind)
        header = lines[0].split()
        try:
            idx = [header.index(c) for c in (id_column, "uid", "cuid")]
        except ValueError:
            raise SysvIpcError("unexpected %s header" % kind)
        for line in lines[1:]:
            cols = line.split()
            if not cols:
                continue
            try:
                objects.append((kind,) + tuple(int(cols[i]) for i in idx))
            except (IndexError, ValueError):
                raise SysvIpcError("unexpected %s row" % kind)
    return objects


def _purge_sysv_ipc():
    """IPC_RMID every shm/msg/sem object owned or created by this uid (the guest
    shares it), then prove none is left. Runs after kill(-1): no guest can be
    attached any more, so a removed segment disappears once its last attacher's
    exit finished detaching it. Fails closed. No-op off Linux.
    """
    if not sys.platform.startswith("linux"):
        return
    me = os.geteuid()
    libc = None
    for _ in range(IPC_SETTLE_ATTEMPTS):
        ours = [o for o in _sysvipc_objects() if me in (o[2], o[3])]
        if not ours:
            return
        libc = libc or _libc()
        for kind, ident, _uid, _cuid in ours:
            if kind == "shm":
                rc = libc.shmctl(ident, IPC_RMID, None)
            elif kind == "msg":
                rc = libc.msgctl(ident, IPC_RMID, None)
            else:
                rc = libc.semctl(ident, 0, IPC_RMID, 0)
            if rc != 0:
                err = ctypes.get_errno()
                if err not in (errno.EINVAL, errno.EIDRM):  # already gone
                    raise SysvIpcError("cannot remove %s: %s" % (kind, errno.errorcode.get(err, err)))
        time.sleep(IPC_SETTLE_S)
    raise SysvIpcError("System V IPC objects survive removal")


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


_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)


def _is_ours(name, dir_fd, me):
    try:
        return os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_uid == me
    except FileNotFoundError:
        return False
    except OSError:
        return True  # cannot tell: assume it is ours and fail closed


def _sweep(dfd, deadline, me):
    """One lazy pass over the directory `dfd`.

    Every non-directory is unlinked relative to `dfd` and every empty
    subdirectory removed in place; the type comes from d_type (no stat per
    entry) and nothing is moved, so no directory grows (T53 run 4: moving each
    entry up into /tmp cost ~4 syscalls per entry and left the /tmp root 14 MB
    larger for the life of the environment). The deadline is checked per
    entry, inside the listing. Returns (state, subdir): "deadline", "descend"
    with the first non-empty subdirectory, "progress", "stuck" (an entry
    this uid owns cannot be removed), "foreign" (only entries of other users
    are left) or "empty".
    """
    removed, stuck_ours, others, descend = False, False, False, None
    with os.scandir(dfd) as entries:
        for entry in entries:
            if time.monotonic() >= deadline:
                return "deadline", None
            name = entry.name
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
            except OSError:
                is_dir = False
            try:
                if is_dir:
                    os.rmdir(name, dir_fd=dfd)
                else:
                    os.unlink(name, dir_fd=dfd)
                removed = True
            except FileNotFoundError:
                removed = True
            except OSError as exc:
                if not _is_ours(name, dfd, me):
                    others = True
                elif is_dir and exc.errno in (errno.ENOTEMPTY, errno.EEXIST):
                    if descend is None:
                        descend = name
                else:
                    stuck_ours = True
    if descend is not None:
        return "descend", descend
    if removed:
        return "progress", None
    if stuck_ours:
        return "stuck", None
    if others:
        return "foreign", None
    return "empty", None


def wipe_tmp(deadline):
    """Remove everything under TMP_ROOT before `deadline` (time.monotonic()).

    Returns True when nothing this uid can remove is left. Depth-first with
    O(1) descriptors and no recursion or paths (a guest can build a chain far
    deeper than the recursion limit or PATH_MAX with mkdir + chdir): it walks
    down into a non-empty subdirectory by its descriptor, clears it, and goes
    back up through "..", whose next pass removes the now empty child. Every
    guest task is dead when this runs, so the tree no longer changes.
    """
    me = os.geteuid()
    try:
        dfd = os.open(TMP_ROOT, _DIR_FLAGS)
    except OSError:
        return False
    depth = 0
    try:
        while True:
            state, child = _sweep(dfd, deadline, me)
            if state == "deadline":
                return False
            if state == "progress":
                continue
            if state == "descend":
                try:
                    os.chmod(child, 0o700, dir_fd=dfd)  # the guest may have chmod'ed it 000
                    cfd = os.open(child, _DIR_FLAGS | getattr(os, "O_NOFOLLOW", 0), dir_fd=dfd)
                except OSError:
                    return False
                os.close(dfd)
                dfd, depth = cfd, depth + 1
                continue
            if depth == 0:
                return state != "stuck"  # /tmp itself may keep entries of other users
            if state != "empty":
                return False  # below /tmp everything was created by the guest
            try:
                pfd = os.open("..", _DIR_FLAGS, dir_fd=dfd)
            except OSError:
                return False
            os.close(dfd)
            dfd, depth = pfd, depth - 1
    finally:
        os.close(dfd)


def _remove_tenant_files(tmpdir):
    """Tenant data first, by name, before the bounded wipe of the rest."""
    for rel in ("source.py", "limits.json", "result.json", "result.json.part"):
        try:
            os.unlink(os.path.join(tmpdir, rel))
        except OSError:
            pass
    in_dir = os.path.join(tmpdir, "in")
    try:
        names = os.listdir(in_dir)
    except OSError:
        return
    for name in names:
        try:
            os.unlink(os.path.join(in_dir, name))
        except OSError:
            pass


def _tmp_free_inodes():
    return os.statvfs(TMP_ROOT).f_ffree


def _tmp_free_bytes():
    st = os.statvfs(TMP_ROOT)
    return st.f_bfree * st.f_frsize


def _count_entries(path, stop=None):
    """Entries of `path`, counting no further than `stop`."""
    n = 0
    with os.scandir(path) as entries:
        for _entry in entries:
            n += 1
            if stop is not None and n >= stop:
                break
    return n


def _blocks_bytes(st):
    return getattr(st, "st_blocks", 0) * 512


class _TmpWatch:
    """What the guest consumes in TMP_ROOT while it runs, from outside.

    Inodes come from statvfs. Directory entries have no counter of their own,
    so they are measured as the blocks /tmp lost minus the data the guest may
    legitimately write: its stdout/stderr (fstat of the handler's descriptors)
    and the result file (stat by name). The tenant files written before the
    spawn are held open, so a guest that unlinks or truncates them to free
    blocks and hide entries is credited back (only a few KiB of directories
    it could remove stay uncounted). Entries in /tmp itself are counted
    directly: they can reuse free slots and cost no new block.
    """

    def __init__(self, tmpdir, streams):
        self.tmpdir = tmpdir
        self.streams = [s.fileno() for s in streams]
        self.held = []
        try:
            paths = [os.path.join(tmpdir, "source.py"), os.path.join(tmpdir, "limits.json")]
            in_dir = os.path.join(tmpdir, "in")
            paths += [os.path.join(in_dir, n) for n in sorted(os.listdir(in_dir))]
            for path in paths:
                self.held.append(os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
                                         | getattr(os, "O_CLOEXEC", 0)))
            self.held_bytes = self._held_bytes()
            # Inodes whose blocks are already accounted for: a guest that links
            # one of them as result.json must not get them credited again.
            self.known = {(st.st_dev, st.st_ino) for st in map(os.fstat, self.held + self.streams)}
            self.result_inode = None
            self.free_inodes = _tmp_free_inodes()
            self.free_bytes = _tmp_free_bytes()
            self.root_entries = _count_entries(TMP_ROOT)
        except BaseException:
            self.close()
            raise

    def _held_bytes(self):
        return sum(_blocks_bytes(os.fstat(fd)) for fd in self.held)

    def _result_bytes(self):
        """Blocks of the result file the runner opened, and of nothing else.

        Only one inode is credited: the first regular, singly-linked file seen
        under either name that is not a tenant file or a stream. Otherwise a
        guest could link(in/<table>.json, result.json) without a descriptor and
        have blocks already spent before the baseline subtracted again,
        stretching the cap ~9x (independent audit, observation 1). .part is
        looked at first: os.replace(.part, result.json) keeps the inode.
        """
        for name in ("result.json.part", "result.json"):
            try:
                st = os.stat(os.path.join(self.tmpdir, name), follow_symlinks=False)
            except OSError:
                continue
            ident = (st.st_dev, st.st_ino)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or ident in self.known:
                continue
            if self.result_inode is None:
                self.result_inode = ident
            if ident == self.result_inode:
                return _blocks_bytes(st)
        return 0

    def directory_bytes(self):
        consumed = self.free_bytes - _tmp_free_bytes()
        data = sum(_blocks_bytes(os.fstat(fd)) for fd in self.streams) + self._result_bytes()
        freed = max(0, self.held_bytes - self._held_bytes())
        return consumed - data + freed

    def exceeded(self):
        """None, or why the guest must be stopped."""
        try:
            if self.free_inodes - _tmp_free_inodes() > TMP_INODE_CAP:
                return "inodes"
            if self.directory_bytes() > TMP_DIR_BYTES_CAP:
                return "entries"
            limit = self.root_entries + TMP_ROOT_ENTRY_CAP
            if _count_entries(TMP_ROOT, limit + 1) > limit:
                return "entries"
        except OSError:
            return "inodes"  # cannot watch: stop the guest
        return None

    def close(self):
        for fd in self.held:
            try:
                os.close(fd)
            except OSError:
                pass
        self.held = []


def _tmp_root_ok():
    """TMP_ROOT is the root-owned 1777 directory without xattrs Lambda gives.

    The guest cannot change it there (EPERM, T53 run 6); a different owner,
    mode or any extended attribute would be a channel between tenants, so the
    run is refused. Only meaningful inside Lambda.
    """
    try:
        st = os.lstat(TMP_ROOT)
        if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != TMP_ROOT_MODE or st.st_uid != TMP_ROOT_UID:
            return False
        listxattr = getattr(os, "listxattr", None)  # Linux only
        if listxattr is None:
            return True
        try:
            return not listxattr(TMP_ROOT, follow_symlinks=False)
        except OSError as exc:
            return exc.errno in (errno.ENOTSUP, errno.EOPNOTSUPP)
    except OSError:
        return False


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


def _wait_child(proc, deadline, watch):
    """Wait until the child exits, the deadline passes or the guest went past
    TMP_INODE_CAP inodes, TMP_DIR_BYTES_CAP of directory entries or
    TMP_ROOT_ENTRY_CAP entries in /tmp itself. Returns
    None, "timeout", "inodes" or "entries"."""
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "timeout"
        try:
            proc.wait(timeout=min(WATCH_INTERVAL_S, remaining))
            return None
        except subprocess.TimeoutExpired:
            pass
        # Undo prlimit/setpriority/sched_* the guest applied to this process
        # while it runs, so the watch below keeps its descriptors and CPU.
        _guard_process_state()
        reason = watch.exceeded()
        if reason:
            return reason


def _execute(tmpdir, source, inputs, limits, child_deadline):
    """Run one child. Returns (code, message, output); code None means ok."""
    os.mkdir(os.path.join(tmpdir, "in"), 0o700)
    for table in inputs:
        _write_private(os.path.join(tmpdir, "in", table["name"] + ".json"),
                       json.dumps({"columns": table["columns"], "rows": table["rows"]}, allow_nan=False))
    _write_private(os.path.join(tmpdir, "source.py"), source)
    _write_private(os.path.join(tmpdir, "limits.json"), json.dumps(limits))

    stopped = None
    err_tail = ""
    # Anonymous unlinked descriptors in TMP_ROOT: the child cannot unlink,
    # symlink or replace them with a FIFO inside tmpdir.
    with tempfile.TemporaryFile(dir=TMP_ROOT) as fo, tempfile.TemporaryFile(dir=TMP_ROOT) as fe:
        watch = _TmpWatch(tmpdir, (fo, fe))
        try:
            proc = subprocess.Popen(
                [sys.executable, "-I", RUNNER_PATH, tmpdir],
                cwd=tmpdir, env=_child_env(tmpdir), stdin=subprocess.DEVNULL,
                stdout=fo, stderr=fe, close_fds=True, start_new_session=True,
                preexec_fn=_limit_child(limits),
            )
            try:
                stopped = _wait_child(proc, child_deadline, watch)
            finally:
                try:
                    _kill_group(proc.pid)
                finally:
                    _reap_strays()  # also what escaped the group (double fork + setsid)
        finally:
            watch.close()
        if stopped:
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        else:
            err_tail = _read_stream(fe)
    if stopped == "timeout":
        return "ANALYSIS_TIMEOUT", "wall time limit exceeded", None
    if stopped in ("inodes", "entries"):
        return "ANALYSIS_RUNTIME", "too many files or directories created in the sandbox", None

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
    # Before touching anything: no survivor may still be changing this
    # process, then put it back to the fixed reference or restart the runtime
    # (normally a no-op: the previous invocation already did both).
    try:
        _reap_strays()
    except Exception as exc:
        return _response(echo_id, echo_nonce, "error", started, "ANALYSIS_RUNTIME",
                         "sandbox error: %s" % type(exc).__name__)
    _guard_process_state()
    if _valid_runtime_digest() is None:
        return _response(echo_id, echo_nonce, "error", started, "ANALYSIS_RUNTIME", "runtime digest missing")
    try:
        execution_id, nonce, source, inputs, limits = validate_request(event)
    except RequestError as exc:
        return _response(echo_id, echo_nonce, "error", started, "ANALYSIS_INPUT", str(exc))

    child_deadline = started + max(1, limits["wall_ms"] - TEARDOWN_RESERVE_MS) / 1000.0
    reply_deadline = started + max(0, limits["wall_ms"] - RESPONSE_MARGIN_MS) / 1000.0
    # All of this runs BEFORE any data of this tenant exists: no survivor of a
    # previous run may see it, nothing it left (processes, IPC objects, /tmp
    # entries) may reach this tenant, and the guest must not be able to read the
    # parent. Any failure stops the run without spawning.
    try:
        _harden_parent_dumpable()
        _purge_sysv_ipc()  # after the kill(-1) at the top: nothing is attached
    except Exception as exc:
        return _response(execution_id, nonce, "error", started, "ANALYSIS_RUNTIME",
                         "sandbox error: %s" % type(exc).__name__)
    wipe_deadline = min(child_deadline - MIN_CHILD_MS / 1000.0, started + PRE_RUN_WIPE_MS / 1000.0)
    if not wipe_tmp(wipe_deadline):
        return _response(execution_id, nonce, "error", started, "ANALYSIS_RUNTIME",
                         "sandbox busy: cleanup of a previous run did not finish, retry")
    _guard_process_state()  # the wipe ran with this process's limits; recheck
    if _IN_LAMBDA and not _tmp_root_ok():
        return _response(execution_id, nonce, "error", started, "ANALYSIS_RUNTIME",
                         "sandbox error: /tmp was altered")
    tmpdir = None
    try:
        tmpdir = tempfile.mkdtemp(prefix=TMP_PREFIX, dir=TMP_ROOT)
        os.chmod(tmpdir, 0o700)
        code, message, output = _execute(tmpdir, source, inputs, limits, child_deadline)
    except Exception as exc:  # infrastructure failure; never echo guest data
        code, message, output = "ANALYSIS_RUNTIME", "sandbox error: %s" % type(exc).__name__, None
    finally:
        # Every guest task is dead here (_execute reaped them), so nothing can
        # alter this process again before the next invocation.
        _guard_process_state()
        try:
            _purge_sysv_ipc()
        except Exception as exc:
            code, message, output = "ANALYSIS_RUNTIME", "sandbox error: %s" % type(exc).__name__, None
        if tmpdir is not None:
            _remove_tenant_files(tmpdir)
        wipe_tmp(reply_deadline)  # unfinished: the next run finishes it before spawning
        _guard_process_state()
    if code is None:
        return _response(execution_id, nonce, "ok", started, output=output)
    return _response(execution_id, nonce, "error", started, code, message)


def _init_environment():
    """Once per runtime, at import (Lambda INIT, before the first invocation).

    After Lambda resets an environment (timeout, runtime exit) the new runtime
    starts with whatever the previous guest left in /tmp. Kill any survivor,
    put this process to the fixed reference and wipe /tmp for up to
    INIT_WIPE_MS, so the first tenant does not pay for it. Errors are left to
    the per-invocation checks, which fail closed.
    """
    if not _IN_LAMBDA or os.getppid() != 0:
        return
    try:
        _reap_strays()
    except OSError:
        return
    _guard_process_state()
    wipe_tmp(time.monotonic() + INIT_WIPE_MS / 1000.0)


_init_environment()
