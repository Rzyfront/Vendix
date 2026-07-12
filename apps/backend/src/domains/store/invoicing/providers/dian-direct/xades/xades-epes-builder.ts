import * as crypto from 'crypto';
import { C14nCanonicalization } from 'xml-crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

// node-forge is imported via require to stay consistent with the rest of the
// dian-direct provider (see dian-xml-signer.service.ts).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const forge = require('node-forge');

/**
 * Algorithm identifiers used by the DIAN XAdES-EPES profile.
 * DIAN validates the SignedInfo with inclusive C14N (REC-xml-c14n-20010315),
 * SHA-256 digests and RSA-SHA256 signatures.
 */
const ALGORITHMS = {
  /** Inclusive canonical XML 1.0 (NOT exclusive) — required by DIAN. */
  C14N: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  /** SHA-256 digest. */
  DIGEST_SHA256: 'http://www.w3.org/2001/04/xmlenc#sha256',
  /** RSA-SHA256 signature. */
  SIGNATURE_RSA_SHA256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  /** Enveloped-signature transform. */
  ENVELOPED: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  /** XAdES SignedProperties reference Type. */
  SIGNED_PROPERTIES_TYPE: 'http://uri.etsi.org/01903#SignedProperties',
} as const;

const NAMESPACES = {
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
  /** Common Extension Components — hosts the signature. */
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
} as const;

/**
 * DIAN signature policy v2 (Resolución 000012/2021, Anexo Técnico 1.8/1.9).
 *
 * - identifier: canonical URL of the signature policy document.
 * - description: policy description string DIAN expects.
 * - hashDigestValue: SHA-256 (base64) of the policy document. This is a fixed
 *   constant published/expected by DIAN and reused across the CO open-source
 *   ecosystem. Source references:
 *   https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf
 */
export const DIAN_SIGNATURE_POLICY = {
  identifier:
    'https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf',
  description:
    'Política de firma para facturas electrónicas de la República de Colombia.',
  hashDigestValue: 'dMoMvtcG5aIzgYo0tIsSQeVJBDnUnfSOfBpxXrmor0Y=',
} as const;

interface NamespacePrefix {
  prefix: string;
  namespaceURI: string;
}

/**
 * Builds and injects a DIAN-compliant XAdES-EPES enveloped signature into a UBL
 * 2.1 document.
 *
 * The signature is placed inside the second
 * `ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent` element (the first
 * one carries the `sts:DianExtensions` software-security block).
 *
 * The produced `ds:Signature` contains:
 *  - `ds:SignedInfo` with inclusive C14N + RSA-SHA256 and three references:
 *      1. the document (URI="", enveloped-signature transform),
 *      2. the `ds:KeyInfo` element,
 *      3. the `xades:SignedProperties` element (Type SignedProperties).
 *  - `ds:SignatureValue`.
 *  - `ds:KeyInfo` with the signing `ds:X509Certificate` (base64 DER).
 *  - `ds:Object/xades:QualifyingProperties/xades:SignedProperties` with
 *    SigningTime, SigningCertificate (cert digest + issuer/serial) and the
 *    SignaturePolicyIdentifier (DIAN policy v2).
 */
export class XadesEpesBuilder {
  private readonly parser = new DOMParser();
  private readonly serializer = new XMLSerializer();
  private readonly c14n = new C14nCanonicalization();

