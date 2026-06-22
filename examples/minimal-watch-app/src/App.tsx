import { useState } from "react";
import { Button, HStack, Text, VStack } from "react-native-watchos";

// A whole watch app in one component: state + native widgets, no glue.
// Everything is imported from the package exports — no relative reach
// into the renderer's source, no esbuild alias, no tsconfig paths.
export function App() {
  const [count, setCount] = useState(0);
  return (
    <VStack spacing={6}>
      <Text bold size={20}>
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
    </VStack>
  );
}
