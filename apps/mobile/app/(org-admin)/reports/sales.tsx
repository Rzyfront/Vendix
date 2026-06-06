import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgReportsService } from '@/features/org/services/org-reports.service';
import { Card } from '@/shared/components/card/card';
import { Spinner } from '@/shared/components/spinner/spinner';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgListItem } from '@/shared/components/org-list-item';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

function lastMonthRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

export default function SalesReportScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const filter = lastMonthRange();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-reports-sales', filter],
    queryFn: () => OrgReportsService.getSales(filter),
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
        <Text style={styles.title}>Reporte de Ventas</Text>
        <Text style={styles.subtitle}>
          {filter.start_date} – {filter.end_date}
        </Text>

        {data ? (
          <>
            <View style={styles.section}>
              <OrgStatsGrid
                columns={2}
                stats={[
                  { label: 'Ventas totales', value: formatCurrency(data.total_sales.amount), icon: 'dollar-sign', color: colors.success },
                  { label: 'Órdenes', value: data.total_orders, icon: 'clipboard-list' },
                  { label: 'Ticket promedio', value: formatCurrency(data.average_ticket.amount), icon: 'trending-up' },
                  { label: 'Tendencia', value: `${data.change_percent > 0 ? '+' : ''}${data.change_percent.toFixed(1)}%`, icon: data.trend === 'up' ? 'trending-up' : data.trend === 'down' ? 'trending-down' : 'minus', color: data.trend === 'up' ? colors.success : data.trend === 'down' ? colors.error : undefined },
                ]}
              />
            </View>

            {data.top_products?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Top productos</Text>
                {data.top_products.slice(0, 10).map((p, i) => (
                  <OrgListItem
                    key={i}
                    title={p.product_name}
                    subtitle={`${p.quantity} unidades`}
                    leftIcon="package"
                    rightValue={formatCurrency(p.total.amount)}
                    chevron={false}
                  />
                ))}
              </View>
            ) : null}

            {data.by_channel?.length ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Por canal</Text>
                {data.by_channel.map((c, i) => (
                  <OrgListItem
                    key={i}
                    title={c.channel}
                    subtitle={`${c.orders} órdenes`}
                    leftIcon="layout-grid"
                    rightValue={formatCurrency(c.total.amount)}
                    chevron={false}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <Text style={styles.muted}>No hay datos para el periodo seleccionado.</Text>
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
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  muted: { color: colorScales.gray[500], textAlign: 'center' },
});
