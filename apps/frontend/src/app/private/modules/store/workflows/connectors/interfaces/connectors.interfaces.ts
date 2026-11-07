/** Shapes of `store/workflows/connectors` (P3.3). */

export type ConnectorKey =
  | 'http'
  | 'inbound_webhook'
  | 'email_out'
  | 'email_in'
  | 'whatsapp'
  | 'dian';

export type ConnectorState = 'connected' | 'not_connected' | 'available';

export interface ConnectorStatus {
  state: ConnectorState;
  summary: string;
  missing: string | null;
  details: Record<string, string | number | null>;
}

export interface ConnectorActionInput {
  key: string;
  label: string;
  type: string;
  required: boolean;
  values: string[] | null;
  min: number | null;
  max: number | null;
}

export interface ConnectorAction {
  name: string;
  label: string;
  permission: string;
  inputs: ConnectorActionInput[];
}

export interface ConnectorView {
  key: ConnectorKey;
  label: string;
  description: string;
  actions: ConnectorAction[];
  triggers: string[];
  testable: boolean;
  status: ConnectorStatus;
}

export interface ConnectorTestCheck {
  key: string;
  ok: boolean;
  message: string;
}

export interface ConnectorTestResult {
  ok: boolean;
  simulated: boolean;
  message: string;
  checks?: ConnectorTestCheck[];
}

/** Body of the WhatsApp test; email and DIAN send none. */
export interface WhatsappTestBody {
  to: string;
  template: string;
  language?: string;
  params?: string;
}
