import { Injectable, Logger } from '@nestjs/common';
import { DIAN_ENDPOINTS, DIAN_SOAP_ACTIONS } from './constants/dian-endpoints';
import { DianSendBillResponse } from './interfaces/dian-response.interface';

/**
 * Lightweight SOAP client for DIAN web services.
 * Uses native fetch (Node 18+) — no heavy SOAP libraries needed.
 *
 * Implements retry with exponential backoff for network timeouts only.
 * Validation rejections are NOT retried.
 */
@Injectable()
export class DianSoapClient {
  private readonly logger = new Logger(DianSoapClient.name);
  private readonly max_retries = 3;
  private readonly base_timeout_ms = 30_000;

  /**
   * Sends a signed ZIP file to DIAN via SendBillSync.
   */
  async sendBillSync(
    zip_base64: string,
    file_name: string,
    environment: 'test' | 'production',
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.SendBillSync;

    const soap_body = this.buildSendBillSyncEnvelope(
      zip_base64,
      file_name,
    );

    return this.executeWithRetry(endpoint, soap_action, soap_body);
  }

  /**
   * Sends a test set to DIAN via SendTestSetAsync.
   */
  async sendTestSetAsync(
    zip_base64: string,
    file_name: string,
    test_set_id: string,
    environment: 'test' | 'production',
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.SendTestSetAsync;

    const soap_body = this.buildSendTestSetEnvelope(
      zip_base64,
      file_name,
      test_set_id,
    );

    return this.executeWithRetry(endpoint, soap_action, soap_body);
  }

  /**
   * Checks the status of a previously sent document.
   */
  async getStatus(
    tracking_id: string,
    environment: 'test' | 'production',
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.GetStatus;

    const soap_body = this.buildGetStatusEnvelope(tracking_id);

    return this.executeWithRetry(endpoint, soap_action, soap_body);
  }

  /**
   * Executes a SOAP request with retry for network timeouts.
   */
  private async executeWithRetry(
    endpoint: string,
    soap_action: string,
    soap_body: string,
  ): Promise<DianSendBillResponse> {
    let last_error: Error | null = null;

    for (let attempt = 1; attempt <= this.max_retries; attempt++) {
      const start_time = Date.now();

      try {
        const controller = new AbortController();
        const timeout_id = setTimeout(
          () => controller.abort(),
          this.base_timeout_ms,
        );

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: soap_action,
          },
          body: soap_body,
          signal: controller.signal,
        });

        clearTimeout(timeout_id);

        const response_text = await response.text();
        const duration_ms = Date.now() - start_time;

        this.logger.log(
          `DIAN SOAP response: status=${response.status}, duration=${duration_ms}ms`,
        );

        // Parse the SOAP response
        return this.parseSoapResponse(
          response_text,
          response.status,
          duration_ms,
        );
      } catch (error) {
        const duration_ms = Date.now() - start_time;
        last_error = error as Error;

        // Only retry on network errors/timeouts, not on validation failures
        if (error.name === 'AbortError' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
          const delay_ms = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          this.logger.warn(
            `DIAN request attempt ${attempt}/${this.max_retries} failed (${error.message}). Retrying in ${delay_ms}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay_ms));
          continue;
        }

        // Non-retriable error
        return {
          success: false,
          status_code: 'NETWORK_ERROR',
          status_message: error.message,
          raw_response: '',
          duration_ms,
        };
      }
    }

    // All retries exhausted
    return {
      success: false,
      status_code: 'TIMEOUT',
      status_message: `All ${this.max_retries} attempts failed: ${last_error?.message}`,
      raw_response: '',
      duration_ms: 0,
    };
  }

  /**
   * Parses a SOAP response XML into a structured response.
   */
  private parseSoapResponse(
    response_xml: string,
    http_status: number,
    duration_ms: number,
  ): DianSendBillResponse {
    // Extract status code from SOAP response
    const status_code_match = response_xml.match(
      /<b:StatusCode>(.*?)<\/b:StatusCode>/,
    );
    const status_message_match = response_xml.match(
      /<b:StatusMessage>(.*?)<\/b:StatusMessage>/,
    );
    const is_valid_match = response_xml.match(
      /<b:IsValid>(.*?)<\/b:IsValid>/,
    );

    const status_code = status_code_match?.[1] || String(http_status);
    const status_message =
      status_message_match?.[1] || 'No status message in response';
    const is_valid = is_valid_match?.[1]?.toLowerCase() === 'true';

    return {
      success: is_valid || status_code === '00',
      status_code,
      status_message,
      raw_response: response_xml,
      duration_ms,
    };
  }

  /**
   * Builds the SOAP envelope for SendBillSync.
   */
  private buildSendBillSyncEnvelope(
    zip_base64: string,
    file_name: string,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wcf="http://wcf.dian.colombia">
  <soap:Header/>
  <soap:Body>
    <wcf:SendBillSync>
      <wcf:fileName>${file_name}</wcf:fileName>
      <wcf:contentFile>${zip_base64}</wcf:contentFile>
    </wcf:SendBillSync>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Builds the SOAP envelope for SendTestSetAsync.
   */
  private buildSendTestSetEnvelope(
    zip_base64: string,
    file_name: string,
    test_set_id: string,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wcf="http://wcf.dian.colombia">
  <soap:Header/>
  <soap:Body>
    <wcf:SendTestSetAsync>
      <wcf:fileName>${file_name}</wcf:fileName>
      <wcf:contentFile>${zip_base64}</wcf:contentFile>
      <wcf:testSetId>${test_set_id}</wcf:testSetId>
    </wcf:SendTestSetAsync>
  </soap:Body>
</soap:Envelope>`;
  }

  /**
   * Builds the SOAP envelope for GetStatus.
   */
  private buildGetStatusEnvelope(tracking_id: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:wcf="http://wcf.dian.colombia">
  <soap:Header/>
  <soap:Body>
    <wcf:GetStatus>
      <wcf:trackId>${tracking_id}</wcf:trackId>
    </wcf:GetStatus>
  </soap:Body>
</soap:Envelope>`;
  }
}
