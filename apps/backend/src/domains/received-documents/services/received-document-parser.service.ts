import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DOMParser } from '@xmldom/xmldom';
import {
  NormalizedReceivedDocument,
  ReceivedDocumentItem,
  ReceivedDocumentTax,
  ReceivedDocumentType,
} from '../interfaces/received-document.interface';

const MAX_XML_BYTES = 10 * 1024 * 1024;
// Bound both parser resource use and recursive tree walking for hostile inputs.
const MAX_XML_DEPTH = 64;
const MAX_XML_NODES = 100_000;
const MAX_EMBEDDED_DOCUMENTS = 4;
const XML_NS = {
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  creditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  debitNote: 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2',
  attachedDocument:
    'urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2',
  applicationResponse:
    'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
} as const;

// Inbound monetary arithmetic follows DIAN's Colombian invoice rules and the
// outgoing Vendix UBL emitter. This is parsing/consistency validation, not
// acceptance or signature verification: FAU06/FAU14 and §11.9.1/.2 from
// https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf
// match `invoice-calculator.service.ts` and `fiscal-document.validator.ts`.
const MONEY_TOLERANCE = '0.01';

type XmlElement = Element;
type Issue = { code: string; message: string };

/**
 * Deterministic, side-effect-free normalizer for inbound DIAN UBL documents.
 * It deliberately does not establish DIAN acceptance or verify XML signatures.
 */
@Injectable()
export class ReceivedDocumentParserService {
  parse(xml: string): NormalizedReceivedDocument {
    const warnings: Issue[] = [];
    const root = this.parseXml(xml);

    if (this.is(root, 'AttachedDocument', XML_NS.attachedDocument)) {
      const embedded = this.embeddedDocuments(root);
      if (embedded.length === 0) {
        return this.nonElectronic(
          warnings,
          'ATTACHED_DOCUMENT_NO_EMBEDDED_XML',
          'AttachedDocument no contiene XML embebido legible.',
        );
      }
      if (embedded.length > MAX_EMBEDDED_DOCUMENTS) {
        throw new BadRequestException('El documento contiene demasiados XML embebidos.');
      }

      const parsed = embedded.map((source) => this.parseXml(source));
      const businessDocs = parsed.filter((node) =>
        this.documentType(node),
      );
      const responses = parsed.filter((node) =>
        this.is(node, 'ApplicationResponse', XML_NS.applicationResponse),
      );
      const parentDocument = [
        ...this.children(root, 'ParentDocumentLineReference', XML_NS.cac),
        ...this.children(root, 'ChildDocumentReference', XML_NS.cac),
      ].flatMap((line) => this.children(line, 'DocumentReference', XML_NS.cac))[0];
      if (parentDocument) {
        warnings.push({
          code: 'ATTACHED_DOCUMENT_REFERENCE',
          message:
            `Referencia del AttachedDocument: ID=${this.text(this.child(parentDocument, 'ID', XML_NS.cbc)) || '(vacío)'} UUID=${this.text(this.child(parentDocument, 'UUID', XML_NS.cbc)) || '(vacío)'}.`,
        });
      }
      for (const response of responses) {
        const responseBody = this.child(response, 'DocumentResponse', XML_NS.cac);
        const responseOutcome = this.child(responseBody, 'Response', XML_NS.cac);
        const responseCode = this.text(this.child(responseOutcome, 'ResponseCode', XML_NS.cbc));
        const responseDescription = this.text(this.child(responseOutcome, 'Description', XML_NS.cbc)).slice(0, 250);
        warnings.push({
          code: 'APPLICATION_RESPONSE_EVIDENCE_UNVERIFIED',
          message:
            `El AttachedDocument incluye ApplicationResponse ID=${this.text(this.child(response, 'ID', XML_NS.cbc)) || '(vacío)'} UUID=${this.text(this.child(response, 'UUID', XML_NS.cbc)) || '(vacío)'} ResponseCode=${responseCode || '(vacío)'} Description=${responseDescription || '(vacía)'}; se conserva como evidencia no verificada, no se interpreta como aceptación DIAN.`,
        });
      }
      if (businessDocs.length !== 1) {
        if (businessDocs.length > 1) {
          throw new BadRequestException(
            'El AttachedDocument contiene más de un documento comercial UBL.',
          );
        }
        return this.nonElectronic(
          warnings,
          'ATTACHED_DOCUMENT_UNSUPPORTED_CONTENT',
          'El XML embebido no es una factura, nota crédito o nota débito UBL soportada.',
        );
      }
      const result = this.normalize(businessDocs[0], warnings);
      if (this.hasSignature(root) && !result.validation.has_signature) {
        result.validation.has_signature = true;
        result.validation.warnings.push(this.issue(
          'SIGNATURE_NOT_VERIFIED',
          'El AttachedDocument contiene un nodo de firma XML; su presencia no significa que la firma se haya verificado.',
        ));
      }
      return result;
    }

    if (!this.documentType(root)) {
      return this.nonElectronic(
        warnings,
        'UNSUPPORTED_UBL_ROOT',
        'El elemento raíz no corresponde a Invoice, CreditNote o DebitNote UBL soportado.',
      );
    }
    return this.normalize(root, warnings);
  }

  private parseXml(source: string): XmlElement {
    if (typeof source !== 'string' || source.length === 0) {
      throw new BadRequestException('El XML está vacío.');
    }
    if (Buffer.byteLength(source, 'utf8') > MAX_XML_BYTES) {
      throw new BadRequestException('El XML excede el límite de 10 MiB.');
    }
    // Reject declarations before the parser sees them. XML predefined/numeric
    // entities remain supported; custom and external entity declarations do not.
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
      throw new BadRequestException('DOCTYPE y declaraciones ENTITY no están permitidos.');
    }

