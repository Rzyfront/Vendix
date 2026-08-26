import { Injectable } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

import {
  AIU_BUCKETS,
  InvoiceProfileConfig,
} from './invoice-profile-config.contract';

/**
 * Compuerta F.13: los códigos PUC de `config.accounting` se validan contra el
 * plan de cuentas AL GUARDAR, con existencia **y** `accepts_entries = true`.
 *
 * ## Por qué existe
 *
 * El contrato (`invoice-profile-config.contract.ts`) declara en su docblock que
 * la existencia de la cuenta «se valida al usarla», pero ese consumidor nunca
 * se escribió: el sistema aceptó 24 códigos inexistentes —entre ellos
 * `413501`, que no está en el PUC de NINGUNA organización— sin una queja, y el
 * fallo reaparecía lejos, como asiento imposible sobre un documento ya
 * emitido. Esta compuerta adelanta el rechazo al guardado con decisión escrita
 * (rzy, 2026-08-25): **422 desde ya**, no aviso.
 *
 * ## Contra QUÉ PUC se valida — la decisión de alcance
 *
 * Lo decide `organizations.fiscal_scope` con el MISMO resolutor del módulo de
 * contabilidad ({@link FiscalScopeService}), para que la compuerta juzgue al
 * perfil contra exactamente las cuentas que los selectores del editor le
 * ofrecen:
 *
 * - `ORGANIZATION` ⇒ el PUC de nivel organización.
 * - `STORE` ⇒ el PUC de la entidad contable de la tienda del perfil.
 *
 * Validar contra otro PUC aceptaría un código que no existe donde el asiento va
 * a caer, y el defecto volvería a aparecer en emisión.
 *
 * ## Caso borde perfil org-wide bajo scope STORE — decisión escrita
 *
 * No puede ocurrir por esta API: `invoice_profiles.store_id` es NO nullable y
 * `ProfilesService.getScope()` rechaza sin tienda (`STORE_CONTEXT_001`), así
 * que la compuerta siempre recibe `store_id`. Si el modelo algún día permitiera
 * un perfil sin tienda bajo scope STORE, `findFiscalAccountingEntityId` cae por
 * sí mismo a la entidad de nivel organización — que es la opción «validar
 * contra el PUC de organización declarando la limitación» que el plan dejó
 * escrita. No se exige tienda: se hereda el fallback del resolutor y queda
 * dicho aquí.
 *
 * ## Sólo lectura, y fuera de la transacción
 *
 * Usa `findFiscalAccountingEntityId` (READ-ONLY) y no
 * `resolveAccountingEntityForFiscal`: una compuerta que valida no debe crear la
 * entidad contable como efecto secundario. Si el tenant todavía no tiene PUC,
 * cualquier código pedido no puede existir en él y se rechaza honestamente.
 * Y corre ANTES de la transacción de guardado por la misma razón que la
 * comprobación previa de nombre en `ProfilesService`: no es la garantía, es el
 * mensaje temprano — nada de lo que esta transacción escriba depende de las
 * filas leídas acá.
 *
 * Las versiones ya guardadas con códigos inválidos NO se tocan: son inmutables
 * por diseño, quedan identificables por la consulta de DB-07 y su corrección
 * ocurre por edición normal, que crea versión nueva append-only.
 */
