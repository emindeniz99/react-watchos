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
  useEffect(() => onPhoneMessage((m) => setFromPhone(JSON.stringify(m))), []);
  return (
    <VStack spacing={6}>
      <Text bold size={16}>
        From phone
      </Text>
      <Text size={12} color="secondary">
        {fromPhone}
      </Text>
      <Button onPress={() => sendToPhone({ kind: "tap", at: Date.now() })}>
        <Text>Ping phone</Text>
      </Button>
    </VStack>
  );
}
