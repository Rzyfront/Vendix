module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Wire the TypeScript path aliases defined in tsconfig.json into Metro
      // so imports like `@/shared/theme` and `@/core/api/query-client` resolve
      // at bundle time. Without this, Expo Go on Android throws
      // `Unable to resolve module @/...` during the initial bundle.
      [
        'module-resolver',
        {
          root: ['./'],
          extensions: [
            '.ios.ts',
            '.android.ts',
            '.ts',
            '.ios.tsx',
            '.android.tsx',
            '.tsx',
            '.jsx',
            '.js',
            '.json',
          ],
          alias: {
            // Only specific aliases — no bare `@` catch-all. The plugin's
            // internal matcher treats any `@/...` as a hit for `@` because
            // `startsWith('@/')` is true for all of them, which would
            // shadow these specifics and resolve them to `./src/...`
            // (wrong for `@/assets/vlogo.png`, `@/app/_layout.tsx`, etc.).
            '@/app': './app',
            '@/shared': './src/shared',
            '@/core': './src/core',
            '@/features': './src/features',
            '@/assets': './assets',
          },
        },
      ],
      // Reanimated 4 moved its babel plugin out of
      // `react-native-reanimated/plugin` and into `react-native-worklets`.
      // Required for Skia/Victory worklets to hoist correctly on Android.
      'react-native-worklets/plugin',
    ],
  };
};