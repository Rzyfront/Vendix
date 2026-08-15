import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import {
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
} from '../../domains/store/invoicing/fiscal-document-requirements';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { EncryptionService } from './encryption.service';

/**
 * Las tres columnas de `invoice_resolutions` que custodian la ClTec.
 *
 * Se declaran juntas porque son UN dato en tres representaciones —claro, cifrado
 * y huella— y sólo tienen sentido si se escriben a la vez. Escribir una sin las
 * otras es exactamente el estado del que este servicio saca al sistema.
 */
export interface StoredTechnicalKey {
  technical_key?: string | null;
  technical_key_encrypted?: string | null;
  technical_key_fingerprint?: string | null;
}

/**
 * Custodia de la clave técnica DIAN (ClTec) de una resolución de numeración.
 *
 * ── QUÉ ES LO QUE SE ESTÁ GUARDANDO ────────────────────────────────────────
 *
 * La ClTec es el 14º campo del CUFE y la única entrada del hash que el XML NO
 * transporta: la DIAN la conoce porque ella misma la emitió al autorizar el
 * rango. Quien la tenga puede recomputar el CUFE de cualquier factura de ese
 * rango. Vivía en `technical_key` en texto plano, junto al resto de la fila.
 *
 * ── POR QUÉ NO HUBO —NI PUEDE HABER— UN BACKFILL POR SQL ───────────────────
 *
 * Sólo la aplicación puede cifrar: `DIAN_ENCRYPTION_KEY` no está disponible para
 * el runner de migraciones, a propósito. Así que ninguna migración puede llenar
 * `technical_key_encrypted`, y la columna llevaba desde su creación NULL en
 * todas las filas. El relleno ocurre donde el texto plano existe —al leerlo—,
 * una fila a la vez y sin mutación masiva de producción. Es el mismo patrón que
 * `DianSecretEnvelopeService` ya usa para el Software-PIN y la contraseña del
 * certificado.
 *
 * ── POR QUÉ EL TEXTO PLANO TODAVÍA SE ESCRIBE ──────────────────────────────
 *
 * Por una sola consulta, y conviene nombrarla: `findResolutionsSharingTechnicalKey`
 * busca —SIN scope de tenant, sobre la tabla entera de la plataforma— otra
 * resolución con la misma ClTec. Es el detector de contaminación cruzada entre
 * NIT, y es una comparación ENTRE filas. El cifrado usa salt e IV frescos por
 * registro, así que dos filas con la misma clave dan ciphertexts distintos y esa
 * igualdad jamás coincidiría; peor, su resultado vacío se lee idéntico a «no hay
 * contaminación». Para eso está `technical_key_fingerprint`: un SHA-256 pelado
 * —determinista, estable entre entornos, inmune a rotación de llave— que permite
 * la comparación sin exponer el secreto.
 *
 * Con la huella en su sitio, anular la columna en claro es un paso posterior de
 * DATOS, que exige aprobación explícita y snapshot (CLAUDE.md §6.3). Este
 * servicio deja el terreno listo y no lo da por hecho: nunca borra el texto
 * plano.
 *
 * ── POR QUÉ NADA DE ESTO PUEDE TUMBAR UNA EMISIÓN ──────────────────────────
 *
 * `reveal()` y `upgradeInPlace()` no lanzan. Sus llamadores gastan consecutivos
 * autorizados; fallar una factura porque un endurecimiento no pudo escribir su
 * copia cifrada cambiaría una mejora cosmética por un número quemado, que no se
 * recupera. Todo fallo se registra y se traga.
 */
