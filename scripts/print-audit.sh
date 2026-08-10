#!/usr/bin/env bash
# Print single-entry-point audit — Vendix (QUI-663)
#
# Printing has exactly ONE engine: DocumentPrintService
# (apps/frontend/src/app/shared/services/print/document-print.service.ts).
# It resolves format / @page / margin / copies from
# `store_settings.receipts.printing[document]` and waits for the document and
# its images before calling print(). Anything that emits paper on its own is a
# store's print configuration being ignored.
#
# Exits 0 while every hit is allowlisted. The allowlists below are the emitters
# still pending migration: they shrink to empty, never grow. Deleting a name
# from an allowlist is how a migration is declared done.
#
# NOTE: in this repo `rg -r` means REPLACE, not recursive. Never write `rg -rn`.
set -eu
cd "$(dirname "$0")/.."

FAILED=0
fail() { echo "❌ $1"; FAILED=1; }
ok() { echo "✅ $1"; }
warn() { echo "⚠️  $1"; }

# ─── The one legitimate engine ───────────────────────────────────────────
ENGINE='apps/frontend/src/app/shared/services/print/'

# ─── Allowlists: emitters not migrated yet ───────────────────────────────
# Each entry is a file that still prints on its own. Remove it the moment it
# routes through DocumentPrintService.

# Browser emitters: hidden iframe or popup window + window.print().
PENDING_BROWSER_EMITTERS='(
apps/frontend/src/app/private/modules/store/orders/services/order-print\.service\.ts|
apps/frontend/src/app/private/modules/store/orders/purchase-orders/services/purchase-order-print\.service\.ts|
apps/frontend/src/app/private/modules/store/dispatch-notes/services/dispatch-note-print\.service\.ts|
apps/frontend/src/app/private/modules/store/quotations/services/quotation-print\.service\.ts|
apps/frontend/src/app/private/modules/store/reservations/services/reservation-print\.service\.ts|
apps/frontend/src/app/private/modules/store/layaway/services/layaway-print\.service\.ts|
apps/frontend/src/app/private/modules/store/withholding-tax/services/withholding-certificate-print\.service\.ts|
apps/frontend/src/app/private/modules/ecommerce/services/guest-order-print\.service\.ts|
apps/frontend/src/app/private/modules/store/restaurant-ops/tables/pages/tables-manage-page/tables-manage-page\.component\.ts|
apps/frontend/src/app/private/modules/store/restaurant-ops/tables/components/table-qr-modal/table-qr-modal\.component\.ts|
apps/frontend/src/app/private/modules/store/pos/components/pos-customer-modal\.component\.ts|
apps/frontend/src/app/private/modules/store/pos/components/pos-order-confirmation\.component\.ts
)'

# Hand-written @page rules. Same list plus the component stylesheets that carry
# their own print block.
PENDING_PAGE_RULES="$PENDING_BROWSER_EMITTERS"

# Native (expo-print) emitters on the mobile app.
PENDING_NATIVE_EMITTERS='(
apps/mobile/app/\(store-admin\)/pos/index\.tsx
)'

# Backend pdfkit builders with a hardcoded page size. The backend has no
# DocumentPrintService yet; these are tracked so the debt stays visible.
PENDING_PDFKIT_BUILDERS='(
apps/backend/src/common/pdf/pdfkit\.ts|
apps/backend/src/domains/store/dispatch-notes/pdf/dispatch-note-pdf\.builder\.ts|
apps/backend/src/domains/store/subscriptions/services/subscription-invoice-pdf\.service\.ts|
apps/backend/src/domains/store/dispatch-routes/route-flow/pdf-export\.service\.ts|
apps/backend/src/domains/organization/orders/services/order-pdf\.builder\.ts|
apps/backend/src/domains/store/payroll/paystubs/paystub-pdf\.builder\.ts|
apps/backend/src/domains/store/invoicing/services/invoice-pdf\.builder\.ts
)'

# Collapse the multi-line, human-readable allowlists into one ERE alternation.
#
# An emptied allowlist squashes to `()`, and `grep -vE '()'` matches EVERY line
# — the check would go permanently green precisely when the last emitter was
# migrated and it finally has something to guard. Emit nothing in that case so
# the caller skips the filter entirely.
squash() {
  local squashed
  squashed=$(printf '%s' "$1" | tr -d ' \n')
  [ "$squashed" = "()" ] && squashed=''
  printf '%s' "$squashed"
}

