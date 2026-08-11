'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { logDiagnosticEvent } from './backgroundDiagnostics';
import { updateResumeIndex } from './bookLibrary';
import { chunkFetchPlan } from './chunkFetchPlan';
import { sentenceOrdinals } from './sentenceOrdinals';

// Roughly two minutes of audio ahead of the anchor, at the ~12s Chunks ticket 01
// measured on real edge-tts output. Raised from 2 because the media stack has to
// re-fetch a growing EVENT playlist to discover new segments, and reaching the end of
// the playlist is the one failure this phase can't rule out in advance (see the spec's
// Further Notes) - a wide generated region means playback rarely gets there. Not wider,
// because the whole plan is requested in parallel, so the window is also the size of the
// TTS burst a Book fires on open.
//
// The anchor is currentIndex, which ticket 05 made a function of the reading position -
// so a cuechange moving into a later Chunk widens the generated region ahead of it, and
// a Book longer than this window keeps generating instead of stopping at the end of the
// opening burst. Ticket 06 is where this value gets checked against playback actually
// catching up to a growing playlist.
const LOOKAHEAD = 10;
// Natural playback can advance the active sentence roughly every few seconds - this
// coalesces those persistence writes into one trailing call instead of a network
// request on every single sentence boundary (see phase 1.5 ticket 05).
const RESUME_PERSIST_DEBOUNCE_MS = 400;
// Stands in for a MediaError code the element did not give us. Zero is not one of the four
// the spec defines, so it reads as "failed, cause unknown" everywhere a code is compared.
const MEDIA_ERR_UNKNOWN = 0;

// Both HLS routes (see ticket 03) are addressed the same way: a Book, a voice, and which
// Chunk to start at. `from` is normally 0 and moves only when the Listener seeks somewhere
// the playlist can't reach (see seekToSentence and ticket 07); it is left off the query
// entirely at 0, so an ordinary listening session's URLs are unchanged by its existence.
function bookAudioUrl(route, { bookId, voice, from }) {
  const query = new URLSearchParams({ voice });
  if (from > 0) query.set('from', String(from));
  return `/api/books/${encodeURIComponent(bookId)}/${route}?${query}`;
}

// The EVENT playlist: one continuous source for the stretch of the Book being listened
// to. It grows as Chunks generate, so the media stack keeps re-fetching it and moves
// between segments on its own; nothing in this hook runs at a Chunk boundary.
function playlistUrl(source) {
  return bookAudioUrl('playlist.m3u8', source);
}

// The absolute Sentence times that become this element's metadata cues. They are relative
// to the playlist's own zero, so it has to be read for the same `from` the element is
// playing or every cue lands at the wrong second.
function manifestUrl(source) {
  return bookAudioUrl('manifest', source);
}

