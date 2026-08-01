'use client';

import { Box, Button, Text, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { clearDiagnosticLog, getDiagnosticLog } from '@/app/_lib/backgroundDiagnostics';

// TEMPORARY: on-screen view of backgroundDiagnostics.js's log, for diagnosing Phase 1.8's
// still-unresolved background reconciliation bug (Phase 1.9 ticket 04) without needing a
// Mac/remote debugger - the log survives a process kill (it's in localStorage), but a
// live console doesn't. Always visible rather than gated behind a flag, since this app
// currently has one Listener. Delete once ticket 04 ships - see
// specs/phase-1-9-reader-route-restructure.md.
export default function BackgroundDiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  // Read synchronously (lazy initializer, not an effect) so the very first render
  // already shows whatever was logged before this mount - matching localStorage's own
  // synchronous read, rather than a render where entries starts empty and flips a beat
  // later.
  const [entries, setEntries] = useState(() => getDiagnosticLog());

  // Events get logged by effects elsewhere (useBookPlayer, useMediaSession) whenever
  // they happen, not through this component - polling while open is the simplest way to
  // reflect those without plumbing a subscription through every call site.
  useEffect(() => {
    if (!open) return undefined;
    const interval = setInterval(() => setEntries(getDiagnosticLog()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  const handleClear = () => {
    clearDiagnosticLog();
    setEntries([]);
  };

  return (
    <Box
      flexShrink={0}
      borderTopWidth="1px"
      borderColor="hairline"
      fontSize="xs"
      color="foregroundMuted"
    >
      <Button
        size="xs"
        variant="ghost"
        borderRadius="none"
        w="full"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '隱藏除錯記錄' : `除錯記錄（${entries.length}）`}
      </Button>
      {open && (
        <VStack align="stretch" gap={1} maxH="40" overflowY="auto" px={3} pb={3}>
          <Button size="xs" variant="outline" alignSelf="start" onClick={handleClear}>
            清除記錄
          </Button>
          {entries.length === 0 ? (
            <Text>（尚無記錄）</Text>
          ) : (
            [...entries].reverse().map((entry, index) => (
              <Text key={`${entry.timestamp}-${entry.type}-${index}`} fontFamily="mono" truncate>
                {new Date(entry.timestamp).toLocaleTimeString()} — {entry.type}{' '}
                {JSON.stringify(entry.detail)}
              </Text>
            ))
          )}
        </VStack>
      )}
    </Box>
  );
}
