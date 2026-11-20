import { DispatchTransferDto } from '../../../../store/orders/stock-transfers/dto/transfer-advanced.dto';

/**
 * Despacho de una transferencia de organización.
 *
 * Desde P2 comparte el bloque de transporte, el conteo de salida por línea y el
 * lote con la superficie de tienda (`DispatchTransferDto`): `items` permite
 * despachar menos de lo pedido y elegir lote, y `transport_method` + vehículo +
 * costo quedan registrados en la transferencia.
 *
 * `notes` se sigue anexando a las notas existentes para trazabilidad.
 */
export class DispatchOrgTransferDto extends DispatchTransferDto {}
