import { Injectable, Logger } from '@nestjs/common';
import {
  DianApplicationResponse,
  DianValidationError,
} from './interfaces/dian-response.interface';

/**
 * Parses DIAN SOAP responses and ApplicationResponse XML.
 * Extracts validation results, error codes, and document keys.
 */
@Injectable()
export class DianResponseParserService {
  private readonly logger = new Logger(DianResponseParserService.name);

  /**
   * Parses the DIAN SOAP response to extract the ApplicationResponse.
   * The ApplicationResponse may be base64-encoded inside the SOAP body.
   */
  parseApplicationResponse(soap_xml: string): DianApplicationResponse {
    try {
      // Extract the XmlBase64Bytes content (ApplicationResponse is base64-encoded)
      const xml_bytes_match = soap_xml.match(
        /<b:XmlBase64Bytes>(.*?)<\/b:XmlBase64Bytes>/s,
      );

      let app_response_xml = '';
      if (xml_bytes_match?.[1]) {
        app_response_xml = Buffer.from(xml_bytes_match[1], 'base64').toString(
          'utf-8',
        );
      }

      // Extract IsValid
      const is_valid_match = soap_xml.match(/<b:IsValid>(.*?)<\/b:IsValid>/);
      const is_valid = is_valid_match?.[1]?.toLowerCase() === 'true';

      // Extract StatusCode
      const status_code_match = soap_xml.match(
        /<b:StatusCode>(.*?)<\/b:StatusCode>/,
      );
      const status_code = status_code_match?.[1] || 'unknown';

      // Extract StatusDescription
      const status_desc_match = soap_xml.match(
        /<b:StatusDescription>(.*?)<\/b:StatusDescription>/s,
      );
      const status_description = status_desc_match?.[1] || 'No description';

      // Parse validation errors from ApplicationResponse or StatusDescription
      const errors = this.extractErrors(app_response_xml || status_description);

      // Extract document key (CUFE/CUDE) from response
      const document_key = this.extractDocumentKey(
        app_response_xml || soap_xml,
      );

      return {
        is_valid,
        status_code,
        status_description: this.cleanHtmlEntities(status_description),
        errors,
        document_key,
        raw_xml: app_response_xml || soap_xml,
      };
    } catch (error) {
      this.logger.error(`Failed to parse DIAN response: ${error.message}`);
      return {
        is_valid: false,
        status_code: 'PARSE_ERROR',
        status_description: `Failed to parse response: ${error.message}`,
        errors: [
          {
            code: 'PARSE_ERROR',
            message: error.message,
            severity: 'error',
          },
        ],
        raw_xml: soap_xml,
      };
    }
  }

  /**
   * Extracts validation errors from DIAN response XML.
   */
  private extractErrors(xml: string): DianValidationError[] {
    const errors: DianValidationError[] = [];

    // Match error patterns like: "Regla: FAD06a, Notificación: ..."
    const rule_pattern =
      /Regla:\s*([\w]+),?\s*(?:Notificación|Rechazo):\s*([^;|\n]+)/g;
    let match: RegExpExecArray | null;

    while ((match = rule_pattern.exec(xml)) !== null) {
      errors.push({
        code: match[1].trim(),
        message: match[2].trim(),
        severity: xml.includes('Rechazo') ? 'error' : 'warning',
      });
    }

    // Also look for structured error responses
    const error_message_pattern = /<cbc:Description>(.*?)<\/cbc:Description>/g;
    while ((match = error_message_pattern.exec(xml)) !== null) {
      const msg = this.cleanHtmlEntities(match[1]);
      if (msg && !errors.some((e) => e.message === msg)) {
        errors.push({
          code: 'DIAN_VALIDATION',
          message: msg,
          severity: 'error',
        });
      }
    }

    return errors;
  }

  /**
   * Extracts the document key (CUFE/CUDE) from the DIAN response.
   */
  private extractDocumentKey(xml: string): string | undefined {
    // Look for UUID in ApplicationResponse
    const uuid_match = xml.match(/<cbc:UUID>(.*?)<\/cbc:UUID>/);
    if (uuid_match?.[1]) {
      return uuid_match[1];
    }

    // Look for XmlDocumentKey in SOAP response
    const doc_key_match = xml.match(
      /<b:XmlDocumentKey>(.*?)<\/b:XmlDocumentKey>/,
    );
    return doc_key_match?.[1] || undefined;
  }

  /**
   * Cleans HTML entities from XML text content.
   */
  private cleanHtmlEntities(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, '') // Strip remaining HTML tags
      .trim();
  }
}
