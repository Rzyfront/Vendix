"""Offline tests for runner.py: output validation (pure) and the descriptor
seal. The seal tests run runner.py in a SUBPROCESS with stub numpy/pandas and
benign test programs only (no adversarial guest code); the in-process ones
always mock setrlimit, so this test process never loses its descriptors."""
import errno
import json
import math
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import runner  # noqa: E402

LIMITS = {"input_columns": 50, "output_bytes": 256 * 1024, "output_tables": 5, "output_series": 6,
          "output_figures": 20, "output_rows": 1000, "output_points": 1000}


def validate(result, **over):
    return runner.validate_output(result, dict(LIMITS, **over))


class FakeNumpyScalar:
    def __init__(self, v):
        self._v = v

    def item(self):
        return self._v


class OutputValidationTests(unittest.TestCase):
    def test_nan_and_inf_become_none_and_numpy_scalars_become_python(self):
        out = validate({"tables": [{"title": "t", "columns": ["a", "b", "c"],
                                    "rows": [[math.nan, math.inf, FakeNumpyScalar(2.5)]]}]})
        self.assertEqual(out["tables"][0]["rows"], [[None, None, 2.5]])

    def test_series_with_nan_values_and_bool_cells(self):
        out = validate({"series": [{"title": "s", "chart": "line", "x": ["a", "b"],
                                    "datasets": [{"label": "d", "values": [1, float("nan")]}]}],
                        "figures": [{"label": "ok", "value": True}]})
        self.assertEqual(out["series"][0]["datasets"][0]["values"], [1, None])
        self.assertEqual(out["figures"][0]["value"], "true")

    def test_rejects_non_dict_empty_and_unknown_keys(self):
        for bad in (
            [],
            {},
            {"plot": 1},
            {"notes": ["only note"]},
            {"tables": []},
            {"series": []},
            {"figures": []},
            {"tables": [], "notes": ["only note"]},
        ):
            with self.assertRaises(runner.OutputError):
                validate(bad)

    def test_caps(self):
        table = {"title": "t", "columns": ["a"], "rows": [[1]] * 1001}
        valid_fig = [{"label": "n", "value": 1}]
        with self.assertRaises(runner.OutputError):
            validate({"tables": [table]})
        with self.assertRaises(runner.OutputError):
            validate({"tables": [{"title": "x" * 121, "columns": ["a"], "rows": []}]})
        with self.assertRaises(runner.OutputError):
            validate({"figures": valid_fig, "notes": ["n"] * 6})
        with self.assertRaises(runner.OutputError):
            validate({"figures": valid_fig, "notes": ["n" * 301]})
        with self.assertRaises(runner.OutputError):
            validate({"figures": [{"label": "f", "value": 1}] * 21})
        with self.assertRaises(runner.OutputError):
            validate({"figures": [{"label": "f", "value": "v" * 121}]})
        with self.assertRaises(runner.OutputError):
            validate({"figures": [{"label": "f", "value": 1, "unit": "u" * 41}]})
        with self.assertRaises(runner.OutputError):
            validate({"series": [{"title": "s", "chart": "line", "x": list(range(1001)),
                                  "datasets": [{"label": "d", "values": [0] * 1001}]}]})
        ok = validate({"figures": [{"label": "f", "value": "v" * 120, "unit": "u" * 40}]})
        self.assertEqual(len(ok["figures"][0]["value"]), 120)
        self.assertEqual(len(ok["figures"][0]["unit"]), 40)

    def test_schema_errors(self):
        with self.assertRaises(runner.OutputError):  # ragged row
            validate({"tables": [{"title": "t", "columns": ["a", "b"], "rows": [[1]]}]})
        with self.assertRaises(runner.OutputError):  # dataset length != x
            validate({"series": [{"title": "s", "chart": "bar", "x": [1, 2],
                                  "datasets": [{"label": "d", "values": [1]}]}]})
        with self.assertRaises(runner.OutputError):  # bad chart
            validate({"series": [{"title": "s", "chart": "pie", "x": [1],
                                  "datasets": [{"label": "d", "values": [1]}]}]})
        with self.assertRaises(runner.OutputError):  # unsupported cell type
            validate({"tables": [{"title": "t", "columns": ["a"], "rows": [[object()]]}]})

    def test_output_bytes_cap(self):
        rows = [["x" * 400] for _ in range(1000)]
        with self.assertRaises(runner.OutputError):
            validate({"tables": [{"title": "t", "columns": ["a"], "rows": rows}]}, output_bytes=1000)

    def test_sanitize_message_strips_paths_and_bounds(self):
        msg = runner.sanitize_message("Traceback\nValueError: bad /var/task/x.py and C:/a/b")
        self.assertEqual(msg, "ValueError: bad <path> and <path>")
        self.assertEqual(len(runner.sanitize_message("x" * 900)), 500)


def _python(code):
    return subprocess.run([sys.executable, "-I", "-B", "-c", code], capture_output=True, text=True, timeout=120)


