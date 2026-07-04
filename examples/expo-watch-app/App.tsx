import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { sendMessage, watchEvents } from "react-native-watch-connectivity";

// Companion iOS app. The watch UI itself runs ON the watch (watch-ui/, React
// in QuickJS via react-watchos). This screen is the WatchConnectivity
// counterpart: it sends to / receives from the watch.
//
// Not part of `npm run typecheck` here — it's built by Expo's own tooling on
// macOS (tsconfig only covers the renderer-side watch-ui).
export default function App() {
  const [fromWatch, setFromWatch] = useState("none yet");
  useEffect(() => {
    const unsubscribe = watchEvents.addListener("message", (m) =>
      setFromWatch(JSON.stringify(m)),
    );
    return () => unsubscribe();
  }, []);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Expo Watch App</Text>
      <Text style={styles.body}>
        The watch UI runs on the watch. This is the phone side of the link.
      </Text>
      <Button
        title="Send to watch"
        onPress={() => sendMessage({ status: "synced", at: Date.now() })}
      />
      <Text style={styles.body}>From watch: {fromWatch}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: "600" },
  body: { fontSize: 14, color: "#444" },
});
