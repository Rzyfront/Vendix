import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { FiscalGateService } from '@common/services/fiscal-gate.service';

export interface EmissionGateContext {
  organization_id?: number;
  store_id?: number;
}

/**
 * Las dos compuertas que hay que cruzar ANTES de gastar un consecutivo.
 *
 * Vivían como métodos privados de `InvoicingService` y por eso el carril de
 * notas de crédito —que está en otro servicio— no las cruzaba. Medido en vivo el
 * 2026-08-24 sobre la misma tienda, en el mismo minuto y con el mismo token:
 * `POST /store/invoicing` respondía **403 `INVOICING_ENABLEMENT_001`** y
 * `POST /store/invoicing/credit-notes` respondía **201**, gastando el
 * consecutivo de la resolución 40 (`current_number` 5 → 6). Un consecutivo
 * gastado no se devuelve.
 *
 * Se extrae y NO se copia a propósito: el criterio tiene que ser uno. Copiarlo
 * daría dos implementaciones del mismo predicado que divergen la primera vez que
 * alguien toque una — el patrón que este dominio ya midió más de una vez.
 *
 * `InvoicingService` delega aquí y conserva el nombre de su método privado, así
 * que sus tres sitios de llamada (`create`, `createFromOrder`,
 * `createFromSalesOrder`) no cambian.
 */
@Injectable()
export class InvoiceEmissionGateService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly fiscalGate: FiscalGateService,
  ) {}

  /**
   * Primera compuerta: el área fiscal `invoicing` tiene que estar activa.
   *
   * El `ModuleFlowGuard` bloquea la entrada HTTP y `send()`/`accept()` ya validan
   * en `InvoiceFlowService`, pero los creadores también se invocan por rutas
   * internas que NO pasan por el controlador (invoice-data-requests, remisiones
   * de despacho, futura auto-emisión POS). Sin esta compuerta esos llamadores
   * crearían facturas saltándose el master switch `fiscal_status.invoicing`.
   * Fail-closed ante área inactiva.
   *
   * Usa el MISMO criterio (ACTIVE || LOCKED, vía `FiscalGateService.isAreaEnabled`)
   * y el MISMO error que `InvoiceFlowService.assertInvoicingAreaActive`, para no
   * divergir del gate de send/accept.
   *
   * Encima aplica `assertElectronicEmissionLive`: el área activa no basta cuando
   * el tenant ya configuró FE y su habilitación sigue en trámite.
   */
  async assertAreaActive(context: EmissionGateContext): Promise<void> {
    const enabled = await this.fiscalGate.isAreaEnabled(
      Number(context.organization_id),
      context.store_id != null ? Number(context.store_id) : null,
      'invoicing',
    );
    if (!enabled) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_AREA_001,
        'La facturación electrónica no está activa para esta tienda. ' +
          'Actívala en Configuración fiscal antes de emitir documentos.',
      );
    }

    await this.assertElectronicEmissionLive(context);
  }

  /**
   * Segunda compuerta: si el tenant SÍ configuró facturación electrónica, gastar
   * numeración exige que la habilitación esté viva (producción + enabled).
   *
   * `fiscal_status.invoicing` sólo afirma que el área fiscal está activa, y se
   * pone ACTIVE al terminar el wizard fiscal. Una tienda en set de pruebas la
   * pasaba y creaba documentos que consumen numeración: `InvoiceNumberGenerator`
   * elige la resolución por `accounting_entity_id` + `document_type` con
   * `is_active`, **sin distinguir ambiente**, así que los números que gastara un
   * trámite salían del rango que la tienda usará en producción, y la DIAN
   * rechaza numeración duplicada o con huecos que no puede explicar.
   *
   * Ese razonamiento no depende de que el documento sea una factura: la nota de
   * crédito llama al mismo generador con el mismo `accounting_entity_id`, y la
   * resolución se elige igual por `document_type` sin mirar ambiente. Por eso la
   * compuerta es del acto de numerar, no del tipo de documento.
   *
   * NO se exige a quien no tiene configuración DIAN: la facturación de Vendix
   * también emite documentos para comercios sin habilitación, y bloquearlos
   * convertiría una compuerta en una pérdida de función. El criterio es «si
   * configuraste FE, no emites hasta estar habilitado». Medido el 2026-08-24:
   * de 21 tiendas, **1** tiene fila en `dian_configurations`, así que la
   * indulgencia cubre 20 de 21 y la compuerta muerde exactamente donde debe.
   *
   * El set de pruebas no pasa por aquí: `DianTestService` reserva su bloque
   * directamente sobre `invoice_resolutions`, sin crear facturas.
   */
  async assertElectronicEmissionLive(
    context: EmissionGateContext,
  ): Promise<void> {
    const organization_id = Number(context.organization_id);
    if (!Number.isFinite(organization_id)) return;

    const scope = await this.fiscalScope.requireFiscalScope(organization_id);

    // Misma resolución que `DianConfigService.getEmissionStatus`: la
    // habilitación pertenece al alcance dueño del NIT.
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          ...(scope === 'ORGANIZATION'
            ? { organization_id, store_id: null }
            : { store_id: context.store_id }),
          configuration_type: 'invoicing',
        },
        orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
        select: { environment: true, enablement_status: true },
      });

    if (!config) return;

    const is_live =
      config.environment === 'production' &&
      config.enablement_status === 'enabled';

    if (!is_live) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_ENABLEMENT_001,
        'La facturación electrónica de esta tienda aún no está habilitada en producción ante la DIAN, así que no puede emitir documentos que consuman la numeración de la resolución. Completa el set de pruebas y activa producción.',
        // El ambiente sí es público —el comerciante lo eligió— y saber si está
        // en habilitación o en producción es justo lo que le dice qué paso le
        // falta. `enablement_status` viaja por el mismo motivo.
        {
          environment: config.environment,
          enablement_status: config.enablement_status,
        },
      );
    }
  }
}
