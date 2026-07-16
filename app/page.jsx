'use client';
import { Button, HStack } from '@chakra-ui/react';

export default function Home() {
  return (
    <HStack bg="background" color="foreground">
      <Button>Click me</Button>
      <Button>Click me</Button>
    </HStack>
  );
}
