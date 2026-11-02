export type MetaAppReviewStatus = 'pending' | 'approved' | 'rejected';

/** Masked view returned by GET /superadmin/social-sales/meta/config. */
export interface MetaWhatsappConfigView {
  configured: boolean;
  key: string;
  app_id: string | null;
  app_secret_masked: string | null;
  whatsapp_config_id: string | null;
  verify_token_masked: string | null;
  graph_version: string | null;
  app_review_status: MetaAppReviewStatus;
  allow_dev_signup: boolean;
  updated_by_user_id: number | null;
  updated_at: string | null;
}

/** PATCH body: only changed fields are ever present. */
export interface UpdateMetaWhatsappConfigDto {
  app_id?: string;
  app_secret?: string;
  whatsapp_config_id?: string;
  verify_token?: string;
  graph_version?: string;
  app_review_status?: MetaAppReviewStatus;
  allow_dev_signup?: boolean;
}
