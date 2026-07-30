'use client';

import { Box, VStack } from '@chakra-ui/react';
import NextLink from 'next/link';
import { FiChevronLeft } from 'react-icons/fi';

import PronunciationReportList from '../_components/PronunciationReportList';

export default function PronunciationReportsPage() {
  return (
    <Box bg="background" color="foreground" minH="100vh">
      <VStack align="start" gap={6} maxW="640px" mx="auto" w="full" px={4} py={8}>
        <Box
          as={NextLink}
          href="/"
          display="inline-flex"
          alignItems="center"
          gap={1}
          fontSize="sm"
          color="foregroundMuted"
          _hover={{ color: 'foreground' }}
        >
          <FiChevronLeft /> Back to library
        </Box>
        <PronunciationReportList />
      </VStack>
    </Box>
  );
}
