import React, { type ReactNode } from 'react';
import { View, StyleSheet, RefreshControl, ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, colorScales, spacing } from '@/shared/theme';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';

interface OrgPageContainerProps {
  children?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  scrollable?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  empty?: {
    icon?: string;
    title: string;
    description?: string;
    message?: string;
    actionLabel?: string;
    onAction?: () => void;
  };
  padding?: boolean;
}

export function OrgPageContainer({
  children,
  loading = false,
  refreshing = false,
  onRefresh,
  scrollable = true,
  contentContainerStyle,
  empty,
  padding = true,
}: OrgPageContainerProps) {
  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const content = (
    <>
      {empty ? (
        <EmptyState
          icon={empty.icon as any}
          title={empty.title}
          description={empty.message || empty.description}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
        />
      ) : (
        children
      )}
    </>
  );

  if (!scrollable) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={[styles.body, padding && styles.padding]}>{content}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          padding && styles.padding,
          contentContainerStyle,
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
      >
        {content}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  padding: {
    padding: spacing[4],
  },
  body: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
});
