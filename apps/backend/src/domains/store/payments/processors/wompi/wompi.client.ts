import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  WompiConfig,
  WompiEnvironment,
  WompiCreateTransactionRequest,
  WompiTransactionResponse,
  WompiMerchantResponse,
  WompiFinancialInstitution,
  WompiWebhookEvent,
  WompiCreatePaymentLinkRequest,
  WompiPaymentLinkResponse,
} from './wompi.types';

/**
 * Immutable Wompi API client. Instances are created via WompiClientFactory
 * so concurrent requests never race on shared mutable config.
 */
export class WompiClient {
  private readonly logger = new Logger(WompiClient.name);

  constructor(readonly config: WompiConfig) {}

  private get baseUrl(): string {
    return this.config.environment === WompiEnvironment.PRODUCTION
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('WompiClient not configured.');
    }
  }

  // ── HTTP helpers ────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: any; bearerToken?: string; idempotencyKey?: string },
  ): Promise<T> {
    this.ensureConfigured();

    const url = `${this.baseUrl}${path}`;
    const token = options?.bearerToken ?? this.config.private_key;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const fetchOptions: RequestInit = { method, headers };
    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    this.logger.debug(`Wompi ${method} ${url}`);

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      this.logger.error(`Wompi API error: ${response.status}`, data);
      throw new Error(
        data?.error?.message ??
          data?.error?.reason ??
          `Wompi API error: ${response.status}`,
      );
    }

    return data as T;
  }

  // ── Transacciones ───────────────────────────

  async createTransaction(
    data: WompiCreateTransactionRequest,
    idempotencyKey?: string,
  ): Promise<WompiTransactionResponse> {
    return this.request<WompiTransactionResponse>('POST', '/transactions', {
      body: data,
      idempotencyKey,
    });
  }

  async getTransaction(
    transactionId: string,
  ): Promise<WompiTransactionResponse> {
    return this.request<WompiTransactionResponse>(
      'GET',
      `/transactions/${transactionId}`,
    );
  }

  async getTransactionsByReference(
    reference: string,
  ): Promise<{ data: import('./wompi.types').WompiTransactionData[] }> {
    const encoded = encodeURIComponent(reference);
    return this.request<{
      data: import('./wompi.types').WompiTransactionData[];
    }>('GET', `/transactions/?reference=${encoded}`);
  }

  async voidTransaction(
    transactionId: string,
    idempotencyKey?: string,
  ): Promise<WompiTransactionResponse> {
    return this.request<WompiTransactionResponse>(
      'POST',
      `/transactions/${transactionId}/void`,
      { idempotencyKey },
    );
  }

  // ── Merchant / Acceptance Token ─────────────

  async getAcceptanceTokens(): Promise<{
    acceptance_token: string;
    personal_auth_token: string;
  }> {
    this.ensureConfigured();

    const response = await this.request<WompiMerchantResponse>(
      'GET',
      `/merchants/${this.config.public_key}`,
    );

    return {
      acceptance_token: response.data.presigned_acceptance.acceptance_token,
      personal_auth_token:
        response.data.presigned_personal_data_auth.acceptance_token,
    };
  }

  // ── Integrity signature ──────────────────────

  generateIntegritySignature(
    reference: string,
    amountInCents: number,
    currency: string,
  ): string {
    this.ensureConfigured();
    const concatenated = `${reference}${amountInCents}${currency}${this.config.integrity_secret}`;
    return crypto.createHash('sha256').update(concatenated).digest('hex');
  }

  // ── PSE: Instituciones financieras ──────────

  async getFinancialInstitutions(): Promise<WompiFinancialInstitution[]> {
    this.ensureConfigured();

    const response = await this.request<{ data: WompiFinancialInstitution[] }>(
      'GET',
      '/pse/financial_institutions',
      { bearerToken: this.config.public_key },
    );

    return response.data;
  }

  // ── Payment Links ────────────────────────────

  async createPaymentLink(
    data: WompiCreatePaymentLinkRequest,
  ): Promise<WompiPaymentLinkResponse> {
    return this.request<WompiPaymentLinkResponse>('POST', '/payment_links', {
      body: data,
    });
  }

  async getPaymentLink(linkId: string): Promise<WompiPaymentLinkResponse> {
    return this.request<WompiPaymentLinkResponse>(
      'GET',
      `/payment_links/${linkId}`,
      { bearerToken: this.config.public_key },
    );
  }

  // ── Webhook signature validation ────────────

  validateWebhookSignature(event: WompiWebhookEvent): boolean {
    this.ensureConfigured();

    try {
      const { properties, checksum } = event.signature;

      const values = properties.map((prop) => {
        const keys = prop.split('.');
        let value: any = event.data;
        for (const key of keys) {
          value = value?.[key];
        }
        return String(value);
      });

      const concatenated =
        values.join('') + String(event.timestamp) + this.config.events_secret;

      const hash = crypto
        .createHash('sha256')
        .update(concatenated)
        .digest('hex');

      const hashBuffer = Buffer.from(hash, 'hex');
      const checksumBuffer = Buffer.from(checksum, 'hex');
      if (hashBuffer.length !== checksumBuffer.length) return false;
      return crypto.timingSafeEqual(hashBuffer, checksumBuffer);
    } catch (error) {
      this.logger.error('Webhook signature validation failed', error);
      return false;
    }
  }
}
