import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInvoicingService } from '@/features/org/services/org-invoicing.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function InvoicesScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-invoicing-invoices'],
    queryFn: () => OrgInvoicingService.listInvoices({ pageSize: 100 }),
  });

  const invoices = data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        invoices.length === 0
          ? { icon: 'file-text', title: 'Sin facturas', message: 'No hay facturas emitidas.' }
          : undefined
      }
    >
      {invoices.map((i) => (
        <OrgListItem
          key={i.id}
          title={`${i.prefix ?? ''}${i.invoice_number}`}
          subtitle={i.customer_name}
          description={`${i.store_name} • ${new Date(i.issue_date).toLocaleDateString()}`}
          leftIcon="file-text"
          rightValue={formatCurrency(i.total.amount)}
          rightBadge={
            i.status === 'PAID'
              ? { label: 'Pagada', variant: 'success' }
              : i.status === 'OVERDUE'
              ? { label: 'Vencida', variant: 'error' }
              : i.status === 'ISSUED' || i.status === 'SENT'
              ? { label: 'Emitida', variant: 'info' }
              : i.status === 'VOIDED' || i.status === 'CANCELLED'
              ? { label: 'Anulada', variant: 'muted' }
              : { label: i.status, variant: 'warning' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
