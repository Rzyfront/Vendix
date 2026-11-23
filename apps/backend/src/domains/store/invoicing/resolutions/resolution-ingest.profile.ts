import type { DocumentIngestProfile } from '@common/ai-ingest/profiles/ingest-profile.interface';
import {
  LAX_CONFIDENCE_MAP,
  laxObject,
} from '@common/ai-ingest/extraction/lax-schema';

/**
 * ai-ingest profile of the DIAN numbering-resolution scanner (plan ia-cargas
 * F5b, point #13). Lax schema with the prompt's shape: prefix, ranges,
 * resolution number and dates reach `normalizeResponse` as the model wrote
 * them, so for the same answer the result is identical.
 */

/** Same cap the endpoint always had (multer `fileSize`). */
export const RESOLUTION_SCAN_MAX_BYTES = 15 * 1024 * 1024;

export const RESOLUTION_FIELD_KEYS = [
  'prefix',
  'document_type',
  'resolution_number',
  'resolution_date',
  'range_from',
  'range_to',
  'valid_from',
  'valid_to',
  'technical_key',
  'environment',
] as const;

export const RESOLUTION_SCAN_SCHEMA = laxObject(
  [...RESOLUTION_FIELD_KEYS, 'confidence', 'extraction_notes'],
  { field_confidence: LAX_CONFIDENCE_MAP },
);

export const RESOLUTION_INGEST_PROFILE: DocumentIngestProfile = {
  key: 'dian_resolution',
  mode: 'document',
  documentSchema: { name: 'dian_resolution_scan', schema: RESOLUTION_SCAN_SCHEMA },
  limits: {
    // Formulario 1876 / resolution letter: 1-3 pages; all in ONE call.
    maxPages: 10,
    pagesPerBatch: 10,
    maxBytes: RESOLUTION_SCAN_MAX_BYTES,
  },
};

/** The request the scanner always sent; kept word for word. */
export const RESOLUTION_SCAN_INSTRUCTION =
  'Extract the numbering-resolution data from this Colombian DIAN resolution document. Return ONLY the JSON object matching the schema defined in your system instructions.';

export const RESOLUTION_FIELD_LABELS: Record<string, string> = {
  prefix: 'prefijo',
  document_type: 'tipo de documento',
  resolution_number: 'número de resolución',
  resolution_date: 'fecha de la resolución',
  range_from: 'rango inicial',
  range_to: 'rango final',
  valid_from: 'inicio de vigencia',
  valid_to: 'fin de vigencia',
  technical_key: 'clave técnica',
  environment: 'ambiente',
};
