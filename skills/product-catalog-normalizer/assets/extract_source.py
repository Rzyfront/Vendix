#!/usr/bin/env python3
"""Extract every raw row from a client catalog file.

Handles the machine-readable formats. PDF / images / Word are NOT handled here:
those go through the agent's own reading tools (see SKILL.md), because layout
recovery needs judgment, not a parser.

Never dedupes, never filters, never reorders: this dumps ALL sheets and ALL rows
so the agent can see everything before deciding what is a product.

Usage:
    extract_source.py <archivo> [--json out.json]
    extract_source.py <archivo> --records --sheet "Hoja1" --header-row 3
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys

ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


def _read_text(path: str) -> str:
    raw = open(path, "rb").read()
    for enc in ENCODINGS:
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def from_delimited(path: str) -> list[dict]:
    text = _read_text(path)
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = max(",;\t|", key=lambda d: sample.count(d))
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim)]
    return [{"name": os.path.basename(path), "delimiter": delim, "rows": rows}]


def from_excel(path: str) -> list[dict]:
    import openpyxl

    # data_only=True resolves formulas to their cached value; a template-driven
    # price column is often a formula and the literal "=B2*1.19" is useless here
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = []
    for ws in wb.worksheets:
        rows = [
            ["" if v is None else v for v in row]
            for row in ws.iter_rows(values_only=True)
        ]
        out.append({"name": ws.title, "state": ws.sheet_state, "rows": rows})
    wb.close()
    return out


def to_records(sheet: dict, header_row: int) -> list[dict]:
    rows = sheet["rows"]
    if header_row < 1 or header_row > len(rows):
        raise SystemExit(f"header-row {header_row} fuera de rango (1..{len(rows)})")
    headers = [str(h).strip() for h in rows[header_row - 1]]
    recs = []
    for i, r in enumerate(rows[header_row:], start=header_row + 1):
        if not any(str(v).strip() for v in r):
            continue
        rec = {"_row": i}
        for j, h in enumerate(headers):
            if h:
                rec[h] = r[j] if j < len(r) else ""
        recs.append(rec)
    return recs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--json", dest="out")
    ap.add_argument("--records", action="store_true", help="emit dicts, needs --header-row")
    ap.add_argument("--sheet")
    ap.add_argument("--header-row", type=int, default=1)
    ap.add_argument("--preview", type=int, default=5)
    a = ap.parse_args()

    ext = os.path.splitext(a.path)[1].lower()
    if ext in (".xlsx", ".xlsm"):
        sheets = from_excel(a.path)
    elif ext in (".csv", ".tsv", ".txt"):
        sheets = from_delimited(a.path)
    elif ext == ".xls":
        raise SystemExit(
            ".xls antiguo no soportado. Convertir primero:\n"
            "  libreoffice --headless --convert-to xlsx <archivo>"
        )
    else:
        raise SystemExit(
            f"{ext} no es un formato tabular. PDF/imagen/Word se leen con las "
            "herramientas del agente, ver SKILL.md fase 2."
        )

    if a.records:
        target = next((s for s in sheets if s["name"] == a.sheet), sheets[0])
        payload = to_records(target, a.header_row)
    else:
        payload = sheets

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
        print(f"escrito {a.out}")

    if not a.records:
        for s in sheets:
            print(f"\nHoja '{s['name']}': {len(s['rows'])} filas")
            for r in s["rows"][: a.preview]:
                print("  ", r)
    else:
        print(f"{len(payload)} registros")
        for r in payload[: a.preview]:
            print("  ", r)
    return 0


if __name__ == "__main__":
    sys.exit(main())
