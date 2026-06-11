import { version, useState } from "react";
import {
  Button,
  Divider,
  Gauge,
  HStack,
  Image,
  List,
  NavigationLink,
  NavigationStack,
  Picker,
  ProgressView,
  ScrollView,
  Spacer,
  TabView,
  Text,
  TextField,
  Toggle,
  VStack,
  ZStack,
  playHaptic,
  publishWidgets,
  requestNotificationPermission,
  scheduleNotification,
} from "../src/index";
import { hydrationStore } from "./hydrationStore";

/** The original showcase: state, both event kinds, stacks and symbols. */
function CounterScreen() {
  const [count, setCount] = useState(0);
  const [liked, setLiked] = useState(false);
  return (
    <VStack spacing={6}>
      <HStack spacing={4}>
        <Image
          systemName={liked ? "heart.fill" : "heart"}
          color={liked ? "red" : "secondary"}
        />
        <Text bold size={16}>
          React on watchOS
        </Text>
      </HStack>
      <Text size={24} bold>
        Count: {count}
      </Text>
      <HStack spacing={8}>
        <Button onPress={() => setCount((c) => c - 1)}>
          <Text size={20}>-</Text>
        </Button>
        <Button onPress={() => setCount((c) => c + 1)}>
          <Text size={20}>+</Text>
        </Button>
      </HStack>
      <Toggle value={liked} onChange={setLiked} label="Like" />
      <Spacer />
      <Text size={11} color="secondary">
        React {version} in QuickJS
      </Text>
    </VStack>
  );
}

/**
 * Drives the hydration complication: every change updates the shared
 * store and republishes all widget timelines (App Group storage +
 * WidgetCenter reload on the native side).
 */
function HydrationScreen() {
  const [glasses, setGlasses] = useState(hydrationStore.glasses);
  const setAndPublish = (next: number) => {
    const clamped = Math.max(0, Math.min(hydrationStore.goal, next));
    hydrationStore.glasses = clamped;
    setGlasses(clamped);
    publishWidgets();
    if (clamped === hydrationStore.goal) playHaptic("success");
  };
  const remind = () => {
    requestNotificationPermission();
    scheduleNotification({
      id: "hydration.reminder",
      title: "Hydration",
      body: "Time for a glass of water",
      afterMs: 30 * 60_000,
    });
    playHaptic("click");
  };
  return (
    <VStack spacing={6}>
      <Gauge
        value={glasses}
        min={0}
        max={hydrationStore.goal}
        label="Water"
        style="circular"
      />
      <Text>{`${glasses} of ${hydrationStore.goal} glasses`}</Text>
      <Button onPress={() => setAndPublish(glasses + 1)}>
        <Text>Add glass</Text>
      </Button>
      <Button onPress={() => setAndPublish(0)}>
        <Text size={12} color="secondary">
          Reset
        </Text>
      </Button>
      <Button onPress={remind}>
        <Text size={12}>Remind me in 30 min</Text>
      </Button>
      <Text size={11} color="secondary">
        Updates the complication
      </Text>
    </VStack>
  );
}

/** The primitives added after v1, in one scrollable gallery. */
function GalleryScreen() {
  const [progress, setProgress] = useState(2);
  return (
    <ScrollView>
      <VStack spacing={8}>
        <Gauge value={0.7} label="Gauge" style="linear" />
        <Divider />
        <ProgressView value={progress} total={5} label="ProgressView" />
        <Button onPress={() => setProgress((p) => (p + 1) % 6)}>
          <Text size={12}>Advance progress</Text>
        </Button>
        <Divider />
        <ZStack>
          <Image systemName="circle.fill" color="blue" size={44} />
          <Text bold color="white" size={12}>
            ZStack
          </Text>
        </ZStack>
      </VStack>
    </ScrollView>
  );
}

const MOODS = ["calm", "focused", "tired", "great"];

/** TextField (dictation/scribble), Picker, and haptics. */
function InputsScreen() {
  const [name, setName] = useState("");
  const [mood, setMood] = useState(0);
  return (
    <VStack spacing={8}>
      <TextField value={name} placeholder="Your name" onChange={setName} />
      <Text size={12} color="secondary">
        {name ? `Hi, ${name}!` : "Dictate or scribble above"}
      </Text>
      <Picker label="Mood" options={MOODS} value={mood} onChange={setMood} />
      <Button
        onPress={() => playHaptic(mood === 3 ? "success" : "click")}
      >
        <Text size={12}>{`Feel ${MOODS[mood]} (haptic)`}</Text>
      </Button>
    </VStack>
  );
}

/** Each child of TabView is a vertically-paged screen on watchOS. */
function TabsScreen() {
  return (
    <TabView>
      <VStack spacing={4}>
        <Image systemName="1.circle.fill" color="blue" size={28} />
        <Text size={12}>Swipe up for page 2</Text>
      </VStack>
      <VStack spacing={4}>
        <Image systemName="2.circle.fill" color="green" size={28} />
        <Text size={12}>React-paged TabView</Text>
      </VStack>
    </TabView>
  );
}

export function App() {
  return (
    <NavigationStack title="React Watch">
      <List>
        <NavigationLink title="Counter">
          <CounterScreen />
        </NavigationLink>
        <NavigationLink title="Hydration">
          <HydrationScreen />
        </NavigationLink>
        <NavigationLink title="Gallery">
          <GalleryScreen />
        </NavigationLink>
        <NavigationLink title="Inputs">
          <InputsScreen />
        </NavigationLink>
        <NavigationLink title="Tabs">
          <TabsScreen />
        </NavigationLink>
      </List>
    </NavigationStack>
  );
}
