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

  // Regla ZB01. El aserto sobre `textContent` que había aquí antes era ciego a
  // la estructura: es recursivo, así que devolvía 'supplier' tanto con el rol
  // como texto directo —que rompe el esquema— como anidado correctamente. Por
  // eso el defecto llegó a producción en verde. Estos asertos verifican el
  // anidamiento que el XSD de XAdES 1.3.2 exige (`SignerRole` es element-only).
  it('emits SignerRole as ClaimedRoles/ClaimedRole, never as raw text', () => {
    const signerRole = doc
      .getElementsByTagNameNS(XADES_NS, 'SignerRole')
      .item(0);

    const directText = Array.from(signerRole.childNodes as any[])
      .filter((n: any) => n.nodeType === 3)
      .map((n: any) => n.nodeValue)
      .join('')
      .trim();
    expect(directText).toBe('');

    const claimedRoles = signerRole.getElementsByTagNameNS(
      XADES_NS,
      'ClaimedRoles',
    );
    expect(claimedRoles.length).toBe(1);

    const claimedRole = claimedRoles
      .item(0)
      .getElementsByTagNameNS(XADES_NS, 'ClaimedRole');
    expect(claimedRole.length).toBe(1);
    expect(claimedRole.item(0).textContent).toBe('supplier');
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

  /**
   * Under HSM custody the `.p12` private key must never be read. Asserting on the
   * KMS key-id reaching the client is the only way to see that from outside: a
   * regression that silently fell back to the local key would still produce a
   * valid-looking signed document.
   */
  describe('KMS custody', () => {
    it('signs through KMS and never touches the local private key', async () => {
      const captured: Record<string, unknown>[] = [];
      class FakeSignCommand {
        constructor(public readonly input: Record<string, unknown>) {}
      }
      const DIGEST_INFO_SHA256 = Buffer.from(
        '3031300d060960864801650304020105000420',
        'hex',
      );

      // Inject the fake client through the private cache the lazy loader fills,
      // which is what lets this run with no AWS credentials and no network.
      (service as any).kms_client = {
        send: async (command: any) => {
          captured.push(command.input);
          return {
            Signature: new Uint8Array(
              crypto.privateEncrypt(
                {
                  key: crypto.createPrivateKey(material.privateKeyPem),
                  padding: crypto.constants.RSA_PKCS1_PADDING,
                },
                Buffer.concat([
                  DIGEST_INFO_SHA256,
                  command.input.Message as Buffer,
                ]),
              ),
            ),
          };
        },
      };
      (service as any).kms_sign_command = FakeSignCommand;

      const extractSpy = jest.spyOn(service as any, 'extractFromP12');

      const signed = await service.sign(
        UNSIGNED_INVOICE,
        material.p12Buffer,
        password,
        'arn:aws:kms:us-east-1:1:key/abc',
      );

      expect(signed).toContain('ds:SignatureValue');
      expect(signed).toContain('xades:SignedProperties');
      // The certificate is still published — it is public material.
      expect(signed).toContain('ds:X509Certificate');
      expect(captured[0]?.KeyId).toBe('arn:aws:kms:us-east-1:1:key/abc');
      // The .p12 private key was never extracted.
      expect(extractSpy).not.toHaveBeenCalled();
    });

    it('builds WS-Security credentials backed by a non-exportable signer', () => {
      (service as any).kms_client = { send: async () => ({}) };
      (service as any).kms_sign_command = class {
        constructor(public readonly input: Record<string, unknown>) {}
      };

      const creds = service.buildWsCredentials(
        material.p12Buffer,
        password,
        'arn:aws:kms:us-east-1:1:key/abc',
      );

      // The transport signature must move with the document signature, otherwise
      // the private key would still have to exist in this process.
      expect(creds.signer.is_exportable).toBe(false);
      expect(creds.certificate_der_base64).toEqual(expect.any(String));
      expect(creds.certificate_der_base64.length).toBeGreaterThan(100);
    });

    it('keeps the in-process custody when no KMS key is configured', () => {
      const creds = service.buildWsCredentials(
        material.p12Buffer,
        password,
      );
      expect(creds.signer.is_exportable).toBe(true);
    });
  });

  /**
   * QUI-674 — EL WORKER DIAN BLOQUEABA EL EVENT LOOP DE TODA LA API.
   *
   * `pkcs12FromAsn1` es descifrado PBE en JS puro y 100% SÍNCRONO: mientras corre,
   * el proceso entero está detenido. `sign()` abría el contenedor DOS veces por
   * documento (llave + certificado), así que un set de 50 documentos hacía 100
   * aperturas seguidas. En producción eso dio 504 de nginx en rutas triviales y
   * `could not renew lock for job` en BullMQ.
   *
   * Estos tests miden la causa directamente —cuántas veces se ABRE el
   * contenedor—, que es lo único que no puede degradarse en silencio: una firma
   * de más sigue produciendo un XML válido.
   */
  describe('caché del material PKCS#12', () => {
    let parseSpy: jest.SpyInstance;
    let freshService: DianXmlSignerService;

    beforeEach(() => {
      // Servicio nuevo por test: la caché vive en la instancia, así que compartir
      // la del `beforeAll` haría que el conteo dependiera del orden de los tests.
      freshService = new DianXmlSignerService();
      parseSpy = jest.spyOn(forge.pkcs12, 'pkcs12FromAsn1');
      parseSpy.mockClear();
    });

    afterEach(() => {
      parseSpy.mockRestore();
    });

    it('abre el contenedor UNA vez por firma, no dos', async () => {
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    });

    it('no vuelve a abrirlo en las firmas siguientes del mismo lote', async () => {
      // Tres documentos del mismo set: el coste de apertura se paga una vez.
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    });

    it('comparte la apertura con las credenciales WS-Security del mismo envío', async () => {
      // El envío SOAP firma el sobre con el MISMO certificado que el documento.
      // Si `buildWsCredentials` no compartiera la caché, cada corrida pagaría una
      // apertura extra.
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      const creds = freshService.buildWsCredentials(
        material.p12Buffer,
        password,
      );
      expect(creds.certificate_der_base64).toEqual(expect.any(String));
      expect(parseSpy).toHaveBeenCalledTimes(1);
    });

    it('la contraseña forma parte de la clave: una equivocada nunca acierta la entrada buena', async () => {
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      parseSpy.mockClear();

      // Si la clave de caché ignorara la contraseña, esto devolvería el material
      // ya abierto y la firma tendría éxito con una contraseña incorrecta.
      await expect(
        freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, 'otra'),
      ).rejects.toThrow(/Failed to sign XML document/);
      expect(parseSpy).toHaveBeenCalledTimes(1);
    });

    it('un fallo no se cachea: reintentar vuelve a abrir el contenedor', async () => {
      await expect(
        freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, 'otra'),
      ).rejects.toThrow(/Failed to sign XML document/);
      await expect(
        freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, 'otra'),
      ).rejects.toThrow(/Failed to sign XML document/);
      expect(parseSpy).toHaveBeenCalledTimes(2);
    });

    it('clearP12Cache() suelta el material y obliga a releer', async () => {
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      freshService.clearP12Cache();
      await freshService.sign(UNSIGNED_INVOICE, material.p12Buffer, password);
      expect(parseSpy).toHaveBeenCalledTimes(2);
    });

    /**
     * La caché NO puede debilitar la custodia HSM: bajo KMS el certificado es
     * material público y se cachea, pero la llave privada no se exporta a PEM ni
     * se retiene. Si después alguien SÍ necesita firmar en proceso, la entrada se
     * promueve releyendo el contenedor — nunca devolviendo una llave ausente.
     */
    it('bajo custodia KMS cachea el certificado sin materializar la llave', () => {
      const certOnly = freshService.buildWsCredentials(
        material.p12Buffer,
        password,
        'arn:aws:kms:us-east-1:1:key/abc',
      );
      expect(certOnly.signer.is_exportable).toBe(false);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      // Custodia local sobre el MISMO contenedor: la entrada cacheada no traía
      // llave, así que hay que releer en vez de fallar con "No private key".
      const local = freshService.extractCredentials(
        material.p12Buffer,
        password,
      );
      expect(local.private_key_pem).toContain('PRIVATE KEY');
      expect(parseSpy).toHaveBeenCalledTimes(2);

      // Y ya promovida, no se relee más.
      freshService.extractCredentials(material.p12Buffer, password);
      expect(parseSpy).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * `sign` is async since the signature can be produced by a remote HSM. A PEM
   * string is still accepted and wrapped in `LocalPemSigner`, which is what keeps
   * this call site — and every other existing caller — working unchanged.
   */
  it('exposes XadesEpesBuilder for direct use', async () => {
    const builder = new XadesEpesBuilder();
    const signed = await builder.sign(
      UNSIGNED_INVOICE,
      material.privateKeyPem,
      material.certificatePem,
      new Date('2026-07-11T15:30:00Z'),
    );
    expect(signed).toContain('xades:SignedProperties');
    expect(signed).toContain('ds:SignatureValue');
  });

  /**
   * La DIAN compara la FECHA de `xades:SigningTime` contra `cbc:IssueDate` y
   * rechaza el documento cuando difieren: «Valida que fecha de generación de la
   * factura sea igual a la fecha de firma». `UNSIGNED_INVOICE` declara
   * `2026-07-11`, así que ése es el día que la firma debe declarar sin importar
   * cuándo se ejecute la transmisión.
   */
  describe('xades:SigningTime — la fecha de firma sigue a la del documento', () => {
    const readSigningTime = (xml: string): string => {
      const parsed: any = new DOMParser().parseFromString(xml, 'text/xml');
      const node = parsed
        .getElementsByTagNameNS(XADES_NS, 'SigningTime')
        .item(0);
      return (node.textContent ?? '').trim();
    };

    const civilDateInBogota = (date: Date): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);

    it('estampa el instante recibido en vez del reloj de pared', async () => {
      // El documento se generó el 11-jul 23:28 Bogotá; la transmisión ocurre
      // ahora, otro día. Es la forma exacta de FVJL11/FVJL12 en producción.
      const signed = await service.sign(
        UNSIGNED_INVOICE,
        material.p12Buffer,
        password,
        null,
        new Date('2026-07-12T04:28:56.000Z'),
      );

      expect(readSigningTime(signed)).toBe('2026-07-11T23:28:56-05:00');
      // Y eso es lo que la regla compara: mismo día que `cbc:IssueDate`.
      expect(readSigningTime(signed).slice(0, 10)).toBe('2026-07-11');
    });

    it('sin instante explícito estampa el reloj de pared — el defecto que rechazó FVJL11', async () => {
      // `signedXml` del `beforeAll` se firmó sin el quinto argumento.
      expect(readSigningTime(signedXml).slice(0, 10)).toBe(
        civilDateInBogota(new Date()),
      );
      // El fixture declara `<cbc:IssueDate>2026-07-11</cbc:IssueDate>`: mientras
      // hoy no sea ese día, firma y documento hablan de fechas distintas.
      expect(readSigningTime(signedXml).slice(0, 10)).not.toBe('2026-07-11');
    });

    it('el instante del documento gana aunque el reloj de pared diga otro día', async () => {
      const con_documento = await service.sign(
        UNSIGNED_INVOICE,
        material.p12Buffer,
        password,
        null,
        new Date('2026-07-12T04:28:56.000Z'),
      );
      const con_reloj = await service.sign(
        UNSIGNED_INVOICE,
        material.p12Buffer,
        password,
      );

      expect(readSigningTime(con_documento)).not.toBe(
        readSigningTime(con_reloj),
      );
      expect(readSigningTime(con_documento).slice(0, 10)).toBe('2026-07-11');
    });
  });
});
