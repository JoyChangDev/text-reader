'use client';

import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';

import { cleanupBlobs, getUsage } from '@/app/_lib/blobUsage';

// Listener-facing visibility into Blob storage usage (ticket 09) - shows the current
// percentage and lets the Listener trigger the same /api/blob-cleanup route the daily
// cron hits, on demand.
export default function BlobUsageIndicator() {
  const [usage, setUsage] = useState(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  // Guards against setState after unmount, same pattern BookLibrary.jsx uses - both the
  // initial fetch and the post-cleanup refresh can outlive the component.
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    getUsage().then((fetchedUsage) => {
      if (!unmountedRef.current) setUsage(fetchedUsage);
    });
  }, []);

  const handleCleanup = async () => {
    setCleaningUp(true);
    try {
      await cleanupBlobs();
      const fetchedUsage = await getUsage();
      if (!unmountedRef.current) setUsage(fetchedUsage);
    } catch (error) {
      console.error('Blob cleanup failed', error);
    } finally {
      if (!unmountedRef.current) setCleaningUp(false);
    }
  };

  if (!usage) return null;

  const rounded = Math.round(usage.percent);

  return (
    <Box
      w="full"
      bg="backgroundElevated"
      borderWidth="1px"
      borderColor="hairline"
      borderRadius="lg"
      p={3}
    >
      <HStack justify="space-between" mb={2}>
        <Text fontSize="sm" color="foregroundMuted">
          已使用 {rounded}% 儲存空間
        </Text>
        <Button size="sm" variant="outline" onClick={handleCleanup} disabled={cleaningUp}>
          {cleaningUp ? '清理中…' : '立即清理'}
        </Button>
      </HStack>
      <Box h="1.5" w="full" borderRadius="full" bg="backgroundSunken" overflow="hidden">
        <Box h="full" bg="accent" w={`${rounded}%`} />
      </Box>
    </Box>
  );
}