    const errors: string[] = [];
    const parser = new DOMParser({
      errorHandler: {
        warning: (message: string) => errors.push(message),
        error: (message: string) => errors.push(message),
        fatalError: (message: string) => errors.push(message),
      },
    });
    let document: Document;
    try {
      document = parser.parseFromString(source, 'application/xml') as unknown as Document;
    } catch {
      throw new BadRequestException('El XML no se pudo analizar.');
    }
    const root = document?.documentElement;
    const documentRoots = Array.from(document?.childNodes ?? []).filter(
      (node) => node.nodeType === 1,
    );
    const strayText = Array.from(document?.childNodes ?? []).some(
      (node) => node.nodeType === 3 && !!node.textContent?.trim(),
    );
    if (!root || documentRoots.length !== 1 || strayText || errors.length > 0) {
      throw new BadRequestException('El XML está malformado o no tiene una única raíz.');
    }

    let nodeCount = 0;
    const stack: Array<{ node: Node; depth: number }> = [{ node: root, depth: 1 }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodeCount += 1;
      if (nodeCount > MAX_XML_NODES) {
        throw new BadRequestException('El XML excede el límite de nodos permitido.');
      }
      if (current.depth > MAX_XML_DEPTH) {
        throw new BadRequestException('El XML excede la profundidad máxima permitida.');
      }
      for (let child = current.node.firstChild; child; child = child.nextSibling) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
    return root;
  }

  private embeddedDocuments(root: XmlElement): string[] {
    // DIAN AttachedDocument uses Attachment/ExternalReference for the attached
    // invoice. ApplicationResponse evidence is commonly nested under
    // ParentDocumentLineReference/DocumentReference/Attachment instead.
    const attachments = this.children(root, 'Attachment', XML_NS.cac);
    const parentReferences = [
      ...this.children(root, 'ParentDocumentLineReference', XML_NS.cac),
      ...this.children(root, 'ChildDocumentReference', XML_NS.cac),
    ].flatMap((line) => this.children(line, 'DocumentReference', XML_NS.cac));
    const references = [
      ...attachments.flatMap((attachment) => this.children(attachment, 'ExternalReference', XML_NS.cac)),
      ...parentReferences.flatMap((documentReference) =>
        this.children(this.child(documentReference, 'Attachment', XML_NS.cac), 'ExternalReference', XML_NS.cac),
      ),
    ];
    return references.flatMap((reference) => {
      const descriptionElement = this.child(reference, 'Description', XML_NS.cbc);
      if (!descriptionElement) return [];
      // UBL cbc:Description is a text/CDATA container. Raw nested XML becomes
      // DOM elements here, and textContent would flatten those tags away before
      // prefix/suffix validation could see them. Require callers to use the
      // standard escaped-text or CDATA representation for embedded documents.
      for (
        let child = descriptionElement.firstChild;
        child;
        child = child.nextSibling
      ) {
        if (child.nodeType === 1) {
          throw new BadRequestException(
            'El XML embebido debe estar escapado o dentro de CDATA, no como elementos anidados en Description.',
          );
        }
      }
      const description = this.text(descriptionElement);
      if (!description.trim()) return [];
      // Description may hold escaped XML or CDATA. DOM textContent decodes XML
      // entities and leaves CDATA contents intact; parseXml then validates it.
      const candidate = description.trim();
      if (!candidate.includes('<')) return [];
      const firstMarkup = candidate.indexOf('<');
      const lastMarkupEnd = candidate.lastIndexOf('>');
      if (
        candidate.slice(0, firstMarkup).trim() ||
        lastMarkupEnd < firstMarkup ||
        candidate.slice(lastMarkupEnd + 1).trim()
      ) {
        throw new BadRequestException(
          'El XML embebido contiene texto ajeno antes o después del documento.',
        );
      }
      // Parse the complete trimmed value; never extract/slice an apparent XML
      // substring out of unrelated surrounding text.
      return [candidate];
    });
  }

