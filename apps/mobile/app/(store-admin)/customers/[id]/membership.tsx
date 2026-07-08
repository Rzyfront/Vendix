import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MembershipService } from '@/features/store/services/membership.service';
import { formatDate } from '@/shared/utils/date';
import { Avatar } from '@/shared/components/avatar/avatar';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

export default function MembershipProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['customer-membership', id],
    queryFn: () => MembershipService.getProfile(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <Spinner />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.loading}>
        <View style={styles.emptyState}>
          <Icon name="dumbbell" size={48} color={colorScales.gray[300]} />
          <Text style={styles.emptyTitle}>Sin membresía</Text>
          <Text style={styles.emptyText}>
            Este cliente no tiene un perfil de socio registrado.
          </Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Volver</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const fields: { label: string; value: string | undefined; icon: string }[] = [
    { label: 'Número de socio', value: profile.member_number, icon: 'hash' },
    { label: 'Fecha de ingreso', value: profile.join_date ? formatDate(profile.join_date) : undefined, icon: 'calendar' },
    { label: 'Plan', value: profile.plan_name, icon: 'package' },
    { label: 'Estado', value: profile.status, icon: 'check-circle' },
  ].filter((f) => f.value);

  return (
    <View style={styles.root}>
      <View style={styles.stickyHeader}>
        <Pressable onPress={() => router.back()} style={styles.backArrow}>
          <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Perfil de socio</Text>
          <Text style={styles.headerSub}>Cliente #{id}</Text>
        </View>
        <Badge
          label={profile.status ?? 'Activo'}
          variant={profile.status === 'active' ? 'success' : 'neutral'}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.profileCard}>
          <View style={styles.avatarSection}>
            <Avatar name={`Socio ${id}`} size="xl" />
            <View style={styles.avatarInfo}>
              <Text style={styles.memberName}>Socio #{profile.member_number || id}</Text>
              <Text style={styles.memberPlan}>{profile.plan_name || 'Sin plan'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Icon name="clipboard-list" size={18} color={colors.primary} />
            <Text style={styles.infoTitle}>Datos del socio</Text>
          </View>
          {fields.map((field) => (
            <View key={field.label} style={styles.infoRow}>
              <View style={styles.infoLeft}>
                <Icon name={field.icon as any} size={14} color={colorScales.gray[400]} />
                <Text style={styles.infoLabel}>{field.label}</Text>
              </View>
              <Text style={styles.infoValue}>{field.value}</Text>
            </View>
          ))}

          {/* Extra data fields from extra_data */}
          {Object.entries(profile).map(([key, value]) => {
            if (['id', 'customer_id', 'member_number', 'join_date', 'plan_id', 'plan_name', 'status'].includes(key)) return null;
            if (!value) return null;
            return (
              <View key={key} style={styles.infoRow}>
                <View style={styles.infoLeft}>
                  <Icon name="info" size={14} color={colorScales.gray[400]} />
                  <Text style={styles.infoLabel}>{key.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={styles.infoValue}>{String(value)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[8],
  },
  emptyTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
  backBtn: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[6],
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100],
  },
  backBtnText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium as any,
  },
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    gap: spacing[3],
  },
  backArrow: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  headerSub: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  body: {
    padding: spacing[4],
    gap: spacing[4],
  },
  profileCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  avatarInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  memberPlan: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  infoTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  infoLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
  },
});
