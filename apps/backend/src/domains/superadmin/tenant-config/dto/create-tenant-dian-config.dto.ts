import { IsInt, IsOptional, Min } from 'class-validator';

import { CreateDianConfigDto } from '../../../store/invoicing/dian-config/dto/create-dian-config.dto';

/**
 * Alta de configuración DIAN desde la consola de tenants.
 *
 * ES UNA CLASE QUE EXTIENDE, NUNCA UN TIPO INTERSECCIÓN. El `ValidationPipe`
 * global (`main.ts`: `whitelist: true`, `forbidNonWhitelisted: true`) decide si
 * valida a partir de `design:paramtypes`, y TypeScript emite `Object` para una
 * intersección: el pipe la trata como tipo nativo y NO valida nada.
 *
 * No es teoría. `organization/invoicing/dian-config/dian-config.controller.ts`
 * declara hoy `@Body() dto: CreateDianConfigDto & { store_id?: number }`, así
 * que ese endpoint acepta un NIT con letras, un `software_id` que no es UUID y
 * cualquier campo extra — precisamente los datos que la DIAN rechaza sin
 * veredicto legible.
 */
export class CreateTenantDianConfigDto extends CreateDianConfigDto {
  /**
   * Tienda titular, opcional y REDUNDANTE: el ancla real la fija la URL
   * (`:scope/:tenantId`) más el `fiscal_scope` de la organización, que es lo que
   * `TenantContextRunner` resuelve.
   *
   * Se acepta para que un cliente que reutilice el payload del panel de
   * organización no reciba un 400 por `forbidNonWhitelisted`, pero el
   * controlador rechaza el valor si CONTRADICE a la URL. Anclar en silencio a
   * otra tienda escribiría la configuración bajo el índice único parcial
   * equivocado y con el NIT de otro contribuyente.
   */
  @IsOptional()
  @IsInt({ message: 'store_id debe ser un entero' })
  @Min(1, { message: 'store_id debe ser mayor que cero' })
  store_id?: number;
}
