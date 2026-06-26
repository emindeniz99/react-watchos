import { useEffect, useState } from "react";
import {
  Button,
  fetchAndApplyUpdate,
  onPhoneMessage,
  sendToPhone,
  Text,
  VStack,
} from "react-native-watchos";

// Your OTA endpoint — the manifest your build stamps (scripts/build-watch.mjs
// calls writeOTAManifest) served from any static host. Injected at build time
// from REACT_WATCH_OTA_URL; empty until you set it.
const OTA_URL = process.env.REACT_WATCH_OTA_URL;

// The watch UI — React running in QuickJS on the watch, rendering native
// SwiftUI. It mirrors the iPhone app over WatchConnectivity: messages the
// phone sends arrive via onPhoneMessage; the button replies with sendToPhone.
export function App() {
  const [fromPhone, setFromPhone] = useState("waiting for phone…");
  const [sendStatus, setSendStatus] = useState("");
  const [otaStatus, setOtaStatus] = useState("");
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
  // OTA: fetch the manifest, and if it's a fresher release than this bundle,
  // download + stage it. It takes effect on the next launch (the watch loads a
  // staged bundle before the shipped one). No-op when already up to date.
  const checkForUpdate = async () => {
    if (!OTA_URL) return setOtaStatus("set REACT_WATCH_OTA_URL");
    setOtaStatus("checking…");
    try {
      const staged = await fetchAndApplyUpdate(OTA_URL);
      setOtaStatus(staged ? `staged v${staged} — relaunch` : "up to date");
    } catch {
      setOtaStatus("update check failed");
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
      <Button onPress={checkForUpdate}>
        <Text>Check for update</Text>
      </Button>
      {otaStatus ? (
        <Text size={12} color="secondary">
          {otaStatus}
        </Text>
      ) : null}
    </VStack>
  );
}
