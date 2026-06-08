import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgFiscalService } from '@/features/org/services/org-fiscal.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function FiscalDashboard() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-fiscal-dashboard'],
    queryFn: () => OrgFiscalService.getDashboard(),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={styles.title}>Dashboard Fiscal</Text>

        {data ? (
          <>
            <View style={styles.section}>
              <OrgStatsGrid
                columns={2}
                stats={[
                  { label: 'Obligaciones', value: data.total_obligations, icon: 'clipboard-list' },
                  { label: 'Pendientes', value: data.pending_obligations, icon: 'clock', color: colorScales.amber[500] },
                  { label: 'Vencidas', value: data.overdue, icon: 'alert-triangle', color: colors.error },
                  { label: 'Impuestos año', value: formatCurrency(data.total_taxes_paid_year.amount), icon: 'dollar-sign', color: colors.success },
                ]}
              />
            </View>

            {data.alerts?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Alertas</Text>
                {data.alerts.map((a) => (
                  <OrgListItem
                    key={a.id}
                    title={a.title}
                    subtitle={a.due_date ? new Date(a.due_date).toLocaleDateString() : undefined}
                    description={a.description}
                    leftIcon={
                      a.type === 'DEADLINE' ? 'clock' :
                      a.type === 'OVERDUE' ? 'alert-triangle' :
                      a.type === 'WARNING' ? 'alert-triangle' :
                      'info'
                    }
                    leftIconColor={
                      a.severity === 'HIGH' ? colors.error :
                      a.severity === 'MEDIUM' ? colorScales.amber[500] :
                      colorScales.blue[500]
                    }
                    rightBadge={{
                      label: a.severity,
                      variant: a.severity === 'HIGH' ? 'error' : a.severity === 'MEDIUM' ? 'warning' : 'info',
                    }}
                    chevron={false}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={styles.muted}>No hay datos disponibles.</Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { padding: spacing[4] },
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900], marginBottom: spacing[4] },
  section: { marginBottom: spacing[4] },
  sectionTitle: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[500], textTransform: 'uppercase', marginBottom: spacing[2] },
  muted: { color: colorScales.gray[500], textAlign: 'center' },
});