  private normalize(
    root: XmlElement,
    warnings: Issue[],
  ): NormalizedReceivedDocument {
    const documentType = this.documentType(root)!;
    const errors: Issue[] = [];
    const invoiceNumber = this.text(this.child(root, 'ID', XML_NS.cbc));
    const issueDate = this.date(this.text(this.child(root, 'IssueDate', XML_NS.cbc)));
    const dueDateText = this.text(this.child(root, 'DueDate', XML_NS.cbc));
    const dueDate = dueDateText ? this.date(dueDateText) : undefined;
    const currency =
      this.text(this.child(root, 'DocumentCurrencyCode', XML_NS.cbc)) || '';
    const key = this.text(this.child(root, 'UUID', XML_NS.cbc)) || undefined;
    const keyValid = !!key && /^[a-f\d]{96}$/i.test(key);

    if (!invoiceNumber) errors.push(this.issue('MISSING_DOCUMENT_NUMBER', 'Falta el número del documento.'));
    if (!issueDate) errors.push(this.issue('MISSING_OR_INVALID_ISSUE_DATE', 'La fecha de emisión falta o no es una fecha ISO válida.'));
    if (dueDateText && !dueDate) errors.push(this.issue('INVALID_DUE_DATE', 'La fecha de vencimiento no es una fecha ISO válida.'));
    if (!currency) errors.push(this.issue('MISSING_CURRENCY', 'Falta la moneda del documento.'));
    else if (!/^[A-Z]{3}$/.test(currency)) errors.push(this.issue('INVALID_CURRENCY', 'La moneda debe ser un código ISO 4217 de tres letras en mayúscula.'));
    if (!key) errors.push(this.issue('MISSING_DOCUMENT_KEY', 'Falta el UUID/clave del documento.'));
    else if (!keyValid) errors.push(this.issue('INVALID_DOCUMENT_KEY_FORMAT', 'La clave/UUID no tiene el formato hexadecimal DIAN de 96 caracteres; esto no verifica su autenticidad.'));

    const supplierParty = this.party(this.child(root, 'AccountingSupplierParty', XML_NS.cac));
    const receiverParty = this.party(this.child(root, 'AccountingCustomerParty', XML_NS.cac));
    if (!supplierParty.taxId) errors.push(this.issue('MISSING_ISSUER_TAX_ID', 'Falta el NIT/documento del emisor.'));
    if (!supplierParty.name) errors.push(this.issue('MISSING_ISSUER_NAME', 'Falta el nombre del emisor.'));
    if (!receiverParty.taxId) errors.push(this.issue('MISSING_RECEIVER_TAX_ID', 'Falta el NIT/documento del adquirente.'));
    if (!receiverParty.name) errors.push(this.issue('MISSING_RECEIVER_NAME', 'Falta el nombre del adquirente.'));

    const lines = this.children(root, documentType === 'invoice' ? 'InvoiceLine' : documentType === 'credit_note' ? 'CreditNoteLine' : 'DebitNoteLine', XML_NS.cac);
    const items = lines.map((line, index) => this.parseItem(line, index + 1, documentType, errors));
    const totalElement = documentType === 'debit_note' ? 'RequestedMonetaryTotal' : 'LegalMonetaryTotal';
    const monetaryTotals = this.child(root, totalElement, XML_NS.cac);
    const subtotalText = this.text(this.child(monetaryTotals, 'LineExtensionAmount', XML_NS.cbc));
    const discountText = this.text(this.child(monetaryTotals, 'AllowanceTotalAmount', XML_NS.cbc));
    const chargeText = this.text(this.child(monetaryTotals, 'ChargeTotalAmount', XML_NS.cbc));
    const exclusiveText = this.text(this.child(monetaryTotals, 'TaxExclusiveAmount', XML_NS.cbc));
    const inclusiveText = this.text(this.child(monetaryTotals, 'TaxInclusiveAmount', XML_NS.cbc));
    const prepaidText = this.text(this.child(monetaryTotals, 'PrepaidAmount', XML_NS.cbc));
    const roundingText = this.text(this.child(monetaryTotals, 'PayableRoundingAmount', XML_NS.cbc));
    const payableText = this.text(this.child(monetaryTotals, 'PayableAmount', XML_NS.cbc));
    const subtotal = this.money(subtotalText, errors, 'HEADER_SUBTOTAL', true);
    const discount = this.money(discountText, errors, 'HEADER_DISCOUNT');
    const charge = this.money(chargeText, errors, 'HEADER_CHARGE');
    const exclusive = this.money(exclusiveText, errors, 'TAX_EXCLUSIVE_AMOUNT');
    const inclusive = this.money(inclusiveText, errors, 'TAX_INCLUSIVE_AMOUNT');
    const prepaid = this.money(prepaidText, errors, 'PREPAID_AMOUNT');
    const payableRounding = this.rounding(roundingText, errors);
    const total = this.money(payableText, errors, 'HEADER_PAYABLE', true);
    const headerAdjustments = this.children(root, 'AllowanceCharge', XML_NS.cac);
    let detailDiscount = new Prisma.Decimal(0);
    let detailCharge = new Prisma.Decimal(0);
    headerAdjustments.forEach((adjustment, index) => {
      const indicator = this.text(this.child(adjustment, 'ChargeIndicator', XML_NS.cbc)).toLowerCase();
      const amount = this.money(this.text(this.child(adjustment, 'Amount', XML_NS.cbc)), errors, `HEADER_ALLOWANCE_CHARGE_${index + 1}`, true);
      if (indicator === 'true') detailCharge = detailCharge.plus(amount);
      else if (indicator === 'false') detailDiscount = detailDiscount.plus(amount);
      else errors.push(this.issue('INVALID_ALLOWANCE_CHARGE_INDICATOR', 'ChargeIndicator debe ser true o false.'));
    });
    if (headerAdjustments.length > 0) {
      if (!discountText && detailDiscount.gt(0)) {
        errors.push(this.issue('MISSING_HEADER_ALLOWANCE_TOTAL', 'Hay descuentos de cabecera sin AllowanceTotalAmount.'));
      } else if (this.abs(detailDiscount.minus(discount)).gt(MONEY_TOLERANCE)) {
        errors.push(this.issue('HEADER_ALLOWANCE_TOTAL_MISMATCH', 'AllowanceTotalAmount no coincide con los descuentos de cabecera (tolerancia de un céntimo).'));
      }
      if (!chargeText && detailCharge.gt(0)) {
        errors.push(this.issue('MISSING_HEADER_CHARGE_TOTAL', 'Hay cargos de cabecera sin ChargeTotalAmount.'));
      } else if (this.abs(detailCharge.minus(charge)).gt(MONEY_TOLERANCE)) {
        errors.push(this.issue('HEADER_CHARGE_TOTAL_MISMATCH', 'ChargeTotalAmount no coincide con los cargos de cabecera (tolerancia de un céntimo).'));
      }
    }
    const headerTaxElements = this.children(root, 'TaxTotal', XML_NS.cac);
    const headerTaxes = headerTaxElements.flatMap((taxTotal) =>
      this.parseTaxTotal(taxTotal, undefined, errors),
    );
    const headerWithholdingElements = this.children(root, 'WithholdingTaxTotal', XML_NS.cac);
    const headerWithholdingTaxes = headerWithholdingElements.flatMap((taxTotal) =>
      this.parseTaxTotal(taxTotal, undefined, errors, false),
    );
    const itemTaxes = items.flatMap((item) => item.taxes);
    // Prefer declared header subtotals. When absent, expose line tax rows as
    // the aggregate representation; never concatenate both and double-count.
    const taxes = headerTaxes.length > 0
      ? [...headerTaxes, ...headerWithholdingTaxes]
      : itemTaxes;
    const headerTaxAmount = headerTaxElements.reduce(
      (sum, node) => sum.plus(this.money(this.text(this.child(node, 'TaxAmount', XML_NS.cbc)), errors, 'HEADER_TAX_TOTAL', true)),
      new Prisma.Decimal(0),
    );
    const calculatedTax = headerTaxElements.length
      ? headerTaxAmount
      : itemTaxes
          .filter((tax) => !['withholding', 'reteiva', 'reteica'].includes(tax.tax_type))
          .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    const headerWithholdingAmount = headerWithholdingElements.reduce(
      (sum, node) => sum.plus(this.money(this.text(this.child(node, 'TaxAmount', XML_NS.cbc)), errors, 'HEADER_WITHHOLDING', true)),
      new Prisma.Decimal(0),
    );
    const withholdingAmount = headerWithholdingElements.length
      ? headerWithholdingAmount
      : itemTaxes
          .filter((tax) => ['withholding', 'reteiva', 'reteica'].includes(tax.tax_type))
          .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    const lineNet = items.reduce((sum, item) => sum.plus(item.net_amount), new Prisma.Decimal(0));
    const lineTax = itemTaxes
      .filter((tax) => !['withholding', 'reteiva', 'reteica'].includes(tax.tax_type))
      .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    this.validateTaxArithmetic({
      subtotal, lineNet, discount, charge, inclusive, total, headerTaxAmount, lineTax,
      payableRounding, errors, hasInclusive: !!inclusiveText,
      hasAnyTaxTotal: headerTaxElements.length > 0 || lines.some((line) => this.children(line, 'TaxTotal', XML_NS.cac).length > 0),
    });
    if (lines.length === 0) errors.push(this.issue('MISSING_DOCUMENT_LINES', 'El documento no contiene líneas comerciales.'));
    if (this.hasSignature(root)) {
      warnings.push(this.issue('SIGNATURE_NOT_VERIFIED', 'El documento contiene un nodo de firma XML; su presencia no significa que la firma se haya verificado.'));
    }

    const reference = this.reference(root, documentType);
    return {
      document_type: documentType,
      invoice_number: invoiceNumber,
      issuer_tax_id: supplierParty.taxId,
      issuer_name: supplierParty.name,
      receiver_tax_id: receiverParty.taxId,
      receiver_name: receiverParty.name,
      document_key: key,
      issue_date: issueDate ?? '',
      due_date: dueDate,
      currency,
      subtotal_amount: this.moneyString(subtotal),
      discount_amount: this.moneyString(discount),
      charge_amount: chargeText ? this.moneyString(charge) : undefined,
      tax_exclusive_amount: exclusiveText ? this.moneyString(exclusive) : undefined,
      tax_inclusive_amount: inclusiveText ? this.moneyString(inclusive) : undefined,
      tax_amount: this.moneyString(this.computedMoney(calculatedTax, errors, 'DOCUMENT_TAX_AMOUNT')),
      total_amount: this.moneyString(total),
      prepaid_amount: prepaidText ? this.moneyString(prepaid) : undefined,
      payable_rounding_amount: roundingText ? payableRounding.toFixed(2) : undefined,
      withholding_amount: headerWithholdingElements.length || withholdingAmount.gt(0)
        ? this.moneyString(this.computedMoney(withholdingAmount, errors, 'WITHHOLDING_AMOUNT'))
        : undefined,
      items,
      taxes,
      reference_key: reference.key,
      reference_number: reference.number,
      validation: {
        errors,
        warnings,
        has_signature: this.hasSignature(root),
        document_key_format_valid: keyValid,
      },
    };
  }