@Injectable()
export class ProfileAccountingValidator {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscal_scope: FiscalScopeService,
  ) {}

  /**
   * Rechaza con `INVOICING_PROFILE_010` si algún código de `config.accounting`
   * no sirve para asentar contra el PUC que gobierna el perfil. `config`
   * llega YA normalizado: aquí sólo importa qué códigos trae.
   */
  async assertAccountsUsable(
    config: InvoiceProfileConfig,
    scope: ProfileAccountScope,
  ): Promise<void> {
    const [issues] = await this.describeAccountsUsability([config], scope);
    if (issues.length === 0) return;

    // La FORMA del error es la del editor (`details.issues[]` con ruta con
    // puntos), para que el pintado por campo sirva igual; el CÓDIGO es propio
    // porque éste es un fallo de existencia contra la base, no de forma del
    // snapshot.
    throw new VendixHttpException(
      ErrorCodes.INVOICING_PROFILE_010,
      issues.length === 1
        ? issues[0].message
        : `${issues[0].message} (y ${issues.length - 1} ${
            issues.length === 2 ? 'cuenta' : 'cuentas'
          } con problema en la configuración contable del perfil).`,
      {
        ...(scope.profile_id != null && { profile_id: scope.profile_id }),
        operation_type: scope.operation_type,
        issue_count: issues.length,
        issues,
      },
    );
  }

  /**
   * El MISMO criterio de {@link assertAccountsUsable}, sin rechazar a nadie:
   * describe los problemas de cada config y devuelve un array POSICIONAL —la
   * posición i responde al config i—, vacío cuando el perfil está sano.
   *
   * Existe para el panel de salud de F.13 (`GET /profiles/account-health`),
   * que necesita MARCAR las versiones vigentes legadas, no bloquearlas: la
   * decisión del dueño (2026-08-25) fue marcar + corregir en UI, sin UPDATE.
   * Duplicar aquí el recorrido de `collectAccountRefs` o el predicado contra
   * `chart_of_accounts` sería escribir dos veces la regla que este módulo ya
   * vio divergir en silencio — el panel juzga con EXACTAMENTE lo mismo que la
   * compuerta, así que lo que marca coincide con lo que el próximo guardado
   * va a exigir corregir.
   *
   * Recibe un LOTE a propósito: una pasada de tienda resuelve el fiscal scope
   * UNA vez y consulta el PUC UNA sola vez con la UNIÓN de códigos de todos
   * los perfiles. El panel lista toda la tienda; N consultas por N perfiles
   * sería el mismo dato multiplicado por el tamaño del listado.
   */
  async describeAccountsUsability(
    configs: ReadonlyArray<InvoiceProfileConfig>,
    scope: ProfileAccountScope,
  ): Promise<ProfileAccountIssue[][]> {
    const refs_by_config = configs.map((config) => collectAccountRefs(config));
    // Sección vacía —el default del contrato trae todo `null`, que significa
    // «heredar el mapeo de la tienda»—: nada que validar, ni una consulta.
    if (refs_by_config.every((refs) => refs.length === 0)) {
      return configs.map(() => []);
    }

    const fiscal_scope = await this.fiscal_scope.getFiscalScope(
      scope.organization_id,
    );
    const puc_label =
      fiscal_scope === 'ORGANIZATION'
        ? 'el PUC de la organización'
        : 'el PUC de la tienda';

    const accounting_entity_id = await this.fiscal_scope.findFiscalAccountingEntityId(
      { organization_id: scope.organization_id, store_id: scope.store_id },
    );

    if (accounting_entity_id === null) {
      // Sin PUC que gobierne el perfil, ningún código puede existir en él. Es
      // la misma respuesta que daría el selector: no hay cuentas entre las que
      // elegir.
      return refs_by_config.map((refs) =>
        refs.map((ref) => notInChart(ref, puc_label)),
      );
    }

    const codes = [
      ...new Set(refs_by_config.flat().map((ref) => ref.code)),
    ];
    const rows = await this.prisma.chart_of_accounts.findMany({
      where: {
        organization_id: scope.organization_id,
        accounting_entity_id,
        code: { in: codes },
      },
      select: { code: true, accepts_entries: true },
    });
    const accepts_by_code = new Map(rows.map((row) => [row.code, row.accepts_entries]));

    return refs_by_config.map((refs) =>
      refs
        .map((ref): ProfileAccountIssue | null => {
          const accepts_entries = accepts_by_code.get(ref.code);
          if (accepts_entries === undefined) {
            return notInChart(ref, puc_label);
          }
          if (!accepts_entries) {
            // La mitad del invariante que DB-07 encontró violada en silencio:
            // una cuenta de agrupación EXISTE y no sirve — guardarla produce
            // un asiento imposible en la emisión, no en el guardado.
            return {
              field: ref.field,
              code: 'ACCOUNT_DOES_NOT_ACCEPT_ENTRIES',
              message: `La cuenta «${ref.code}» es de agrupación y no admite movimientos. Elige una cuenta imputable de ${puc_label}.`,
            };
          }
          return null;
        })
        .filter((issue): issue is ProfileAccountIssue => issue !== null),
    );
  }
}

/** Ámbito de tenant que necesita juzgar cuentas: el mismo para gate y panel. */
export interface ProfileAccountScope {
  organization_id: number;
  store_id: number;
  operation_type: string;
  profile_id?: number | null;
}

/** Un problema de una cuenta del perfil: campo exacto + código estable. */
export interface ProfileAccountIssue {
  field: string;
  code: string;
  message: string;
}

/** Un código pedido por el perfil y la ruta exacta donde vive. */
interface AccountRef {
  field: string;
  code: string;
}

function notInChart(ref: AccountRef, puc_label: string): ProfileAccountIssue {
  return {
    field: ref.field,
    code: 'ACCOUNT_NOT_IN_CHART',
    message: `La cuenta «${ref.code}» no existe en ${puc_label}. Elige una cuenta del plan de cuentas.`,
  };
}

/**
 * Recorre la sección contable del snapshot en el MISMO orden que el contrato
 * usa para validar la forma, y con las mismas rutas con puntos — así el 422 de
 * existencia nombra el campo exacto que el editor ya sabe marcar. Los valores
 * vacíos o no-cadena son asunto de la validación de forma y aquí se ignoran.
 */
function collectAccountRefs(config: InvoiceProfileConfig): AccountRef[] {
  const refs: AccountRef[] = [];
  const accounting = config.accounting;

  const vat = accounting?.vat_payable_account;
  if (typeof vat === 'string' && vat.trim() !== '') {
    refs.push({ field: 'accounting.vat_payable_account', code: vat.trim() });
  }

  const by_bucket = accounting?.revenue_account_by_bucket;
  if (by_bucket) {
    for (const bucket of AIU_BUCKETS) {
      const code = by_bucket[bucket];
      if (typeof code === 'string' && code.trim() !== '') {
        refs.push({
          field: `accounting.revenue_account_by_bucket.${bucket}`,
          code: code.trim(),
        });
      }
    }
  }

  const overrides = accounting?.mapping_key_overrides;
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      const code = overrides[key];
      if (typeof code === 'string' && code.trim() !== '') {
        refs.push({ field: `accounting.mapping_key_overrides.${key}`, code: code.trim() });
      }
    }
  }

  return refs;
}
