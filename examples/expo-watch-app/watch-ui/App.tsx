import { useEffect, useState } from "react";
import {
  Button,
  Text,
  VStack,
  onPhoneMessage,
  sendToPhone,
} from "react-native-watchos";

// The watch UI — React running in QuickJS on the watch, rendering native
// SwiftUI. It mirrors the iPhone app over WatchConnectivity: messages the
// phone sends arrive via onPhoneMessage; the button replies with sendToPhone.
export function App() {
  const [fromPhone, setFromPhone] = useState("waiting for phone…");
  const [sendStatus, setSendStatus] = useState("");
  useEffect(() => onPhoneMessage((m) => setFromPhone(JSON.stringify(m))), []);
  // sendToPhone rejects when the phone isn't reachable (CX-022) — handle it, so
  // a tap with no phone surfaces a status instead of leaking an unhandled
  // rejection. This is the pattern to copy.
  const ping = async () => {
    try {
      await sendToPhone({ kind: "tap", at: Date.now() });
      setSendStatus("sent ✓");
    } catch {
      setSendStatus("phone unreachable");
    }
  };
  return (
    <VStack spacing={6}>
      <Text bold size={16}>
        From phone
      </Text>
      <Text size={12} color="secondary">
        {fromPhone}
      </Text>
      <Button onPress={ping}>
        <Text>Ping phone</Text>
      </Button>
      {sendStatus ? (
        <Text size={12} color="secondary">
          {sendStatus}
        </Text>
      ) : null}
    </VStack>
  );
}
