import { RefreshControl, ScrollView, type ScrollViewProps } from 'react-native';

interface PullToRefreshProps extends ScrollViewProps {
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}

export function PullToRefresh({
  refreshing,
  onRefresh,
  children,
  ...props
}: PullToRefreshProps) {
  return (
    <ScrollView
      {...props}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#2F6F4E"
          colors={['#2F6F4E']}
        />
      }
    >
      {children}
    </ScrollView>
  );
}