class DescriptorSealTests(unittest.TestCase):
    """T53 (second run): a guest socket to the Lambda Runtime API intercepted the
    next tenant's invocation. The guest must not create ANY descriptor."""

    def test_seal_blocks_every_new_descriptor_but_keeps_the_open_ones(self):
        cp = _python(textwrap.dedent("""
            import errno, json, os, resource, socket, sys
            sys.path.insert(0, %r)
            import runner
            r, w = os.pipe()
            runner._seal_descriptors()
            out = {}
            for name, make in (("socket", lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM)),
                               ("open", lambda: os.open(os.devnull, os.O_RDONLY)),
                               ("pipe", os.pipe)):
                try:
                    make()
                    out[name] = "ALLOWED"
                except OSError as exc:
                    out[name] = errno.errorcode.get(exc.errno)
            try:
                resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
                out["raise_limit"] = "ALLOWED"
            except (ValueError, OSError):
                out["raise_limit"] = "DENIED"
            os.write(w, b"x")
            out["open_pipe"] = os.read(r, 1).decode()
            os.write(1, json.dumps(out).encode())
        """ % HERE))
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertEqual(json.loads(cp.stdout), {
            "socket": "EMFILE", "open": "EMFILE", "pipe": "EMFILE",
            "raise_limit": "DENIED", "open_pipe": "x"})

    def test_seal_fails_closed_and_leaks_no_probe_when_the_limit_does_not_apply(self):
        before = sorted(os.listdir("/dev/fd"))
        with patch.object(runner.resource, "setrlimit") as setrlimit:
            with self.assertRaises(runner.SealError):
                runner._seal_descriptors()
        setrlimit.assert_called_once_with(resource.RLIMIT_NOFILE, (0, 0))
        self.assertEqual(sorted(os.listdir("/dev/fd")), before)


class RunUnderSealTests(unittest.TestCase):
    """runner.run() end to end in a subprocess, real seal, stub numpy/pandas."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="runner-test-")
        self.addCleanup(shutil.rmtree, self.root, True)
        self.stubs = os.path.join(self.root, "stubs")
        os.mkdir(self.stubs)
        with open(os.path.join(self.stubs, "numpy.py"), "w") as fh:
            fh.write("")
        with open(os.path.join(self.stubs, "pandas.py"), "w") as fh:
            fh.write("def DataFrame(rows, columns):\n    return {'columns': columns, 'rows': rows}\n")
        self.work = os.path.join(self.root, "work")
        os.makedirs(os.path.join(self.work, "in"))
        with open(os.path.join(self.work, "limits.json"), "w") as fh:
            json.dump(dict(LIMITS, input_rows=5000), fh)
        with open(os.path.join(self.work, "in", "sales.json"), "w") as fh:
            json.dump({"columns": ["v"], "rows": [[1], [2]]}, fh)

    def run_source(self, source, before_run=""):
        with open(os.path.join(self.work, "source.py"), "w") as fh:
            fh.write(source)
        cp = _python("import sys\nsys.path[:0] = [%r, %r]\nimport runner\n%s\nrunner.run(%r)\n"
                     % (self.stubs, HERE, before_run, self.work))
        self.assertEqual(cp.returncode, 0, cp.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.work, "result.json.part")))
        with open(os.path.join(self.work, "result.json")) as fh:
            return json.load(fh)

    def test_guest_runs_after_the_seal_and_the_result_is_still_written(self):
        out = self.run_source(
            "import os\n"
            "try:\n    os.open(os.devnull, os.O_RDONLY)\n    state = -1\n"
            "except OSError as exc:\n    state = exc.errno\n"
            "result = {'figures': [{'label': 'open_errno', 'value': state},"
            " {'label': 'rows', 'value': len(inputs['sales']['rows'])}]}\n")
        self.assertEqual(out, {"status": "ok", "output": {"figures": [
            {"label": "open_errno", "value": errno.EMFILE}, {"label": "rows", "value": 2}]}})

    def test_a_guest_that_hits_the_seal_gets_a_clear_error(self):
        out = self.run_source("open(__import__('os').devnull)\nresult = {'figures': [{'label': 'n', 'value': 1}]}\n")
        self.assertEqual(out, {"status": "error", "error_code": "ANALYSIS_RUNTIME",
                               "error_message": runner.SEALED_MESSAGE})

    def test_the_guest_never_runs_when_the_seal_fails(self):
        out = self.run_source(
            "result = {'figures': [{'label': 'ran', 'value': 1}]}\n",
            before_run="def _broken():\n    raise runner.SealError('no seal')\nrunner._seal_descriptors = _broken")
        self.assertEqual(out, {"status": "error", "error_code": "ANALYSIS_RUNTIME",
                               "error_message": "sandbox seal failed"})

    def test_errors_before_the_guest_still_reach_the_result_file(self):
        out = self.run_source("def (:\n")
        self.assertEqual(out["status"], "error")
        self.assertEqual(out["error_code"], "ANALYSIS_SYNTAX")


if __name__ == "__main__":
    unittest.main()
