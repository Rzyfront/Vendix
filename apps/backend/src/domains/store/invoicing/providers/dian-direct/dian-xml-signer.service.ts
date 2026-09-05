import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { XadesEpesBuilder } from './xades/xades-epes-builder';
import {
  KmsAsymmetricSigner,
  KmsSignPort,
  LocalPemSigner,
  XadesSigner,
} from './xades/xades-signer';

/**
 * Todo lo que se puede sacar de un contenedor PKCS#12 con UNA sola apertura.
 *
 * `private_key_pem` es `null` a propósito cuando el llamador no necesita firmar
 * en proceso: bajo custodia KMS la llave privada NO debe materializarse aquí.
 * `has_private_key` dice si el contenedor la trae, sin exportarla.
 */
interface P12Material {
  certificate_pem: string;
  certificate_der_base64: string;
  subject_cn?: string;
  issuer_cn?: string;
  not_after: Date;
  has_private_key: boolean;
  private_key_pem: string | null;
}

interface P12CacheEntry {
  material: P12Material;
  /** Instante absoluto de caducidad. NO se refresca al acertar (ver `readP12`). */
  expires_at: number;
}

/**
 * XML Digital Signature service for DIAN electronic invoicing.
 * Signs UBL XML documents using a PKCS#12 (.p12) certificate.
 *
 * Produces an XAdES-EPES (Electronic Signature with Explicit Policy) signature
 * as required by DIAN resolution 000012/2021 and the Anexo Técnico (v1.8/1.9):
 * an enveloped `ds:Signature` inside the second
 * `ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent`, with a
 * `xades:QualifyingProperties/xades:SignedProperties` block carrying SigningTime,
 * SigningCertificate and the DIAN SignaturePolicyIdentifier.
 *
 * @see XadesEpesBuilder for the signature construction details.
 */
@Injectable()
export class DianXmlSignerService {
  private readonly logger = new Logger(DianXmlSignerService.name);
  private readonly xades_builder = new XadesEpesBuilder();

  /**
   * Lazily-built KMS client. Built on first HSM signature so a deployment that
   * never configures KMS pays nothing (no client, no credential resolution).
   */
  private kms_client?: KmsSignPort;
  private kms_sign_command?: new (input: Record<string, unknown>) => any;

  /**
   * ## Caché del material PKCS#12 — por qué existe (QUI-674)
   *
   * `pkcs12FromAsn1` es descifrado PBE en JS puro (miles de iteraciones de
   * SHA-1/3DES) y es 100% SÍNCRONO: mientras corre, el event loop de TODO el
   * proceso está detenido. Firmar el set de pruebas DIAN (50 documentos) abría
   * el contenedor DOS veces por documento —una para la llave, otra para el
   * certificado—: 100 aperturas síncronas en una sola corrida. Eso bloqueaba la
   * API entera (504 de nginx en rutas triviales) y vencía el lock de BullMQ.
   *
   * Con la caché el contenedor se abre UNA vez por corrida.
   *
   * ## Cota — es material criptográfico, no un memo cualquiera
   *
   * - **Tamaño acotado** (`P12_CACHE_MAX_ENTRIES`): LRU por orden de inserción.
   *   Un mapa sin cota sería una fuga de llaves privadas proporcional al número
   *   de entidades fiscales que hayan firmado alguna vez en la vida del proceso.
   * - **Vida acotada** (`P12_CACHE_TTL_MS`, absoluto): la caducidad se fija al
   *   parsear y NO se refresca al acertar, así que ninguna entrada sobrevive más
   *   de la ventana aunque se use en bucle.
   * - **Clave irreversible**: SHA-256 del buffer + la contraseña. La contraseña
   *   entra en la clave por CORRECCIÓN (una contraseña distinta no puede acertar
   *   una entrada abierta con otra) y el hash impide recuperarla desde la clave.
   * - **Nunca se registra**: ni la clave, ni el material, ni un prefijo de
   *   ninguno de los dos aparece en un log.
   * - **Instancia, no global**: vive en el provider (singleton de Nest), así que
   *   un test que construye su propio servicio arranca con la caché vacía.
   * - **Los fallos no se cachean**: una contraseña inválida vuelve a fallar
   *   parseando, nunca desde memoria.
   */
  private static readonly P12_CACHE_MAX_ENTRIES = 4;
  private static readonly P12_CACHE_TTL_MS = 10 * 60 * 1000;
  private readonly p12_cache = new Map<string, P12CacheEntry>();

