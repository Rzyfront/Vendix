import { Injectable } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

import { InvoiceProfileConfig } from './invoice-profile-config.contract';
import {
  ProfileAccountingValidator,
} from './profile-accounting.validator';

/**
 * Una cuenta marcada en el panel: la MISMA forma de issue que manda el 422
 * de la compuerta (`details.issues[]`), para que el editor y el panel pinten
 * con un solo vocabulario. El `message` no viaja: `field` + `code` son las
 * claves estables del contrato y el texto lo redacta quien pinta.
 */
export interface ProfileAccountHealthIssue {
  field: string;
  code: string;
}

/**
 * Fila del panel: un perfil cuya versión ACTUAL lleva códigos contables que
 * el PUC no puede asentar (no existen, o existen como agrupación).
 *
 * Los perfiles SANOS no aparecen: el panel es el mapa de los perfiles a
 * corregir, no un listado más.
 */
export interface ProfileAccountHealthRow {
  profile_id: number;
  name: string;
  state: string;
  version: number;
  issues: ProfileAccountHealthIssue[];
}

/**
 * PANEL DE SALUD F.13 — qué perfiles de esta tienda arrastran códigos PUC
 * inválidos en su versión VIGENTE. **Sólo lectura: cero escrituras.**
 *
 * ## Por qué existe y qué decisión sirve
 *
 * La compuerta (`ProfileAccountingValidator.assertAccountsUsable`) dejó de
 * aceptar códigos inexistentes o de agrupación AL GUARDAR, pero las versiones
 * legadas NO se reescriben: son append-only y quedaron MARCADAS (decisión del
 * dueño, 2026-08-25) a la espera de que su corrección llegue por la vía
 * normal de edición. Este endpoint es el mapa de esas filas: lista cada
 * perfil cuya versión actual violaría la compuerta si se guardara hoy, con el
 * campo exacto y el código estable de cada problema — exactamente los dos
 * valores con los que el editor ya sabe marcar un input.
 *
 * ## El criterio NO está copiado, está prestado
 *
 * Delega en `ProfileAccountingValidator.describeAccountsUsability`, el método
 * read-only que expone la propia compuerta. Si mañana cambia el predicado
 * (otro campo, otro código de issue), el panel cambia con ella: jamás puede
 * pasar que el panel declare sano un perfil cuyo próximo guardado rechace el
 * 422, ni al revés.
 *
 * ## Sólo la versión ACTUAL
 *
 * Una versión pasada es la prueba de con qué reglas se emitió un documento:
 * marcarla sería ruido. Se juzga `profile.current_version` y nada más; una
 * versión vieja inválida bajo un perfil ya corregido NO aparece.
 *
 * ## Sin paginación — decisión escrita
 *
 * El volumen es acotado por diseño: filas = perfiles de UNA tienda (decenas
 * como máximo), filtradas a las que tienen problemas. El panel necesita el
 * conjunto completo para mostrar su contador («N perfiles por corregir»);
 * paginar una lista de marcadores partiría el número en páginas y obligaría
 * a sumar `meta.total` para saber lo que el usuario ve de un vistazo. Si una
 * tienda llegara a miles de perfiles, este contrato se revisa entonces.
 *
 * ## Consultas: tres, sin importar cuántos perfiles
 *
 * (1) perfiles de la tienda —el cliente scoped inyecta `store_id`—, (2) sus
 * versiones vigentes en un solo `findMany` con OR de pares `(profile_id,
 * version)`, (3) UNA lectura de `chart_of_accounts` con la UNIÓN de códigos,
 * hecha dentro del validador. N perfiles no multiplican consultas.
 */
@Injectable()
export class ProfileAccountHealthService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly accounts: ProfileAccountingValidator,
  ) {}

  async health(): Promise<ProfileAccountHealthRow[]> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id || !context?.store_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Selecciona una tienda antes de consultar la salud contable de los perfiles.',
      );
    }
    const organization_id = context.organization_id;
    const store_id = context.store_id;

    // El cliente scoped ya filtra por store_id: ningún perfil ajeno entra aquí.
    const profiles = await this.prisma.invoice_profiles.findMany({
      select: {
        id: true,
        name: true,
        state: true,
        current_version: true,
      },
    });
    if (profiles.length === 0) return [];

    // Las versiones se scopean relacionalmente vía profile.store_id; los ids
    // salen de la consulta anterior, así que el lote ya nace dentro del tenant.
    const versions = await this.prisma.invoice_profile_versions.findMany({
      where: {
        profile_id: { in: profiles.map((profile) => profile.id) },
        OR: profiles.map((profile) => ({
          profile_id: profile.id,
          version: profile.current_version,
        })),
      },
      select: { profile_id: true, version: true, config: true },
    });
    const version_by_profile = new Map(
      versions.map((version) => [version.profile_id, version]),
    );

    // Un perfil sin fila de versión vigente (imposible por el flujo de
    // creación, pero no se le inventa config) no se juzga: no hay nada que
    // marcar sobre un snapshot que no existe.
    const judged = profiles.flatMap((profile) => {
      const version = version_by_profile.get(profile.id);
      return version ? [{ profile, version }] : [];
    });

    const issues_by_config =
      await this.accounts.describeAccountsUsability(
        judged.map(({ version }) => version.config as InvoiceProfileConfig),
        { organization_id, store_id, operation_type: 'health' },
      );

    return judged.flatMap(({ profile, version }, index) => {
      const issues = issues_by_config[index] ?? [];
      if (issues.length === 0) return [];
      return [
        {
          profile_id: profile.id,
          name: profile.name,
          state: profile.state,
          version: version.version,
          issues: issues.map((issue) => ({
            field: issue.field,
            code: issue.code,
          })),
        },
      ];
    });
  }
}
