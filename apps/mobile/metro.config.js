const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Bound release bundling workers on machines also running the Android emulator.
if (process.env.CHARGE_METRO_WORKERS) {
  config.maxWorkers = Math.max(1, Math.min(4, Number(process.env.CHARGE_METRO_WORKERS) || 2));
}

// Windows native builds pass an app-relative entry file. Keep shared workspace
// dependencies visible when the build script uses the app as Metro's server root.
if (process.env.EXPO_NO_METRO_WORKSPACE_ROOT === '1') {
  const workspaceRoot = path.resolve(__dirname, '../..');
  config.watchFolders = [...new Set([
    ...config.watchFolders,
    path.join(workspaceRoot, 'node_modules'),
    path.join(workspaceRoot, 'packages'),
    path.join(workspaceRoot, 'src'),
  ])];
  config.resolver.nodeModulesPaths = [
    path.join(__dirname, 'node_modules'),
    path.join(workspaceRoot, 'node_modules'),
  ];
}

module.exports = config;
