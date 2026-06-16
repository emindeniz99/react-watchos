import { useEffect, useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import {
  sendMessage,
  watchEvents,
} from "react-native-watch-connectivity";

/**
 * Companion iOS app. The watch UI itself runs on the watch (React + QuickJS
 * via ../js); this app is the WatchConnectivity counterpart to the watch's
 * PhoneConnectivity.swift. Messages sent here arrive on the watch as a
 * `watchConnectivity` native push (onPhoneMessage); messages the watch
 * sends (sendToPhone) arrive here via watchEvents.
 */
export default function App() {
  const [fromWatch, setFromWatch] = useState<string>("none yet");

  useEffect(() => {
    const unsubscribe = watchEvents.addListener("message", (message) => {
      setFromWatch(JSON.stringify(message));
    });
    return () => unsubscribe();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>React Watch Demo</Text>
      <Text style={styles.body}>
        The watch UI runs on the watch (React in QuickJS). This app is the
        phone side of the WatchConnectivity link.
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