# ─── Helpers ─────────────────────────────────────────────────────────────

# Files matching a pattern, minus the engine and minus an allowlist.
# Uses `rg -l` (list files) — never `rg -r`, which is REPLACE in this repo.
offenders() {
  local pattern="$1"
  local allow
  allow=$(squash "$2")
  shift 2
  rg -l "$pattern" "$@" 2>/dev/null \
    | grep -vF "$ENGINE" \
    | { if [ -n "$allow" ]; then grep -vE "$allow"; else cat; fi; } \
    | sort || true
}

# Same, but a file only counts when it ALSO matches a second pattern. Used to
# separate "printing" from the many legitimate `window.open` calls that open a
# tab, share a link or download a file.
offenders_paired() {
  local pattern="$1"
  local companion="$2"
  local allow="$3"
  shift 3
  offenders "$pattern" "$allow" "$@" \
    | while read -r f; do
        if rg -q "$companion" "$f" 2>/dev/null; then echo "$f"; fi
      done
}

# Like `offenders`, but ignores matches that live ONLY on comment lines
# (//, *, /*). A docstring explaining why `@page` is not written by hand
# documents compliance; flagging it would punish the explanation.
offenders_code_only() {
  local pattern="$1"
  local allow="$2"
  shift 2
  offenders "$pattern" "$allow" "$@" \
    | while read -r f; do
        awk -v pat="$pattern" '
          /^[[:space:]]*(\/\/|\*|\/\*)/ { next }
          $0 ~ pat { found = 1; exit }
          END { if (found) print FILENAME }
        ' "$f"
      done
}

report() {
  local label="$1"
  local hits="$2"
  if [ -z "$hits" ]; then
    ok "$label: 0"
  else
    fail "$label:"
    printf '%s\n' "$hits" | sed 's/^/     /'
  fi
}

# ─── Checks ──────────────────────────────────────────────────────────────

# 1. Hidden iframe built to print.
hits=$(offenders_paired \
  "createElement\(['\"]iframe['\"]\)" \
  '\.print\(\)' \
  "$PENDING_BROWSER_EMITTERS" \
  apps/frontend/src apps/mobile)
report "iframe de impresión fuera del servicio común" "$hits"

# 2. Popup window driven to the printer.
hits=$(offenders_paired \
  'window\.open\(' \
  '\.print\(\)' \
  "$PENDING_BROWSER_EMITTERS" \
  apps/frontend/src apps/mobile)
report "window.open de impresión fuera del servicio común" "$hits"

# 3. expo-print on the mobile app.
hits=$(offenders \
  'Print\.printAsync' \
  "$PENDING_NATIVE_EMITTERS" \
  apps/mobile apps/frontend/src)
report "Print.printAsync fuera del servicio común" "$hits"

# 4. @page written by hand. The rule belongs to PRINT_PAGE_GEOMETRY; a template
#    that writes its own overrides the store's configured paper silently.
hits=$(offenders_code_only \
  '@page' \
  "$PENDING_PAGE_RULES" \
  apps/frontend/src apps/backend/src)
report "@page escrito a mano" "$hits"

# 5. pdfkit page size hardcoded in a builder. Paired with `PDFDocument` so the
#    many unrelated `size:` keys in the codebase (AI payloads, product options)
#    are not swept in.
hits=$(offenders_paired \
  "size: *['\[]" \
  'PDFDocument' \
  "$PENDING_PDFKIT_BUILDERS" \
  apps/backend/src)
report "size: hardcodeado en pdfkit" "$hits"

# ─── Debt still open (informative) ───────────────────────────────────────
pending=$(printf '%s|%s|%s' \
  "$(squash "$PENDING_BROWSER_EMITTERS")" \
  "$(squash "$PENDING_NATIVE_EMITTERS")" \
  "$(squash "$PENDING_PDFKIT_BUILDERS")" \
  | tr -d '()' | tr '|' '\n' | grep -c '[^[:space:]]' || true)
echo ""
if [ "$pending" != "0" ]; then
  warn "$pending emisores siguen sin migrar (allowlist en este script) — QUI-663"
fi

echo ""
if [ "$FAILED" = "0" ]; then
  echo "✅ Print audit PASSED"
  exit 0
else
  echo "❌ Print audit FAILED — enrutá la impresión por DocumentPrintService"
  exit 1
fi
