import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgPurchaseOrdersService } from '@/features/org/services/org-purchase-orders.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function PurchaseOrdersList() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-purchase-orders-list'],
    queryFn: () => OrgPurchaseOrdersService.list({ pageSize: 100 }),
  });

  const pos = data ?? [];

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
        pos.length === 0
          ? { icon: 'shopping-bag', title: 'Sin órdenes de compra', message: 'Crea una orden de compra a un proveedor.' }
          : undefined
      }
    >
      {pos.map((p) => (
        <OrgListItem
          key={p.id}
          title={`#${p.po_number}`}
          subtitle={`${p.supplier_name} • ${p.store_name}`}
          description={`${p.total_items} items • ${p.total_quantity} unidades`}
          leftIcon="shopping-bag"
          rightValue={formatCurrency(p.total.amount)}
          rightBadge={
            p.status === 'RECEIVED'
              ? { label: 'Recibida', variant: 'success' }
              : p.status === 'APPROVED'
              ? { label: 'Aprobada', variant: 'info' }
              : p.status === 'PENDING'
              ? { label: 'Pendiente', variant: 'warning' }
              : p.status === 'CANCELLED'
              ? { label: 'Cancelada', variant: 'error' }
              : { label: p.status, variant: 'muted' }
          }
          rightMeta={new Date(p.order_date).toLocaleDateString()}
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
