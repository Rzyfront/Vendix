/**
 * [print-editor-dsk P1.1] — AJV runtime singleton for `PrintFormatDefinition v2`.
 *
 * Skill: vendix-validation, vendix-error-handling.
 *
 * Validates definitions against `definition-v2.schema.json` AND runs two
 * custom invariants the schema intentionally doesn't enforce:
 *
 *  - `columnsWidthSum100` — `sum(columns[?enabled].width_percent) === 100`.
 *    The schema can't enforce a sum invariant on a user-editable column
 *    set; runtime check is the only option.
 *  - `customTemplateBalanced` — Handlebars `{{` opens must equal `}}`
 *    closes in `custom_template`. Counts literal occurrences; does not
 *    parse Handlebars (that happens at render time in
 *    `PrintTemplateCompilerService`).
 *
 * Exposes `validatePrintFormatDefinition(definition)` for callers in
 * services (e.g. `PrintFormatsService.updateStoreFormat`,
 * `createLibraryTemplate`).
 *
 * Companion spec: `__tests__/ajv-instance.spec.ts`.
 *
 * ## Why two-pass (AJV + manual) instead of AJV `addKeyword`?
 *
 * AJV's `addKeyword({ keyword: 'X', validate: fn })` only fires when the
 * SCHEMA references `X`. The v2 schema is hand-written JSON without these
 * keywords, so registering them on the AJV instance would be a no-op.
 * Two options were possible:
 *
 *  1. Mutate `definition-v2.schema.json` to add `columnsWidthSum100: true`
 *     and `customTemplateBalanced: true` at the root. REJECTED — the schema
 *     is shared with the upstream contract and was authored deliberately to
 *     leave these invariants in code.
 *  2. Run AJV first, then run the two invariants as a second pass and
 *     merge the error arrays. ADOPTED here.
 *
 * The merge is symmetric: callers receive `{ valid, errors }` where
 * `valid === true` only if BOTH passes pass.
 *
 * ## AJV resolution
 *
 * AJV 8.x is hoisted from the workspace root (`node_modules/ajv`) — the
 * peerDependency resolves through npm workspaces, but
 * `apps/backend/package.json` does not declare `ajv` directly. Do NOT add
 * it as a direct dep here without a peer-deps audit: this file already
 * runs in production through the same resolution path the existing
 * `definition-v2.spec.ts` uses.
 *
 * ## Schema loading
 *
 * The schema is loaded with `fs.readFileSync` rather than
 * `import ... from './definition-v2.schema.json'` because
 * `apps/backend/tsconfig.json` does NOT enable `resolveJsonModule` — and
 * adding it would force a tsconfig change that ripples through every
 * other test in the module. fs.readFileSync keeps the schema as data,
 * not as code.
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv, { ValidateFunction } from 'ajv';

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, 'definition-v2.schema.json'),
    path.join(process.cwd(), 'src/domains/store/print-formats/schemas/definition-v2.schema.json'),
    path.join(process.cwd(), 'apps/backend/src/domains/store/print-formats/schemas/definition-v2.schema.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

const SCHEMA_PATH = resolveSchemaPath();
const definitionV2Schema = JSON.parse(
  fs.readFileSync(SCHEMA_PATH, 'utf-8'),
) as Record<string, unknown>;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  // No `addFormats(ajv)` — `ajv-formats` is not declared as a backend dep
  // and the schema only annotates `format: "uri"` (which AJV leaves as a
  // no-op annotation without the format package). Adding formats would
  // introduce a hidden runtime dep not in `apps/backend/package.json`.
});

/**
 * Compile the v2 schema. AJV caches the closure so subsequent
 * `validateDefinitionV2(definition)` calls are O(n) over the definition
 * shape with no recompilation.
 */
const validateDefinitionV2: ValidateFunction = ajv.compile(definitionV2Schema);

/**
 * Custom invariant #1 — `sum(columns[?enabled].width_percent) === 100`.
 *
 * Returns an AJV-shaped error or `null` when the invariant holds. Skips
 * when `columns` is absent or not an array (column set is optional).
 * Skips columns with `enabled === false` (column hidden).
 */
function checkColumnsWidthSum100(definition: any): unknown | null {
  if (!Array.isArray(definition?.columns)) return null;
  const enabled = definition.columns.filter(
    (c: any) => c && c.enabled !== false,
  );
  const total = enabled.reduce(
    (sum: number, c: any) => sum + (Number(c.width_percent) || 0),
    0,
  );
  if (total === 100) return null;
  return {
    keyword: 'columnsWidthSum100',
    instancePath: '/columns',
    schemaPath: '#/columnsWidthSum100',
    params: { total, enabledCount: enabled.length },
    message: `enabled columns width_percent must sum to 100 (got ${total})`,
  };
}

/**
 * Custom invariant #2 — balanced Handlebars braces in `custom_template`.
 *
 * Skips when `custom_template` is absent or not a string. Counts `{{` and
 * `}}` literal occurrences.
 */
function checkCustomTemplateBalanced(definition: any): unknown | null {
  if (typeof definition?.custom_template !== 'string') return null;
  const opens = (definition.custom_template.match(/\{\{/g) || []).length;
  const closes = (definition.custom_template.match(/\}\}/g) || []).length;
  if (opens === closes) return null;
  return {
    keyword: 'customTemplateBalanced',
    instancePath: '/custom_template',
    schemaPath: '#/customTemplateBalanced',
    params: { opens, closes },
    message: `custom_template has unbalanced Handlebars braces (${opens} '{{' vs ${closes} '}}')`,
  };
}

/**
 * Public API for callers (services + tests).
 *
 * Returns `{ valid, errors }` where:
 *  - `valid === true` ⇔ BOTH the schema pass AND the custom invariants
 *    pass.
 *  - `errors` is the concatenation of AJV errors + custom invariant
 *    errors. AJV errors are reset on every call (AJV mutates
 *    `validateDefinitionV2.errors`), so the merge must run inside one
 *    synchronous frame.
 *
 * Service callers wrap this in `VendixHttpException` under
 * `PRINT_CONFIG_VALIDATION_001` for HTTP 422.
 *
 * NOTE: callers must guard with `if (dto.overrides && 'v' in dto.overrides && dto.overrides.v === 2)`
 * to preserve v1 backward compatibility. v1 overrides have no `v` field;
 * passing them through would reject them because the schema requires
 * `v: 2`. The guard lives in the service, not here, so this function
 * stays a thin wrapper.
 */
export function validatePrintFormatDefinition(definition: unknown): {
  valid: boolean;
  errors: unknown[];
} {
  const schemaValid = validateDefinitionV2(definition);
  const schemaErrors = schemaValid ? [] : [...(validateDefinitionV2.errors || [])];

  const customErrors: unknown[] = [];
  const def = definition as any;
  const e1 = checkColumnsWidthSum100(def);
  if (e1) customErrors.push(e1);
  const e2 = checkCustomTemplateBalanced(def);
  if (e2) customErrors.push(e2);

  return {
    valid: schemaValid && customErrors.length === 0,
    errors: [...schemaErrors, ...customErrors],
  };
}

export { ajv, validateDefinitionV2 };