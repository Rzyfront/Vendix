import { Injectable } from '@nestjs/common';
import { Prisma, tax_type_enum } from '@prisma/client';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import type { AIMessage, AIMessageContentPart } from '../../../ai-engine/interfaces/ai-provider.interface';
import { parseAiJson } from '../../../ai-engine/utils/ai-json.util';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import type { ManualReceivedDocumentDto } from '../dto/received-document.dto';
import type { NormalizedReceivedDocument, ReceivedDocumentType } from '../interfaces/received-document.interface';
import type { ReceivedDocumentScanExtraction } from '../interfaces/received-document-scan.interface';
import type { ReceivedDocumentSourceFile } from './received-document-pages.service';
import { ReceivedDocumentPagesService } from './received-document-pages.service';
import { ReceivedDocumentsService } from '../received-documents.service';

const OCR_APP_KEY = 'received_document_ocr';
const MAX_AI_CONTENT_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 200_000;
const MAX_LINES_FOR_NORMALIZER = 501;
const MAX_HEADER_TAXES_FOR_NORMALIZER = 101;
const MAX_LINE_TAXES_FOR_NORMALIZER = 21;
const DOCUMENT_TYPES: ReceivedDocumentType[] = ['invoice', 'credit_note', 'debit_note', 'non_electronic'];
const TAX_TYPES = new Set<string>(Object.values(tax_type_enum));

const EXTRACTION_PROMPT = `Lee únicamente los hechos fiscales visibles en las páginas del documento de proveedor. Devuelve SOLO un objeto JSON con esta forma exacta: {"facts":{...},"evidence":[{"field":"facts.invoice_number","page":1,"quote":"texto visible"}]}. En facts incluye las propiedades del DTO de captura manual: document_type (invoice, credit_note, debit_note o non_electronic), invoice_number, document_key, reference_key, reference_number, issuer_tax_id, issuer_name, receiver_tax_id, receiver_name, issue_date, due_date, currency, subtotal_amount, discount_amount, charge_amount, tax_exclusive_amount, tax_inclusive_amount, tax_amount, total_amount, prepaid_amount, payable_rounding_amount, withholding_amount, reviewer_note, items y taxes. Cada item incluye external_code, description, quantity, unit_code, unit_price, discount_amount, net_amount, total_amount y taxes. Cada impuesto incluye tax_type, scheme_code, tax_name, rate, base_amount y amount.

Reglas: transcribe solo hechos visibles; no completes ni infieras datos ausentes. Si falta un campo usa null. No inventes el NIT del comprador/adquirente: copia receiver_tax_id solo si es visible en el documento; no uses contexto de tienda, organización ni emisor. Importes, cantidades, tasas y precios son cadenas decimales sin símbolos ni separadores de miles. Fechas completas en YYYY-MM-DD; si no se ve completa, null. No clasifiques impuestos dudosos: usa tax_type="unclassified". Evidencia breve literal con número de página para cada dato relevante legible. No confirmes aceptación, recepción de bienes, coincidencias, reconocimiento fiscal ni contabilización.`;