  /**
   * Signs an XML document.
   *
   * @param xml_content - The unsigned UBL XML string
   * @param p12_buffer - The .p12 certificate file buffer. Always required: the
   *   **certificate** is public material and lives here even when the private key
   *   does not (`kms_key_id` set), because XAdES must publish it in
   *   `KeyInfo`/`SigningCertificate`.
   * @param p12_password - The certificate password. May be empty when signing via
   *   KMS with a `.p12`/`.cer` that carries no private key.
   * @param kms_key_id - When present, the RSA signature is produced **inside AWS
   *   KMS** by a key whose private half never leaves the HSM. The `.p12` private
   *   key, if any, is then never touched.
   * @param signing_date - Instante que se estampa en `xades:SigningTime`. Lo
   *   resuelve quien llama a partir de la `IssueDate`/`IssueTime` del propio
   *   documento, porque la DIAN exige que la fecha de firma coincida con la de
   *   generación y rechaza el documento cuando difieren
   *   («Valida que fecha de generación de la factura sea igual a la fecha de
   *   firma»). Omitirlo deja el reloj de pared, que es correcto sólo mientras
   *   la emisión ocurra el mismo día que la fecha del documento.
   * @returns The signed XML string (XAdES-EPES)
   */
  async sign(
    xml_content: string,
    p12_buffer: Buffer,
    p12_password: string,
    kms_key_id?: string | null,
    signing_date?: Date,
  ): Promise<string> {
    try {
      // Una sola lectura del contenedor por custodia local. Antes había DOS
      // llamadas a `extractFromP12` —llave y certificado— y cada una abría el
      // PKCS#12 de cero; en un set de 50 documentos eso eran 100 descifrados PBE
      // síncronos que congelaban el proceso entero (QUI-674). Hoy además la
      // apertura la sirve la caché de `readP12`.
      const local_material = kms_key_id
        ? null
        : this.extractFromP12(p12_buffer, p12_password);

      const signer = kms_key_id
        ? this.buildKmsSigner(kms_key_id)
        : new LocalPemSigner(local_material!.private_key);

      // The certificate is read the same way in both custodies. When the key lives
      // in KMS the container may legitimately hold no private key, so it is read
      // with a certificate-only extraction that does not demand a key bag.
      const certificate = kms_key_id
        ? this.extractCertificateOnly(p12_buffer, p12_password)
        : local_material!.certificate;

      const signed_xml = await this.xades_builder.sign(
        xml_content,
        signer,
        certificate,
        signing_date ?? new Date(),
      );

      this.logger.debug(
        `XML document signed successfully (XAdES-EPES, ${
          kms_key_id ? 'KMS non-exportable key' : 'in-process PEM key'
        })`,
      );
      return signed_xml;
    } catch (error) {
      this.logger.error(`XML signing failed: ${error.message}`);
      throw new Error(`Failed to sign XML document: ${error.message}`);
    }
  }

  /**
   * Builds the KMS-backed signer, resolving the SDK lazily.
   *
   * `require` rather than a top-level import for the same reason `node-forge` is
   * required here: the module is only needed on the code path that uses it, and a
   * deployment signing with a local `.p12` should not fail to boot over an SDK it
   * never calls.
   */
  private buildKmsSigner(kms_key_id: string): XadesSigner {
    if (!this.kms_client || !this.kms_sign_command) {
      let sdk: any;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sdk = require('@aws-sdk/client-kms');
      } catch {
        throw new Error(
          'Signing with a KMS key requires @aws-sdk/client-kms to be installed.',
        );
      }
      this.kms_client = new sdk.KMSClient({
        region: process.env.AWS_REGION || 'us-east-1',
      });
      this.kms_sign_command = sdk.SignCommand;
    }

    const client = this.kms_client;
    const command = this.kms_sign_command;
    if (!client || !command) {
      throw new Error('Failed to initialize the AWS KMS signing client.');
    }

