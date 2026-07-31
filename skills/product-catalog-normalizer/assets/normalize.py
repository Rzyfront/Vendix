#!/usr/bin/env python3
"""Deterministic normalizers for product catalog imports.

Only rules that are EXACT live here (price punctuation, ml conversion, title
case, whitespace cleanup, category keyword match). Anything requiring judgment
(brand attribution, ambiguous category) is left to the agent, which must never
invent data.

Usage:
    normalize.py --self-test
    normalize.py --in rows.json --out normalized.json [--name-key nombre] \
                 [--price-key precio] [--desc-key descripcion]

Input JSON: list of dicts (raw client rows). Output JSON: same list with an
added "_norm" object per row: {name, qty_ml, price, category, category_hit,
notes[]}.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata

# --------------------------------------------------------------------------
# Text cleanup
# --------------------------------------------------------------------------

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f​﻿]")
_WS = re.compile(r"\s+")


def clean_text(value) -> str:
    """Trim, collapse whitespace/newlines, drop control and zero-width chars."""
    if value is None:
        return ""
    s = str(value)
    s = _CTRL.sub("", s)
    s = s.replace(" ", " ")
    s = _WS.sub(" ", s)
    return s.strip(" \t\r\n-–—·|;,")


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def norm_key(s: str) -> str:
    """Canonical form for matching header names."""
    return _WS.sub(" ", strip_accents(str(s or "")).lower().replace("_", " ")).strip()


# --------------------------------------------------------------------------
# Quantity -> ml
# --------------------------------------------------------------------------

# Multiplier to millilitres. cc == ml. Ounce = US fluid ounce.
_UNIT_ML = {
    "ml": 1.0,
    "mls": 1.0,
    "mililitro": 1.0,
    "mililitros": 1.0,
    "cc": 1.0,
    "cm3": 1.0,
    "cl": 10.0,
    "dl": 100.0,
    "l": 1000.0,
    "lt": 1000.0,
    "lts": 1000.0,
    "ltr": 1000.0,
    "litro": 1000.0,
    "litros": 1000.0,
    "oz": 29.5735,
    "onz": 29.5735,
}

# number (with , or . decimals) + optional space + unit word
_QTY_RE = re.compile(
    r"(?P<num>\d{1,6}(?:[.,]\d{1,3})?)\s*"
    r"(?P<unit>ml|mls|mililitros?|cc|cm3|cl|dl|lts?|ltr|litros?|l|oz|onz)"
    r"\.?(?![a-z0-9])",
    re.IGNORECASE,
)

# "6 x 330 ml", "6x330ml" -> multipack, must not be collapsed
_PACK_RE = re.compile(r"\b(\d{1,2})\s*[xX×]\s*(?=\d)")

# bare trailing number that MAY be ml (needs contextual confirmation)
_BARE_RE = re.compile(r"(?<![\d.,])(\d{3,4})(?![\d.,])")


def _to_number(num: str) -> float:
    return float(num.replace(",", "."))


def _fmt_ml(ml: float) -> str:
    return f"{int(round(ml))} ml"


def normalize_quantity(text: str):
    """Rewrite every explicit volume in `text` to the canonical `<int> ml`.

    Returns (rewritten_text, qty_ml_or_None, notes[]). `qty_ml` is the volume of
    a single unit; for multipacks it is the per-unit volume and a note is added.
    Never invents a volume when none is present.
    """
    notes: list[str] = []
    if not text:
        return "", None, notes

    found: list[float] = []

    def _sub(m: re.Match) -> str:
        unit = m.group("unit").lower()
        raw = _to_number(m.group("num"))
        ml = raw * _UNIT_ML[unit]
        if unit in ("oz", "onz"):
            notes.append(f"oz->ml aproximado ({m.group(0).strip()} = {_fmt_ml(ml)})")
        if ml < 1 or ml > 100000:
            notes.append(f"volumen fuera de rango, sin convertir: {m.group(0).strip()}")
            return m.group(0)
        found.append(ml)
        return _fmt_ml(ml)

    out = _QTY_RE.sub(_sub, text)
    out = _WS.sub(" ", out).strip()

    if _PACK_RE.search(out) and found:
        notes.append("multipack detectado: volumen es por unidad")

    if not found:
        notes.append("sin volumen explicito")
        return out, None, notes

    return out, found[0], notes


def bare_number_candidates(text: str) -> list[int]:
    """3-4 digit bare numbers that could be ml. Requires agent confirmation."""
    return [int(m.group(1)) for m in _BARE_RE.finditer(text or "")]


# --------------------------------------------------------------------------
# Title case
# --------------------------------------------------------------------------

_LOWER_TOKENS = {
    "ml", "cl", "dl", "cc", "l", "oz", "g", "kg", "mg", "un", "und", "uds",
}
_UPPER_TOKENS = {
    "xo", "vs", "vsop", "vo", "nv", "ipa", "pet", "dop", "igp", "abv", "gt", "sa",
    "s.a.", "dvd", "usb", "led",
}
_ROMAN = re.compile(r"^[IVXLCDM]{2,}$")
_SPLIT = re.compile(r"([\s\-/&.])")


def _cap_token(tok: str, was_upper: bool) -> str:
    if not tok:
        return tok
    low = tok.lower()
    if low in _LOWER_TOKENS:
        return low
    if low in _UPPER_TOKENS:
        return tok.upper()
    if was_upper and _ROMAN.match(tok):
        return tok.upper()
    if re.fullmatch(r"[\d.,°%]+", tok):
        return tok
    # starts with a digit: measurement or pack notation (6x330, 3d) -> never
    # uppercase the interior letter
    if tok[0].isdigit():
        return tok.lower()
    # mixed case already curated by the source (JägerMeister, iPhone) -> keep
    if not tok.isupper() and not tok.islower() and any(c.isalpha() for c in tok):
        return tok
    for i, ch in enumerate(tok):
        if ch.isalpha():
            return tok[:i] + ch.upper() + tok[i + 1 :].lower()
    return tok


def title_case(text: str) -> str:
    """Capitalize every word. Units stay lowercase, acronyms stay uppercase.

    Applied AFTER normalize_quantity so that `750 ml` survives intact.
    """
    if not text:
        return ""
    parts = _SPLIT.split(text)
    out = []
    for p in parts:
        if _SPLIT.fullmatch(p):
            out.append(p)
        else:
            out.append(_cap_token(p, was_upper=p.isupper()))
    return _WS.sub(" ", "".join(out)).strip()


def normalize_name(raw) -> tuple[str, int | None, list[str]]:
    """Full name pipeline: clean -> ml -> title case."""
    cleaned = clean_text(raw)
    with_ml, qty, notes = normalize_quantity(cleaned)
    return title_case(with_ml), (int(qty) if qty else None), notes


# --------------------------------------------------------------------------
# Price
# --------------------------------------------------------------------------

_NUMISH = re.compile(r"[^\d.,]+")


def normalize_price(raw):
    """Return (value, notes[]). Value is int when integral, else float, else None.

    NEVER changes magnitude: `45.000` is 45000, never 45.
    Colombian convention: a lone separator followed by exactly 3 digits is a
    thousands separator; 1-2 digits means decimals.
    """
    notes: list[str] = []
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, ["precio vacio"]

    if isinstance(raw, bool):
        return None, ["precio no numerico"]
    if isinstance(raw, (int, float)):
        v = float(raw)
        return (int(v) if v.is_integer() else v), notes

    s = str(raw)
    cleaned = _NUMISH.sub(" ", s).strip()
    if not cleaned:
        return None, [f"precio sin digitos: {s!r}"]

    tokens = cleaned.split()
    if len(tokens) > 1:
        # "45 000" style space-thousands
        if all(re.fullmatch(r"\d{3}", t) for t in tokens[1:]):
            tokens = ["".join(tokens)]
        elif len(set(tokens)) == 1:
            tokens = [tokens[0]]
        else:
            return None, [f"precio ambiguo, varios numeros en {s!r}"]

    tok = tokens[0].strip(".,")
    if not tok:
        return None, [f"precio sin digitos: {s!r}"]

    has_dot, has_comma = "." in tok, "," in tok

    if has_dot and has_comma:
        dec_sep = "." if tok.rfind(".") > tok.rfind(",") else ","
        thou_sep = "," if dec_sep == "." else "."
        tok = tok.replace(thou_sep, "")
        int_part, _, dec_part = tok.partition(dec_sep)
    elif has_dot or has_comma:
        sep = "." if has_dot else ","
        groups = tok.split(sep)
        if len(groups) > 2:
            int_part, dec_part = "".join(groups), ""
        else:
            right = groups[1]
            if len(right) == 3:
                int_part, dec_part = groups[0] + right, ""
            elif len(right) in (1, 2):
                int_part, dec_part = groups[0], right
            else:
                return None, [f"precio ambiguo, separador irregular en {s!r}"]
    else:
        int_part, dec_part = tok, ""

    if not int_part.isdigit():
        return None, [f"precio no parseable: {s!r}"]

    value = float(f"{int_part}.{dec_part}") if dec_part else float(int_part)
    if value.is_integer():
        return int(value), notes
    notes.append(f"precio con decimales conservados: {s!r} -> {value}")
    return value, notes


# --------------------------------------------------------------------------
# Category
# --------------------------------------------------------------------------

# Ordered: the FIRST match wins, so specific beats generic
# (Champagne before Vino, Crema De Licor before Licor).
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("Mezcal", ["mezcal"]),
    ("Tequila", ["tequila"]),
    ("Champagne", ["champagne", "champana", "champan"]),
    ("Espumante", ["espumante", "espumoso", "prosecco", "cava", "lambrusco", "asti"]),
    ("Sangría", ["sangria"]),
    ("Vermouth", ["vermouth", "vermut", "martini rosso", "martini bianco"]),
    ("Crema De Licor", ["crema de", "baileys", "amarula", "sheridan"]),
    ("Aperitivo", ["aperitivo", "campari", "aperol", "ramazzotti"]),
    ("Cognac", ["cognac", "coñac", "hennessy", "remy martin", "courvoisier"]),
    ("Brandy", ["brandy", "domecq", "torres 10"]),
    ("Whisky", ["whisky", "whiskey", "bourbon", "scotch", "single malt"]),
    ("Vodka", ["vodka"]),
    ("Ginebra", ["ginebra", "gin", "gordons", "tanqueray", "bombay", "beefeater"]),
    # brand keywords like "cristal"/"nectar" are intentionally absent: they
    # collide with Agua Cristal, Cerveza Cristal and fruit nectars
    ("Aguardiente", ["aguardiente", "antioqueno"]),
    ("Ron", ["ron", "rum", "bacardi", "havana club"]),
    ("Cerveza", ["cerveza", "beer", "lager", "ipa", "pilsen", "corona extra"]),
    (
        "Vino",
        [
            "vino", "cabernet", "merlot", "sauvignon", "malbec", "tempranillo",
            "carmenere", "syrah", "shiraz", "chardonnay", "pinot", "rioja",
            "moscatel", "carignan", "grenache", "zinfandel",
        ],
    ),
    ("Energizante", ["energizante", "red bull", "monster", "vive100", "speed max"]),
    ("Gaseosa", ["gaseosa", "soda", "coca cola", "coca-cola", "pepsi", "sprite", "fanta", "quatro"]),
    ("Agua", ["agua", "water"]),
    ("Licor", ["licor", "liqueur", "jagermeister", "sambuca", "anis", "absenta"]),
]

CATEGORIES = [c for c, _ in CATEGORY_RULES] + ["Otro"]


def _kw_pattern(kw: str) -> re.Pattern:
    # accent-insensitive word boundaries; \b is unreliable next to accented text
    esc = re.escape(strip_accents(kw)).replace(r"\ ", r"[\s\-]+")
    return re.compile(rf"(?<![a-z0-9]){esc}(?![a-z0-9])")


_COMPILED = [(cat, [_kw_pattern(k) for k in kws]) for cat, kws in CATEGORY_RULES]


def detect_category(*texts) -> tuple[str | None, str | None]:
    """First-match category from name/description/brand. None when unresolved.

    Word-boundary matching is mandatory: a naive substring match makes `ron`
    fire on `patrón`, `Cerón` and `Ronda`.
    """
    hay = strip_accents(" ".join(clean_text(t) for t in texts if t)).lower()
    if not hay:
        return None, None
    for cat, pats in _COMPILED:
        for p in pats:
            m = p.search(hay)
            if m:
                return cat, m.group(0)
    return None, None


# --------------------------------------------------------------------------
# Brand support (deterministic part only)
# --------------------------------------------------------------------------

_DESCRIPTORS = {
    "botella", "caja", "unidad", "und", "un", "pack", "six", "sixpack", "lata",
    "premium", "especial", "original", "clasico", "clasica", "tradicional",
    "reserva", "extra", "anejo", "blanco", "tinto", "rosado", "seco", "dulce",
    "sin", "con", "azucar", "de", "del", "la", "el", "los", "las", "y",
}


def brand_candidate(name: str) -> str:
    """Strip category words, volumes and descriptors, leaving likely brand tokens.

    This is a HINT for the agent, not an answer. The agent must confirm against
    the source document or a known-brand list, and leave the cell empty when
    unsure. Never invent a brand.
    """
    cat, _ = detect_category(name)
    toks = []
    for t in clean_text(name).split():
        low = strip_accents(t).lower()
        if re.fullmatch(r"[\d.,°%]+", t) or low in _LOWER_TOKENS or low in _DESCRIPTORS:
            continue
        if cat and low in strip_accents(cat).lower().split():
            continue
        if any(_kw_pattern(k).fullmatch(low) for c, ks in CATEGORY_RULES if c == cat for k in ks):
            continue
        toks.append(t)
    return " ".join(toks[:3])


# --------------------------------------------------------------------------
# Row pipeline
# --------------------------------------------------------------------------


def normalize_row(row: dict, name_key=None, price_key=None, desc_key=None) -> dict:
    name_raw = row.get(name_key) if name_key else None
    price_raw = row.get(price_key) if price_key else None
    desc_raw = row.get(desc_key) if desc_key else None

    name, qty, notes = normalize_name(name_raw)
    price, pnotes = normalize_price(price_raw)
    notes = notes + pnotes

    if qty is None:
        cands = bare_number_candidates(name)
        if cands:
            notes.append(f"posible volumen sin unidad: {cands} (confirmar contexto)")

    cat, hit = detect_category(name, desc_raw)
    if cat is None:
        notes.append("categoria no inferible por keyword")

    return {
        "name": name,
        "qty_ml": qty,
        "price": price,
        "category": cat,
        "category_hit": hit,
        "brand_hint": brand_candidate(name),
        "description": clean_text(desc_raw) or None,
        "notes": notes,
    }


# --------------------------------------------------------------------------
# Self test
# --------------------------------------------------------------------------

_NAME_CASES = [
    ("RON VIEJO DE CALDAS 750ML", "Ron Viejo De Caldas 750 ml"),
    ("TEQUILA JOSE CUERVO ESPECIAL 750ML", "Tequila Jose Cuervo Especial 750 ml"),
    ("VINO GATO NEGRO CABERNET 750 ML", "Vino Gato Negro Cabernet 750 ml"),
    ("whisky  johnnie   walker red label 1000ML", "Whisky Johnnie Walker Red Label 1000 ml"),
    ("BAILEYS ORIGINAL 700 ml.", "Baileys Original 700 ml"),
    ("VODKA ABSOLUT 0,75 L", "Vodka Absolut 750 ml"),
    ("GINEBRA HENDRICKS 1 L", "Ginebra Hendricks 1000 ml"),
    ("AGUARDIENTE ANTIOQUEÑO SIN AZÚCAR 375ml", "Aguardiente Antioqueño Sin Azúcar 375 ml"),
    ("COGNAC REMY MARTIN XO 700ML", "Cognac Remy Martin XO 700 ml"),
    ("cerveza corona six pack 6x330ml", "Cerveza Corona Six Pack 6x330 ml"),
]

_PRICE_CASES = [
    ("$45.000", 45000),
    ("45,000", 45000),
    ("45.000,00", 45000),
    ("COP 120.000", 120000),
    ("120000.00", 120000),
    ("1.234.567", 1234567),
    ("45 000", 45000),
    ("  $ 8.500 ", 8500),
    (45000, 45000),
    (45000.0, 45000),
    ("", None),
    ("2x45.000", None),
    ("consultar", None),
]

_CAT_CASES = [
    ("Ron Viejo De Caldas 750 ml", "Ron"),
    ("Tequila Jose Cuervo Especial 750 ml", "Tequila"),
    ("Vino Gato Negro Cabernet 750 ml", "Vino"),
    ("Whisky Johnnie Walker Red Label 750 ml", "Whisky"),
    ("Aperol Aperitivo 750 ml", "Aperitivo"),
    ("Baileys Original 700 ml", "Crema De Licor"),
    ("Prosecco La Marca 750 ml", "Espumante"),
    ("Tequila Patrón Silver 750 ml", "Tequila"),   # 'ron' inside 'Patrón' must not win
    ("Vino Cerón Reserva 750 ml", "Vino"),         # 'ron' inside 'Cerón'
    ("Agua Cristal 600 ml", "Agua"),
    ("Destornillador Stanley", None),
]


def self_test() -> int:
    fails = 0
    for raw, want in _NAME_CASES:
        got, _, _ = normalize_name(raw)
        if got != want:
            fails += 1
            print(f"NAME  FAIL {raw!r}\n  got  {got!r}\n  want {want!r}")
    for raw, want in _PRICE_CASES:
        got, _ = normalize_price(raw)
        if got != want:
            fails += 1
            print(f"PRICE FAIL {raw!r}: got {got!r} want {want!r}")
    for raw, want in _CAT_CASES:
        got, _ = detect_category(raw)
        if got != want:
            fails += 1
            print(f"CAT   FAIL {raw!r}: got {got!r} want {want!r}")
    total = len(_NAME_CASES) + len(_PRICE_CASES) + len(_CAT_CASES)
    print(f"{total - fails}/{total} passed")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--out")
    ap.add_argument("--name-key")
    ap.add_argument("--price-key")
    ap.add_argument("--desc-key")
    a = ap.parse_args()

    if a.self_test:
        return self_test()
    if not a.inp:
        ap.error("--in required (or --self-test)")

    with open(a.inp, encoding="utf-8") as f:
        rows = json.load(f)
    for r in rows:
        r["_norm"] = normalize_row(r, a.name_key, a.price_key, a.desc_key)

    out = json.dumps(rows, ensure_ascii=False, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"{len(rows)} filas -> {a.out}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
