export type CheckLegibility = 'good' | 'fair' | 'poor';
export type CheckVerdict = 'pass' | 'warn' | 'fail' | 'needs_review';

/** Normalized 0..1 box of the value on its page (x,y = top-left corner). */
export interface CheckRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CheckFieldResult {
  value: string | number | boolean;
  confidence: number;
  page: number | null;
  region: CheckRegion | null;
}

export interface DocumentCheckResult {
  doc_type: string | null;
  legibility: CheckLegibility;
  matches_request: boolean | null;
  mismatch_reasons: string[];
  valid_until: string | null;
  /** Read text, trimmed. Not returned by the API (it feeds the search index). */
  text: string;
  page_count: number;
  fields: Record<string, CheckFieldResult>;
  /** Requested keys the document had no usable value for. */
  unread_keys: string[];
}

export interface RequestedField {
  key: string;
  label: string;
  type: string;
}
