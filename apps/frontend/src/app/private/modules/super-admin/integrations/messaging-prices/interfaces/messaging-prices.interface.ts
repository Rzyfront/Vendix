export type MessagingPriceSource = 'platform_settings' | 'environment' | 'default';

export interface MessagingPriceField<T> {
  value: T;
  source: MessagingPriceSource;
}

/** Country code (1-4 digits) or `default` -> USD price. */
export type MessagingPriceTable = Record<string, number>;

export interface MessagingPricesView {
  key: string;
  sms_price_table: MessagingPriceField<MessagingPriceTable>;
  sms_max_price_usd: MessagingPriceField<number>;
  sms_max_price_margin: MessagingPriceField<number>;
  whatsapp_price_table: MessagingPriceField<MessagingPriceTable>;
  email_price_usd: MessagingPriceField<number>;
  fallbacks: {
    sms_per_segment_usd: number;
    whatsapp_per_message_usd: number;
  };
  updated_by_user_id: number | null;
  updated_at: string | null;
}

/** PATCH body: absent = unchanged, `null` = remove from panel, value = save. */
export interface UpdateMessagingPricesDto {
  sms_price_table?: MessagingPriceTable | null;
  sms_max_price_usd?: number | null;
  sms_max_price_margin?: number | null;
  whatsapp_price_table?: MessagingPriceTable | null;
  email_price_usd?: number | null;
}