@Injectable()
export class TechnicalKeyVaultService {
  private readonly logger = new Logger(TechnicalKeyVaultService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Huella determinista de una ClTec, o `null` si no hay clave.
   *
   * SHA-256 sin llave, y es deliberado. La ClTec es un SHA-1 en hexadecimal —160
   * bits sin estructura adivinable—, así que no hay diccionario que enumerar y
   * la huella no filtra el secreto. A cambio se gana lo que un HMAC no da: la
   * huella sobrevive a una rotación de `DIAN_ENCRYPTION_KEY` y vale igual en
   * todos los entornos. Con llave, rotar dejaría mudo al detector de ClTec
   * compartida — un control de seguridad apagándose en silencio, que es la
   * forma de fallo que esta columna existe para evitar.
   */
  fingerprint(raw: string | null | undefined): string | null {
    const technical_key = normalizeTechnicalKey(raw);
    if (!technical_key) return null;
    return createHash('sha256').update(technical_key, 'utf8').digest('hex');
  }

  /**
   * Convierte una ClTec en las tres columnas que hay que persistir.
   *
   * Devuelve SIEMPRE las tres claves, incluso en `null`: un `undefined` haría
   * que Prisma dejara la columna como estaba, y en un `update` que cambia la
   * clave eso conservaría la huella y el cifrado de la clave ANTERIOR. La fila
   * quedaría apuntando a dos claves distintas a la vez, y la que manda al
   * recomputar el CUFE sería la vieja.
   *
   * @param raw ClTec ya validada de forma por `assertTechnicalKeyShape`. Este
   *            servicio no juzga la forma —no es su trabajo— pero sí se niega a
   *            cifrar una clave malformada: ver abajo.
   */
  sealForWrite(raw: string | null | undefined): Required<StoredTechnicalKey> {
    const technical_key = normalizeTechnicalKey(raw) || null;
    if (!technical_key) {
      return {
        technical_key: null,
        technical_key_encrypted: null,
        technical_key_fingerprint: null,
      };
    }

    return {
      technical_key,
      technical_key_encrypted: this.tryEncrypt(technical_key),
      technical_key_fingerprint: this.fingerprint(technical_key),
    };
  }

  /**
   * Devuelve la ClTec en claro, prefiriendo la copia cifrada.
   *
   * El orden importa y no es simetría: la copia cifrada es la que se escribe
   * hoy, así que si ambas existen y difieren, la cifrada es la reciente. Cuando
   * no abre —llave rotada sin re-cifrar, envoltura corrupta— se cae al texto
   * plano en vez de fallar, porque el llamador está a punto de emitir y quedarse
   * sin clave le cuesta un consecutivo.
   */
  reveal(stored: StoredTechnicalKey | null | undefined): string | null {
    if (!stored) return null;

    const sealed = (stored.technical_key_encrypted ?? '').trim();
    if (sealed) {
      try {
        const plain = normalizeTechnicalKey(this.encryption.decrypt(sealed));
        if (plain) return plain;
      } catch (error) {
        this.logger.warn(
          `No se pudo descifrar technical_key_encrypted; se usa el texto plano de respaldo: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return normalizeTechnicalKey(stored.technical_key) || null;
  }

  /**
   * True cuando la fila guarda una ClTec que todavía no tiene copia cifrada o no
   * tiene huella. Lo consume la checklist de alistamiento como AVISO, nunca como
   * bloqueo: la clave funciona igual, y negar la emisión por un endurecimiento
   * pendiente convertiría una mejora en una caída.
   */
  needsUpgrade(stored: StoredTechnicalKey | null | undefined): boolean {
    if (!stored) return false;
    const plain = normalizeTechnicalKey(stored.technical_key);
    if (!plain) return false;

    const sealed = (stored.technical_key_encrypted ?? '').trim();
    if (!sealed) return true;
    if (!(stored.technical_key_fingerprint ?? '').trim()) return true;

    // Envoltura vieja o llave anterior: mismo criterio que usa
    // `DianSecretEnvelopeService` para el Software-PIN.
    return this.encryption.needsReencryption(sealed);
  }

  /**
   * Rellena la copia cifrada y la huella de una fila que sólo tenía texto plano.
   * Seguro de llamar en cada lectura: no hace nada a partir de la segunda vez.
   *
   * NO borra `technical_key`. Anular la única copia legible sin la aprobación
   * explícita del humano convertiría un fallo de llave en una pérdida
   * irrecuperable: el texto plano no está en ningún otro sitio, y la clave la
   * emitió la DIAN al autorizar un rango que ya está en uso.
   */
  async upgradeInPlace(
    resolution_id: number,
    stored: StoredTechnicalKey,
  ): Promise<void> {
    try {
      if (!this.needsUpgrade(stored)) return;

      const plain = normalizeTechnicalKey(stored.technical_key);
      const sealed = this.tryEncrypt(plain);
      if (!sealed) return;

      // El round-trip es la parte que importa: se prueba que la envoltura nueva
      // abre y devuelve la MISMA clave antes de escribirla. Sin esa prueba, una
      // copia cifrada ilegible se leería después como la fuente preferida y
      // taparía el texto plano que sí servía.
      if (normalizeTechnicalKey(this.encryption.decrypt(sealed)) !== plain) {
        throw new Error(
          'La ClTec re-cifrada no devolvió el mismo valor; se conserva la almacenada',
        );
      }

      await this.prisma.invoice_resolutions.update({
        where: { id: resolution_id },
        data: {
          technical_key_encrypted: sealed,
          technical_key_fingerprint: this.fingerprint(plain),
        },
      });

      this.logger.log(
        `ClTec cifrada en sitio para la resolución ${resolution_id}`,
      );
    } catch (error) {
      // Terminal a propósito: ver el comentario de la clase.
      this.logger.warn(
        `No se pudo cifrar la ClTec de la resolución ${resolution_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Cifra, o devuelve `null` cuando no se puede — nunca propaga el fallo.
   *
   * `encrypt()` se niega a acuñar secretos bajo la llave de respaldo visible en
   * el repositorio cuando corre en producción. Para el Software-PIN ese rechazo
   * aborta el guardado, y está bien: sin PIN no hay nada que guardar. Aquí no:
   * la resolución se guarda igual en `technical_key`, tal como se guardaba antes
   * de que esta columna existiera, y negar el guardado sería una regresión —el
   * usuario perdería la resolución entera por una llave de entorno que no
   * controla—. Se degrada, se avisa, y la checklist de alistamiento sigue
   * reportando la llave ausente.
   */
  private tryEncrypt(plaintext: string): string | null {
    if (!plaintext) return null;
    if (!isWellFormedTechnicalKey(plaintext)) {
      // Una clave malformada es la que quemó un consecutivo en producción el
      // 14/08/2026. No se le da una copia cifrada que la haga parecer legítima:
      // se deja sólo en claro para que los validadores de forma la sigan viendo.
      return null;
    }

    try {
      return this.encryption.encrypt(plaintext);
    } catch (error) {
      this.logger.warn(
        `No se pudo cifrar la ClTec; queda sólo en texto plano: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
