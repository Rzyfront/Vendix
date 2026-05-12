import { useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AccountingService } from '@/features/store/services/accounting.service';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { spacing, borderRadius, colorScales, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

interface QuickNavLink {
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  color: string;
  bgColor: string;
}

const QUICK_LINKS: QuickNavLink[] = [
  { title: 'Plan de Cuentas', subtitle: 'Cuentas y estructura PUC', icon: 'list-tree', route: 'chart-of-accounts', color: colorScales.blue[600], bgColor: colorScales.blue[50] },
  { title: 'Asientos Contables', subtitle: 'Registros y movimientos', icon: 'book-open', route: 'journal-entries', color: colorScales.green[600], bgColor: colorScales.green[50] },
  { title: 'Períodos Fiscales', subtitle: 'Gestión de períodos', icon: 'calendar', route: 'fiscal-periods', color: colorScales.amber[600], bgColor: colorScales.amber[50] },
  { title: 'Cuentas por Cobrar', subtitle: 'Cartera de clientes', icon: 'trending-up', route: 'receivables', color: colorScales.blue[600], bgColor: colorScales.blue[50] },
  { title: 'Cuentas por Pagar', subtitle: 'Obligaciones con proveedores', icon: 'trending-down', route: 'payables', color: colorScales.red[600], bgColor: colorScales.red[50] },
];

export default function AccountingIndex() {
  const router = useRouter();

  const { data: jeData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['accounting-journal-entries-summary'],
    queryFn: () => AccountingService.getJournalEntries({ page: 1, limit: 1 }),
  });

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleNav = (route: string) => {
    router.push(`/(store-admin)/accounting/${route}` as never);
  };

  const totalEntries = jeData?.pagination?.total ?? 0;

  return (
    <View style={styles.container}>
      <FlatList
        data={[]}
        keyExtractor={() => 'spacer'}
        renderItem={() => null}
        ListHeaderComponent={
          <View>
            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: 'Total Asientos',
                  value: totalEntries,
                  icon: <Icon name="book-open" size={14} color={colorScales.blue[600]} />,
                },
                {
                  label: 'Módulos',
                  value: 5,
                  icon: <Icon name="layers" size={14} color={colorScales.green[600]} />,
                },
              ]}
            />

            <Text style={styles.sectionTitle}>Módulos</Text>

            <View style={styles.navSection}>
              {QUICK_LINKS.map((item) => (
                <Pressable key={item.route} onPress={() => handleNav(item.route)} style={styles.navPressable}>
                  <Card style={StyleSheet.flatten([styles.navCard, { borderLeftWidth: 4, borderLeftColor: item.color }])}>
                    <View style={styles.navContent}>
                      <View style={[styles.navIcon, { backgroundColor: item.bgColor }]}>
                        <Icon name={item.icon} size={20} color={item.color} />
                      </View>
                      <View style={styles.navTextWrap}>
                        <Text style={styles.navTitle}>{item.title}</Text>
                        <Text style={styles.navSubtitle}>{item.subtitle}</Text>
                      </View>
                      <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as never,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  navSection: {
    paddingHorizontal: spacing[4],
  },
  navPressable: {
    marginBottom: spacing[3],
  },
  navCard: {
    overflow: 'hidden',
  },
  navContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    gap: spacing[3],
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTextWrap: {
    flex: 1,
  },
  navTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as never,
    color: colorScales.gray[900],
  },
  navSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  statsWrap: {
    paddingHorizontal: spacing[4],
  },
});
