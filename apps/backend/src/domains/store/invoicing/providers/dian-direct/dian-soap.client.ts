import * as crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ExclusiveCanonicalization } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { DIAN_ENDPOINTS, DIAN_SOAP_ACTIONS } from './constants/dian-endpoints';
import { DianSendBillResponse } from './interfaces/dian-response.interface';

export interface WsSecurityCredentials {
  private_key_pem: string;
  certificate_der_base64: string;
}

/** Namespace URIs used in the SOAP envelope */
const NS = {
  soap: 'http://www.w3.org/2003/05/soap-envelope',
  wcf: 'http://wcf.dian.colombia',
  wsa: 'http://www.w3.org/2005/08/addressing',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  ec: 'http://www.w3.org/2001/10/xml-exc-c14n#',
} as const;

/**
 * Lightweight SOAP client for DIAN web services.
 * Uses native fetch (Node 18+) — no heavy SOAP libraries needed.
 *
 * Implements retry with exponential backoff for network timeouts only.
 * Validation rejections are NOT retried.
 *
 * Supports optional WS-Security (X.509 signed) when credentials are provided.
 * Uses xml-crypto's ExclusiveCanonicalization for proper C14N digest computation.
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
    credentials?: WsSecurityCredentials,
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.SendBillSync;

    const soap_body = this.buildSendBillSyncEnvelope(
      zip_base64,
      file_name,
      endpoint,
      soap_action,
      credentials,
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
    credentials?: WsSecurityCredentials,
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.SendTestSetAsync;

    const soap_body = this.buildSendTestSetEnvelope(
      zip_base64,
      file_name,
      test_set_id,
      endpoint,
      soap_action,
      credentials,
    );

    return this.executeWithRetry(endpoint, soap_action, soap_body);
  }

  /**
   * Checks the status of a previously sent document.
   */
  async getStatus(
    tracking_id: string,
    environment: 'test' | 'production',
    credentials?: WsSecurityCredentials,
  ): Promise<DianSendBillResponse> {
    const endpoint = DIAN_ENDPOINTS[environment].url;
    const soap_action = DIAN_SOAP_ACTIONS.GetStatus;

    const soap_body = this.buildGetStatusEnvelope(
      tracking_id,
      endpoint,
      soap_action,
      credentials,
    );

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

    // Debug: write SOAP envelope to file for analysis
    try {
      const fs = require('fs');
      const header_end = soap_body.indexOf('<soap:Body>');
      if (header_end > 0) {
        fs.writeFileSync(
          '/tmp/dian_soap_request.xml',
          soap_body.substring(0, header_end + 100),
        );
      }
    } catch {
      /* ignore */
    }

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
            'Content-Type': `application/soap+xml; charset=utf-8; action="${soap_action}"`,
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

        // Log raw response for debugging (truncated)
        if (response.status !== 200) {
          this.logger.debug(
            `DIAN raw response: ${response_text.substring(0, 1500)}`,
          );
        }

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
        if (
          error.name === 'AbortError' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ECONNREFUSED'
        ) {
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
    const is_soap_response = response_xml.includes('Envelope');

    // SOAP Fault (e.g., HTTP 500 with InvalidSecurity) — still a valid SOAP response
    if (is_soap_response && response_xml.includes('Fault')) {
      const fault_reason_match = response_xml.match(
        /<s:Text[^>]*>(.*?)<\/s:Text>/,
      );
      const fault_code_match = response_xml.match(/<s:Value>(.*?)<\/s:Value>/);
      return {
        success: false,
        status_code: fault_code_match?.[1] || String(http_status),
        status_message:
          fault_reason_match?.[1] || `SOAP Fault (HTTP ${http_status})`,
        raw_response: response_xml,
        duration_ms,
        is_soap_fault: true,
      };
    }

    // Non-SOAP HTTP error (e.g., 415 with HTML error page)
    if (http_status !== 200) {
      return {
        success: false,
        status_code: String(http_status),
        status_message: `DIAN returned HTTP ${http_status}`,
        raw_response: response_xml,
        duration_ms,
      };
    }

    // Extract status code from SOAP response
    const status_code_match = response_xml.match(
      /<b:StatusCode>(.*?)<\/b:StatusCode>/,
    );
    const status_message_match = response_xml.match(
      /<b:StatusMessage>(.*?)<\/b:StatusMessage>/,
    );
    const is_valid_match = response_xml.match(/<b:IsValid>(.*?)<\/b:IsValid>/);

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
   * Wraps a SOAP body with the full envelope including WS-Addressing headers.
   * DIAN uses WSHttpBinding which requires WS-Addressing (wsa:To, wsa:Action).
   *
   * When credentials are provided, includes WS-Security with X.509 signature.
   */
  private wrapEnvelope(
    endpoint: string,
    soap_action: string,
    body_content: string,
    credentials?: WsSecurityCredentials,
  ): string {
    if (credentials) {
      return this.buildSignedEnvelope(
        endpoint,
        soap_action,
        body_content,
        credentials,
      );
    }

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<soap:Envelope xmlns:soap="${NS.soap}" xmlns:wcf="${NS.wcf}" xmlns:wsa="${NS.wsa}">`,
      '<soap:Header>',
      `<wsa:Action>${soap_action}</wsa:Action>`,
      `<wsa:To>${endpoint}</wsa:To>`,
      '</soap:Header>',
      `<soap:Body>${body_content}</soap:Body>`,
      '</soap:Envelope>',
    ].join('');
  }

  /**
   * Builds a complete SOAP envelope with WS-Security signature.
   *
   * Uses xml-crypto's ExclusiveCanonicalization to produce correct C14N output
   * that matches what DIAN's WCF server computes during signature verification.
   *
   * Flow:
   * 1. Build envelope with Timestamp + BinarySecurityToken (no Signature yet)
   * 2. Parse with DOMParser to get a real DOM tree
   * 3. Use Exclusive C14N to canonicalize <wsa:To> with PrefixList="soap wcf"
   * 4. Compute SHA-256 digest of the canonical <wsa:To>
   * 5. Build <ds:SignedInfo>, canonicalize it with PrefixList="wsa soap wcf"
   * 6. RSA-SHA256 sign the canonical SignedInfo
   * 7. Insert <ds:Signature> into the Security header and serialize
   */
  private buildSignedEnvelope(
    endpoint: string,
    soap_action: string,
    body_content: string,
    credentials: WsSecurityCredentials,
  ): string {
    const hash = crypto.randomBytes(8).toString('hex');
    const to_id = `id-${hash}`;
    const ts_id = `TS-${hash}`;
    const cert_id = `SOENAC-${hash}`;
    const sig_id = `SIG-${hash}`;
    const ki_id = `KI-${hash}`;
    const str_id = `STR-${hash}`;

    // a) Timestamp (no milliseconds — DIAN format: Y-m-dTH:i:sZ)
    const now = new Date();
    const expires = new Date(now.getTime() + 60000);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const created = fmt(now);
    const expires_str = fmt(expires);

    // b) Build the complete envelope WITHOUT Signature (placeholder for insertion)
    const message_id = `urn:uuid:${crypto.randomUUID()}`;
    const envelope_xml =
      `<soap:Envelope xmlns:soap="${NS.soap}" xmlns:wcf="${NS.wcf}" xmlns:wsa="${NS.wsa}" xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
      `<soap:Header>` +
      `<wsa:Action soap:mustUnderstand="1">${soap_action}</wsa:Action>` +
      `<wsa:To wsu:Id="${to_id}">${endpoint}</wsa:To>` +
      `<wsse:Security soap:mustUnderstand="1">` +
      `<wsu:Timestamp wsu:Id="${ts_id}">` +
      `<wsu:Created>${created}</wsu:Created>` +
      `<wsu:Expires>${expires_str}</wsu:Expires>` +
      `</wsu:Timestamp>` +
      `<wsse:BinarySecurityToken ` +
      `ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" ` +
      `EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary" ` +
      `wsu:Id="${cert_id}">${credentials.certificate_der_base64}</wsse:BinarySecurityToken>` +
      `</wsse:Security>` +
      `</soap:Header>` +
      `<soap:Body>${body_content}</soap:Body>` +
      `</soap:Envelope>`;

    // c) Replicating the DIAN PHP reference pattern (Stenfrank/soap-dian):
    //    - Extract the <wsa:To> from the DOM as a string
    //    - Inject namespace declarations via string replacement
    //    - Parse into a fresh DOMDocument
    //    - Call C14N (inclusive) on the document element
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    const doc = parser.parseFromString(envelope_xml, 'text/xml');

    // d) DigestValue: serialize <wsa:To>, inject missing namespaces, C14N, SHA-256
    //    Replicates PHP pattern: str_replace to add xmlns:soap and xmlns:wcf
    //    (xmlns:wsa and xmlns:wsu are already present from serialization)
    const to_element = doc.getElementsByTagNameNS(NS.wsa, 'To')[0];
    const to_serialized = serializer.serializeToString(to_element);
    // Only inject namespaces that aren't already present
    const ns_to_inject: string[] = [];
    if (!to_serialized.includes(`xmlns:soap="`))
      ns_to_inject.push(`xmlns:soap="${NS.soap}"`);
    if (!to_serialized.includes(`xmlns:wcf="`))
      ns_to_inject.push(`xmlns:wcf="${NS.wcf}"`);
    if (!to_serialized.includes(`xmlns:wsa="`))
      ns_to_inject.push(`xmlns:wsa="${NS.wsa}"`);
    const to_with_ns =
      ns_to_inject.length > 0
        ? to_serialized.replace(
            '<wsa:To ',
            `<wsa:To ${ns_to_inject.join(' ')} `,
          )
        : to_serialized;
    const to_doc = parser.parseFromString(to_with_ns, 'text/xml');
    const c14n = new ExclusiveCanonicalization();
    const canonical_to_str = c14n
      .process(to_doc.documentElement, {
        inclusiveNamespacesPrefixList: ['wsa', 'soap', 'wcf', 'wsu'],
      })
      .toString();

    this.logger.debug(`Canonical <wsa:To>: ${canonical_to_str}`);

    const to_digest = crypto
      .createHash('sha256')
      .update(canonical_to_str)
      .digest('base64');

    // e) Build <ds:SignedInfo> structure (without digest first, then with)
    const signed_info_xml =
      `<ds:SignedInfo xmlns:ds="${NS.ds}">` +
      `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#">` +
      `<ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="wsa soap wcf"/>` +
      `</ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>` +
      `<ds:Reference URI="#${to_id}">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#">` +
      `<ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="soap wcf"/>` +
      `</ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>` +
      `<ds:DigestValue>${to_digest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    // f) Signature: inject extra namespaces into SignedInfo, parse, C14N, sign
    //    SignedInfo already has xmlns:ds, add xmlns:wsa, xmlns:soap, xmlns:wcf
    const si_with_ns = signed_info_xml.replace(
      `<ds:SignedInfo xmlns:ds="${NS.ds}">`,
      `<ds:SignedInfo xmlns:ds="${NS.ds}" xmlns:wsa="${NS.wsa}" xmlns:soap="${NS.soap}" xmlns:wcf="${NS.wcf}">`,
    );
    const si_doc = parser.parseFromString(si_with_ns, 'text/xml');
    const canonical_si_str = c14n
      .process(si_doc.documentElement, {
        inclusiveNamespacesPrefixList: ['ds', 'wsa', 'soap', 'wcf'],
      })
      .toString();

    this.logger.debug(`Canonical SignedInfo: ${canonical_si_str}`);

    // g) RSA-SHA256 sign the canonical SignedInfo
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonical_si_str);
    const signature_value = signer.sign(credentials.private_key_pem, 'base64');

    // h) Build the complete signed envelope as a string (avoid DOM serialization
    //    which adds redundant namespace declarations to child elements)
    const signature_block =
      `<ds:Signature xmlns:ds="${NS.ds}" Id="${sig_id}">` +
      signed_info_xml +
      `<ds:SignatureValue>${signature_value}</ds:SignatureValue>` +
      `<ds:KeyInfo Id="${ki_id}">` +
      `<wsse:SecurityTokenReference wsu:Id="${str_id}">` +
      `<wsse:Reference URI="#${cert_id}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>` +
      `</wsse:SecurityTokenReference>` +
      `</ds:KeyInfo>` +
      `</ds:Signature>`;

    // Insert signature into the envelope string (before </wsse:Security>)
    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      envelope_xml.replace(
        '</wsse:Security>',
        signature_block + '</wsse:Security>',
      )
    );
  }

  /**
   * Builds the SOAP envelope for SendBillSync.
   */
  private buildSendBillSyncEnvelope(
    zip_base64: string,
    file_name: string,
    endpoint: string,
    soap_action: string,
    credentials?: WsSecurityCredentials,
  ): string {
    return this.wrapEnvelope(
      endpoint,
      soap_action,
      `<wcf:SendBillSync>
      <wcf:fileName>${file_name}</wcf:fileName>
      <wcf:contentFile>${zip_base64}</wcf:contentFile>
    </wcf:SendBillSync>`,
      credentials,
    );
  }

  /**
   * Builds the SOAP envelope for SendTestSetAsync.
   */
  private buildSendTestSetEnvelope(
    zip_base64: string,
    file_name: string,
    test_set_id: string,
    endpoint: string,
    soap_action: string,
    credentials?: WsSecurityCredentials,
  ): string {
    return this.wrapEnvelope(
      endpoint,
      soap_action,
      `<wcf:SendTestSetAsync>
      <wcf:fileName>${file_name}</wcf:fileName>
      <wcf:contentFile>${zip_base64}</wcf:contentFile>
      <wcf:testSetId>${test_set_id}</wcf:testSetId>
    </wcf:SendTestSetAsync>`,
      credentials,
    );
  }

  /**
   * Builds the SOAP envelope for GetStatus.
   */
  private buildGetStatusEnvelope(
    tracking_id: string,
    endpoint: string,
    soap_action: string,
    credentials?: WsSecurityCredentials,
  ): string {
    return this.wrapEnvelope(
      endpoint,
      soap_action,
      `<wcf:GetStatus>
      <wcf:trackId>${tracking_id}</wcf:trackId>
    </wcf:GetStatus>`,
      credentials,
    );
  }
}
