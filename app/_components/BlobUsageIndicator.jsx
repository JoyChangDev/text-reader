'use client';

import { Button, HStack, Text } from '@chakra-ui/react';
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

  return (
    <HStack>
      <Text>{Math.round(usage.percent)}% of storage used</Text>
      <Button size="sm" variant="outline" onClick={handleCleanup} disabled={cleaningUp}>
        {cleaningUp ? 'Cleaning up…' : 'Clean up now'}
      </Button>
    </HStack>
  );
}
