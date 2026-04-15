export interface MessageResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

export interface SendMessageOptions {
  template_id?: string;
  media_url?: string;
}

export interface MessagingProvider {
  send(phone: string, body: string, options?: SendMessageOptions): Promise<MessageResult>;
  getName(): string;
}