  /**
   * Signs the given unsigned UBL XML string and returns the signed XML.
   *
   * @param xml_content - Unsigned UBL XML (with an empty second ExtensionContent).
   * @param private_key_pem - Signer private key in PEM format.
   * @param certificate_pem - Signer certificate in PEM format.
   * @param signing_date - Instant used for `xades:SigningTime` (defaults to now).
   * @param signer_role - `xades:SignerRole` value. DIAN Anexo Técnico 10.12:
   *   `supplier` when the invoice is signed by the "Obligado a Facturar",
   *   `third party` when signed by an authorized technology provider.
   */
  sign(
    xml_content: string,
    private_key_pem: string,
    certificate_pem: string,
    signing_date: Date = new Date(),
    signer_role: string = 'supplier',
  ): string {
    const cert_info = this.buildCertificateInfo(certificate_pem);

    // Preserve the original XML declaration (C14N ignores it, but DIAN's ZIP
    // parser expects a well-formed prolog).
    const declaration_match = xml_content.match(/^\s*<\?xml[^>]*\?>/i);
    const xml_declaration = declaration_match
      ? declaration_match[0].trim()
      : '<?xml version="1.0" encoding="UTF-8"?>';

    const doc: any = this.parser.parseFromString(xml_content, 'text/xml');
    const root: any = doc.documentElement;

    // 1. Document digest (Reference #1). The enveloped-signature transform
    //    removes the ds:Signature from the node-set, so digesting the pristine
    //    document (before injecting the signature) yields the exact value the
    //    validator obtains after removing the signature.
    const document_digest = this.digestNode(root, []);

    // 2. Identifiers for cross-references inside the signature.
    const signature_uuid = crypto.randomUUID();
    const signature_id = `xmldsig-${signature_uuid}`;
    const signed_properties_id = `${signature_id}-signedprops`;
    const key_info_id = `${signature_id}-keyinfo`;
    const signature_value_id = `${signature_id}-sigvalue`;
    const reference_document_id = `${signature_id}-ref0`;

    const signing_time = this.formatColombianTime(signing_date);

    // 3. Build the signature skeleton (KeyInfo + Object/QualifyingProperties).
    //    SignedInfo and SignatureValue are added afterwards, once their digests
    //    can be computed against the DOM.
    const skeleton_xml =
      `<ds:Signature xmlns:ds="${NAMESPACES.ds}" Id="${signature_id}">` +
      `<ds:KeyInfo Id="${key_info_id}">` +
      `<ds:X509Data>` +
      `<ds:X509Certificate>${cert_info.certificateBase64}</ds:X509Certificate>` +
      `</ds:X509Data>` +
      `</ds:KeyInfo>` +
      `<ds:Object>` +
      `<xades:QualifyingProperties xmlns:xades="${NAMESPACES.xades}" Target="#${signature_id}">` +
      `<xades:SignedProperties Id="${signed_properties_id}">` +
      `<xades:SignedSignatureProperties>` +
      `<xades:SigningTime>${signing_time}</xades:SigningTime>` +
      `<xades:SigningCertificate>` +
      `<xades:Cert>` +
      `<xades:CertDigest>` +
      `<ds:DigestMethod Algorithm="${ALGORITHMS.DIGEST_SHA256}"></ds:DigestMethod>` +
      `<ds:DigestValue>${cert_info.certDigest}</ds:DigestValue>` +
      `</xades:CertDigest>` +
      `<xades:IssuerSerial>` +
      `<ds:X509IssuerName>${this.escapeXml(cert_info.issuerName)}</ds:X509IssuerName>` +
      `<ds:X509SerialNumber>${cert_info.serialNumber}</ds:X509SerialNumber>` +
      `</xades:IssuerSerial>` +
      `</xades:Cert>` +
      `</xades:SigningCertificate>` +
      `<xades:SignaturePolicyIdentifier>` +
      `<xades:SignaturePolicyId>` +
      `<xades:SigPolicyId>` +
      `<xades:Identifier>${DIAN_SIGNATURE_POLICY.identifier}</xades:Identifier>` +
      `<xades:Description>${this.escapeXml(DIAN_SIGNATURE_POLICY.description)}</xades:Description>` +
      `</xades:SigPolicyId>` +
      `<xades:SigPolicyHash>` +
      `<ds:DigestMethod Algorithm="${ALGORITHMS.DIGEST_SHA256}"></ds:DigestMethod>` +
      `<ds:DigestValue>${DIAN_SIGNATURE_POLICY.hashDigestValue}</ds:DigestValue>` +
      `</xades:SigPolicyHash>` +
      `</xades:SignaturePolicyId>` +
      `</xades:SignaturePolicyIdentifier>` +
      `<xades:SignerRole>${this.escapeXml(signer_role)}</xades:SignerRole>` +
      `</xades:SignedSignatureProperties>` +
      `</xades:SignedProperties>` +
      `</xades:QualifyingProperties>` +
      `</ds:Object>` +
      `</ds:Signature>`;

    const extension_content = this.findSignatureContainer(doc);
    if (!extension_content) {
      throw new Error(
        'Signature container not found: expected a second ext:ExtensionContent in ext:UBLExtensions',
      );
    }

    const skeleton_doc: any = this.parser.parseFromString(
      skeleton_xml,
      'text/xml',
    );
    const signature_node: any = doc.importNode(
      skeleton_doc.documentElement,
      true,
    );
    extension_content.appendChild(signature_node);

    // 4. Digest KeyInfo (Reference #2) and SignedProperties (Reference #3) as
    //    they sit inside the document (inclusive C14N pulls in ancestor
    //    namespaces exactly as the validator will).
    const key_info_node = this.getFirstElementByLocalName(
      signature_node,
      NAMESPACES.ds,
      'KeyInfo',
    );
    const signed_properties_node = this.getFirstElementByLocalName(
      signature_node,
      NAMESPACES.xades,
      'SignedProperties',
    );

    const key_info_digest = this.digestNode(
      key_info_node,
      this.collectAncestorNamespaces(key_info_node),
    );
    const signed_properties_digest = this.digestNode(
      signed_properties_node,
      this.collectAncestorNamespaces(signed_properties_node),
    );

    // 5. Build SignedInfo with the three references and inject it as the first
    //    child of ds:Signature.
    const signed_info_xml =
      `<ds:SignedInfo xmlns:ds="${NAMESPACES.ds}">` +
      `<ds:CanonicalizationMethod Algorithm="${ALGORITHMS.C14N}"></ds:CanonicalizationMethod>` +
      `<ds:SignatureMethod Algorithm="${ALGORITHMS.SIGNATURE_RSA_SHA256}"></ds:SignatureMethod>` +
      `<ds:Reference Id="${reference_document_id}" URI="">` +
      `<ds:Transforms>` +
      `<ds:Transform Algorithm="${ALGORITHMS.ENVELOPED}"></ds:Transform>` +
      `</ds:Transforms>` +
      `<ds:DigestMethod Algorithm="${ALGORITHMS.DIGEST_SHA256}"></ds:DigestMethod>` +
      `<ds:DigestValue>${document_digest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `<ds:Reference URI="#${key_info_id}">` +
      `<ds:DigestMethod Algorithm="${ALGORITHMS.DIGEST_SHA256}"></ds:DigestMethod>` +
      `<ds:DigestValue>${key_info_digest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `<ds:Reference Type="${ALGORITHMS.SIGNED_PROPERTIES_TYPE}" URI="#${signed_properties_id}">` +
      `<ds:DigestMethod Algorithm="${ALGORITHMS.DIGEST_SHA256}"></ds:DigestMethod>` +
      `<ds:DigestValue>${signed_properties_digest}</ds:DigestValue>` +
      `</ds:Reference>` +
      `</ds:SignedInfo>`;

    const signed_info_doc: any = this.parser.parseFromString(
      signed_info_xml,
      'text/xml',
    );
    const signed_info_node: any = doc.importNode(
      signed_info_doc.documentElement,
      true,
    );
    signature_node.insertBefore(signed_info_node, signature_node.firstChild);

    // 6. Canonicalize SignedInfo (in place) and RSA-SHA256 sign it.
    const canonical_signed_info = this.c14n
      .process(signed_info_node, {
        ancestorNamespaces: this.collectAncestorNamespaces(signed_info_node),
      } as any)
      .toString();

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(canonical_signed_info, 'utf8');
    const signature_value = signer.sign(private_key_pem, 'base64');

    // 7. Insert SignatureValue between SignedInfo and KeyInfo.
    const signature_value_xml =
      `<ds:SignatureValue xmlns:ds="${NAMESPACES.ds}" Id="${signature_value_id}">` +
      `${signature_value}` +
      `</ds:SignatureValue>`;
    const signature_value_doc: any = this.parser.parseFromString(
      signature_value_xml,
      'text/xml',
    );
    const signature_value_node: any = doc.importNode(
      signature_value_doc.documentElement,
      true,
    );
    signature_node.insertBefore(signature_value_node, key_info_node);

    const serialized = this.serializer.serializeToString(doc);
    return serialized.startsWith('<?xml')
      ? serialized
      : `${xml_declaration}\n${serialized}`;
  }

  /**
   * Extracts certificate material needed by XAdES SigningCertificate:
   * base64 DER cert, its SHA-256 digest, RFC2253 issuer name and decimal serial.
   */
  private buildCertificateInfo(certificate_pem: string): {
    certificateBase64: string;
    certDigest: string;
    issuerName: string;
    serialNumber: string;
  } {
    const cert = forge.pki.certificateFromPem(certificate_pem);
    const cert_der_bytes: string = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const cert_der_buffer = Buffer.from(cert_der_bytes, 'binary');

    return {
      certificateBase64: cert_der_buffer.toString('base64'),
      certDigest: crypto
        .createHash('sha256')
        .update(cert_der_buffer)
        .digest('base64'),
      issuerName: this.buildIssuerName(cert.issuer),
      serialNumber: this.hexSerialToDecimal(cert.serialNumber),
    };
  }

  /**
   * Builds an RFC2253 issuer distinguished name (most-specific RDN first),
   * mirroring Java's X500Principal.getName(), which is what the DIAN
   * (Java/Apache Santuario based) validator derives from the certificate.
   */
  private buildIssuerName(issuer: any): string {
    const attributes: any[] = issuer?.attributes ?? [];
    const rdns = attributes.map((attr) => {
      const key: string = attr.shortName || attr.type || 'UNKNOWN';
      return `${key}=${this.escapeRfc2253(String(attr.value ?? ''))}`;
    });
    // node-forge yields attributes in DER (encoding) order; RFC2253 reverses it.
    return rdns.reverse().join(',');
  }

  /** Converts a hexadecimal certificate serial number to its decimal form. */
  private hexSerialToDecimal(serial_hex: string): string {
    const normalized = (serial_hex || '').replace(/[^0-9a-fA-F]/g, '');
    if (!normalized) {
      return '0';
    }
    return BigInt(`0x${normalized}`).toString(10);
  }

  /**
   * Locates the signature container: the second ext:ExtensionContent inside
   * ext:UBLExtensions (the first hosts the DIAN software-security block).
   */
  private findSignatureContainer(doc: any): any | null {
    const contents = doc.getElementsByTagNameNS(
      NAMESPACES.ext,
      'ExtensionContent',
    );
    if (contents && contents.length >= 2) {
      return contents.item(1);
    }
    if (contents && contents.length === 1) {
      return contents.item(0);
    }
    return null;
  }

  /**
   * SHA-256 (base64) digest of a node's inclusive C14N form, importing the
   * given ancestor namespaces onto the canonicalized root.
   */
  private digestNode(node: any, ancestor_namespaces: NamespacePrefix[]): string {
    const canonical = this.c14n
      .process(node, { ancestorNamespaces: ancestor_namespaces } as any)
      .toString();
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('base64');
  }

  /**
   * Collects in-scope namespace declarations from a node's ancestors (nearest
   * declaration wins), excluding the node's own prefix. This reproduces the
   * inclusive-C14N ancestor import that xml-crypto's findAncestorNs performs.
   */
  private collectAncestorNamespaces(node: any): NamespacePrefix[] {
    const own_prefix: string = node.prefix || '';
    const seen = new Set<string>();
    const collected: NamespacePrefix[] = [];

    let current: any = node.parentNode;
    while (current && current.nodeType === 1) {
      const attributes = current.attributes;
      if (attributes) {
        for (let i = 0; i < attributes.length; i++) {
          const attr = attributes[i];
          const name: string = attr.nodeName;
          if (name === 'xmlns' || name.indexOf('xmlns:') === 0) {
            const prefix = name === 'xmlns' ? '' : name.substring(6);
            if (!seen.has(prefix)) {
              seen.add(prefix);
              collected.push({
                prefix,
                namespaceURI: attr.nodeValue || attr.value || '',
              });
            }
          }
        }
      }
      current = current.parentNode;
    }

    return collected.filter((ns) => ns.prefix !== own_prefix);
  }

  /** Returns the first descendant (or self) element matching ns + localName. */
  private getFirstElementByLocalName(
    root: any,
    namespace_uri: string,
    local_name: string,
  ): any {
    const matches = root.getElementsByTagNameNS(namespace_uri, local_name);
    const node = matches && matches.length > 0 ? matches.item(0) : null;
    if (!node) {
      throw new Error(
        `Signature build error: <${local_name}> element not found`,
      );
    }
    return node;
  }

  /** Formats a Date as ISO 8601 with a fixed Colombia (-05:00) offset. */
  private formatColombianTime(date: Date): string {
    const bogota = new Date(date.getTime() - 5 * 60 * 60 * 1000);
    const pad = (value: number): string => String(value).padStart(2, '0');
    return (
      `${bogota.getUTCFullYear()}-${pad(bogota.getUTCMonth() + 1)}-${pad(bogota.getUTCDate())}` +
      `T${pad(bogota.getUTCHours())}:${pad(bogota.getUTCMinutes())}:${pad(bogota.getUTCSeconds())}-05:00`
    );
  }

  /** Minimal XML text/attribute escaping for injected string values. */
  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Minimal RFC2253 value escaping for distinguished-name components. */
  private escapeRfc2253(value: string): string {
    return value.replace(/([,+"\\<>;])/g, '\\$1').replace(/^ | $/g, '\\ ');
  }
}