  private parseItem(
    line: XmlElement,
    lineNumber: number,
    documentType: ReceivedDocumentType,
    errors: Issue[],
  ): ReceivedDocumentItem {
    const quantityNode = this.child(line, documentType === 'invoice' ? 'InvoicedQuantity' : documentType === 'credit_note' ? 'CreditedQuantity' : 'DebitedQuantity', XML_NS.cbc);
    const quantityText = this.text(quantityNode);
    const lineNetText = this.text(this.child(line, 'LineExtensionAmount', XML_NS.cbc));
    const price = this.child(line, 'Price', XML_NS.cac);
    const priceAmountText = this.text(this.child(price, 'PriceAmount', XML_NS.cbc));
    const quantity = this.quantity(quantityText, errors, `LINE_${lineNumber}_QUANTITY`, true);
    const itemNode = this.child(line, 'Item', XML_NS.cac);
    const description = this.text(this.child(itemNode, 'Description', XML_NS.cbc)) || this.text(this.child(itemNode, 'Name', XML_NS.cbc));
    const lineNet = this.money(lineNetText, errors, `LINE_${lineNumber}_NET`, true);
    const priceAmount = this.unitPrice(priceAmountText, errors, `LINE_${lineNumber}_PRICE`, true);
    const baseQuantityText = this.text(this.child(price, 'BaseQuantity', XML_NS.cbc)) || '1';
    const baseQuantity = this.quantity(baseQuantityText, errors, `LINE_${lineNumber}_BASE_QUANTITY`, true);
    if (baseQuantity.lte(0)) {
      errors.push(this.issue('BASE_QUANTITY_MUST_BE_POSITIVE', `La cantidad base de la línea ${lineNumber} debe ser mayor que cero.`));
    }
    const allowanceCharges = this.children(line, 'AllowanceCharge', XML_NS.cac);
    const discount = allowanceCharges
      .filter((node) => this.text(this.child(node, 'ChargeIndicator', XML_NS.cbc)).toLowerCase() !== 'true')
      .reduce((sum, node, index) => sum.plus(this.money(this.text(this.child(node, 'Amount', XML_NS.cbc)), errors, `LINE_${lineNumber}_DISCOUNT_${index + 1}`, true)), new Prisma.Decimal(0));
    const charges = allowanceCharges
      .filter((node) => this.text(this.child(node, 'ChargeIndicator', XML_NS.cbc)).toLowerCase() === 'true')
      .reduce((sum, node, index) => sum.plus(this.money(this.text(this.child(node, 'Amount', XML_NS.cbc)), errors, `LINE_${lineNumber}_CHARGE_${index + 1}`, true)), new Prisma.Decimal(0));
    const taxes = [
      ...this.children(line, 'TaxTotal', XML_NS.cac).flatMap((total) => this.parseTaxTotal(total, lineNumber, errors)),
      ...this.children(line, 'WithholdingTaxTotal', XML_NS.cac).flatMap((total) => this.parseTaxTotal(total, lineNumber, errors, false)),
    ];
    if (!description) errors.push(this.issue('MISSING_LINE_DESCRIPTION', `Falta la descripción de la línea ${lineNumber}.`));
    if (quantity.lte(0)) errors.push(this.issue('INVALID_LINE_QUANTITY', `La cantidad de la línea ${lineNumber} debe ser positiva.`));
    if (baseQuantity.gt(0)) {
      const expectedNet = quantity.mul(priceAmount).div(baseQuantity)
        .minus(discount).plus(charges)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
      if (this.abs(expectedNet.minus(lineNet)).gt('0.01')) {
        errors.push(this.issue('LINE_AMOUNT_MISMATCH', `El neto de la línea ${lineNumber} no coincide con cantidad × precio/base menos descuentos más cargos (tolerancia COP 0,01).`));
      }
    }
    const taxable = taxes
      .filter((tax) => !['withholding', 'reteiva', 'reteica'].includes(tax.tax_type))
      .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    const id = this.child(itemNode, 'SellersItemIdentification', XML_NS.cac) ?? this.child(itemNode, 'StandardItemIdentification', XML_NS.cac);
    const code = this.text(this.child(id, 'ID', XML_NS.cbc));
    const quantityUnit = quantityNode?.getAttribute('unitCode') || undefined;
    return {
      line_number: lineNumber,
      external_code: code || undefined,
      description,
      quantity: quantity.toString(),
      unit_code: quantityUnit,
      unit_price: baseQuantity.lte(0)
        ? '0'
        : this.unitPriceValue(priceAmount.div(baseQuantity), errors, `LINE_${lineNumber}_NORMALIZED_PRICE`).toString(),
      discount_amount: this.moneyString(discount),
      net_amount: this.moneyString(lineNet),
      total_amount: this.moneyString(this.computedMoney(lineNet.plus(taxable), errors, `LINE_${lineNumber}_TOTAL`)),
      taxes,
    };
  }

