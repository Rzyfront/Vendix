import { DispatchNoteStatus } from '../interfaces/dispatch-note.interface';

export const STATUS_LABELS: Record<DispatchNoteStatus, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  delivered: 'Entregada',
  invoiced: 'Facturada',
  voided: 'Anulada',
};

export const STATUS_COLORS: Record<DispatchNoteStatus, string> = {
  draft: '#6b7280',
  confirmed: '#3b82f6',
  delivered: '#10b981',
  invoiced: '#8b5cf6',
  voided: '#ef4444',
};

export const STATUS_BG_CLASSES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  confirmed: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  invoiced: 'bg-purple-100 text-purple-800',
  voided: 'bg-red-100 text-red-800',
};
