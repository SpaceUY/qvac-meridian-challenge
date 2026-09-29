/**
 * Bytes per streaming chunk fed into transcribeStream() - roughly 100ms of
 * 16kHz/16-bit/mono audio (16000 samples/s * 2 bytes/sample * 0.1s),
 * simulating incremental hands-free audio delivery rather than one big
 * write().
 */
export const STREAM_CHUNK_BYTES = 3200;
