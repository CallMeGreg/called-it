const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_LOCAL_PLAYGROUND === '1') {
  // Static dev exports have no Metro server. Keep Fast Refresh's JS setup, not its network bootstraps.
  const networkBootstraps = new Set([
    require.resolve('expo/src/async-require/setupHMR.ts'),
    require.resolve('expo/src/async-require/messageSocket.ts'),
  ]);
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolution = context.resolveRequest(context, moduleName, platform);
    if (platform === 'web' && resolution.type === 'sourceFile' && networkBootstraps.has(resolution.filePath)) {
      return { type: 'empty' };
    }
    return resolution;
  };
}

module.exports = config;
