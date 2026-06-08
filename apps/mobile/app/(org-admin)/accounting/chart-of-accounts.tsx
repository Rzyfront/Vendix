import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgAccountingService } from '@/features/org/services/org-accounting.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgBadge } from '@/shared/components/org-badge';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

const TYPE_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'info' | 'primary' | 'muted' | 'neutral'> = {
  ASSET: 'info',
  LIABILITY: 'error',
  EQUITY: 'warning',
  INCOME: 'success',
  EXPENSE: 'muted',
};

export default function ChartOfAccountsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['org-accounting-coa'],
    queryFn: () => OrgAccountingService.listAccounts({ pageSize: 200 }),
  });

  const accounts = accountsQuery.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await accountsQuery.refetch();
    setRefreshing(false);
  };

  // Group by type
  const grouped: Record<string, typeof accounts> = {};
  accounts.forEach((a) => {
    if (!grouped[a.type]) grouped[a.type] = [];
    grouped[a.type].push(a);
  });

  return (
    <OrgPageContainer
      loading={accountsQuery.isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        accounts.length === 0
          ? { icon: 'book-open', title: 'Sin cuentas', message: 'Crea cuentas para iniciar el plan contable.' }
          : undefined
      }
    >
      {Object.entries(grouped).map(([type, list]) => (
        <View key={type} style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{type}</Text>
            <OrgBadge label={`${list.length}`} variant="muted" size="sm" />
          </View>
          {list.map((a) => (
            <OrgListItem
              key={a.id}
              title={a.name}
              subtitle={a.code}
              leftIcon={
                a.type === 'ASSET'
                  ? 'database'
                  : a.type === 'LIABILITY'
                  ? 'trending-down'
                  : a.type === 'EQUITY'
                  ? 'shield'
                  : a.type === 'INCOME'
                  ? 'trending-up'
                  : 'trending-down'
              }
              leftIconColor={
                a.type === 'ASSET' ? colorScales.blue[500] :
                a.type === 'LIABILITY' ? colorScales.red[500] :
                a.type === 'EQUITY' ? colorScales.amber[500] :
                a.type === 'INCOME' ? colorScales.green[500] :
                colorScales.gray[500]
              }
              rightBadge={
                a.is_active
                  ? { label: 'Activa', variant: 'success' }
                  : { label: 'Inactiva', variant: 'muted' }
              }
              chevron
            />
          ))}
        </View>
      ))}
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing[4] },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
  },
});
