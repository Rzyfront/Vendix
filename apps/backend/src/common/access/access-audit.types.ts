export const ACCESS_AUDIT_SOURCES = ['backend', 'frontend'] as const;
export const ACCESS_AUDIT_SURFACES = [
  'api',
  'sidebar',
  'url',
  'apps_card',
  'vexi',
] as const;
export const ACCESS_AUDIT_DECISIONS = [
  'would_hide',
  'would_block',
  'hidden',
  'blocked',
] as const;
export const ACCESS_AUDIT_LAYERS = ['industry', 'store', 'user', 'org'] as const;
export const ACCESS_GATE_MODES = ['audit', 'enforce'] as const;

export type AccessAuditSource = (typeof ACCESS_AUDIT_SOURCES)[number];
export type AccessAuditSurface = (typeof ACCESS_AUDIT_SURFACES)[number];
export type AccessAuditDecision = (typeof ACCESS_AUDIT_DECISIONS)[number];
export type AccessAuditLayer = (typeof ACCESS_AUDIT_LAYERS)[number];
export type AccessGateMode = (typeof ACCESS_GATE_MODES)[number];

/** One measurable access-gate event. Never carries PII. */
export interface AccessAuditEvent {
  source: AccessAuditSource;
  surface: AccessAuditSurface;
  store_id: number | null;
  organization_id: number | null;
  user_id: number | null;
  role: string | null;
  key: string;
  industry: string[];
  decision: AccessAuditDecision;
  layer: AccessAuditLayer;
  route: string | null;
  mode: AccessGateMode;
}
