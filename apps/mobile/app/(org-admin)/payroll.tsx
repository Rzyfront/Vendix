import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgPayrollService } from '@/features/org/services/org-payroll.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function PayrollScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['org-payroll-settings'],
    queryFn: () => OrgPayrollService.getSettings(),
  });
  const employeesQuery = useQuery({
    queryKey: ['org-payroll-employees'],
    queryFn: () => OrgPayrollService.listEmployees({ pageSize: 50 }),
  });
  const periodsQuery = useQuery({
    queryKey: ['org-payroll-periods'],
    queryFn: () => OrgPayrollService.listPeriods({ pageSize: 12 }),
  });

  const employees = employeesQuery.data ?? [];
  const periods = periodsQuery.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([settingsQuery.refetch(), employeesQuery.refetch(), periodsQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={employeesQuery.isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={styles.section}>
        <OrgStatsGrid
          columns={2}
          stats={[
            { label: 'Empleados', value: employees.length, icon: 'briefcase' },
            { label: 'Frecuencia', value: settingsQuery.data?.default_payment_frequency ?? '—', icon: 'clock' },
            { label: 'Periodos', value: periods.length, icon: 'calendar-clock' },
            { label: 'SMLV', value: settingsQuery.data?.smlv_value ? formatCurrency(settingsQuery.data.smlv_value.amount) : '—', icon: 'banknote' },
          ]}
        />
      </View>

      <View style={styles.section}>
        <OrgSectionHeader title="Periodos" />
        {periods.map((p) => (
          <OrgListItem
            key={p.id}
            title={p.name}
            subtitle={`${new Date(p.start_date).toLocaleDateString()} – ${new Date(p.end_date).toLocaleDateString()}`}
            leftIcon="calendar-clock"
            rightValue={formatCurrency(p.total_net.amount)}
            rightBadge={
              p.status === 'PAID'
                ? { label: 'Pagado', variant: 'success' }
                : p.status === 'PROCESSING'
                ? { label: 'Procesando', variant: 'warning' }
                : p.status === 'CLOSED'
                ? { label: 'Cerrado', variant: 'muted' }
                : { label: 'Abierto', variant: 'info' }
            }
            chevron
          />
        ))}
      </View>

      <View style={styles.section}>
        <OrgSectionHeader title="Empleados" subtitle={`${employees.length} registros`} />
        {employees.slice(0, 20).map((e) => (
          <OrgListItem
            key={e.id}
            title={e.full_name}
            subtitle={e.position}
            description={e.document_number}
            leftIcon="briefcase"
            rightValue={formatCurrency(e.base_salary.amount)}
            rightBadge={e.is_active ? { label: 'Activo', variant: 'success' } : { label: 'Inactivo', variant: 'muted' }}
            chevron={false}
          />
        ))}
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing[4] },
});
