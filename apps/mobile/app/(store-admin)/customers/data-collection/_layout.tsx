import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

const TABS = [
  { id: 'fields', label: 'Campos', icon: 'database' },
  { id: 'templates', label: 'Plantillas', icon: 'layout-template' },
  { id: 'submissions', label: 'Formularios', icon: 'inbox' },
];

export default function DataCollectionLayout() {
  const router = useRouter();
  const segments = useSegments();

  const activeTab = segments.includes('templates')
    ? 'templates'
    : segments.includes('submissions')
      ? 'submissions'
      : 'fields';

  const handleTabChange = (tabId: string) => {
    router.push(`/(store-admin)/customers/data-collection/${tabId}` as never);
  };

  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabList}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                onPress={() => handleTabChange(tab.id)}
                style={[styles.tab, isActive && styles.tabActive]}
              >
                <Icon
                  name={tab.icon}
                  size={16}
                  color={isActive ? colors.primary : colorScales.gray[500]}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <Slot />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  tabBar: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  tabList: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    gap: spacing[1],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[500],
  },
  tabLabelActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});
