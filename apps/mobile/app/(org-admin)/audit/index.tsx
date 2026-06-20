import { useRouter } from 'expo-router';
import { ScrollView, Text, View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

/**
 * Hub de Auditoría y Cumplimiento.
 *
 * Espejo de `audit.component.ts` (web): cuatro tarjetas que navegan a las
 * tres pantallas que existen en este momento (registros / intentos de
 * login / sesiones) + una cuarta "Informes de cumplimiento" marcada como
 * próximamente. Cuando exista el cuarto módulo en el backend, basta con
 * reemplazar el Pressable deshabilitado por un `router.push(...)`.
 */
export default function AuditHubScreen() {
  const router = useRouter();

  const cards: Array<{
    key: string;
    title: string;
    description: string;
    icon: string;
    color: string;
    route?: string;
    comingSoon?: boolean;
  }> = [
    {
      key: 'logs',
      title: 'Registros de auditoría',
      description: 'Eventos auditables de la organización con filtros y exportación.',
      icon: 'history',
      color: colors.primary,
      route: '/(org-admin)/audit/logs',
    },
    {
      key: 'login',
      title: 'Intentos de Login',
      description: 'Histórico de autenticaciones exitosas y fallidas por usuario.',
      icon: 'log-in',
      color: colorScales.blue[600],
      route: '/(org-admin)/audit/login-attempts',
    },
    {
      key: 'sessions',
      title: 'Sesiones',
      description: 'Sesiones activas de usuarios con opción de terminarlas.',
      icon: 'monitor',
      color: colorScales.blue[700],
      route: '/(org-admin)/audit/sessions',
    },
    {
      key: 'compliance',
      title: 'Informes de cumplimiento',
      description: 'Reportes regulatorios y fiscales (próximamente).',
      icon: 'shield-check',
      color: colorScales.amber[600],
      comingSoon: true,
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Auditoría y Cumplimiento</Text>
        <Text style={styles.subtitle}>
          Supervisa la actividad, accesos e identidad de los usuarios de la organización.
        </Text>

        <View style={styles.grid}>
          {cards.map((card) => {
            const Container: any = card.route ? Pressable : View;
            return (
              <Container
                key={card.key}
                style={[styles.card, card.comingSoon && styles.cardDisabled]}
                disabled={!card.route}
                onPress={card.route ? () => router.push(card.route as any) : undefined}
              >
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: card.color + '15' },
                  ]}
                >
                  <Icon name={card.icon} size={22} color={card.color} />
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {card.title}
                </Text>
                <Text style={styles.cardDescription} numberOfLines={3}>
                  {card.description}
                </Text>
                {card.comingSoon ? (
                  <View style={styles.badgeSoon}>
                    <Text style={styles.badgeSoonText}>Próximamente</Text>
                  </View>
                ) : (
                  <View style={styles.cardFooter}>
                    <Text style={styles.cardCta}>Abrir</Text>
                    <Icon name="chevron-right" size={16} color={card.color} />
                  </View>
                )}
              </Container>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
    marginBottom: spacing[5],
  },
  grid: {
    gap: spacing[3],
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[4],
  },
  cardDisabled: {
    opacity: 0.6,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  cardDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
    lineHeight: 19,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing[3],
    gap: spacing[1],
  },
  cardCta: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.primary,
  },
  badgeSoon: {
    alignSelf: 'flex-start',
    marginTop: spacing[3],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.amber[100],
  },
  badgeSoonText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.amber[700],
  },
});
