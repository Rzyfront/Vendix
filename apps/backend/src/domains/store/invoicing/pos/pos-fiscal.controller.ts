import {
  Controller,
  Get,
  Param,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { PosFiscalEmissionService } from './pos-fiscal-emission.service';

/**
 * Superficie fiscal DEL POS. Dos rutas y ninguna más: mirar el estado y pedir
 * la emisión.
 *
 * ## Por qué no cuelga de `InvoicingController`
 *
 * Aquel declara `@RequireModuleFlow('invoicing')` a nivel de clase, así que una
 * tienda con el área fiscal inactiva recibe 403 en TODAS sus rutas. Para el
 * carril fiscal eso es correcto —no hay nada que hacer allí—, pero para el POS
 * significaría que el indicador no puede ni siquiera preguntar y el cajero vería
 * un error donde la respuesta correcta es «esta tienda no factura
 * electrónicamente».
 *
 * No se pierde ninguna compuerta: `PosFiscalEmissionService` consulta el MISMO
 * `FiscalGateService.isAreaEnabled` que usa el guard (vía
 * `InvoicingService.getElectronicEmissionEligibility`), sólo que lo convierte en
 * un estado `not_applicable` en vez de en una excepción. Es la diferencia entre
 * las dos superficies, no una excepción a la regla.
 *
 * ## Por qué el permiso es `store:pos:access` y no `invoicing:*`
 *
 * Porque `invoicing:read` / `invoicing:write` los tienen SÓLO admin, manager,
 * owner y super_admin (verificado en la base de dev). El cajero no. Exigirlos
 * aquí daría 403 a la única persona para la que existe esta superficie.
 *
 * `store:pos:access` —«puede abrir la caja»— lo tienen admin, cashier, manager,
 * owner, Preventista y super_admin: un superconjunto exacto de quien puede
 * llegar a estas dos rutas, porque para verlas hay que estar dentro del POS.
 * Emitir el documento de una venta que acabas de cobrar es parte de cobrarla,
 * no una atribución fiscal aparte.
 *
 * NOTA sobre el guard: hasta este cambio la clase no declaraba NINGUNO, así que
 * los `@Permissions` de abajo eran decoración inerte —Nest sólo los lee si hay
 * un guard que los consulte— y `POST .../emit` quedaba abierto a cualquier
 * usuario autenticado, `customer` incluido. No es un permiso nuevo ni una
 * restricción nueva: es hacer efectiva la que el archivo ya declaraba.
 */
@Controller('store/invoicing/pos')
@UseGuards(PermissionsGuard)
export class PosFiscalController {
  constructor(
    private readonly emission: PosFiscalEmissionService,
    private readonly response_service: ResponseService,
  ) {}

  /**
   * Estado fiscal de una venta, para el indicador NO MODAL del POS. Sólo lee.
   *
   * Mismo permiso que emitir: quien puede pedir el documento puede ver en qué
   * estado quedó. Separarlos daría un cajero capaz de emitir a ciegas.
   */
  @Get('orders/:orderId/fiscal-status')
  @Permissions('store:pos:access')
  async getFiscalStatus(@Param('orderId') order_id: string) {
    const result = await this.emission.getStatusForOrder(+order_id);
    return this.response_service.success(result);
  }

  /**
   * Emisión bajo demanda: el cajero pide el documento de una venta ya cobrada,
   * o reintenta una que quedó pendiente.
   *
   * Responde **200 con el estado**, incluso cuando la DIAN falla. No es
   * indulgencia con el error: la venta ya está cerrada y el documento pendiente
   * ya quedó registrado con su motivo: devolver un 5xx sólo le quitaría al POS
   * la única información útil que hay —en qué estado quedó— y le pintaría al
   * cajero un fallo sobre una operación que sí ocurrió.
   *
   * Un documento que la prevalidación rechaza NO se transmite: vuelve con
   * `state: 'failed'` y sus `blockers`, cada uno con qué está mal y dónde se
   * corrige.
   */
  @Post('orders/:orderId/emit')
  @Permissions('store:pos:access')
  @HttpCode(HttpStatus.OK)
  async emit(@Param('orderId') order_id: string) {
    const result = await this.emission.emitForOrder(+order_id);
    return this.response_service.success(result, result.message);
  }
}
