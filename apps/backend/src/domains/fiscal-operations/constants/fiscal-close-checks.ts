export interface FiscalCloseCheckDefinition {
  key: string;
  title: string;
  description: string;
  blocking: boolean;
}

export const FISCAL_CLOSE_CHECKS: FiscalCloseCheckDefinition[] = [
  {
    key: 'dian_invoices_all_accepted',
    title: 'Facturación DIAN aceptada',
    description: 'No deben existir facturas electrónicas pendientes, rechazadas o con error en el periodo.',
    blocking: true,
  },
  {
    key: 'dian_credit_notes_all_accepted',
    title: 'Notas crédito/débito aceptadas',
    description: 'Las notas electrónicas del periodo deben estar aceptadas por DIAN.',
    blocking: true,
  },
  {
    key: 'support_documents_complete',
    title: 'Documento soporte completo',
    description: 'Los documentos soporte del periodo no deben quedar rechazados o pendientes.',
    blocking: true,
  },
  {
    key: 'payroll_electronic_complete',
    title: 'Nómina electrónica completa',
    description: 'La nómina electrónica activa debe estar transmitida o aceptada.',
    blocking: true,
  },
  {
    key: 'bank_reconciliations_complete',
    title: 'Bancos conciliados',
    description: 'Las conciliaciones bancarias del periodo deben estar completadas.',
    blocking: true,
  },
  {
    key: 'inventory_valuation_complete',
    title: 'Inventario valorizado',
    description: 'Debe existir valorización de inventario para el periodo.',
    blocking: true,
  },
  {
    key: 'tax_declarations_ready',
    title: 'Declaraciones aprobadas',
    description: 'Las declaraciones requeridas del periodo deben estar aprobadas, presentadas, aceptadas o pagadas.',
    blocking: true,
  },
  {
    key: 'journal_entries_posted',
    title: 'Asientos contabilizados',
    description: 'No deben existir asientos en borrador dentro del periodo.',
    blocking: true,
  },
  {
    key: 'trial_balance_balanced',
    title: 'Balance de prueba cuadrado',
    description: 'El total débito debe coincidir con el total crédito para el periodo.',
    blocking: true,
  },
  {
    key: 'accounts_receivable_reviewed',
    title: 'Cuentas por cobrar revisadas',
    description: 'Alertas sobre cartera vencida antes del cierre.',
    blocking: false,
  },
  {
    key: 'accounts_payable_reviewed',
    title: 'Cuentas por pagar revisadas',
    description: 'Alertas sobre obligaciones de proveedores vencidas antes del cierre.',
    blocking: false,
  },
];
