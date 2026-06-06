import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

export default function PaymentMethodsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-payment-methods'],
    queryFn: () => OrgConfigService.listPaymentMethods({ pageSize: 100 }),
  });

  const methods = data ?? [];

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
        methods.length === 0
          ? { icon: 'credit-card', title: 'Sin métodos de pago', message: 'Configura los métodos de pago aceptados.' }
          : undefined
      }
    >
      {methods.map((m) => (
        <OrgListItem
          key={m.id}
          title={m.name}
          subtitle={m.code}
          description={`Tipo: ${m.type}${m.provider ? ` • ${m.provider}` : ''}`}
          leftIcon={
            m.type === 'CASH'
              ? 'banknote'
              : m.type === 'CARD'
              ? 'credit-card'
              : m.type === 'TRANSFER'
              ? 'arrow-left-right'
              : m.type === 'DIGITAL_WALLET'
              ? 'smartphone'
              : 'circle-dollar-sign'
          }
          rightBadge={
            m.is_active
              ? { label: 'Activo', variant: 'success' }
              : { label: 'Inactivo', variant: 'muted' }
          }
          chevron
        />
      ))}
    </OrgPageContainer>
  );
}
