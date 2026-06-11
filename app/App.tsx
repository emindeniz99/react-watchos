import { StyleSheet, Text, View } from "react-native";

/**
 * Companion iOS app. The interesting part runs on the watch: React +
 * QuickJS render targets/watch via the custom reconciler in ../js.
 * This screen exists so the watch target has a host app and a future
 * WatchConnectivity link has somewhere to live.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>React Watch Demo</Text>
      <Text style={styles.body}>
        Open the watch app — its UI is rendered by React running inside
        QuickJS on the watch itself.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 15, textAlign: "center", color: "#555" },
});
