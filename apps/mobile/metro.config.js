const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_conditionsByPlatform.web = ['react-native', 'browser'];
config.resolver.extraNodeModules = new Proxy(
  { punycode: require.resolve('punycode') },
  {
    // For any other module name (defensive), fall back to the local
    // node_modules. This keeps `xlsx`/`punycode` working on Android/Hermes
    // where the default Metro resolution can miss the polyfill.
    get: (target, name) =>
      target[name] ?? path.join(__dirname, 'node_modules', name),
  },
);

module.exports = config;
