import type { ConfirmData } from '../../../../../shared/components/dialog/dialog.service';

/**
 * Confirmation shown before an UNPAID order goes out to Consumidor final.
 *
 * The backend issues it cash with payment means «Acuerdo mutuo» (ZZZ) while
 * the balance stays pending on the order, so the cashier must read the
 * consequence first. Paid orders never ask. `count` > 1 words it for the
 * bulk invoicing modal.
 */
export function unpaidFinalConsumerConfirm(count = 1): ConfirmData {
  const plural = count > 1;
  const subject = plural
    ? `${count} órdenes no están pagadas`
    : 'Esta orden no está pagada';
  const invoice = plural ? 'las facturas' : 'la factura';
  return {
    title: plural ? 'Órdenes sin pagar' : 'Orden sin pagar',
    message:
      `<strong>${subject}</strong>, por eso se recomienda emitir ${invoice} a crédito. ` +
      'Para facturar a crédito se necesitan los datos del cliente.<br><br>' +
      `Si continúas como Consumidor final, ${invoice} ${plural ? 'saldrán' : 'saldrá'} ` +
      '<strong>de contado, como ya pagada</strong> (medio de pago «Acuerdo mutuo»), ' +
      `a nombre de Consumidor final 222222222222. El saldo sigue pendiente en ${plural ? 'cada orden' : 'la orden'} ` +
      'y debes cobrarlo después con «Registrar pago».<br><br>' +
      '¿Deseas continuar?',
    confirmText: 'Sí, emitir a Consumidor final',
    cancelText: 'Volver',
    confirmVariant: 'danger',
  };
}
