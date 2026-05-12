export const EXOGENOUS_FORMATS = {
  '1001': {
    code: '1001',
    name: 'Retenciones practicadas',
    description: 'Pagos o abonos en cuenta y retenciones practicadas',
  },
  '1003': {
    code: '1003',
    name: 'Retenciones que le practicaron',
    description: 'Retenciones en la fuente que le practicaron',
  },
  '1005': {
    code: '1005',
    name: 'IVA descontable y generado',
    description: 'Impuesto sobre las ventas descontable e IVA generado',
  },
  '1006': {
    code: '1006',
    name: 'IVA régimen simplificado',
    description: 'IVA en compras a proveedores del régimen simplificado/SIET',
  },
  '1007': {
    code: '1007',
    name: 'Ingresos recibidos',
    description: 'Ingresos recibidos de terceros',
  },
  '1008': {
    code: '1008',
    name: 'Saldos cuentas por cobrar',
    description: 'Saldos de cuentas por cobrar al 31 de diciembre',
  },
  '1009': {
    code: '1009',
    name: 'Saldos cuentas por pagar',
    description: 'Saldos de cuentas por pagar al 31 de diciembre',
  },
} as const;

export type ExogenousFormatCode = keyof typeof EXOGENOUS_FORMATS;
