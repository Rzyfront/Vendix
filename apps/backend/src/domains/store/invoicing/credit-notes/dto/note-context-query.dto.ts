import { IsIn } from 'class-validator';

export const INVOICE_NOTE_TYPES = ['credit_note', 'debit_note'] as const;
export type InvoiceNoteType = (typeof INVOICE_NOTE_TYPES)[number];

/** Query contract for fetching server-calculated note defaults and balances. */
export class NoteContextQueryDto {
  @IsIn(INVOICE_NOTE_TYPES, {
    message: 'note_type debe ser credit_note o debit_note.',
  })
  note_type!: InvoiceNoteType;
}
