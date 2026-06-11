import { version, useState } from "react";
import {
  Button,
  HStack,
  Image,
  Spacer,
  Text,
  Toggle,
  VStack,
} from "../src/index";

/** Component showcase: every v1 primitive, state, and both event kinds. */
export function App() {
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
