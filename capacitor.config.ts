import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Native Android package — must match android/app/src/main/java/com/universeflow/app
  appId: 'com.universeflow.app',
  appName: 'Univers Flow',
  webDir: 'dist/client',
  server: {
    // Production-safe default: APKs must load the bundled dist assets, not a
    // remote Lovable/dev server. Shipping server.url caused downloaded APKs to
    // run mismatched web/native code, which broke playback plugins and made all
    // songs fail. Use capacitor.config.dev.ts locally if hot-reload is needed.
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
      showSpinner: false,
      androidSpinnerStyle: 'small',
      iosSpinnerStyle: 'small',
      spinnerColor: '#FF2D55',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#000000',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    scheme: 'UniversFlow',
  },
  android: {
    backgroundColor: '#000000',
    allowMixedContent: true,
    // captureInput must be FALSE — true breaks IME composition (emoji
    // keyboard, swipe typing, autocomplete/autosuggest) inside the WebView.
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
  // Disable JS hijacking the hardware back button while media plays.
  // @ts-expect-error supported by the Android runtime even if absent from older type defs
  hardwareBackButton: false,
};

export default config;
