import { Platform } from 'react-native';

type PlatformType = 'ios' | 'android' | 'web';

export const isIOS: boolean = Platform.OS === 'ios';
export const isAndroid: boolean = Platform.OS === 'android';
export const isWeb: boolean = Platform.OS === 'web';
export const platform: PlatformType = Platform.OS as PlatformType;

export const isMobile: boolean = isIOS || isAndroid;

export function getPlatform(): PlatformType {
  return Platform.OS as PlatformType;
}

export function isIphone(): boolean {
  return isIOS;
}

export function isIpad(): boolean {
  return isIOS && Platform.osVersion?.includes('iPad');
}

export function select<T>(options: { ios?: T; android?: T; web?: T; default?: T }): T | undefined {
  if (isIOS && options.ios !== undefined) return options.ios;
  if (isAndroid && options.android !== undefined) return options.android;
  if (isWeb && options.web !== undefined) return options.web;
  return options.default;
}

export const androidVersion = Platform.Version;
export const iosVersion = (Platform as any).osVersion;