  private parseTaxTotal(
    total: XmlElement,
    lineNumber: number | undefined,
    errors: Issue[],
    requireSubtotals = true,
  ): ReceivedDocumentTax[] {
    const subtotals = this.children(total, 'TaxSubtotal', XML_NS.cac);
    const amount = this.money(
      this.text(this.child(total, 'TaxAmount', XML_NS.cbc)),
      errors,
      lineNumber ? `LINE_${lineNumber}_TAX_TOTAL` : 'HEADER_TAX_TOTAL',
      true,
    );
    if (requireSubtotals && subtotals.length === 0) {
      errors.push(this.issue('TAX_TOTAL_WITHOUT_SUBTOTALS', 'Un cac:TaxTotal declara TaxAmount sin TaxSubtotal que lo respalde.'));
    }
    const parsed = subtotals.flatMap((subtotal) =>
      this.parseTaxSubtotals(subtotal, lineNumber, errors),
    );
    if (subtotals.length > 0) {
      const subtotalAmount = parsed.reduce(
        (sum, tax) => sum.plus(tax.amount),
        new Prisma.Decimal(0),
      );
      if (this.abs(amount.minus(subtotalAmount)).gt(MONEY_TOLERANCE)) {
        errors.push(this.issue('TAX_TOTAL_SUBTOTAL_MISMATCH', 'TaxTotal/TaxAmount no coincide con la suma de sus TaxSubtotal (tolerancia 0,01 en moneda del documento).'));
      }
    }
    return parsed;
  }

