import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

interface SettingTile {
  key: string;
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  href: string;
  badge?: string;
  badgeVariant?: 'primary' | 'warning' | 'muted';
}

const SETTINGS_TILES: SettingTile[] = [
  {
    key: 'operating-scope',
    title: 'Modo operativo',
    description:
      'Cambia entre operación por tienda (inventario independiente) o consolidada a nivel de organización.',
    icon: 'building-2',
    iconColor: colors.primary,
    iconBg: colorScales.green[100],
    href: '/(org-admin)/settings/operating-scope',
  },
];

/**
 * Hub de Configuración (paridad con la sección Configuración del sidebar web).
 *
 * Lista las sub-secciones operativas disponibles a nivel de organización.
 * Por ahora solo se expone "Modo Operativo" — el resto del módulo fiscal
 * (modo fiscal, datos fiscales, wizard DIAN) se omite por alcance mobile v1.
 */
export default function SettingsHubScreen() {
  const router = useRouter();

  const onPress = (href: string) => {
    router.push(href as never);
  };

  return (
    <OrgPageContainer>
      <View style={styles.intro}>
        <Text style={styles.title}>Configuración</Text>
        <Text style={styles.subtitle}>
          Ajustes operativos que afectan toda la organización. Los cambios aquí impactan a todas las tiendas activas.
        </Text>
      </View>

      {SETTINGS_TILES.map((tile) => (
        <Pressable
          key={tile.key}
          style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          onPress={() => onPress(tile.href)}
        >
          <View style={[styles.tileIcon, { backgroundColor: tile.iconBg }]}>
            <Icon name={tile.icon} size={22} color={tile.iconColor} />
          </View>
          <View style={styles.tileBody}>
            <Text style={styles.tileTitle}>{tile.title}</Text>
            <Text style={styles.tileDescription} numberOfLines={2}>
              {tile.description}
            </Text>
          </View>
          <Icon name="chevron-right" size={18} color={colorScales.gray[400]} />
        </Pressable>
      ))}

      <View style={styles.scopeNote}>
        <Icon name="info" size={14} color={colorScales.gray[500]} />
        <Text style={styles.scopeNoteText}>
          La configuración fiscal (DIAN, modo fiscal, datos tributarios) se administra desde el panel web.
        </Text>
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  intro: {
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[4],
    marginBottom: spacing[2],
  },
  tilePressed: {
    backgroundColor: colorScales.gray[50],
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: {
    flex: 1,
  },
  tileTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  tileDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
  scopeNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingHorizontal: spacing[2],
  },
  scopeNoteText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
});