// Plays a Book as one continuous HLS source: the caller attaches `audioRef` to a single
// <audio> element whose `src` is the Book's EVENT playlist, and `.play()` is called
// exactly once per listening session, from the Listener's own gesture. Segment
// advancement happens inside the browser's media stack, which is the point - ADR 0003
// established that the failure this phase fixes is a background `.play()` on a
// freshly-loaded element, not a frozen main thread, so the fix is to never need a second
// one (see ticket 04). This hook still drives look-ahead TTS generation via
// /api/audio-chunks, which is what makes the playlist grow, and still persists the
// reading position; `initialIndex` lets a caller resume a Book where it was left off.
export function useBookPlayer({
  bookId,
  chunks,
  initialIndex = 0,
  initialSentenceIndex = 0,
  voice,
  speed = 1,
}) {
  const [chunkAudio, setChunkAudio] = useState({});
  const [wantsToPlay, setWantsToPlay] = useState(false);
  // What the element itself reported about the source it was given, as opposed to what
  // /api/audio-chunks reported about generating a Chunk. Nothing read `audio.error` before
  // ticket 06, which is why a browser with no HLS demuxer - every desktop one but Safari,
  // by ADR 0003's design - was indistinguishable from a dead play button. A MediaError code
  // or null, never an object: a shape that could hold an absent code would put this state
  // back into "something failed and there is nothing to show for it".
  const [mediaErrorCode, setMediaErrorCode] = useState(null);
  // Which Chunk the playlist currently being played starts at. Only seekToSentence moves
  // it, and only when the Listener asks for somewhere this playlist can't reach.
  const [playlistStart, setPlaylistStart] = useState(0);
  const audioRef = useRef(null);
  const pendingFetchesRef = useRef(new Set());

  const ordinals = useMemo(() => sentenceOrdinals(chunks), [chunks]);

  // The reading position, held as one Book-global Sentence ordinal because that is what
  // a cue carries and what the Book-wide timeline is indexed by. The (Chunk, Sentence)
  // pair everything outside this hook speaks in - TranscriptView's props, the library's
  // stored resume position - is derived from it below, so neither of those had to change.
  const [activeOrdinal, setActiveOrdinal] = useState(() =>
    ordinals.toOrdinal(initialIndex, initialSentenceIndex),
  );

  // Deriving currentIndex here, rather than tracking it separately, is what restores an
  // advancing look-ahead anchor: a cuechange moves the ordinal into a later Chunk and the
  // look-ahead effect below follows it there. Nothing else tells this hook that playback
  // moved on - segment advancement left the app in ticket 04 (see ADR 0003).
  const { chunkIndex: currentIndex, sentenceIndex: activeSentenceIndex } =
    ordinals.toChunkPosition(activeOrdinal);

  const currentStatus = chunkAudio[currentIndex]?.status;

  // A chunk that failed to generate should not keep showing Pause with nothing
  // happening (a visible error/retry surfaces instead - see AudioPlayer/PlayerBar).
  const isPlaying = wantsToPlay && currentStatus !== 'error';

  const fetchChunk = useCallback(
    async (index) => {
      if (pendingFetchesRef.current.has(index)) return;
      pendingFetchesRef.current.add(index);
      setChunkAudio((prev) => ({ ...prev, [index]: { status: 'loading' } }));

      try {
        const response = await fetch('/api/audio-chunks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId, chunkIndex: index, text: chunks[index], voice }),
        });

        if (!response.ok) {
          throw new Error('Audio generation failed');
        }

        const data = await response.json();
        setChunkAudio((prev) => ({
          ...prev,
          [index]: { status: 'ready', url: data.url, boundaries: data.boundaries, voice },
        }));
      } catch {
        setChunkAudio((prev) => ({ ...prev, [index]: { status: 'error' } }));
      } finally {
        pendingFetchesRef.current.delete(index);
      }
    },
    [bookId, chunks, voice],
  );

  // Keep the look-ahead buffer topped up as playback position or chunk state changes.
  // A generated Chunk is a segment the playlist route can serve, so this is what makes
  // the playlist grow - it is no longer what feeds the <audio> element directly.
  useEffect(() => {
    if (chunks.length === 0) return;

    const statuses = Object.fromEntries(
      Object.entries(chunkAudio).map(([index, entry]) => [index, entry.status]),
    );
    const plan = chunkFetchPlan({
      totalChunks: chunks.length,
      currentIndex,
      lookahead: LOOKAHEAD,
      statuses,
    });

    plan.forEach((index) => fetchChunk(index));
  }, [chunks, currentIndex, chunkAudio, fetchChunk]);

  // The metadata TextTrack every highlight comes from, built once per mount. Created
  // programmatically rather than declared as a <track src>, because a <track>'s source is
  // fetched once and this Book's cue set grows as Chunks generate - and because a
  // cross-origin <track> would impose a CORS requirement the design otherwise avoids.
  // Adding cues is plain JS, which ADR 0003 established stays reliable in the background;
  // only .play() does not.
  const trackRef = useRef(null);
  // Which Chunks already have cues. The manifest always describes the whole Book so far,
  // so every read but the first re-describes Chunks that are already on the track.
  const cuedChunksRef = useRef(new Set());
  // Which Chunks the Book has narrated audio for, across the whole Book rather than just
  // the stretch on the timeline - the manifest reports it for every Chunk. It is what
  // seekToSentence needs to tell "the playlist will reach there" from "it never can".
  //
  // Replaced wholesale on every manifest read rather than accumulated: the manifest is
  // keyed by voice, so what one voice had narrated says nothing about the next, and a set
  // that only ever grew would keep insisting Chunks are reachable that the new voice has
  // never generated.
  const generatedChunksRef = useRef(new Set());
  // A Sentence the Listener has chosen that has no cue yet, so no time to seek to. Held
  // until its Chunk reaches the timeline (see applySeek). A saved resume position starts
  // life as one of these - opening a Book part-way through is the same problem, and until
  // its cue arrives there is nothing to position the audio by. Ordinal 0 needs no seek:
  // the element already starts there.
  const pendingSeekRef = useRef(activeOrdinal || null);

  // Moves the playhead to a Sentence, using its cue's start as the time - the one write
  // to `audio.currentTime` in the codebase. Without a cue the Sentence isn't on the
  // timeline yet, so the seek is parked rather than dropped, and retried each time cues
  // arrive.
  const applySeek = useCallback((ordinal) => {
    const audio = audioRef.current;
    const cue = trackRef.current?.cues?.getCueById(String(ordinal));
    if (!audio || !cue) {
      pendingSeekRef.current = ordinal;
      return;
    }

    pendingSeekRef.current = null;
    audio.currentTime = cue.startTime;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    // A TextTrack can be added to an element but never removed, so this reuses the one
    // already there rather than stacking up empties - React mounts effects twice under
    // the StrictMode that Next runs in development.
    const track =
      Array.from(audio.textTracks).find(({ kind }) => kind === 'metadata') ??
      audio.addTextTrack('metadata');
    // Load-bearing, not cosmetic: cues in a `disabled` track (the default) never become
    // active, so `cuechange` would never fire and nothing would ever be highlighted. A
    // metadata track renders nothing either way, so `hidden` costs nothing.
    track.mode = 'hidden';
    trackRef.current = track;

    const handleCueChange = () => {
      // A parked seek means the Listener has already chosen a Sentence the playhead
      // hasn't reached yet. The cues it crosses on the way there are not where reading
      // is, and following them would drag the highlight backwards and persist a place
      // the Listener has already left.
      if (pendingSeekRef.current !== null) return;

      const cue = track.activeCues?.[0];
      if (!cue) return;
      setActiveOrdinal(Number(cue.id));
    };
    track.addEventListener('cuechange', handleCueChange);
    return () => track.removeEventListener('cuechange', handleCueChange);
  }, []);

  // Read on mount and again whenever another Chunk finishes generating, which is when the
  // Book gains Sentences that can be placed on the timeline. The mount read matters even
  // for a Book that generates nothing this session: it is how opening a partly-narrated
  // Book learns what is already there, which seekToSentence needs before the first
  // /api/audio-chunks call has resolved.
  const readyChunkCount = Object.values(chunkAudio).filter(
    (entry) => entry.status === 'ready',
  ).length;
  const manifestSrc = manifestUrl({ bookId, voice, from: playlistStart });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    let cancelled = false;
    fetch(manifestSrc)
      .then((response) => (response.ok ? response.json() : null))
      .then((manifest) => {
        if (cancelled || !Array.isArray(manifest?.chunks)) return;

        generatedChunksRef.current = new Set(
          manifest.chunks.filter(({ isGenerated }) => isGenerated).map(({ index }) => index),
        );

        for (const chunk of manifest.chunks) {
          if (chunk.sentences.length === 0 || cuedChunksRef.current.has(chunk.index)) continue;
          cuedChunksRef.current.add(chunk.index);

          for (const sentence of chunk.sentences) {
            const cue = new VTTCue(sentence.startSeconds, sentence.endSeconds, '');
            // The Book-global Sentence ordinal, which is the whole payload - the cue's
            // text is empty because the transcript already has the words.
            cue.id = String(sentence.id);
            track.addCue(cue);
          }
        }

        // Cues arriving is exactly the signal a parked seek was waiting for: a Sentence
        // has a cue only once the playlist covers its Chunk.
        if (pendingSeekRef.current !== null) applySeek(pendingSeekRef.current);
      })
      .catch((error) => {
        console.error('Failed to read the Book manifest', error);
      });

    return () => {
      cancelled = true;
    };
  }, [applySeek, manifestSrc, readyChunkCount]);

  const src = playlistUrl({ bookId, voice, from: playlistStart });
  // The only assignment to `src` in the codebase: once on mount, and again only when the
  // Book, the voice, or the stretch being played changes. Re-pointing it reloads the
  // element, which is why nothing else is allowed to touch it - a reload mid-Book is
  // exactly the interruption this phase exists to remove, and the two things that do it
  // are both explicit Listener gestures made in the foreground, never a boundary the app
  // crossed on its own. `speed` is a dependency only because loading a source resets
  // playbackRate, so the current speed has to be re-applied with each load; the guard
  // means a speed change on its own returns before touching anything.
  const loadedSrcRef = useRef(null);
  // Read by the reload path below, which must not re-run whenever the position moves.
  // Refreshed after every commit rather than during render, which refs don't allow.
  const activeOrdinalRef = useRef(activeOrdinal);
  useEffect(() => {
    activeOrdinalRef.current = activeOrdinal;
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || loadedSrcRef.current === src) return;

    const isReload = loadedSrcRef.current !== null;
    loadedSrcRef.current = src;
    audio.src = src;
    audio.playbackRate = speed;
    // A different source is a fresh attempt: keeping the previous failure on screen would
    // report this one as having failed before it had even loaded.
    setMediaErrorCode(null);

    // A different voice, or a playlist starting somewhere else, is a different timeline -
    // every cue on the old one is now wrong rather than merely stale. Drop them; the new
    // manifest brings the same Sentences back at their new times.
    if (isReload) {
      const track = trackRef.current;
      // Backwards, since each removal shifts everything after it down one.
      for (let index = (track?.cues.length ?? 0) - 1; index >= 0; index -= 1) {
        track.removeCue(track.cues[index]);
      }
      cuedChunksRef.current = new Set();
      // A seek is already parked when the reload is what that seek asked for. A voice
      // change has no target of its own, so it re-parks wherever reading currently is.
      pendingSeekRef.current ??= activeOrdinalRef.current;
    }
  }, [src, speed]);

  // Applied immediately, independent of the load above - a pure client-side effect, no
  // new TTS calls or cache changes (see phase 1.5 ticket 04).
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // The (Chunk, Sentence) pair most recently sent to the library, so the debounced
  // effect below can tell "already persisted by an explicit seekToSentence call" apart
  // from "still needs persisting" without a mutable trigger flag - starts at null so the
  // very first render always persists once (see phase 1.5 ticket 05).
  const lastPersistedRef = useRef(null);
  // Tracked apart from lastPersistedRef, which records the last position sent by any write.
  // The flush below has to know whether a *snapshot* exists for a position, and an ordinary
  // per-Sentence save - Redis only, no blob - answers the wrong question (see ticket 14).
  const lastSnapshotRef = useRef(null);
  const persistTimeoutRef = useRef(null);

  // Persist the reading position - both Chunk and Sentence together, as one atomic pair
  // - so reopening this book later (see BookLibrary) resumes at the exact Sentence
  // rather than just the Chunk. A network call, so a failure is caught here -
  // fire-and-forget from the caller's perspective, since there's no UI for surfacing a
  // failed resume-position save.
  // `updatedAt` is stamped here rather than on the server so it records when reading
  // actually reached this position on this device. A device that was offline flushes late,
  // and without this its hour-old position would overwrite a newer one from another device
  // purely by arriving second - the failure Phase 2's offline downloads make routine (see
  // ticket 10). `snapshot` is only set by the flush path below; ordinary per-Sentence saves
  // go to Redis alone and cost no Blob operation at all.
  const persistResumePosition = useCallback(
    (chunkIndex, sentenceIndex, { snapshot = false } = {}) => {
      lastPersistedRef.current = { chunkIndex, sentenceIndex };
      if (snapshot) lastSnapshotRef.current = { chunkIndex, sentenceIndex };
      updateResumeIndex(bookId, {
        resumeIndex: chunkIndex,
        resumeSentenceIndex: sentenceIndex,
        updatedAt: Date.now(),
        snapshot,
      }).catch((error) => {
        console.error('Failed to persist resume position', error);
      });
    },
    [bookId],
  );

  // Debounced/coalesced (see RESUME_PERSIST_DEBOUNCE_MS) because natural playback
  // advances the active Sentence roughly every few seconds - an explicit Sentence click
  // (seekToSentence below) persists immediately instead, via persistResumePosition
  // directly, and updates lastPersistedRef synchronously so this effect's own later run
  // (once React actually applies that state change) finds nothing left to do.
  useEffect(() => {
    const last = lastPersistedRef.current;
    if (last && last.chunkIndex === currentIndex && last.sentenceIndex === activeSentenceIndex) {
      return undefined;
    }

    persistTimeoutRef.current = setTimeout(
      () => persistResumePosition(currentIndex, activeSentenceIndex),
      RESUME_PERSIST_DEBOUNCE_MS,
    );
    return () => clearTimeout(persistTimeoutRef.current);
  }, [currentIndex, activeSentenceIndex, persistResumePosition]);

  // The Listener's gesture is the only thing that ever starts playback: this call, from
  // the transport control or a MediaSession action. No effect, timer, or event handler
  // calls play() - that is the whole point of the single continuous source (ADR 0003).
  const play = useCallback(() => {
    setWantsToPlay(true);
    // Caught rather than left to reject unhandled: play() rejects with an AbortError if
    // the element is still loading the playlist when the Listener presses play, and the
    // foreground checkpoint below corrects the button back to Play on its own.
    audioRef.current?.play().catch((error) => {
      console.error('Playback could not start', error);
    });
  }, []);
  const pause = useCallback(() => {
    setWantsToPlay(false);
    audioRef.current?.pause();
  }, []);

  // The end of the Book, not the end of a Chunk: with one continuous source, `ended`
  // only fires once the playlist has an #EXT-X-ENDLIST and playback reaches it.
  const handleEnded = useCallback(() => setWantsToPlay(false), []);

  // The element has given up on this source; it will not start on its own, so the intent to
  // play is dropped too rather than leaving a Pause button over silence. `code` is what
  // separates "this browser cannot play HLS at all" from a decode or network failure, and
  // both the code and the element's own message are logged: the message
  // ("PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE") is what named the cause the one time
  // this was diagnosed by hand.
  const handleMediaError = useCallback(() => {
    const error = audioRef.current?.error;
    console.error('The media element could not play this source', error?.code, error?.message);
    // An error event with no MediaError behind it is still a failure that has to say
    // something - falling back to an absent code would show nothing at all, which is the
    // silence this exists to remove.
    setMediaErrorCode(error?.code ?? MEDIA_ERR_UNKNOWN);
    setWantsToPlay(false);
  }, []);

  // A backgrounded tab can suspend or throttle media events without telling the page in
  // an orderly way, so React's `isPlaying` can drift from what the element actually did.
  // Correcting that flag is all this checkpoint has left to do: segment advancement is
  // the media stack's job now, and it never calls play() - a background play() is the
  // failure ADR 0003 identified, so retrying one here would reintroduce it. Stashed in a
  // ref (rather than read directly by the listener effect below) so that effect can
  // attach its listeners once on mount instead of re-subscribing on every state change
  // this closure reads.
  const reconcileOnForegroundRef = useRef(null);
  // The backgrounding-triggered counterpart: if the OS fully kills the tab's process
  // while hidden (rather than just suspending it), any pending debounced write in the
  // persistence effect above never gets to run. This flushes persistResumePosition
  // immediately instead of waiting for it (see phase 1.8 ticket 03). Same
  // ref-refreshed-every-commit trick, for the same reason.
  const flushOnHiddenRef = useRef(null);
  // Refs can't be written during render (only read) - this keeps the ref's closure
  // current after every commit instead, so the listener effect below still only has to
  // attach its listeners once.
  useEffect(() => {
    flushOnHiddenRef.current = () => {
      clearTimeout(persistTimeoutRef.current);
      // Compared against the last *snapshot*, not the last write of any kind. Comparing
      // against lastPersistedRef looked like duplicate suppression and was not: the
      // per-Sentence save that sets it writes to Redis alone, so matching it meant skipping
      // the one write that survives a Redis outage. With a 400ms debounce against
      // multi-second Sentences it matched nearly always, and the snapshot was effectively
      // never written - confirmed against the live store, where a Book read all day had no
      // resume.json at all (ticket 14). What this still skips is a second backgrounding at
      // a position already snapshotted, which is the bound below.
      const last = lastSnapshotRef.current;
      if (last && last.chunkIndex === currentIndex && last.sentenceIndex === activeSentenceIndex) {
        return;
      }
      // The one place that asks for a durable snapshot. Backgrounding is the last moment
      // the position is known before the OS may kill the process, and it happens once a
      // session rather than once a Sentence - which is what keeps the Blob cost bounded.
      persistResumePosition(currentIndex, activeSentenceIndex, { snapshot: true });
    };
  });
  useEffect(() => {
    reconcileOnForegroundRef.current = () => {
      const audio = audioRef.current;
      if (!audio) return;

      let isPlayingCorrectedTo = null;
      if (audio.paused && wantsToPlay) {
        setWantsToPlay(false);
        isPlayingCorrectedTo = false;
      } else if (!audio.paused && !wantsToPlay) {
        setWantsToPlay(true);
        isPlayingCorrectedTo = true;
      }

      // TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js.
      logDiagnosticEvent('reconcile', {
        isPlayingCorrectedTo,
        audioPaused: audio.paused,
        audioCurrentTime: audio.currentTime,
      });
    };
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      // TEMPORARY (Phase 1.9 ticket 04 diagnostics) - see backgroundDiagnostics.js.
      logDiagnosticEvent('visibilitychange', { visibilityState: document.visibilityState });
      if (document.visibilityState === 'visible') {
        reconcileOnForegroundRef.current?.();
      } else if (document.visibilityState === 'hidden') {
        flushOnHiddenRef.current?.();
      }
    };
    const handleFocus = () => {
      logDiagnosticEvent('focus');
      reconcileOnForegroundRef.current?.();
    };
    // A fallback for the case where a killed process doesn't get to fire
    // visibilitychange first - the same flush, reusing the same ref (see phase 1.8
    // ticket 03).
    const handlePageHide = () => {
      logDiagnosticEvent('pagehide');
      flushOnHiddenRef.current?.();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  // Whether the playlist now loaded could ever reach a Chunk, which is not the same as
  // whether it has yet. It truncates at its first gap, so it reaches Chunk N only if
  // every Chunk from its start up to N is narrated - one that isn't, and never will be
  // unless something asks for it, walls off everything after it (see ticket 07).
  //
  // The manifest is the only authority on what is narrated, deliberately - the client's
  // own `chunkAudio` says a Chunk generated, but not whether the playlist can place it
  // (a Chunk cached before durationSeconds existed can't be - see ticket 02). Getting
  // this wrong in the optimistic direction parks a seek against a playlist that will
  // never reach it, which is the ticket 05 hang; getting it wrong the other way costs one
  // extra reload. So it trusts only what the routes themselves report.
  const canPlaylistReach = useCallback(
    (chunkIndex) => {
      if (chunkIndex < playlistStart) return false;

      for (let index = playlistStart; index < chunkIndex; index += 1) {
        if (!generatedChunksRef.current.has(index)) return false;
      }
      return true;
    },
    [playlistStart],
  );

  // Selects where reading is, identified by a Chunk and its index within that Chunk's
  // Sentences - the click target for both the current Chunk's text and any other's,
  // generated or not (see phase 1.5 ticket 01). A Chunk that isn't ready yet is fetched
  // directly here, bypassing chunkFetchPlan's sequential look-ahead ordering, so seeking
  // ahead doesn't force generating every Chunk in between. That rule is why the third
  // case below exists at all.
  //
  // Three ways the playhead gets to the target, in order of how little they disturb:
  //
  //  - It is already on this timeline, so applySeek writes currentTime and that is all.
  //    Seeking backwards inside the playlist is always this case.
  //  - It is past the end of the timeline but the playlist can still grow to it, so
  //    applySeek parks the seek and the cue's arrival applies it.
  //  - The playlist can never reach it - the Listener jumped over a stretch that was
  //    never narrated, or back to before this playlist starts - so the Book is served
  //    from there instead. That reloads the element, which is safe precisely here: it is
  //    an explicit gesture in the foreground, not the background `.play()` on a freshly
  //    loaded element that ADR 0003 identified.
  const seekToSentence = useCallback(
    (chunkIndex, sentenceIndex) => {
      // An explicit click always persists this reading position right away, bypassing
      // the debounce natural playback advance goes through (see phase 1.5 ticket 05).
      clearTimeout(persistTimeoutRef.current);
      persistResumePosition(chunkIndex, sentenceIndex);

      const ordinal = ordinals.toOrdinal(chunkIndex, sentenceIndex);
      // The highlight moves whether or not the audio can, so the Listener always sees
      // what they queued.
      setActiveOrdinal(ordinal);

      if (canPlaylistReach(chunkIndex)) {
        applySeek(ordinal);
      } else {
        // Parked before the re-point so the reload path adopts this target rather than
        // re-parking wherever reading was.
        pendingSeekRef.current = ordinal;
        setPlaylistStart(chunkIndex);
      }

      if (chunkAudio[chunkIndex]?.status !== 'ready') {
        fetchChunk(chunkIndex);
      }
    },
    [applySeek, canPlaylistReach, chunkAudio, fetchChunk, ordinals, persistResumePosition],
  );

  return {
    audioRef,
    currentIndex,
    isPlaying,
    chunkAudio,
    activeSentenceIndex,
    play,
    pause,
    handleEnded,
    handleMediaError,
    mediaErrorCode,
    seekToSentence,
    retryChunk: fetchChunk,
  };
}
