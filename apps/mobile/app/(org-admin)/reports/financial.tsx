import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgReportsService } from '@/features/org/services/org-reports.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

function lastMonthRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) };
}

export default function FinancialReportScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const filter = lastMonthRange();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-reports-financial', filter],
    queryFn: () => OrgReportsService.getFinancial(filter),
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
        <Text style={styles.title}>Reporte Financiero</Text>
        <Text style={styles.subtitle}>{filter.start_date} – {filter.end_date}</Text>

        {data ? (
          <>
            <View style={styles.section}>
              <StatsGrid
                items={[
                  { label: 'Ingresos', value: formatCurrency(data.revenue.amount), icon: 'trending-up', iconColor: colors.success, iconBg: colors.success + '15' },
                  { label: 'Costos', value: formatCurrency(data.cogs.amount), icon: 'package', iconColor: colorScales.amber[500], iconBg: colorScales.amber[500] + '15' },
                  { label: 'Utilidad bruta', value: formatCurrency(data.gross_profit.amount), icon: 'dollar-sign' },
                  { label: 'Utilidad neta', value: formatCurrency(data.net_income.amount), icon: 'check-circle', iconColor: data.net_income.amount > 0 ? colors.success : colors.error, iconBg: (data.net_income.amount > 0 ? colors.success : colors.error) + '15' },
                ]}
              />
            </View>

            {data.income_statement?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Estado de resultados</Text>
                <Card>
                  {data.income_statement.map((row, i) => (
                    <OrgListItem
                      key={i}
                      title={row.account}
                      rightValue={formatCurrency(row.amount.amount)}
                      chevron={false}
                    />
                  ))}
                </Card>
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={styles.muted}>No hay datos para el periodo.</Text>
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
  title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold, color: colorScales.gray[900] },
  subtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2, marginBottom: spacing[4] },
  section: { marginBottom: spacing[4] },
  sectionTitle: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colorScales.gray[500], textTransform: 'uppercase', marginBottom: spacing[2] },
  muted: { color: colorScales.gray[500], textAlign: 'center' },
});
