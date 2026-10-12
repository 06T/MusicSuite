export const PRELOAD_BUDGET = 256 * 1024 * 1024;
export const pcmBytes = (length: number, channels: number) => length * channels * Float32Array.BYTES_PER_ELEMENT;
export const estimatedPcmBytes = (seconds: number) => pcmBytes(Math.ceil(seconds * 44100), 2);
