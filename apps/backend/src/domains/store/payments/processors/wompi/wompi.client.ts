import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  WompiConfig,
  WompiEnvironment,
  WompiCreateTransactionRequest,
  WompiTransactionResponse,
  WompiMerchantResponse,
  WompiFinancialInstitution,
  WompiWebhookEvent,
} from './wompi.types';

@Injectable()
export class WompiClient {
  private readonly logger = new Logger(WompiClient.name);
  private config: WompiConfig;

  // ── Configuración ───────────────────────────

  configure(config: WompiConfig): void {
    this.config = config;
  }

  private get baseUrl(): string {
    return this.config.environment === WompiEnvironment.PRODUCTION
      ? 'https://production.wompi.co/v1'
      : 'https://sandbox.wompi.co/v1';
  }

  private ensureConfigured(): void {
    if (!this.config) {
      throw new Error('WompiClient not configured. Call configure() first.');
    }
  }

  // ── HTTP helpers ────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: any; bearerToken?: string },
  ): Promise<T> {
    this.ensureConfigured();

    const url = `${this.baseUrl}${path}`;
    const token = options?.bearerToken ?? this.config.private_key;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

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
  ): Promise<WompiTransactionResponse> {
    return this.request<WompiTransactionResponse>('POST', '/transactions', {
      body: data,
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

  async voidTransaction(
    transactionId: string,
  ): Promise<WompiTransactionResponse> {
    return this.request<WompiTransactionResponse>(
      'POST',
      `/transactions/${transactionId}/void`,
    );
  }

  // ── Merchant / Acceptance Token ─────────────

  async getAcceptanceToken(): Promise<string> {
    this.ensureConfigured();

    const response = await this.request<WompiMerchantResponse>(
      'GET',
      `/merchants/${this.config.public_key}`,
      { bearerToken: this.config.public_key },
    );

    return response.data.presigned_acceptance.acceptance_token;
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

  // ── Webhook signature validation ────────────

  validateWebhookSignature(event: WompiWebhookEvent): boolean {
    this.ensureConfigured();

    try {
      const { properties, checksum } = event.signature;

      // Concatenar los valores de las propiedades indicadas en el orden dado
      // Las properties vienen como paths e.g. ["transaction.id", "transaction.status", ...]
      const values = properties.map((prop) => {
        const keys = prop.split('.');
        let value: any = event.data;
        for (const key of keys) {
          value = value?.[key];
        }
        return String(value);
      });

      // Concatenar valores + timestamp + events_secret
      const concatenated =
        values.join('') +
        String(event.timestamp) +
        this.config.events_secret;

      const hash = crypto
        .createHash('sha256')
        .update(concatenated)
        .digest('hex');

      return hash === checksum;
    } catch (error) {
      this.logger.error('Webhook signature validation failed', error);
      return false;
    }
  }
}
