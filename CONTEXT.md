# Text Reader

A progressive audiobook reader: upload a text file, it chunks and narrates it via TTS almost immediately, with local caching and a per-device library of in-progress books.

## Language

**Book**:
A single uploaded text, split into an ordered list of Chunks and tracked in the Listener's Library with a resume position.
_Avoid_: Document, file (those refer to the raw upload before it becomes a Book)

**Chunk**:
A contiguous slice of a Book's text, small enough to synthesize and cache as one TTS audio file. The unit of generation, caching, and sequential playback.

**Sentence**:
A sub-span within a Chunk, derived from the Chunk's word-level TTS boundary metadata (not separately stored). The unit of seeking and highlighting.

**Listener**:
The person using the app on a given device. Owns device-scoped preferences (e.g. narration voice, playback speed, theme) that apply across all Books, as distinct from anything stored per-Book.
_Avoid_: User, reader (reader is fine in prose/UI copy, but "Listener" is the precise term when distinguishing device-level settings from Book-level state)

**Library**:
The Listener's persisted list of Books, held server-side so a Book uploaded on one device can be seen and resumed from another. The list itself is a JSON object in the object store; each Book's resume position is stored separately (see below).
_Avoid_: describing it as device-scoped or `localStorage`-backed — it was both before phase 1.6.

**Segment**:
A Chunk's cached audio as HLS serves it — one `.mp3` object, one `#EXTINF` entry in a playlist. One Segment per (Chunk, voice), so "Chunk" is the unit of text and generation and "Segment" is the same audio seen from the media stack. Its URL is always derived, never stored: the configured **segment origin** (`SEGMENT_ORIGIN`, the Worker that fronts the private bucket) concatenated with the Chunk's pathname.
_Avoid_: calling the origin the "store origin" or "blob origin" — reads and writes go to different hosts, so the origin a Listener plays from is not the one the app writes to.

**Resume position**:
Where a Listener stopped in a Book, as an atomic (Chunk, Sentence) pair with the time it was reached. Lives in Redis, with a snapshot in the object store as a backstop — see [ADR 0004](docs/adr/0004-resume-position-store.md).
_Avoid_: reading position, progress (progress is the derived percentage shown in the Library, not the stored position)
