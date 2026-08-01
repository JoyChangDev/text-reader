'use client';

import { useEffect } from 'react';

import { logDiagnosticEvent } from './backgroundDiagnostics';

// Declares this page as playing legitimate media to the OS - the same mechanism that
// surfaces a lock-screen/notification play-pause control, and a signal some mobile
// browsers use when deciding whether to suspend a hidden tab's audio (see Phase 1.8
// tickets 01/02). Scoped to play/pause + metadata only for this phase - no
// previoustrack/nexttrack/seekto/setPositionState. A no-op wherever the MediaSession
// API isn't supported.
export function useMediaSession({ title, isPlaying, play, pause }) {
  useEffect(() => {
    // TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js.
    logDiagnosticEvent('mediaSessionRegistration', {
      supported: 'mediaSession' in navigator,
    });
    if (!('mediaSession' in navigator)) return undefined;

    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pause);

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, [play, pause]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !title) return undefined;
    navigator.mediaSession.metadata = new MediaMetadata({ title });
    // Otherwise a Listener navigating back to the Library leaves this Book's title on
    // the OS lock screen with nothing actually playing.
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, [title]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    return () => {
      navigator.mediaSession.playbackState = 'none';
    };
  }, [isPlaying]);
}
