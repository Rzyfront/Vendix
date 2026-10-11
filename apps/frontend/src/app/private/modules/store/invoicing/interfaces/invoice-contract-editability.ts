/** Contract-linked invoices inherit a frozen quote snapshot and are immutable in the editor. */
export function canEditContractInvoice(
  invoice: { contract_id?: number | null } | null | undefined,
): boolean {
  const contractId = invoice?.contract_id;
  return typeof contractId !== 'number' || !Number.isFinite(contractId) || contractId <= 0;
}
