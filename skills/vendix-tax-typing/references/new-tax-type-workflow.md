# Adding a new tax type — workflow

1. **Enum migration** (own file, `ADD VALUE IF NOT EXISTS`) per `vendix-prisma-migrations`.
2. **Mapping keys** in BOTH `DEFAULT_ACCOUNT_MAPPINGS` and the seed (dual-source). Pick PUC account per `vendix-accounting-rules`.
3. **Calculation** returns the new `tax_type`.
4. **`resolveTaxLines`** auto-handles the new type via the key convention — verify the legacy fallback still balances.
5. **Declaration**: add a `calculateX` + dispatcher route if the tax declares separately; add the obligation enum value (own migration) if it has its own return.
6. **DIAN**: add the scheme code branch in `resolveTaxCodeFromTax`.
7. **Reports + frontend**: extend filters (untyped→iva fallback) and `UI_TO_FISCAL_TAX_TYPE` + UI selector options.
8. **Verify**: run the specs of the touched files (one path per run, see AGENTS.md); confirm the enum and the typed mapping exist per org; create one order with the new tax → validate invoice → check the journal line lands on the right PUC.
