"""Pure output-validation tests for runner.py. No user code is executed and
pandas/numpy are not required."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
        for bad in ([], {}, {"plot": 1}):
            with self.assertRaises(runner.OutputError):
                validate(bad)

    def test_caps(self):
        table = {"title": "t", "columns": ["a"], "rows": [[1]] * 1001}
        with self.assertRaises(runner.OutputError):
            validate({"tables": [table]})
        with self.assertRaises(runner.OutputError):
            validate({"tables": [{"title": "x" * 121, "columns": ["a"], "rows": []}]})
        with self.assertRaises(runner.OutputError):
            validate({"notes": ["n"] * 6})
        with self.assertRaises(runner.OutputError):
            validate({"notes": ["n" * 301]})
        with self.assertRaises(runner.OutputError):
            validate({"figures": [{"label": "f", "value": 1}] * 21})
        with self.assertRaises(runner.OutputError):
            validate({"series": [{"title": "s", "chart": "line", "x": list(range(1001)),
                                  "datasets": [{"label": "d", "values": [0] * 1001}]}]})

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


if __name__ == "__main__":
    unittest.main()
