import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.isecure.app',
  appName: 'iSecure',
  webDir: 'dist',
  backgroundColor: '#09090b',
  android: {
    allowMixedContent: false,
  },
};

export default config;
