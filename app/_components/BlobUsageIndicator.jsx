'use client';

import { Box, Button, HStack, Text } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';

import { cleanupBlobs, getUsage } from '@/app/_lib/blobUsage';

// Listener-facing visibility into Blob storage usage (phase 1.6 ticket 09) - shows the
// current percentage and lets the Listener trigger the same /api/blob-cleanup route the
// daily cron hits, on demand.
//
// The usage check is deliberately NOT run on mount. /api/blob-usage costs one Vercel Blob
// Advanced Operation (a list() call), the Hobby plan includes 2,000 a month, and this sits
// on the home page - so fetching on render billed every visit for a number nobody asked
// for, and got to 95% of that quota. Caching it is not an adequate fix: Next's `use cache`
// needs cacheComponents (off here) and does not persist across serverless requests, and a
// TTL only bounds the cost rather than removing it. On demand costs nothing unless asked.
// See .scratch/phase-1-10-continuous-hls-playback/issues/09-blob-usage-indicator-costs-an-advanced-operation.md.
export default function BlobUsageIndicator() {
  const [usage, setUsage] = useState(null);
  const [checking, setChecking] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  // Guards against setState after unmount, same pattern BookLibrary.jsx uses - both the
  // usage check and the post-cleanup refresh can outlive the component.
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const fetchedUsage = await getUsage();
      if (!unmountedRef.current) setUsage(fetchedUsage);
    } catch (error) {
      console.error('Fetching blob usage failed', error);
    } finally {
      if (!unmountedRef.current) setChecking(false);
    }
  };

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

  const rounded = usage ? Math.round(usage.percent) : 0;

  return (
    <Box
      w="full"
      bg="backgroundElevated"
      borderWidth="1px"
      borderColor="hairline"
      borderRadius="lg"
      p={3}
    >
      <HStack justify="space-between" mb={usage ? 2 : 0}>
        <Text fontSize="sm" color="foregroundMuted">
          {usage ? `已使用 ${rounded}% 儲存空間` : '儲存空間'}
        </Text>
        {usage ? (
          <Button size="sm" variant="outline" onClick={handleCleanup} disabled={cleaningUp}>
            {cleaningUp ? '清理中…' : '立即清理'}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={handleCheck} disabled={checking}>
            {checking ? '查看中…' : '查看用量'}
          </Button>
        )}
      </HStack>
      {usage && (
        <Box h="1.5" w="full" borderRadius="full" bg="backgroundSunken" overflow="hidden">
          <Box h="full" bg="accent" w={`${rounded}%`} />
        </Box>
      )}
    </Box>
  );
}
