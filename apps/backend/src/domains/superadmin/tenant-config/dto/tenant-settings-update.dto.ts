import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * Cuerpo del `PATCH /superadmin/tenants/:scope/:tenantId/settings`.
 *
 * Las secciones viajan ANIDADAS bajo `settings` en vez de sueltas en la raíz
 * del body por una razón concreta: el `ValidationPipe` global corre con
 * `forbidNonWhitelisted: true`, así que un DTO con las secciones en la raíz
 * rechazaría con 400 cualquier clave que no estuviera declarada aquí — y la
 * lista canónica de secciones no vive en este archivo, vive en
 * `KNOWN_SECTIONS` del `SettingsService` de tienda. Envolver en `settings`
 * mantiene ese contrato en un solo sitio: el pipe valida la envoltura y el
 * servicio delegado hace el saneamiento y la validación reales
 * (`sanitizeAndValidate`), exactamente igual que para el comerciante.
 *
 * Además unifica la forma con `PUT /organization/settings`, que ya recibe
 * `{ settings: {...} }`, de modo que el mismo cuerpo sirve para un tenant de
 * alcance tienda y para uno de alcance organización.
 */
@ApiSchema({ name: 'TenantSettingsUpdateDto' })
export class TenantSettingsUpdateDto {
  @ApiProperty({
    description:
      'Secciones de configuración a fusionar. Sólo se tocan las secciones presentes; las ausentes conservan su valor.',
    example: { pos: { require_customer: false }, panel_ui: { STORE_ADMIN: {} } },
  })
  @IsObject()
  settings!: Record<string, unknown>;
}
