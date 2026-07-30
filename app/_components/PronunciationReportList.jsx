'use client';

import { Box, Heading, HStack, Text, VStack } from '@chakra-ui/react';
import { useEffect, useState } from 'react';

import { listReports } from '@/app/_lib/pronunciationReports';

// "2026-07-30T12:00:00.000Z" -> "2026-07-30 12:00" - a plain, timezone/locale-free
// rendering (no toLocaleString(), whose output depends on the reader's environment)
// good enough for a manual-review screen nobody needs to the second.
function formatReportedAt(isoString) {
  return isoString.replace('T', ' ').slice(0, 16);
}

// The reports-review screen (see ticket 10) - every pronunciation issue Listeners have
// flagged via PronunciationReportForm, newest first, for manual review only. Purely a
// read/list view: nothing here edits or dismisses a report, and no automatic
// pronunciation correction happens as a result of anything shown here.
export default function PronunciationReportList() {
  const [reports, setReports] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listReports().then((fetched) => {
      if (!cancelled) setReports(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (reports === null) return null;

  return (
    <VStack align="start" gap={4} w="full">
      <Box>
        <Heading size="md">Pronunciation reports</Heading>
        <Text fontSize="sm" color="foregroundMuted">
          {reports.length} {reports.length === 1 ? 'report' : 'reports'}, newest first
        </Text>
      </Box>
      {reports.length === 0 ? (
        <Text color="foregroundMuted">No pronunciation issues have been reported yet.</Text>
      ) : (
        <VStack align="stretch" gap={0} w="full">
          {reports.map((report, index) => (
            <Box
              // Reports have no id, and this list is never reordered/filtered client-side.
              key={index}
              w="full"
              py={3}
              borderTopWidth="1px"
              borderColor="hairline"
              _first={{ borderTopWidth: 0 }}
            >
              <HStack justify="space-between" gap={2}>
                <Text fontSize="xs" fontWeight="600" truncate>
                  {report.bookTitle}
                </Text>
                <Text
                  fontSize="xs"
                  color="foregroundFaint"
                  flexShrink={0}
                  fontVariantNumeric="tabular-nums"
                >
                  {formatReportedAt(report.reportedAt)}
                </Text>
              </HStack>
              <Text
                display="inline-block"
                mt={2}
                bg="activeSentenceBg"
                color="activeSentenceFg"
                borderRadius="md"
                px={2}
                py={1}
                fontSize="sm"
              >
                {report.phrase}
              </Text>
              {report.description ? (
                <Text fontSize="sm" color="foregroundMuted" mt={2}>
                  {report.description}
                </Text>
              ) : (
                <Text fontSize="sm" color="foregroundFaint" fontStyle="italic" mt={2}>
                  No description provided
                </Text>
              )}
            </Box>
          ))}
        </VStack>
      )}
    </VStack>
  );
}
