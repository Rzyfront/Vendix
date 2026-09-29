import { Injectable, Logger } from '@nestjs/common';
import {
  DianApplicationResponse,
  DianValidationError,
} from './interfaces/dian-response.interface';

/**
 * Una regla de validación de la DIAN, con la severidad DE ESA regla.
 *
 * La DIAN mezcla en una misma respuesta rechazos ("Rechazo") y avisos
 * ("Notificación"). La severidad se decide por mensaje: decidirla por la
 * respuesta entera convertía una notificación RUT01 en rechazo.
 */
export interface DianRuleMessage {
  code: string;
  text: string;
  severity: 'rechazo' | 'notificacion';
}

/** `DianApplicationResponse` más las reglas estructuradas. */
export interface DianParsedResponse extends DianApplicationResponse {
  /** Reglas por mensaje (rechazos y notificaciones), sin duplicados. */
  rule_messages: DianRuleMessage[];
  /**
   * Regla 90 (documento procesado anteriormente) como ÚNICO rechazo: la DIAN
   * ya tiene el documento, así que no es un rechazo del documento.
   */
  already_processed: boolean;
}

const RULE_PATTERN =
  /Regla:\s*([\w]+)\s*,?\s*(Notificaci[oó]n|Rechazo):\s*([^;|\n]+)/gi;

/**
 * Mensaje humano del veredicto, sin elementos vacíos ni códigos sueltos.
 * Éxito: `accepted_label` más las notificaciones ("Notificación RUT01: …").
 * Rechazo: `rejected_label` más "Regla 90: …; Regla CTG01: …".
 */
export function describeDianVerdict(
  parsed: Pick<
    DianParsedResponse,
    'is_valid' | 'rule_messages' | 'status_description'
  >,
  accepted_label: string,
  rejected_label: string,
): string {
  if (parsed.is_valid) {
    const notes = parsed.rule_messages
      .filter((r) => r.severity === 'notificacion')
      .map((r) => `Notificación ${r.code}: ${r.text}`);
    return [accepted_label, ...notes].join('; ');
  }
  const rules = parsed.rule_messages
    .filter((r) => r.severity === 'rechazo')
    .map((r) => `Regla ${r.code}: ${r.text}`);
  const detail = rules.length
    ? rules.join('; ')
    : (parsed.status_description ?? '').trim();
  return detail ? `${rejected_label}: ${detail}` : rejected_label;
}

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
  parseApplicationResponse(soap_xml: string): DianParsedResponse {
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

      const clean_description = this.cleanHtmlEntities(status_description);
      const rule_messages = this.extractRuleMessages(
        soap_xml,
        app_response_xml,
        clean_description,
        is_valid,
      );
      // `errors` conserva su contrato, pero solo con los rechazos reales.
      const errors: DianValidationError[] = rule_messages
        .filter((r) => r.severity === 'rechazo')
        .map((r) => ({ code: r.code, message: r.text, severity: 'error' }));
      const rechazos = rule_messages.filter((r) => r.severity === 'rechazo');
      const already_processed =
        rechazos.some((r) => r.code === '90') &&
        !rechazos.some((r) => r.code !== '90');

      // Extract document key (CUFE/CUDE) from response
      const document_key = this.extractDocumentKey(
        app_response_xml || soap_xml,
      );

      return {
        is_valid,
        status_code,
        status_description: clean_description,
        errors,
        rule_messages,
        already_processed,
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
        rule_messages: [],
        already_processed: false,
        raw_xml: soap_xml,
      };
    }
  }

  /**
   * Extrae las reglas de todas las fuentes: los `<b:string>` de
   * `<b:ErrorMessage>`, los `cbc:Description` del ApplicationResponse y la
   * StatusDescription. Deduplica por code+text.
   */
  private extractRuleMessages(
    soap_xml: string,
    app_response_xml: string,
    status_description: string,
    is_valid: boolean,
  ): DianRuleMessage[] {
    const sources: string[] = [];

    const error_block =
      soap_xml.match(
        /<b:ErrorMessage\b[^>]*>([\s\S]*?)<\/b:ErrorMessage>/,
      )?.[1] ?? '';
    for (const m of error_block.matchAll(
      /<(?:\w+:)?string>([\s\S]*?)<\/(?:\w+:)?string>/g,
    )) {
      sources.push(this.cleanHtmlEntities(m[1]));
    }
    const descriptions: string[] = [];
    for (const m of app_response_xml.matchAll(
      /<cbc:Description>([\s\S]*?)<\/cbc:Description>/g,
    )) {
      descriptions.push(this.cleanHtmlEntities(m[1]));
    }
    sources.push(...descriptions, status_description);

    const rules: DianRuleMessage[] = [];
    const push = (rule: DianRuleMessage) => {
      if (!rule.text) return;
      if (rules.some((r) => r.code === rule.code && r.text === rule.text)) {
        return;
      }
      rules.push(rule);
    };

    for (const source of sources) {
      for (const match of source.matchAll(RULE_PATTERN)) {
        push({
          code: match[1].trim(),
          text: match[3].trim(),
          severity: /^notificaci/i.test(match[2]) ? 'notificacion' : 'rechazo',
        });
      }
    }

    // Sin ninguna regla reconocible y sin aceptación, un cbc:Description libre
    // es lo único que explica el rechazo. Los numéricos ("0") no son mensajes.
    if (rules.length === 0 && !is_valid) {
      for (const text of descriptions) {
        if (text && !/^\d+$/.test(text)) {
          push({ code: 'DIAN_VALIDATION', text, severity: 'rechazo' });
        }
      }
    }

    return rules;
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
