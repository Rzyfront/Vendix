import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';

type ContractLifecycleClient = Pick<Prisma.TransactionClient, 'contracts'>;

interface FiscalAcceptanceInvoice {
  contract_id?: number | null;
  store_id?: number | null;
  organization_id?: number | null;
  status?: string | null;
  accepted_at?: Date | null;
  cufe?: string | null;
}

/**
 * Reconciles the contract status from authoritative fiscal acceptance evidence.
 * Drafts, rejected/timed-out invoices and incomplete acceptance records are
 * intentionally ignored. Tenant predicates and updated_at form a guarded CAS.
 */
export async function markContractFiscalAcceptance(
  client: ContractLifecycleClient,
  invoice: FiscalAcceptanceInvoice,
): Promise<void> {
  const contract_id = invoice.contract_id;
  if (
    contract_id == null ||
    invoice.status !== 'accepted' ||
    !invoice.accepted_at ||
    !invoice.cufe?.trim()
  ) {
    return;
  }

  const store_id = invoice.store_id;
  const organization_id = invoice.organization_id;
  if (store_id == null || organization_id == null) {
    throw new VendixHttpException(
      ErrorCodes.CONTRACT_STATUS_001,
      'No se puede sincronizar el contrato con la aceptación fiscal porque faltan los datos de tienda u organización. Revisa el contexto de la factura y vuelve a intentar.',
      { contract_id, store_id: store_id ?? null, organization_id: organization_id ?? null },
    );
  }

  // Retry once if an unrelated contract edit wins the compare-and-set race.
  // If another acceptance already changed active -> invoiced, the next read is
  // an idempotent success and no accounting/event side effects are repeated.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const contract = await client.contracts.findFirst({
      where: { id: contract_id, store_id, organization_id },
      select: { status: true, updated_at: true },
    });

    if (!contract) {
      throw new VendixHttpException(
        ErrorCodes.CONTRACT_STATUS_001,
        'No se encontró el contrato de esta factura dentro de la tienda y organización actuales. No se modificó ningún contrato; verifica la relación y vuelve a intentar.',
        { contract_id, store_id, organization_id },
      );
    }
    if (contract.status === 'invoiced') return;
    if (contract.status !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.CONTRACT_STATUS_001,
        `La factura fue aceptada fiscalmente, pero el contrato no está vigente (estado actual: ${contract.status}). Revisa el contrato antes de conciliarlo.`,
        { contract_id, contract_status: contract.status },
      );
    }

    const result = await client.contracts.updateMany({
      where: {
        id: contract_id,
        store_id,
        organization_id,
        status: 'active',
        updated_at: contract.updated_at,
      },
      data: { status: 'invoiced', updated_at: new Date() },
    });
    if (result.count > 0) return;
  }

  throw new VendixHttpException(
    ErrorCodes.CONTRACT_STATUS_001,
    'La aceptación fiscal quedó registrada, pero el contrato cambió durante la sincronización. Vuelve a consultar la factura para reparar su estado contractual.',
    { contract_id },
  );
}
