#!/usr/bin/env python3
"""Render a Vendix commercial document (proposal or hardware recommendation) to PDF.

Usage (through render.sh, which prepares the virtualenv):
    render.sh propuesta --data datos.json [--out salida.pdf]
    render.sh hardware  --data datos.json [--out salida.pdf]

The data JSON only carries the client-specific content. The issuer (Rafael
Martínez, Vendix By Quickss S.A.S.), signature, logo and fonts are fixed and
come from this skill's assets/. The PDF is printed with headless Chrome and
then verified: page count, cover data on page 1 and no overflowing page.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
from pathlib import Path

import jinja2
import qrcode
from pypdf import PdfReader

SKILL_DIR = Path(__file__).resolve().parent.parent
SKILLS_ROOT = SKILL_DIR.parent
REPO_ROOT = SKILLS_ROOT.parent
ASSETS = SKILL_DIR / "assets"
TEMPLATES = {
    "propuesta": SKILL_DIR / "templates" / "propuesta.html.j2",
    "hardware": SKILLS_ROOT / "vendix-recomendacion-hardware" / "templates" / "hardware.html.j2",
}
PREFIX = {"propuesta": "Propuesta_Comercial_Vendix", "hardware": "Recomendacion_Hardware_Vendix"}
OUT_DIR = REPO_ROOT / "entregables" / "propuestas"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def cop(value: float | int) -> str:
    """Format an amount as Colombian pesos: 969000 -> $969.000."""
    return "$" + f"{round(value):,}".replace(",", ".")


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")


def today() -> str:
    return dt.date.today().strftime("%d / %m / %Y")


def find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_PATH"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    sys.exit("ERROR: no se encontró Google Chrome ni Chromium. Instálalo o define CHROME_PATH.")


def download(url: str, dest: Path) -> Path:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        dest.write_bytes(resp.read())
    return dest


def prepare_hardware(data: dict, work: Path) -> None:
    """Download photos, build QR codes and compute subtotals and totals."""
    essential = optional = essential_max = optional_max = 0
    data.setdefault("nota_resumen", None)
    data.setdefault("revisar", [])
    for i, eq in enumerate(data["equipos"], 1):
        for key, default in (("opcional", False), ("precio_antes", None), ("descuento", None),
                             ("tienda", data.get("tienda")), ("reputacion", None)):
            eq.setdefault(key, default)
        qty_min = eq.get("cantidad_min", eq.get("cantidad", 1))
        qty_max = eq.get("cantidad_max", qty_min)
        eq["cantidad_min"], eq["cantidad_max"] = qty_min, qty_max
        eq["cantidad_txt"] = str(qty_min) if qty_min == qty_max else f"{qty_min} o {qty_max}"
        eq["subtotal_min"] = eq["precio"] * qty_min
        eq["subtotal_max"] = eq["precio"] * qty_max
        if eq.get("opcional"):
            optional += eq["subtotal_min"]
            optional_max += eq["subtotal_max"]
        else:
            essential += eq["subtotal_min"]
            essential_max += eq["subtotal_max"]
        # Photo: remote URL (downloaded), local file (for example a photo the user shared) or none.
        img = eq.get("imagen")
        if img and img.startswith("http"):
            ext = Path(img.split("?")[0]).suffix or ".jpg"
            eq["imagen"] = download(img, work / f"equipo{i}{ext}").as_uri()
        elif img:
            local = Path(img).expanduser().resolve()
            if not local.exists():
                sys.exit(f"ERROR: no existe la imagen {local}")
            eq["imagen"] = local.as_uri()
        else:
            eq["imagen"] = None
        # QR only when the device has a product link (any online store).
        url = eq.get("url")
        eq["url"] = url or None
        eq["qr"] = eq["url_corta"] = None
        if url:
            qr_path = work / f"qr{i}.png"
            qrcode.make(url, border=1, box_size=10).save(qr_path)
            eq["qr"] = qr_path.as_uri()
            eq["url_corta"] = re.sub(r"^https?://(www\.)?", "", url).split("#")[0]
    data["total_esencial"] = essential
    data["total_esencial_max"] = essential_max
    data["total_con_opcionales"] = essential + optional
    data["total_con_opcionales_max"] = essential_max + optional_max
    data["hay_opcionales"] = optional > 0
    data["hay_rangos"] = essential_max != essential or optional_max != optional


def verify(pdf: Path, html: str, data: dict) -> list[str]:
    reader = PdfReader(str(pdf))
    pages = [p.extract_text() or "" for p in reader.pages]
    expected = html.count('<section class="page"')
    problems = []
    if len(pages) != expected:
        problems.append(f"El PDF tiene {len(pages)} páginas y la plantilla define {expected}: algún contenido se partió en dos hojas.")
    joined = "\n".join(pages)
    for marker in re.findall(r"DESBORDE-PAGINA-\d+", joined):
        problems.append(f"{marker}: el contenido no cabe en la hoja; acorta los textos de esa página.")
    first = re.sub(r"\s+", " ", pages[0]) if pages else ""
    for label in ("CLIENTE", "CONTACTO", "PREPARADO POR", "FECHA"):
        if label not in first.upper():
            problems.append(f"La portada (hoja 1) no muestra {label}.")
    empresa_head = data["cliente"]["empresa"].split()[0]
    if empresa_head.lower() not in first.lower():
        problems.append("La portada no muestra el nombre de la empresa.")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tipo", choices=sorted(TEMPLATES))
    ap.add_argument("--data", required=True, help="JSON con los datos del cliente")
    ap.add_argument("--out", help="Ruta del PDF (por defecto entregables/propuestas/<Tipo>_<Empresa>.pdf)")
    ap.add_argument("--html", help="Guarda también el HTML renderizado en esta ruta (para depurar)")
    args = ap.parse_args()

    data = json.loads(Path(args.data).read_text(encoding="utf-8"))
    data.setdefault("fecha", today())
    emisor = json.loads((ASSETS / "emisor.json").read_text(encoding="utf-8"))

    out = Path(args.out) if args.out else OUT_DIR / f"{PREFIX[args.tipo]}_{slug(data['cliente']['empresa'])}.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="vendix-doc-") as tmp:
        work = Path(tmp)
        if args.tipo == "hardware":
            prepare_hardware(data, work)
        tpl_path = TEMPLATES[args.tipo]
        env = jinja2.Environment(
            loader=jinja2.FileSystemLoader([str(tpl_path.parent), str(SKILL_DIR / "templates")]),
            autoescape=jinja2.select_autoescape(["html", "j2"]),
            undefined=jinja2.StrictUndefined,
        )
        env.filters["cop"] = cop
        html = env.get_template(tpl_path.name).render(d=data, emisor=emisor, assets=ASSETS.as_uri())
        html_file = work / "documento.html"
        html_file.write_text(html, encoding="utf-8")
        if args.html:
            shutil.copy(html_file, args.html)

        cmd = [
            find_chrome(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
            "--allow-file-access-from-files", "--virtual-time-budget=10000",
            f"--user-data-dir={work / 'chrome'}", f"--print-to-pdf={out}", html_file.as_uri(),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if not out.exists():
            sys.exit(f"ERROR: Chrome no generó el PDF.\n{res.stderr[-1500:]}")

    problems = verify(out, html, data)
    pages = len(PdfReader(str(out)).pages)
    if problems:
        print(f"PDF generado con problemas: {out} ({pages} páginas)")
        for p in problems:
            print(f"  - {p}")
        sys.exit(2)
    print(f"OK {out} ({pages} páginas)")


if __name__ == "__main__":
    main()
