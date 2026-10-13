import { DOMParser } from '@xmldom/xmldom';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import type { NoteSourceInvoiceSnapshot } from './note-source-resolver.util';
import { isDianUnitCode } from '../providers/dian-direct/constants/dian-unit-codes';
import { UBL_NAMESPACES } from '../providers/dian-direct/xml/xml-namespaces';

const MAX_ACCEPTED_XML_BYTES = 5 * 1024 * 1024;
const XML_DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

type Fingerprint = {
  key: string;
  description: string;
};

type XmlInvoiceLine = {
  fingerprint: Fingerprint;
  unitCode: string | null;
};

/**
 * Resolves legacy missing/invalid source units from the exact accepted UBL
 * invoice snapshot. Line numbers, order, SKU, and price are deliberately not
 * lineage signals: only the full description/quantity/net-base fingerprint is.
 */
export function resolveEmittedNoteUnitCodes(
  source: NoteSourceInvoiceSnapshot,
  acceptedXml: string,
): ReadonlyMap<number, string> {
  const document = parseAcceptedInvoice(acceptedXml);
  const sourceFingerprints = new Map<string, number[]>();
  const sourceFingerprintById = new Map<number, Fingerprint>();

  for (const item of source.invoice_items) {
    const fingerprint = sourceFingerprint(item);
    if (!fingerprint || !Number.isInteger(item.id) || item.id <= 0) continue;
    const matches = sourceFingerprints.get(fingerprint.key) ?? [];
    matches.push(item.id);
    sourceFingerprints.set(fingerprint.key, matches);
    sourceFingerprintById.set(item.id, fingerprint);
  }

  const xmlLines = directChildren(document.documentElement, UBL_NAMESPACES.CAC, 'InvoiceLine')
    .map(parseXmlInvoiceLine)
    .filter((line): line is XmlInvoiceLine => line !== null);
  const xmlByFingerprint = new Map<string, XmlInvoiceLine[]>();
  for (const line of xmlLines) {
    const matches = xmlByFingerprint.get(line.fingerprint.key) ?? [];
    matches.push(line);
    xmlByFingerprint.set(line.fingerprint.key, matches);
  }

  const emitted = new Map<number, string>();
  for (const item of source.invoice_items) {
    const stored = item.unit_code?.trim();
    if (stored && isDianUnitCode(stored)) continue;

    const fingerprint = sourceFingerprintById.get(item.id);
    if (!fingerprint) continue;
    const sourceMatches = sourceFingerprints.get(fingerprint.key);
    const xmlMatches = xmlByFingerprint.get(fingerprint.key);
    if (sourceMatches?.length !== 1 || xmlMatches?.length !== 1) continue;

    const unitCode = xmlMatches[0].unitCode;
    // Keep the evidence's raw lexical value. Do not trim or normalize it.
    if (unitCode && isDianUnitCode(unitCode)) emitted.set(item.id, unitCode);
  }

  return emitted;
}

function parseAcceptedInvoice(xml: string): Document {
  if (
    typeof xml !== 'string' ||
    Buffer.byteLength(xml, 'utf8') > MAX_ACCEPTED_XML_BYTES ||
    /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)
  ) {
    throw sourceError('accepted_xml_unsafe_or_too_large');
  }

  const parseErrors: string[] = [];
  let document: Document | undefined;
  try {
    document = new DOMParser({
      errorHandler: (level: string) => {
        parseErrors.push(level);
      },
    }).parseFromString(xml, 'text/xml');
  } catch {
    throw sourceError('accepted_xml_malformed');
  }

  const root = document?.documentElement;
  if (parseErrors.length > 0 || !root) {
    throw sourceError('accepted_xml_malformed');
  }
  if (root.localName !== 'Invoice' || root.namespaceURI !== UBL_NAMESPACES.INVOICE) {
    throw sourceError('accepted_xml_root_invalid');
  }
  return document;
}

function sourceFingerprint(item: NoteSourceInvoiceSnapshot['invoice_items'][number]): Fingerprint | null {
  if (typeof item.description !== 'string') return null;
  const description = item.description.trim();
  const quantity = decimal(item.quantity);
  const total = decimal(item.total_amount);
  const tax = decimal(item.tax_amount);
  if (!description || !quantity || !total || !tax) return null;

  const base = total.minus(tax);
  if (!base.isFinite() || base.isNegative()) return null;
  return {
    description,
    key: JSON.stringify([description, quantity.toString(), base.toString()]),
  };
}

function parseXmlInvoiceLine(line: Element): XmlInvoiceLine | null {
  const quantity = singleDirectChild(line, UBL_NAMESPACES.CBC, 'InvoicedQuantity');
  const amount = singleDirectChild(line, UBL_NAMESPACES.CBC, 'LineExtensionAmount');
  const item = singleDirectChild(line, UBL_NAMESPACES.CAC, 'Item');
  if (!quantity || !amount || !item) return null;

  const descriptionElement = singleDirectChild(item, UBL_NAMESPACES.CBC, 'Description');
  const description = descriptionElement?.textContent?.trim();
  const quantityValue = xmlDecimal(quantity.textContent);
  const amountValue = xmlDecimal(amount.textContent);
  if (!description || !quantityValue || !amountValue || amountValue.isNegative()) return null;

  return {
    fingerprint: {
      description,
      key: JSON.stringify([description, quantityValue.toString(), amountValue.toString()]),
    },
    unitCode: quantity.getAttribute('unitCode'),
  };
}

function directChildren(parent: Element, namespace: string, localName: string): Element[] {
  const result: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType !== 1) continue;
    const element = child as Element;
    if (element.namespaceURI === namespace && element.localName === localName) {
      result.push(element);
    }
  }
  return result;
}

function singleDirectChild(parent: Element, namespace: string, localName: string): Element | null {
  const children = directChildren(parent, namespace, localName);
  return children.length === 1 ? children[0] : null;
}

function xmlDecimal(raw: string | null): Prisma.Decimal | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!XML_DECIMAL.test(value)) return null;
  return decimal(value);
}

function decimal(value: Prisma.Decimal.Value): Prisma.Decimal | null {
  try {
    const parsed = new Prisma.Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function sourceError(reason: string): VendixHttpException {
  return new VendixHttpException(ErrorCodes.INVOICING_NOTE_SOURCE_001, undefined, { reason });
}