  private parseTaxSubtotals(
    subtotal: XmlElement,
    lineNumber: number | undefined,
    errors: Issue[],
  ): ReceivedDocumentTax[] {
    const scheme = this.child(this.child(subtotal, 'TaxCategory', XML_NS.cac), 'TaxScheme', XML_NS.cac)
      ?? this.child(subtotal, 'TaxScheme', XML_NS.cac);
    const code = this.text(this.child(scheme, 'ID', XML_NS.cbc));
    const name = this.text(this.child(scheme, 'Name', XML_NS.cbc));
    const taxType = this.taxType(code);
    if (taxType === 'unclassified') {
      errors.push(this.issue('UNCLASSIFIED_TAX_SCHEME', `El esquema tributario '${code || name || 'sin código'}' no está clasificado; requiere revisión fiscal.`));
    }
    const category = this.child(subtotal, 'TaxCategory', XML_NS.cac);
    const percent = this.text(this.child(category, 'Percent', XML_NS.cbc));
    const baseUnitElement = this.child(subtotal, 'BaseUnitMeasure', XML_NS.cbc);
    const perUnitElement = this.child(subtotal, 'PerUnitAmount', XML_NS.cbc);
    const isNominalIbua = code.trim() === '34' && !!baseUnitElement && !!perUnitElement;
    if (code.trim() === '34' && (!!baseUnitElement !== !!perUnitElement)) {
      errors.push(this.issue('INCOMPLETE_IBUA_UNIT_BASIS', 'El IBUA nominal debe declarar juntos BaseUnitMeasure y PerUnitAmount.'));
    }
    const rate = percent
      ? this.rate(percent, errors, `${lineNumber ? `LINE_${lineNumber}_` : ''}TAX_RATE_${code || 'UNKNOWN'}`)
      : new Prisma.Decimal(0);
    const amount = this.money(this.text(this.child(subtotal, 'TaxAmount', XML_NS.cbc)), errors, `${lineNumber ? `LINE_${lineNumber}_` : ''}TAX_AMOUNT_${code || 'UNKNOWN'}`, true);
    const taxableText = this.text(this.child(subtotal, 'TaxableAmount', XML_NS.cbc));
    if (!taxableText && !isNominalIbua) {
      errors.push(this.issue(`INVALID_SOURCE_${lineNumber ? `LINE_${lineNumber}_` : ''}TAX_BASE_${code || 'UNKNOWN'}`, 'TaxableAmount falta en un impuesto de base monetaria.'));
    }
    const base = taxableText
      ? this.money(taxableText, errors, `${lineNumber ? `LINE_${lineNumber}_` : ''}TAX_BASE_${code || 'UNKNOWN'}`, true)
      : new Prisma.Decimal(0);
    let baseQuantity: Prisma.Decimal | undefined;
    let perUnitAmount: Prisma.Decimal | undefined;
    let baseUnitCode: string | undefined;
    if (isNominalIbua) {
      baseQuantity = this.unitMeasure(this.text(baseUnitElement), errors, `${lineNumber ? `LINE_${lineNumber}_` : ''}IBUA_BASE_UNIT`);
      perUnitAmount = this.unitMeasure(this.text(perUnitElement), errors, `${lineNumber ? `LINE_${lineNumber}_` : ''}IBUA_PER_UNIT_AMOUNT`);
      baseUnitCode = baseUnitElement?.getAttribute('unitCode')?.trim() || undefined;
      if (!baseUnitCode) errors.push(this.issue('MISSING_IBUA_BASE_UNIT_CODE', 'El impuesto nominal IBUA requiere unitCode en BaseUnitMeasure.'));
      if (baseQuantity.lte(0)) errors.push(this.issue('INVALID_IBUA_BASE_UNIT', 'BaseUnitMeasure del impuesto IBUA debe ser mayor que cero.'));
      const expected = baseQuantity.mul(perUnitAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN)
        .div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
      if (this.abs(expected.minus(amount)).gt(MONEY_TOLERANCE)) {
        errors.push(this.issue('IBUA_NOMINAL_AMOUNT_MISMATCH', 'El valor nominal IBUA no coincide con PerUnitAmount × BaseUnitMeasure redondeado a dos decimales y dividido por cien.'));
      }
    }
    return [{
      tax_type: taxType,
      scheme_code: code,
      tax_name: name,
      rate: rate.toString(),
      base_amount: this.moneyString(base),
      amount: this.moneyString(amount),
      tax_basis_type: isNominalIbua ? 'unit' : 'monetary',
      ...(isNominalIbua ? {
        base_quantity: baseQuantity!.toFixed(Math.max(2, baseQuantity!.decimalPlaces())),
        base_unit_code: baseUnitCode,
        per_unit_amount: perUnitAmount!.toFixed(Math.max(2, perUnitAmount!.decimalPlaces())),
      } : {}),
      line_number: lineNumber,
    }];
  }

