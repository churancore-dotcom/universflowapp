# Univers Flow release rules. Keep Capacitor plugin entry points available to reflection.
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}