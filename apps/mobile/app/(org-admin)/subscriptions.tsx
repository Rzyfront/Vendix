import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgSubscriptionsService } from '@/features/org/services/org-subscriptions.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function SubscriptionsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const currentQuery = useQuery({
    queryKey: ['org-subscription-current'],
    queryFn: () => OrgSubscriptionsService.getCurrent(),
  });
  const usageQuery = useQuery({
    queryKey: ['org-subscription-usage'],
    queryFn: () => OrgSubscriptionsService.getUsage(),
  });
  const plansQuery = useQuery({
    queryKey: ['org-subscription-plans'],
    queryFn: () => OrgSubscriptionsService.listPlans(),
  });

  const sub = currentQuery.data;
  const usage = usageQuery.data;
  const plans = plansQuery.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([currentQuery.refetch(), usageQuery.refetch(), plansQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={currentQuery.isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {sub ? (
        <View style={styles.section}>
          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>Plan actual</Text>
            <Text style={styles.currentPlan}>{sub.plan_name}</Text>
            <Text style={styles.currentPrice}>{formatCurrency(sub.amount.amount)}</Text>
            <View style={styles.currentMeta}>
              <Text style={styles.metaItem}>
                Estado: <Text style={styles.metaValue}>{sub.status}</Text>
              </Text>
              <Text style={styles.metaItem}>
                Próximo cobro: <Text style={styles.metaValue}>
                  {sub.next_billing_date ? new Date(sub.next_billing_date).toLocaleDateString() : '—'}
                </Text>
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {usage && usage.metrics?.length ? (
        <View style={styles.section}>
          <OrgSectionHeader title="Uso del plan" subtitle="Métricas del periodo actual" />
          <StatsGrid
            items={usage.metrics.map((m) => ({
              label: m.label,
              value: `${m.used}/${m.limit}`,
              icon: 'bar-chart',
            }))}
          />
        </View>
      ) : null}

      {plans.length > 0 ? (
        <View style={styles.section}>
          <OrgSectionHeader title="Planes disponibles" />
          {plans.map((p) => (
            <OrgListItem
              key={p.id}
              title={p.name}
              subtitle={p.description}
              leftIcon="credit-card"
              rightValue={formatCurrency(p.price.amount)}
              rightBadge={p.is_popular ? { label: 'Popular', variant: 'primary' } : undefined}
              chevron
            />
          ))}
        </View>
      ) : null}
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing[4] },
  currentCard: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: spacing[4],
  },
  currentLabel: {
    fontSize: typography.fontSize.xs,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    fontWeight: typography.fontWeight.semibold,
  },
  currentPlan: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: '#fff',
    marginTop: spacing[1],
  },
  currentPrice: {
    fontSize: typography.fontSize.lg,
    color: 'rgba(255,255,255,0.9)',
    marginTop: spacing[1],
  },
  currentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[3],
  },
  metaItem: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: typography.fontSize.xs,
  },
  metaValue: {
    fontWeight: typography.fontWeight.semibold,
  },
});
