export interface AcceptDocumentDto {
  accepted: boolean;
  context?: 'onboarding' | 'dashboard' | 'settings';
}
