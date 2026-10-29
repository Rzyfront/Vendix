/** H4.4 — one revenue line of the Fontur report: a room type or the other guest charges. */
export interface LodgingFonturLine {
  key: string;
  label: string;
  kind: 'lodging' | 'other';
  /** Distinct invoices, notes and closed guest accounts with a line here. */
  documents: number;
  /** Income before taxes, net of credit notes. */
  base: number;
}

/** H4.4 — invoiced income of the quarter and the estimated Fontur contribution. */
export interface LodgingFonturReport {
  year: number;
  quarter: number;
  from: string;
  to: string;
  timezone: string;
  /** Contribution rate in per mil (‰), from Configuración → Hotelería. */
  rate_per_mil: number;
  lines: LodgingFonturLine[];
  totals: {
    documents: number;
    /** Of those, guest accounts closed as a sale without electronic invoice. */
    without_invoice: number;
    base: number;
    contribution: number;
  };
}
