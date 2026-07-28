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
The Listener's persisted list of Books on this device (currently `localStorage`), each with its resume position. Device-scoped, not synced.
