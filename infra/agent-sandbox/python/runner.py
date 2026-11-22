"""Child process of the analysis Lambda (vendix.analysis/v1).

Runs ONCE per execution in a fresh process spawned by handler.py. It loads the
inputs as pandas DataFrames, executes the generated source and writes a
validated result file. It is NOT a containment layer: containment is the Lambda
itself (no VPC egress, empty role, no secrets) plus the rlimits/process-group
kill applied by the parent. It never renders charts.

The validation helpers at the top are pure (no pandas import) so the parent
re-validates the child's output with the same code and tests can import them.
"""
import json
import math
import os
import re
import sys

MAX_CELL_CHARS = 500
MAX_TITLE_CHARS = 120
MAX_UNIT_CHARS = 40
MAX_NOTES = 5
MAX_NOTE_CHARS = 300
CHARTS = ("line", "bar", "scatter")
OUTPUT_KEYS = ("tables", "series", "figures", "notes")
ERROR_CODES = (
    "ANALYSIS_INPUT", "ANALYSIS_SYNTAX", "ANALYSIS_RUNTIME",
    "ANALYSIS_TIMEOUT", "ANALYSIS_MEMORY", "ANALYSIS_OUTPUT",
)
_PATH_RE = re.compile(r"(?:[A-Za-z]:)?(?:/[^\s:'\"()]+)+")


class OutputError(Exception):
    """The generated `result` does not satisfy the output schema/limits."""


def sanitize_message(text, limit=500):
    """Last non-empty line, filesystem paths stripped, bounded."""
    lines = [ln.strip() for ln in str(text).splitlines() if ln.strip()]
    line = lines[-1] if lines else ""
    return _PATH_RE.sub("<path>", line)[:limit]


def _cell(value, depth=0):
    """Plain JSON cell: str | int | float | None. NaN/inf -> None."""
    if value is None:
        return None
    if type(value).__name__ in ("NAType", "NaTType"):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value[:MAX_CELL_CHARS]
    if depth == 0 and hasattr(value, "item"):  # numpy scalar
        return _cell(value.item(), 1)
    if hasattr(value, "isoformat"):  # datetime / Timestamp
        return value.isoformat()[:MAX_CELL_CHARS]
    if type(value).__name__ == "Decimal":
        return _cell(float(value), 1)
    raise OutputError("unsupported cell type %s" % type(value).__name__)


def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip():
        raise OutputError("%s must be a non-empty string" % label)
    if len(value) > limit:
        raise OutputError("%s exceeds %d characters" % (label, limit))
    return value


def _seq(value, label):
    if hasattr(value, "tolist") and not isinstance(value, (list, tuple)):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        raise OutputError("%s must be a list" % label)
    return list(value)


def _table(raw, limits):
    if not isinstance(raw, dict):
        raise OutputError("table must be an object")
    extra = set(raw) - {"title", "columns", "rows"}
    if extra:
        raise OutputError("table has unknown keys")
    title = _text(raw.get("title"), "table title", MAX_TITLE_CHARS)
    columns = [_text(c if isinstance(c, str) else str(c), "column", MAX_TITLE_CHARS)
               for c in _seq(raw.get("columns"), "table columns")]
    if not columns or len(columns) > limits["input_columns"]:
        raise OutputError("table columns out of range")
    rows = _seq(raw.get("rows"), "table rows")
    if len(rows) > limits["output_rows"]:
        raise OutputError("table has more than %d rows" % limits["output_rows"])
    out = []
    for row in rows:
        row = _seq(row, "table row")
        if len(row) != len(columns):
            raise OutputError("table row length differs from columns")
        out.append([_cell(c) for c in row])
    return {"title": title, "columns": columns, "rows": out}


def _series(raw, limits):
    if not isinstance(raw, dict):
        raise OutputError("series must be an object")
    extra = set(raw) - {"title", "chart", "x_label", "y_label", "x", "datasets"}
    if extra:
        raise OutputError("series has unknown keys")
    if raw.get("chart") not in CHARTS:
        raise OutputError("series chart must be line, bar or scatter")
    out = {"title": _text(raw.get("title"), "series title", MAX_TITLE_CHARS), "chart": raw["chart"]}
    for key in ("x_label", "y_label"):
        if raw.get(key) is not None:
            out[key] = _text(raw[key], key, MAX_TITLE_CHARS)
    x = _seq(raw.get("x"), "series x")
    if not x or len(x) > limits["output_points"]:
        raise OutputError("series x must have 1..%d points" % limits["output_points"])
    xs = []
    for v in x:
        c = _cell(v)
        if c is None:
            raise OutputError("series x values must be finite")
        xs.append(c)
    datasets = _seq(raw.get("datasets"), "series datasets")
    if not datasets or len(datasets) > limits["output_series"]:
        raise OutputError("series datasets must be 1..%d" % limits["output_series"])
    out_sets = []
    for ds in datasets:
        if not isinstance(ds, dict) or set(ds) - {"label", "values"}:
            raise OutputError("dataset must be {label, values}")
        values = [_cell(v) for v in _seq(ds.get("values"), "dataset values")]
        if len(values) != len(xs):
            raise OutputError("dataset length differs from x")
        if any(isinstance(v, str) for v in values):
            raise OutputError("dataset values must be numbers or null")
        out_sets.append({"label": _text(ds.get("label"), "dataset label", MAX_TITLE_CHARS), "values": values})
    out["x"], out["datasets"] = xs, out_sets
    return out


