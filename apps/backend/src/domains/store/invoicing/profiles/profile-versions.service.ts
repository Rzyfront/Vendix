import { Injectable } from '@nestjs/common';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { profileNotFound } from './profile-errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

import { QueryProfileVersionsDto } from './dto/query-invoice-profiles.dto';

/**
 * Historial de versiones de un perfil. **Sólo lectura.**
 *
 * No hay `update` ni `restore` en esta clase, y no es un olvido: una versión es
 * el snapshot con el que se calculó una factura. Reescribir una cambiaría,
 * retroactivamente, el IVA que ese documento declaró ante la DIAN. «Volver a
 * una versión anterior» se hace clonando (ADR-1), que produce un perfil nuevo y
 * deja el original intacto.
 *
 * El borrado del historial vive en `ProfilesService.remove`, atado al borrado
 * del perfil y sólo cuando ninguna factura lo referencia.
 */
@Injectable()
export class ProfileVersionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Lista las versiones sin el `config`.
   *
   * El snapshot completo de cada versión pesa lo suyo y el historial no lo
   * necesita: la tabla muestra número, fecha y autor, y el diff pide dos
   * versiones concretas. Devolverlo en el listado sería enviar N snapshots para
   * mostrar N filas de tres columnas.
   */
  async findAll(profile_id: number, query: QueryProfileVersionsDto) {
    await this.assertProfileExists(profile_id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [data, total] = await Promise.all([
      this.prisma.invoice_profile_versions.findMany({
        where: { profile_id },
        select: {
          id: true,
          version: true,
          created_at: true,
          created_by: true,
          creator: { select: { id: true, first_name: true, last_name: true } },
        },
        orderBy: { version: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoice_profile_versions.count({ where: { profile_id } }),
    ]);

    return { data, total, page, limit };
  }

  /** Una versión con su snapshot completo. */
  async findOne(profile_id: number, version: number) {
    await this.assertProfileExists(profile_id);

    const row = await this.prisma.invoice_profile_versions.findFirst({
      where: { profile_id, version },
      select: {
        id: true,
        version: true,
        config: true,
        created_at: true,
        created_by: true,
        creator: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_PROFILE_VERSION_001,
        `La versión ${version} de este perfil no existe.`,
        { profile_id, version },
      );
    }
    return row;
  }

  /**
   * El perfil se comprueba aparte para poder distinguir los dos 404.
   *
   * `invoice_profile_versions` se scopea RELACIONALMENTE, a través de
   * `profile.store_id`: un `profile_id` de otro tenant no devuelve filas, así
   * que sin esta comprobación un historial ajeno y un perfil sin versiones
   * darían la misma respuesta vacía, y el frontend no sabría si volver al
   * listado o quedarse en el historial.
   */
  private async assertProfileExists(profile_id: number): Promise<void> {
    const profile = await this.prisma.invoice_profiles.findFirst({
      where: { id: profile_id },
      select: { id: true },
    });
    if (!profile) throw profileNotFound(profile_id);
  }
}
