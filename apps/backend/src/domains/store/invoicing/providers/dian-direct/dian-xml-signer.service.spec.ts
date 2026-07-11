import { DianXmlSignerService } from './dian-xml-signer.service';
import {
  XadesEpesBuilder,
  DIAN_SIGNATURE_POLICY,
} from './xades/xades-epes-builder';
import { C14nCanonicalization } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';
import * as crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const forge = require('node-forge');

/**
 * Builds a self-signed test certificate + p12 container so the signer can be
 * exercised end-to-end without a real DIAN certificate.
 */
function buildTestP12(password: string): {
  p12Buffer: Buffer;
  privateKeyPem: string;
  certificatePem: string;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0A1B2C3D4E5F';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  const attrs = [
    { shortName: 'CN', value: 'AC SUB CERTICAMARA' },
    { shortName: 'O', value: 'CERTICAMARA S.A.' },
    { shortName: 'OU', value: 'NIT 830084433-7' },
    { shortName: 'C', value: 'CO' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    password,
    { algorithm: '3des' },
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  return {
    p12Buffer: Buffer.from(p12Der, 'binary'),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}

/**
 * Minimal unsigned UBL Invoice with the DIAN UBLExtensions layout: a first
 * ExtensionContent (software security) and an empty second one where the
 * signature must be injected.
 */
const UNSIGNED_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl/>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:ID>SETP990000001</cbc:ID>
  <cbc:IssueDate>2026-07-11</cbc:IssueDate>
</Invoice>`;

const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';

describe('DianXmlSignerService (XAdES-EPES)', () => {
  const password = 'test-password';
  let material: ReturnType<typeof buildTestP12>;
  let service: DianXmlSignerService;
  let signedXml: string;
  let doc: any;

  beforeAll(async () => {
    material = buildTestP12(password);
    service = new DianXmlSignerService();
    signedXml = await service.sign(
      UNSIGNED_INVOICE,
      material.p12Buffer,
      password,
    );
    doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  });

  const getSignature = () =>
    doc.getElementsByTagNameNS(DS_NS, 'Signature').item(0);

  it('produces a single ds:Signature inside the second ExtensionContent', () => {
    const signatures = doc.getElementsByTagNameNS(DS_NS, 'Signature');
    expect(signatures.length).toBe(1);

    const container = getSignature().parentNode;
    expect(container.localName).toBe('ExtensionContent');
  });

  it('emits SignedInfo with the DIAN canonicalization and signature algorithms', () => {
    const c14nMethod = doc
      .getElementsByTagNameNS(DS_NS, 'CanonicalizationMethod')
      .item(0);
    expect(c14nMethod.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    );

    const sigMethod = doc
      .getElementsByTagNameNS(DS_NS, 'SignatureMethod')
      .item(0);
    expect(sigMethod.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    );
  });

  it('emits exactly three References in the required order', () => {
    const signedInfo = doc.getElementsByTagNameNS(DS_NS, 'SignedInfo').item(0);
    const references = signedInfo.getElementsByTagNameNS(DS_NS, 'Reference');
    expect(references.length).toBe(3);

    // Ref #1: whole document, enveloped transform, empty URI.
    const ref0 = references.item(0);
    expect(ref0.getAttribute('URI')).toBe('');
    const transform = ref0.getElementsByTagNameNS(DS_NS, 'Transform').item(0);
    expect(transform.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
    );

    // Ref #2: KeyInfo.
    const ref1 = references.item(1);
    expect(ref1.getAttribute('URI')).toMatch(/#xmldsig-.*-keyinfo$/);

    // Ref #3: SignedProperties with Type.
    const ref2 = references.item(2);
    expect(ref2.getAttribute('Type')).toBe(
      'http://uri.etsi.org/01903#SignedProperties',
    );
    expect(ref2.getAttribute('URI')).toMatch(/#xmldsig-.*-signedprops$/);

    // All digests use SHA-256.
    const digestMethods = signedInfo.getElementsByTagNameNS(
      DS_NS,
      'DigestMethod',
    );
    for (let i = 0; i < digestMethods.length; i++) {
      expect(digestMethods.item(i).getAttribute('Algorithm')).toBe(
        'http://www.w3.org/2001/04/xmlenc#sha256',
      );
    }
  });

  it('includes KeyInfo with an X509Certificate referenced by Reference #2', () => {
    const keyInfo = doc.getElementsByTagNameNS(DS_NS, 'KeyInfo').item(0);
    const keyInfoId = keyInfo.getAttribute('Id');
    expect(keyInfoId).toMatch(/^xmldsig-.*-keyinfo$/);

    const x509 = doc.getElementsByTagNameNS(DS_NS, 'X509Certificate').item(0);
    expect((x509.textContent || '').length).toBeGreaterThan(100);

    const refUri = doc
      .getElementsByTagNameNS(DS_NS, 'SignedInfo')
      .item(0)
      .getElementsByTagNameNS(DS_NS, 'Reference')
      .item(1)
      .getAttribute('URI');
    expect(refUri).toBe(`#${keyInfoId}`);
  });

  it('includes the XAdES QualifyingProperties/SignedProperties block', () => {
    const qualifying = doc
      .getElementsByTagNameNS(XADES_NS, 'QualifyingProperties')
      .item(0);
    const signature = getSignature();
    expect(qualifying.getAttribute('Target')).toBe(
      `#${signature.getAttribute('Id')}`,
    );

    const signedProps = doc
      .getElementsByTagNameNS(XADES_NS, 'SignedProperties')
      .item(0);
    const signedPropsId = signedProps.getAttribute('Id');
    expect(signedPropsId).toMatch(/^xmldsig-.*-signedprops$/);

    const ref2Uri = doc
      .getElementsByTagNameNS(DS_NS, 'SignedInfo')
      .item(0)
      .getElementsByTagNameNS(DS_NS, 'Reference')
      .item(2)
      .getAttribute('URI');
    expect(ref2Uri).toBe(`#${signedPropsId}`);
  });

  it('includes SigningTime with a -05:00 Colombian offset', () => {
    const signingTime = doc
      .getElementsByTagNameNS(XADES_NS, 'SigningTime')
      .item(0);
    expect(signingTime.textContent).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/,
    );
  });

  it('includes SigningCertificate with cert digest and issuer/serial', () => {
    const signingCert = doc
      .getElementsByTagNameNS(XADES_NS, 'SigningCertificate')
      .item(0);
    expect(signingCert).toBeTruthy();

    const certDigest = doc
      .getElementsByTagNameNS(XADES_NS, 'CertDigest')
      .item(0);
    const digestValue = certDigest
      .getElementsByTagNameNS(DS_NS, 'DigestValue')
      .item(0);
    // CertDigest must equal SHA-256(base64) of the certificate DER.
    const cert = forge.pki.certificateFromPem(material.certificatePem);
    const der = forge.asn1
      .toDer(forge.pki.certificateToAsn1(cert))
      .getBytes();
    const expectedDigest = crypto
      .createHash('sha256')
      .update(Buffer.from(der, 'binary'))
      .digest('base64');
    expect(digestValue.textContent).toBe(expectedDigest);

    const issuerName = doc
      .getElementsByTagNameNS(DS_NS, 'X509IssuerName')
      .item(0);
    expect(issuerName.textContent).toContain('CN=AC SUB CERTICAMARA');

    const serial = doc
      .getElementsByTagNameNS(DS_NS, 'X509SerialNumber')
      .item(0);
    // Hex serial 0A1B2C3D4E5F -> decimal.
    expect(serial.textContent).toBe(BigInt('0x0A1B2C3D4E5F').toString(10));
  });

  it('includes the DIAN v2 SignaturePolicyIdentifier', () => {
    const identifier = doc
      .getElementsByTagNameNS(XADES_NS, 'Identifier')
      .item(0);
    expect(identifier.textContent).toBe(DIAN_SIGNATURE_POLICY.identifier);

    const description = doc
      .getElementsByTagNameNS(XADES_NS, 'Description')
      .item(0);
    expect(description.textContent).toBe(DIAN_SIGNATURE_POLICY.description);

    const sigPolicyHash = doc
      .getElementsByTagNameNS(XADES_NS, 'SigPolicyHash')
      .item(0);
    const hashValue = sigPolicyHash
      .getElementsByTagNameNS(DS_NS, 'DigestValue')
      .item(0);
    expect(hashValue.textContent).toBe(DIAN_SIGNATURE_POLICY.hashDigestValue);
  });

  it('includes SignerRole = supplier', () => {
    const signerRole = doc
      .getElementsByTagNameNS(XADES_NS, 'SignerRole')
      .item(0);
    expect(signerRole.textContent).toBe('supplier');
  });

  it('produces a SignatureValue that verifies against the SignedInfo digest', () => {
    // Re-canonicalize SignedInfo exactly as the builder does and confirm the
    // RSA-SHA256 signature verifies with the signer public key.
    const signedInfo = doc.getElementsByTagNameNS(DS_NS, 'SignedInfo').item(0);
    const c14n = new C14nCanonicalization();

    const ownPrefix = signedInfo.prefix || '';
    const seen = new Set<string>();
    const ancestors: { prefix: string; namespaceURI: string }[] = [];
    let current: any = signedInfo.parentNode;
    while (current && current.nodeType === 1) {
      const attrs = current.attributes;
      for (let i = 0; attrs && i < attrs.length; i++) {
        const name: string = attrs[i].nodeName;
        if (name === 'xmlns' || name.indexOf('xmlns:') === 0) {
          const prefix = name === 'xmlns' ? '' : name.substring(6);
          if (!seen.has(prefix)) {
            seen.add(prefix);
            ancestors.push({ prefix, namespaceURI: attrs[i].nodeValue || '' });
          }
        }
      }
      current = current.parentNode;
    }
    const canonicalSignedInfo = c14n
      .process(signedInfo, {
        ancestorNamespaces: ancestors.filter((n) => n.prefix !== ownPrefix),
      } as any)
      .toString();

    const signatureValue = doc
      .getElementsByTagNameNS(DS_NS, 'SignatureValue')
      .item(0)
      .textContent.replace(/\s+/g, '');

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalSignedInfo, 'utf8');
    const ok = verifier.verify(
      material.certificatePem,
      Buffer.from(signatureValue, 'base64'),
    );
    expect(ok).toBe(true);
  });

  it('keeps the public sign() contract (Promise<string>)', async () => {
    const result = service.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual(expect.any(String));
  });

  it('rejects an invalid certificate password', async () => {
    await expect(
      service.sign(UNSIGNED_INVOICE, material.p12Buffer, 'wrong-password'),
    ).rejects.toThrow(/Failed to sign XML document/);
  });

  it('exposes XadesEpesBuilder for direct use', () => {
    const builder = new XadesEpesBuilder();
    const signed = builder.sign(
      UNSIGNED_INVOICE,
      material.privateKeyPem,
      material.certificatePem,
      new Date('2026-07-11T15:30:00Z'),
    );
    expect(signed).toContain('xades:SignedProperties');
    expect(signed).toContain('ds:SignatureValue');
  });
});
