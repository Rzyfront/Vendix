import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import {
  LAX_CONFIDENCE_MAP,
  laxObject,
} from '@common/ai-ingest/extraction/lax-schema';

/**
 * ai-ingest profile of the DIAN habilitación scanner (plan ia-cargas F5b,
 * point #14). Lax schema with the prompt's shape: Test set id, Software id,
 * PIN and the test numbering reach `normalizeResponse` as the model wrote
 * them, so for the same answer the result is identical.
 */

/** Same cap the endpoint always had (multer `fileSize`), per file. */
export const HABILITATION_SCAN_MAX_BYTES = 15 * 1024 * 1024;

export const HABILITATION_ANSWER_KEYS = [
  'name',
  'nit',
  'nit_dv',
  'environment',
  'software_id',
  'software_pin',
  'test_set_id',
  'resolution_number',
  'resolution_prefix',
  'resolution_range_from',
  'resolution_range_to',
  'resolution_valid_from',
  'resolution_valid_to',
  'resolution_date',
  'resolution_technical_key',
] as const;

export const HABILITATION_SCAN_SCHEMA = laxObject(
  [...HABILITATION_ANSWER_KEYS, 'confidence', 'extraction_notes'],
  { field_confidence: LAX_CONFIDENCE_MAP },
);

export const HABILITATION_INGEST_PROFILE: DocumentIngestProfile = {
  key: 'dian_habilitation',
  mode: 'document',
  documentSchema: { name: 'dian_habilitation_scan', schema: HABILITATION_SCAN_SCHEMA },
  limits: {
    // Per file: portal screenshots and PDFs of 1-2 pages.
    maxPages: 5,
    // 3 files × 5 pages: the WHOLE set goes in ONE call, as before, so the
    // model fills one result from both screens of the DIAN portal.
    pagesPerBatch: 15,
    maxBytes: HABILITATION_SCAN_MAX_BYTES,
  },
};

/** The requests the scanner always sent (one file / several); kept word for word. */
export function habilitationInstruction(fileCount: number): string {
  return fileCount > 1
    ? `Extract the DIAN habilitación (software + test set + test numbering resolution) data from these ${fileCount} Colombian DIAN documents. They are pages of the SAME habilitación process: merge them into a single JSON object. Return ONLY the JSON object matching the schema defined in your system instructions.`
    : 'Extract the DIAN habilitación (software + test set + test numbering resolution) data from this Colombian DIAN document. Return ONLY the JSON object matching the schema defined in your system instructions.';
}

export const HABILITATION_FIELD_LABELS: Record<string, string> = {
  nit: 'NIT',
  nit_dv: 'dígito de verificación',
  environment: 'ambiente',
  software_id: 'identificador del software (SoftwareID)',
  software_pin: 'PIN del software',
  test_set_id: 'identificador del set de pruebas (TestSetId)',
  resolution_number: 'número de resolución',
  resolution_prefix: 'prefijo',
  resolution_range_from: 'rango inicial',
  resolution_range_to: 'rango final',
  resolution_valid_from: 'inicio de vigencia',
  resolution_valid_to: 'fin de vigencia',
  resolution_date: 'fecha de la resolución',
  resolution_technical_key: 'clave técnica',
};