  private validateTaxArithmetic(
    input: {
      subtotal: Prisma.Decimal;
      lineNet: Prisma.Decimal;
      discount: Prisma.Decimal;
      charge: Prisma.Decimal;
      inclusive: Prisma.Decimal;
      total: Prisma.Decimal;
      payableRounding: Prisma.Decimal;
      headerTaxAmount: Prisma.Decimal;
      lineTax: Prisma.Decimal;
      errors: Issue[];
      hasInclusive: boolean;
      hasAnyTaxTotal: boolean;
    },
  ): void {
    const tolerance = MONEY_TOLERANCE;
    if (this.abs(input.subtotal.minus(input.lineNet)).gt(tolerance)) {
      input.errors.push(this.issue('LINE_SUBTOTAL_MISMATCH', 'La suma de LineExtensionAmount de las líneas no coincide con la cabecera (tolerancia de un céntimo).'));
    }
    if (input.hasAnyTaxTotal && this.abs(input.headerTaxAmount.minus(input.lineTax)).gt(tolerance)) {
      input.errors.push(this.issue('HEADER_LINE_TAX_MISMATCH', 'La suma de impuestos de cabecera no coincide con las líneas (tolerancia de un céntimo).'));
    }
    if (!input.hasInclusive) {
      input.errors.push(this.issue('MISSING_TAX_INCLUSIVE_AMOUNT', 'Falta TaxInclusiveAmount en el grupo monetario UBL.'));
      return;
    }
    // FAU06: document-level inclusive amount is line extension plus direct
    // TaxTotal amounts. Line discounts are already inside line extension;
    // only the separate document AllowanceTotalAmount affects PayableAmount.
    const inclusiveExpected = input.subtotal.plus(input.headerTaxAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    this.assertComputedMoney(inclusiveExpected, input.errors, 'TAX_INCLUSIVE_AMOUNT');
    if (this.abs(input.inclusive.minus(inclusiveExpected)).gt(tolerance)) {
      input.errors.push(this.issue('TAX_INCLUSIVE_AMOUNT_MISMATCH', 'TaxInclusiveAmount no coincide con LineExtensionAmount + impuestos de cabecera (tolerancia de un céntimo).'));
    }
    // FAU14 / DIAN §11.9.1-.2: withholdings and prepaid amounts remain
    // informational and do not net the declared fiscal payable total.
    const payableExpected = input.inclusive.minus(input.discount).plus(input.charge).plus(input.payableRounding)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    this.assertComputedMoney(payableExpected, input.errors, 'PAYABLE_AMOUNT');
    if (this.abs(input.total.minus(payableExpected)).gt(tolerance)) {
      input.errors.push(this.issue('PAYABLE_TOTAL_MISMATCH', 'PayableAmount no coincide con TaxInclusiveAmount - AllowanceTotalAmount + ChargeTotalAmount + PayableRoundingAmount cuando se declara (tolerancia de un céntimo); anticipos y retenciones no se restan.'));
    }
  }

  private party(accountingParty?: XmlElement): { taxId: string; name: string } {
    const party = accountingParty ? this.child(accountingParty, 'Party', XML_NS.cac) : undefined;
    const taxScheme = this.child(party, 'PartyTaxScheme', XML_NS.cac);
    const legal = this.child(party, 'PartyLegalEntity', XML_NS.cac);
    const partyName = this.child(party, 'PartyName', XML_NS.cac);
    return {
      taxId: this.text(this.child(taxScheme, 'CompanyID', XML_NS.cbc)) || this.text(this.child(legal, 'CompanyID', XML_NS.cbc)),
      name: this.text(this.child(legal, 'RegistrationName', XML_NS.cbc)) || this.text(this.child(partyName, 'Name', XML_NS.cbc)) || this.text(this.child(taxScheme, 'RegistrationName', XML_NS.cbc)),
    };
  }

  private reference(root: XmlElement, type: ReceivedDocumentType): { key?: string; number?: string } {
    if (type === 'invoice') return {};
    const reference = this.child(root, 'BillingReference', XML_NS.cac)
      ?? this.child(root, 'DiscrepancyResponse', XML_NS.cac);
    const invoice = reference ? this.child(reference, 'InvoiceDocumentReference', XML_NS.cac) : undefined;
    return {
      number: this.text(this.child(invoice, 'ID', XML_NS.cbc))
        || this.text(this.child(reference, 'ReferenceID', XML_NS.cbc))
        || undefined,
      key: this.text(this.child(invoice, 'UUID', XML_NS.cbc)) || undefined,
    };
  }

  private nonElectronic(warnings: Issue[], code: string, message: string): NormalizedReceivedDocument {
    return {
      document_type: 'non_electronic', invoice_number: '', issuer_tax_id: '', issuer_name: '',
      receiver_tax_id: '', receiver_name: '', issue_date: '', currency: '', subtotal_amount: '0.00',
      discount_amount: '0.00', tax_amount: '0.00', total_amount: '0.00', items: [], taxes: [],
      validation: { errors: [this.issue(code, message)], warnings, has_signature: false, document_key_format_valid: false },
    };
  }

  private documentType(root: XmlElement): ReceivedDocumentType | undefined {
    if (this.is(root, 'Invoice', XML_NS.invoice)) return 'invoice';
    if (this.is(root, 'CreditNote', XML_NS.creditNote)) return 'credit_note';
    if (this.is(root, 'DebitNote', XML_NS.debitNote)) return 'debit_note';
    return undefined;
  }

  private taxType(code: string): ReceivedDocumentTax['tax_type'] {
    // DIAN's current UBL code catalog: IBUA 34 and ICUI 35. Unknown scheme ids
    // must block review, never silently become IVA.
    switch (code.trim().toUpperCase()) {
      case '01': return 'iva';
      case '04': return 'inc';
      case '03': return 'ica';
      case '34': return 'ibua';
      case '35': return 'icui';
      case '05': return 'reteiva';
      case '06': return 'withholding';
      case '07': return 'reteica';
      default: return 'unclassified';
    }
  }

  private hasSignature(root: XmlElement): boolean {
    const stack: Node[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.nodeType === 1 && this.is(node as XmlElement, 'Signature', XML_NS.ds)) return true;
      for (let child = node.firstChild; child; child = child.nextSibling) stack.push(child);
    }
    return false;
  }