def _figure(raw):
    if not isinstance(raw, dict) or set(raw) - {"label", "value", "unit"}:
        raise OutputError("figure must be {label, value, unit?}")
    out = {"label": _text(raw.get("label"), "figure label", MAX_TITLE_CHARS), "value": _cell(raw.get("value"))}
    if raw.get("unit") is not None:
        out["unit"] = _text(raw["unit"], "figure unit", MAX_UNIT_CHARS)
    return out


def validate_output(result, limits):
    """Normalize `result` to plain JSON or raise OutputError."""
    if not isinstance(result, dict):
        raise OutputError("result must be a dict")
    if set(result) - set(OUTPUT_KEYS):
        raise OutputError("result has unknown keys")
    out = {}
    tables = result.get("tables")
    if tables is not None:
        tables = _seq(tables, "tables")
        if len(tables) > limits["output_tables"]:
            raise OutputError("more than %d tables" % limits["output_tables"])
        out["tables"] = [_table(t, limits) for t in tables]
    series = result.get("series")
    if series is not None:
        series = _seq(series, "series")
        if len(series) > limits["output_series"]:
            raise OutputError("more than %d series" % limits["output_series"])
        out["series"] = [_series(s, limits) for s in series]
    figures = result.get("figures")
    if figures is not None:
        figures = _seq(figures, "figures")
        if len(figures) > limits["output_figures"]:
            raise OutputError("more than %d figures" % limits["output_figures"])
        out["figures"] = [_figure(f) for f in figures]
    notes = result.get("notes")
    if notes is not None:
        notes = _seq(notes, "notes")
        if len(notes) > MAX_NOTES:
            raise OutputError("more than %d notes" % MAX_NOTES)
        out["notes"] = [_text(n, "note", MAX_NOTE_CHARS) for n in notes]
    if not out:
        raise OutputError("result is empty")
    size = len(json.dumps(out, allow_nan=False, separators=(",", ":")).encode("utf-8"))
    if size > limits["output_bytes"]:
        raise OutputError("output exceeds %d bytes" % limits["output_bytes"])
    return out


# --------------------------------------------------------------------------
# Child entrypoint
# --------------------------------------------------------------------------

def _write_result(tmpdir, payload):
    path = os.path.join(tmpdir, "result.json")
    with open(path + ".part", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, allow_nan=False, separators=(",", ":"))
    os.replace(path + ".part", path)


def _fail(tmpdir, code, message):
    _write_result(tmpdir, {"status": "error", "error_code": code, "error_message": sanitize_message(message)})


def _load_inputs(tmpdir, pd):
    frames = {}
    in_dir = os.path.join(tmpdir, "in")
    for name in sorted(os.listdir(in_dir)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(in_dir, name), encoding="utf-8") as fh:
            table = json.load(fh)
        frames[name[:-5]] = pd.DataFrame(table["rows"], columns=table["columns"])
    return frames


def run(tmpdir):
    with open(os.path.join(tmpdir, "limits.json"), encoding="utf-8") as fh:
        limits = json.load(fh)
    # The script directory is the only path entry we want besides site-packages.
    sys.path[:] = [p for p in sys.path if p not in ("", ".", tmpdir)]
    try:
        import numpy as np
        import pandas as pd
    except Exception:  # pragma: no cover - image problem, not user error
        return _fail(tmpdir, "ANALYSIS_RUNTIME", "pandas or numpy unavailable")
    try:
        import statsmodels.api as sm
    except Exception:
        sm = None
    try:
        inputs = _load_inputs(tmpdir, pd)
    except Exception as exc:
        return _fail(tmpdir, "ANALYSIS_INPUT", "inputs could not be loaded: %s" % type(exc).__name__)
    with open(os.path.join(tmpdir, "source.py"), encoding="utf-8") as fh:
        source = fh.read()
    try:
        code = compile(source, "<analysis>", "exec")
    except SyntaxError as exc:
        return _fail(tmpdir, "ANALYSIS_SYNTAX", "%s (line %s)" % (exc.msg, exc.lineno))
    namespace = {"__name__": "__analysis__", "inputs": inputs, "pd": pd, "np": np, "sm": sm}
    try:
        exec(code, namespace)  # noqa: S102 - the whole point; containment is the Lambda
    except MemoryError:
        return _fail(tmpdir, "ANALYSIS_MEMORY", "memory limit exceeded")
    except BaseException as exc:  # includes SystemExit from generated code
        return _fail(tmpdir, "ANALYSIS_RUNTIME", "%s: %s" % (type(exc).__name__, exc))
    if "result" not in namespace:
        return _fail(tmpdir, "ANALYSIS_OUTPUT", "result is not defined")
    try:
        output = validate_output(namespace["result"], limits)
    except OutputError as exc:
        return _fail(tmpdir, "ANALYSIS_OUTPUT", str(exc))
    except MemoryError:
        return _fail(tmpdir, "ANALYSIS_MEMORY", "memory limit exceeded")
    _write_result(tmpdir, {"status": "ok", "output": output})


if __name__ == "__main__":
    run(sys.argv[1])
