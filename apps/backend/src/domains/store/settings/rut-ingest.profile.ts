import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import {
  LAX_LIST,
  laxObject,
} from '@common/ai-ingest/extraction/lax-schema';

/**
 * ai-ingest profile of the RUT scanner (plan ia-cargas F5b, point #12).
 *
 * The schema is the shape the `rut_scanner` prompt always asked for, lax on
 * purpose: every value reaches `normalizeRutResponse` as the model wrote it
 * (ajv never converts it), so NIT, DV, razón social, responsibilities and
 * regime come out identical for the same model answer.
 */

/** Same cap the endpoint always had (multer `fileSize`). */
export const RUT_SCAN_MAX_BYTES = 15 * 1024 * 1024;

export const RUT_SCAN_SCHEMA = laxObject(
  [
    'nit',
    'nit_dv',
    'nit_type',
    'legal_name',
    'person_type',
    'tax_regime',
    'ciiu',
    'fiscal_address',
    'country',
    'department',
    'city',
    'tax_scheme',
    'confidence',
    'extraction_notes',
  ],
  { tax_responsibilities: LAX_LIST },
);

export const RUT_INGEST_PROFILE: DocumentIngestProfile = {
  key: 'rut',
  mode: 'document',
  documentSchema: { name: 'rut_scan', schema: RUT_SCAN_SCHEMA },
  limits: {
    // A RUT is 1-3 "hojas" (more with many establishments); all of them go in
    // ONE call, as the whole PDF did before.
    maxPages: 10,
    pagesPerBatch: 10,
    maxBytes: RUT_SCAN_MAX_BYTES,
  },
};

/** The request the scanner always sent; kept word for word. */
export const RUT_SCAN_INSTRUCTION =
  'Extract the fiscal identity data from this Colombian RUT document (DIAN). Return ONLY the JSON object matching the schema defined in your system instructions.';

/** Screen labels for "two values" warnings when the RUT was read in parts. */
export const RUT_FIELD_LABELS: Record<string, string> = {
  nit: 'NIT',
  nit_dv: 'dígito de verificación',
  legal_name: 'razón social',
  person_type: 'tipo de persona',
  tax_regime: 'régimen',
  tax_responsibilities: 'responsabilidades',
  tax_scheme: 'responsabilidad principal',
  ciiu: 'actividad económica (CIIU)',
};