  private children(parent: XmlElement | undefined, localName: string, namespace: string): XmlElement[] {
    if (!parent) return [];
    const result: XmlElement[] = [];
    for (let node = parent.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1 && this.is(node as XmlElement, localName, namespace)) result.push(node as XmlElement);
    }
    return result;
  }

  private child(parent: XmlElement | undefined, localName: string, namespace: string): XmlElement | undefined {
    return this.children(parent, localName, namespace)[0];
  }

  private is(element: XmlElement, localName: string, namespace: string): boolean {
    return element.localName === localName && element.namespaceURI === namespace;
  }

  private text(element?: XmlElement): string {
    return element?.textContent?.trim() ?? '';
  }

  private date(value: string): string | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
  }

  private money(
    value: string | undefined,
    errors: Issue[],
    field: string,
    required = false,
  ): Prisma.Decimal {
    return this.checkedDecimal(value, errors, field, 13, 2, required);
  }

  private quantity(
    value: string | undefined,
    errors: Issue[],
    field: string,
    required = false,
  ): Prisma.Decimal {
    return this.checkedDecimal(value, errors, field, 11, 4, required);
  }

  private unitPrice(
    value: string | undefined,
    errors: Issue[],
    field: string,
    required = false,
  ): Prisma.Decimal {
    return this.checkedDecimal(value, errors, field, 9, 6, required);
  }

  private unitPriceValue(
    value: Prisma.Decimal,
    errors: Issue[],
    field: string,
  ): Prisma.Decimal {
    const normalized = value.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_EVEN);
    if (normalized.abs().gte('1000000000')) {
      errors.push(this.issue('DECIMAL_OVERFLOW_' + field, 'El precio unitario excede la capacidad Decimal(15,6).'));
      return new Prisma.Decimal(0);
    }
    return normalized;
  }

  private rate(value: string, errors: Issue[], field: string): Prisma.Decimal {
    return this.checkedDecimal(value, errors, field, 3, 5, true);
  }

  private unitMeasure(value: string, errors: Issue[], field: string): Prisma.Decimal {
    return this.checkedDecimal(value, errors, field, 13, 2, true);
  }

  private rounding(value: string | undefined, errors: Issue[]): Prisma.Decimal {
    if (!value?.trim()) return new Prisma.Decimal(0);
    const input = value.trim();
    if (!this.validDecimalText(input) || !this.fitsDecimal(input, 13, 2)) {
      errors.push(this.issue('DECIMAL_OVERFLOW_PAYABLE_ROUNDING', 'PayableRoundingAmount excede Decimal(15,2) o no es decimal válido.'));
      return new Prisma.Decimal(0);
    }
    return new Prisma.Decimal(input);
  }

  private checkedDecimal(
    value: string | undefined,
    errors: Issue[],
    field: string,
    integerDigits: number,
    scale: number,
    required: boolean,
  ): Prisma.Decimal {
    const input = value?.trim() ?? '';
    if (!input) {
      if (required) errors.push(this.issue(`INVALID_SOURCE_${field}`, `${field} falta en el documento.`));
      return new Prisma.Decimal(0);
    }
    if (!this.validDecimalText(input)) {
      errors.push(this.issue(`INVALID_SOURCE_${field}`, `${field} no es un decimal válido.`));
      return new Prisma.Decimal(0);
    }
    if (!this.fitsDecimal(input, integerDigits, scale)) {
      errors.push(this.issue(`DECIMAL_OVERFLOW_${field}`, `${field} excede la capacidad Decimal(15,${scale}) prevista.`));
      return new Prisma.Decimal(0);
    }
    const parsed = new Prisma.Decimal(input);
    if (parsed.isNegative()) {
      errors.push(this.issue(`NEGATIVE_SOURCE_${field}`, `${field} contiene un valor negativo; la polaridad debe derivarse del tipo documental, no de importes con signo.`));
      return new Prisma.Decimal(0);
    }
    return parsed;
  }

  private fitsDecimal(value: string, integerDigits: number, scale: number): boolean {
    const unsigned = value.replace(/^[+-]/, '');
    const [integer, fraction = ''] = unsigned.split('.');
    const significantInteger = integer.replace(/^0+/, '').length;
    return significantInteger <= integerDigits && fraction.length <= scale;
  }

  private validDecimalText(value: string | undefined): boolean {
    const input = value?.trim() ?? '';
    if (!input || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return false;
    const unsigned = input.replace(/^[+-]/, '');
    const [integer, fraction = ''] = unsigned.split('.');
    return integer.length <= 60 && fraction.length <= 12;
  }

  private moneyString(value: Prisma.Decimal): string {
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN).toFixed(2);
  }

  private computedMoney(
    value: Prisma.Decimal,
    errors: Issue[],
    field: string,
  ): Prisma.Decimal {
    this.assertComputedMoney(value, errors, field);
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
  }

  private assertComputedMoney(value: Prisma.Decimal, errors: Issue[], field: string): void {
    const normalized = value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    if (normalized.isNegative()) {
      errors.push(this.issue(`NEGATIVE_COMPUTED_${field}`, `${field} calculado es negativo.`));
    } else if (normalized.gte('10000000000000')) {
      errors.push(this.issue(`DECIMAL_OVERFLOW_COMPUTED_${field}`, `${field} calculado excede Decimal(15,2).`));
    }
  }

  private abs(value: Prisma.Decimal): Prisma.Decimal { return value.abs(); }

  private issue(code: string, message: string): Issue { return { code, message }; }
}
