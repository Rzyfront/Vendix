import { useRouter } from 'expo-router';
import { ScrollView, Text, View, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

/**
 * Hub de Auditoría y Cumplimiento.
 *
 * Espejo de `audit.component.ts` (web): grid simple de tarjetas que
 * navegan a las 4 pantallas del módulo. La web usa `grid-cols-1 md:2 lg:4`
 * con cada tarjeta como un `<a routerLink>` plano (sin íconos grandes,
 * sin badges, sin CTAs). Acá lo replicamos con `Pressable` + `Card`.
 */
export default function AuditHubScreen() {
  const router = useRouter();

  const cards: Array<{
    key: string;
    title: string;
    description: string;
    icon: string;
    route: string;
    color: string;
  }> = [
    {
      key: 'logs',
      title: 'Registros de auditoría',
      description: 'Ver registros de auditoría del sistema',
      icon: 'history',
      color: colors.primary,
      route: '/(org-admin)/audit/logs',
    },
    {
      key: 'login',
      title: 'Intentos de Login',
      description: 'Monitoreo de intentos de inicio de sesión',
      icon: 'log-in',
      color: colorScales.blue[600],
      route: '/(org-admin)/audit/login-attempts',
    },
    {
      key: 'sessions',
      title: 'Sesiones',
      description: 'Gestión de sesiones de usuarios',
      icon: 'monitor',
      color: colorScales.blue[700],
      route: '/(org-admin)/audit/sessions',
    },
    {
      key: 'compliance',
      title: 'Informes de cumplimiento',
      description: 'Monitoreo de cumplimiento',
      icon: 'shield-check',
      color: colorScales.amber[600],
      route: '/(org-admin)/audit/compliance',
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
          Supervisa la actividad, accesos e identidad de los usuarios de la
          organización.
        </Text>

        <View style={styles.grid}>
          {cards.map((card) => (
            <Card
              key={card.key}
              style={styles.card}
              onPress={() => router.push(card.route as any)}
            >
              <View style={styles.cardHeader}>
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: card.color + '15' },
                  ]}
                >
                  <Icon name={card.icon} size={18} color={card.color} />
                </View>
                <Icon
                  name="chevron-right"
                  size={16}
                  color={colorScales.gray[400]}
                />
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {card.title}
              </Text>
              <Text style={styles.cardDescription} numberOfLines={2}>
                {card.description}
              </Text>
            </Card>
          ))}
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
    fontSize: typography.fontSize['2xl'] ?? 22,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[1],
    marginBottom: spacing[5],
  },
  // Grid: 1 col mobile, 2 col >=600px, 4 col >=1024px.
  // Usamos un @media-style con onLayout no es necesario; en su lugar,
  // el grid responde vía `flexBasis: 50%/100%` con un simple cambio de fila.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing[2],
  },
  card: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '100%',
    marginHorizontal: spacing[1],
    marginBottom: spacing[3],
    padding: spacing[4],
    minHeight: 110,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  cardDescription: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    lineHeight: 19,
  },
});