@Injectable()
export class ReceivedDocumentScanService {
  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly pagesService: ReceivedDocumentPagesService,
    private readonly receivedDocuments: ReceivedDocumentsService,
  ) {}

  async assertConfigured(): Promise<void> {
    await this.aiEngine.assertVisionModelLinked(OCR_APP_KEY);
  }

  async extract(file: ReceivedDocumentSourceFile): Promise<ReceivedDocumentScanExtraction> {
    await this.assertConfigured();
    const prepared = await this.pagesService.prepare(file);
    const content: AIMessageContentPart[] = [{ type: 'text', text: EXTRACTION_PROMPT }];
    for (const page of prepared.pages) {
      content.push({ type: 'text', text: `Página ${page.page_number}. Texto extraído (puede estar vacío):\n${page.text}` });
      content.push({ type: 'image_url', image_url: { url: page.data_uri, detail: 'high' } });
    }

    let response;
    try {
      response = await this.aiEngine.run(OCR_APP_KEY, {}, [{ role: 'user', content } as AIMessage]);
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
    }
    if (!response?.success || typeof response.content !== 'string' || !response.content.length) {
      throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
    }
    if (Buffer.byteLength(response.content, 'utf8') > MAX_AI_CONTENT_BYTES) {
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }

    let parsed: unknown;
    try {
      parsed = parseAiJson(response.content);
      this.assertBoundedJson(parsed);
    } catch {
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }
    const root = this.asRecord(parsed);
    const rawFacts = this.asRecord(root?.['facts']);
    if (!root || !rawFacts) throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);

    const normalized = this.receivedDocuments.normalizeExtractionFacts(this.buildManualDto(rawFacts));
    this.appendMalformedOptionalFieldErrors(rawFacts, normalized);
    if (this.containsNominalTaxBasis(rawFacts)) {
      normalized.validation.errors.push({
        code: 'UNREVIEWED_NOMINAL_TAX_BASIS',
        message: 'El documento contiene un impuesto nominal por unidad que requiere revisión fiscal antes de clasificarlo.',
      });
    }
    return {
      normalized,
      raw_extraction: root as Prisma.InputJsonObject,
      page_count: prepared.page_count,
      model: typeof response.model === 'string' && response.model.trim() ? response.model : null,
    };
  }

  private buildManualDto(facts: Record<string, unknown>): ManualReceivedDocumentDto {
    const items = Array.isArray(facts['items']) ? facts['items'] : [];
    const headerTaxes = Array.isArray(facts['taxes']) ? facts['taxes'] : [];
    return {
      document_type: this.documentType(facts['document_type']),
      invoice_number: this.stringField(facts['invoice_number'], 100),
      document_key: this.optionalString(facts['document_key'], 128),
      reference_key: this.optionalString(facts['reference_key'], 128),
      reference_number: this.optionalString(facts['reference_number'], 100),
      issuer_tax_id: this.stringField(facts['issuer_tax_id'], 50),
      issuer_name: this.stringField(facts['issuer_name'], 255),
      receiver_tax_id: this.stringField(facts['receiver_tax_id'], 50),
      receiver_name: this.stringField(facts['receiver_name'], 255),
      issue_date: this.stringField(facts['issue_date'], 40),
      due_date: this.optionalString(facts['due_date'], 40),
      currency: this.currencyField(facts['currency']),
      subtotal_amount: this.decimalField(facts['subtotal_amount']),
      discount_amount: this.decimalField(facts['discount_amount']),
      charge_amount: this.optionalDecimal(facts['charge_amount']),
      tax_exclusive_amount: this.optionalDecimal(facts['tax_exclusive_amount']),
      tax_inclusive_amount: this.optionalDecimal(facts['tax_inclusive_amount']),
      tax_amount: this.decimalField(facts['tax_amount']),
      total_amount: this.decimalField(facts['total_amount']),
      prepaid_amount: this.optionalDecimal(facts['prepaid_amount']),
      payable_rounding_amount: this.optionalDecimal(facts['payable_rounding_amount']),
      withholding_amount: this.optionalDecimal(facts['withholding_amount']),
      reviewer_note: this.optionalString(facts['reviewer_note'], 5000),
      items: items.slice(0, MAX_LINES_FOR_NORMALIZER).map((item) => this.manualItem(item)),
      taxes: headerTaxes.slice(0, MAX_HEADER_TAXES_FOR_NORMALIZER).map((tax) => this.manualTax(tax)),
    };
  }

  private manualItem(value: unknown): ManualReceivedDocumentDto['items'][number] {
    const item = this.asRecord(value) ?? {};
    const taxes = Array.isArray(item['taxes']) ? item['taxes'] : [];
    return {
      external_code: this.optionalString(item['external_code'], 100),
      description: this.stringField(item['description'], 2000),
      quantity: this.decimalField(item['quantity']),
      unit_code: this.optionalString(item['unit_code'], 30),
      unit_price: this.decimalField(item['unit_price']),
      discount_amount: this.decimalField(item['discount_amount']),
      net_amount: this.decimalField(item['net_amount']),
      total_amount: this.decimalField(item['total_amount']),
      taxes: taxes.slice(0, MAX_LINE_TAXES_FOR_NORMALIZER).map((tax) => this.manualTax(tax)),
    };
  }

  private manualTax(value: unknown): NonNullable<ManualReceivedDocumentDto['taxes']>[number] {
    const tax = this.asRecord(value) ?? {};
    const type = typeof tax['tax_type'] === 'string' ? tax['tax_type'] : '';
    return {
      tax_type: (type === 'unclassified' || TAX_TYPES.has(type) ? type : 'unclassified') as NonNullable<ManualReceivedDocumentDto['taxes']>[number]['tax_type'],
      scheme_code: this.optionalString(tax['scheme_code'], 30),
      tax_name: this.stringField(tax['tax_name'], 100),
      rate: this.decimalField(tax['rate']),
      base_amount: this.decimalField(tax['base_amount']),
      amount: this.decimalField(tax['amount']),
    };
  }

  private containsNominalTaxBasis(facts: Record<string, unknown>): boolean {
    const isUnitTax = (value: unknown): boolean => {
      const tax = this.asRecord(value);
      return !!tax && (tax['tax_basis_type'] === 'unit' || 'per_unit_amount' in tax || 'base_quantity' in tax || 'base_unit_code' in tax);
    };
    if (Array.isArray(facts['taxes']) && facts['taxes'].some(isUnitTax)) return true;
    return Array.isArray(facts['items']) && facts['items'].slice(0, MAX_LINES_FOR_NORMALIZER).some((value) => {
      const item = this.asRecord(value);
      return !!item && Array.isArray(item['taxes']) && item['taxes'].slice(0, MAX_LINE_TAXES_FOR_NORMALIZER).some(isUnitTax);
    });
  }

  private appendMalformedOptionalFieldErrors(
    facts: Record<string, unknown>,
    normalized: NormalizedReceivedDocument,
  ): void {
    const invalidPaths: string[] = [];
    const optionalTextFields: Array<[string, number]> = [
      ['document_key', 128],
      ['reference_key', 128],
      ['reference_number', 100],
      ['due_date', 40],
      ['reviewer_note', 5000],
    ];
    for (const [field, maxLength] of optionalTextFields) {
      if (this.isMalformedOptionalText(facts[field], maxLength)) invalidPaths.push(`facts.${field}`);
    }
    const optionalDecimalFields = [
      'charge_amount',
      'tax_exclusive_amount',
      'tax_inclusive_amount',
      'prepaid_amount',
      'payable_rounding_amount',
      'withholding_amount',
    ];
    for (const field of optionalDecimalFields) {
      if (facts[field] != null && !this.decimalField(facts[field])) invalidPaths.push(`facts.${field}`);
    }
    const headerTaxes = Array.isArray(facts['taxes']) ? facts['taxes'].slice(0, MAX_HEADER_TAXES_FOR_NORMALIZER) : [];
    headerTaxes.forEach((tax, index) => {
      const record = this.asRecord(tax);
      if (record && this.isMalformedOptionalText(record['scheme_code'], 30)) invalidPaths.push(`facts.taxes[${index}].scheme_code`);
    });
    const items = Array.isArray(facts['items']) ? facts['items'].slice(0, MAX_LINES_FOR_NORMALIZER) : [];
    items.forEach((item, itemIndex) => {
      const record = this.asRecord(item);
      if (!record) return;
      if (this.isMalformedOptionalText(record['external_code'], 100)) invalidPaths.push(`facts.items[${itemIndex}].external_code`);
      if (this.isMalformedOptionalText(record['unit_code'], 30)) invalidPaths.push(`facts.items[${itemIndex}].unit_code`);
      const taxes = Array.isArray(record['taxes']) ? record['taxes'].slice(0, MAX_LINE_TAXES_FOR_NORMALIZER) : [];
      taxes.forEach((tax, taxIndex) => {
        const taxRecord = this.asRecord(tax);
        if (taxRecord && this.isMalformedOptionalText(taxRecord['scheme_code'], 30)) {
          invalidPaths.push(`facts.items[${itemIndex}].taxes[${taxIndex}].scheme_code`);
        }
      });
    });
    for (const path of invalidPaths) {
      normalized.validation.errors.push({
        code: 'INVALID_OCR_OPTIONAL_FIELD',
        message: `El dato opcional ${path} tiene un tipo o longitud inválidos y requiere revisión.`,
      });
    }
  }

  private isMalformedOptionalText(value: unknown, maxLength: number): boolean {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength;
  }

  private assertBoundedJson(value: unknown): void {
    const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
    let visited = 0;
    while (stack.length) {
      const current = stack.pop()!;
      if (++visited > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) throw new Error('OCR JSON exceeds limits.');
      if (!current.value || typeof current.value !== 'object') continue;
      const children = Array.isArray(current.value) ? current.value : Object.values(current.value as Record<string, unknown>);
      for (const child of children) stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }

  private documentType(value: unknown): ReceivedDocumentType {
    return typeof value === 'string' && DOCUMENT_TYPES.includes(value as ReceivedDocumentType)
      ? value as ReceivedDocumentType
      : '__invalid_document_type__' as ReceivedDocumentType;
  }

  private stringField(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    return text.length <= maxLength ? text : '';
  }

  private optionalString(value: unknown, maxLength: number): string | undefined {
    if (value == null || value === '') return undefined;
    return this.stringField(value, maxLength) || undefined;
  }

  private decimalField(value: unknown): string {
    if (typeof value === 'string') return value.trim().length <= 64 ? value.trim() : '';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
  }

  private optionalDecimal(value: unknown): string | undefined {
    if (value == null) return undefined;
    return this.decimalField(value) || '__invalid_ocr_decimal__';
  }

  private currencyField(value: unknown): string {
    if (typeof value !== 'string') return '';
    const code = value.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return '';
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] };
    const supportedCurrencies = intl.supportedValuesOf?.('currency');
    return supportedCurrencies?.includes(code) ? code : '';
  }
}