    return new KmsAsymmetricSigner(client, kms_key_id, command);
  }

  /**
   * Reads only the certificate out of the container.
   *
   * Separate from `extractFromP12` because that one fails when no private key bag
   * exists — which is precisely the shape of a container built for HSM custody,
   * where the private key is deliberately absent.
   */
  private extractCertificateOnly(p12_buffer: Buffer, password: string): string {
    return this.readP12(p12_buffer, password, false).certificate_pem;
  }

  /**
   * Extracts private key and certificate from a PKCS#12 file.
   *
   * Sigue existiendo como método propio (y no como un `readP12` inline) porque
   * es la superficie observable de la custodia: el spec de KMS espía ESTE nombre
   * para probar que la llave del `.p12` nunca se toca cuando la firma vive en el
   * HSM. Renombrarlo o disolverlo dejaría esa garantía sin testigo.
   */
  private extractFromP12(
    p12_buffer: Buffer,
    password: string,
  ): { private_key: string; certificate: string } {
    const material = this.readP12(p12_buffer, password, true);
    if (!material.private_key_pem) {
      throw new Error('No private key found in .p12 file');
    }
    return {
      private_key: material.private_key_pem,
      certificate: material.certificate_pem,
    };
  }

  /**
   * Purga el material criptográfico retenido en memoria.
   *
   * Existe para que un operador (o un test) pueda forzar la relectura del
   * contenedor tras rotar un certificado sin esperar al TTL, y para no dejar la
   * única vía de vaciado a merced del recolector de basura.
   */
  clearP12Cache(): void {
    this.p12_cache.clear();
  }

  /**
   * Lee el contenedor PKCS#12 UNA vez y sirve el resto desde la caché.
   *
   * @param want_private_key cuando es `false` la llave privada NO se exporta a
   *   PEM ni se guarda: es lo que mantiene intacta la custodia HSM, donde el
   *   único material legítimo en este proceso es el certificado (público).
   *   Si una entrada cacheada se abrió sin llave y luego alguien sí la necesita,
   *   se vuelve a parsear y la entrada se promueve.
   */
  private readP12(
    p12_buffer: Buffer,
    password: string,
    want_private_key: boolean,
  ): P12Material {
    const cache_key = this.p12CacheKey(p12_buffer, password);
    this.purgeExpiredP12Entries();

    const hit = this.p12_cache.get(cache_key);
    if (hit && (!want_private_key || hit.material.private_key_pem)) {
      // Refresca la POSICIÓN LRU, nunca la caducidad: la vida de una llave en
      // memoria queda acotada por su instante de parseo, no por su uso.
      this.p12_cache.delete(cache_key);
      this.p12_cache.set(cache_key, hit);
      return hit.material;
    }

    // Si el parseo falla no se cachea nada: una contraseña inválida vuelve a
    // fallar abriendo el contenedor, nunca desde memoria.
    const material = this.parseP12(p12_buffer, password, want_private_key);

    this.p12_cache.delete(cache_key);
    this.p12_cache.set(cache_key, {
      material,
      expires_at: Date.now() + DianXmlSignerService.P12_CACHE_TTL_MS,
    });

    while (this.p12_cache.size > DianXmlSignerService.P12_CACHE_MAX_ENTRIES) {
      const oldest = this.p12_cache.keys().next().value;
      if (oldest === undefined) break;
      this.p12_cache.delete(oldest);
    }

    return material;
  }

  /**
   * SHA-256 del contenedor + la contraseña.
   *
   * La contraseña entra por CORRECCIÓN: sin ella, un contenedor abierto con la
   * contraseña buena serviría respuestas a una llamada con la contraseña mala.
   * El hash es de una vía, así que la clave no revela ni el `.p12` ni la
   * contraseña — y aun así nunca se registra en ningún log.
   */
  private p12CacheKey(p12_buffer: Buffer, password: string): string {
    return createHash('sha256')
      .update(p12_buffer)
      .update(Buffer.from([0]))
      .update(password, 'utf8')
      .digest('hex');
  }

  private purgeExpiredP12Entries(): void {
    const now = Date.now();
    for (const [key, entry] of this.p12_cache) {
      if (entry.expires_at <= now) {
        this.p12_cache.delete(key);
      }
    }
  }

  /**
   * La ÚNICA apertura real del contenedor. Todo lo demás lee de aquí.
   *
   * `pkcs12FromAsn1` es la operación cara y síncrona; el resto (PEM, DER, campos
   * del sujeto) son transformaciones baratas sobre el objeto ya descifrado, así
   * que se resuelven todas de una vez en lugar de re-abrir el contenedor por
   * cada consumidor como hacía el código anterior.
   */
  private parseP12(
    p12_buffer: Buffer,
    password: string,
    want_private_key: boolean,
  ): P12Material {
    try {
      // Use node-forge for PKCS#12 parsing
      const forge = require('node-forge');
      const p12_asn1 = forge.asn1.fromDer(p12_buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(p12_asn1, password);

      // Extract certificate
      const cert_bags = p12.getBags({ bagType: forge.oids.certBag });
      const cert_bag = cert_bags[forge.oids.certBag]?.[0];
      if (!cert_bag?.cert) {
        throw new Error('No certificate found in .p12 file');
      }
      const certificate_pem = forge.pki.certificateToPem(cert_bag.cert);
      const cert_der_bytes = forge.asn1
        .toDer(forge.pki.certificateToAsn1(cert_bag.cert))
        .getBytes();
      const certificate_der_base64 = Buffer.from(
        cert_der_bytes,
        'binary',
      ).toString('base64');

      // Extract private key
      const key_bags = p12.getBags({ bagType: forge.oids.pkcs8ShroudedKeyBag });
      const key_bag = key_bags[forge.oids.pkcs8ShroudedKeyBag]?.[0];

      return {
        certificate_pem,
        certificate_der_base64,
        subject_cn: cert_bag.cert.subject.getField('CN')?.value,
        issuer_cn: cert_bag.cert.issuer.getField('CN')?.value,
        not_after: cert_bag.cert.validity.notAfter,
        has_private_key: Boolean(key_bag?.key),
        private_key_pem:
          want_private_key && key_bag?.key
            ? forge.pki.privateKeyToPem(key_bag.key)
            : null,
      };
    } catch (error) {
      if (
        error.message.includes('Invalid password') ||
        error.message.includes('PKCS#12 MAC could not be verified')
      ) {
        throw new Error('Invalid certificate password');
      }
      throw error;
    }
  }

  /**
   * Builds the WS-Security material the SOAP transport needs.
   *
   * ## Why the transport needs this too
   *
   * DIAN's WCF binding signs the SOAP envelope with the SAME certificate that
   * signs the document. So moving only the XAdES signature into the HSM would be
   * cosmetic: the private key would still have to exist in this process to sign
   * the envelope, which is exactly the exposure the HSM was meant to remove.
   * Routing both through an `XadesSigner` is what makes the custody real.
   *
   * The `BinarySecurityToken` carries the DER certificate — public material,
   * unchanged in either custody.
   */
  buildWsCredentials(
    p12_buffer: Buffer,
    password: string,
    kms_key_id?: string | null,
  ): { signer: XadesSigner; certificate_der_base64: string } {
    if (kms_key_id) {
      return {
        signer: this.buildKmsSigner(kms_key_id),
        certificate_der_base64: this.extractCertificateDerBase64(
          p12_buffer,
          password,
        ),
      };
    }

    const creds = this.extractCredentials(p12_buffer, password);
    return {
      signer: new LocalPemSigner(creds.private_key_pem),
      certificate_der_base64: creds.certificate_der_base64,
    };
  }

  /**
   * DER-encoded base64 certificate, read without requiring a private key bag —
   * the shape of a container provisioned for HSM custody.
   */
  private extractCertificateDerBase64(
    p12_buffer: Buffer,
    password: string,
  ): string {
    // El DER sale del MISMO parseo que el PEM. Antes esto reconvertía
    // PEM -> ASN.1 -> DER sobre un certificado que acababa de venir de ASN.1,
    // un viaje de ida y vuelta que ya no hace falta.
    return this.readP12(p12_buffer, password, false).certificate_der_base64;
  }

  /**
   * Extracts credentials from a .p12 certificate file.
   * Returns PEM private key, PEM certificate, and DER-encoded base64 certificate
   * (needed for WS-Security BinarySecurityToken).
   */
  extractCredentials(
    p12_buffer: Buffer,
    password: string,
  ): {
    private_key_pem: string;
    certificate_pem: string;
    certificate_der_base64: string;
  } {
    const material = this.readP12(p12_buffer, password, true);
    if (!material.private_key_pem) {
      throw new Error('No private key found in .p12 file');
    }
    return {
      private_key_pem: material.private_key_pem,
      certificate_pem: material.certificate_pem,
      certificate_der_base64: material.certificate_der_base64,
    };
  }

  /**
   * Validates that a .p12 file can be read with the given password
   * and that the certificate is not expired.
   */
  async validateCertificate(
    p12_buffer: Buffer,
    password: string,
  ): Promise<{
    valid: boolean;
    subject?: string;
    issuer?: string;
    expires?: Date;
    error?: string;
  }> {
    try {
      // Sin llave privada: validar un certificado NO es firmar, así que no hay
      // razón para materializar la llave (y menos para retenerla en caché).
      const material = this.readP12(p12_buffer, password, false);
      const expires = material.not_after;

      if (expires < new Date()) {
        return {
          valid: false,
          subject: material.subject_cn,
          issuer: material.issuer_cn,
          expires,
          error: 'Certificate expired',
        };
      }

      return {
        valid: true,
        subject: material.subject_cn,
        issuer: material.issuer_cn,
        expires,
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}
