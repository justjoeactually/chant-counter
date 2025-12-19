// Audio utilities for mantra detection
// Shared functions for audio processing

const AudioUtils = {
    // Detect if we're on a mobile device
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 768 && 'ontouchstart' in window);
    },

    // Trim silence from start and end of audio buffer
    trimSilence(audioData, sampleRate, threshold = 0.02) {
        const windowSize = 1024;
        const rmsValues = [];

        // Calculate RMS for each window
        for (let i = 0; i < audioData.length; i += windowSize) {
            const slice = audioData.slice(i, Math.min(i + windowSize, audioData.length));
            const rms = Math.sqrt(slice.reduce((sum, x) => sum + x * x, 0) / slice.length);
            rmsValues.push({ index: i, rms });
        }

        // Find first and last windows above threshold
        let startIndex = 0;
        let endIndex = audioData.length;

        for (let i = 0; i < rmsValues.length; i++) {
            if (rmsValues[i].rms > threshold) {
                startIndex = Math.max(0, rmsValues[i].index - windowSize);
                break;
            }
        }

        for (let i = rmsValues.length - 1; i >= 0; i--) {
            if (rmsValues[i].rms > threshold) {
                endIndex = Math.min(audioData.length, rmsValues[i].index + windowSize * 2);
                break;
            }
        }

        const trimmed = audioData.slice(startIndex, endIndex);
        const trimmedDuration = trimmed.length / sampleRate;
        const originalDuration = audioData.length / sampleRate;

        return {
            data: trimmed,
            originalDuration,
            trimmedDuration,
            silenceRemoved: originalDuration - trimmedDuration
        };
    },

    // Envelope extraction - extracts amplitude envelope from audio
    extractEnvelope(audioData, windowSize = 1024) {
        const envelope = [];
        for (let i = 0; i < audioData.length; i += windowSize) {
            const slice = audioData.slice(i, Math.min(i + windowSize, audioData.length));
            const rms = Math.sqrt(slice.reduce((sum, x) => sum + x * x, 0) / slice.length);
            envelope.push(rms);
        }
        return new Float32Array(envelope);
    },

    // Normalize array to 0-1 range
    normalize(arr) {
        const max = Math.max(...arr);
        const min = Math.min(...arr);
        const range = max - min;
        if (range === 0) return arr.map(() => 0);
        return arr.map(x => (x - min) / range);
    },

    // Resample array to target length using linear interpolation
    resample(arr, targetLength) {
        if (arr.length === targetLength) return arr;
        const result = new Array(targetLength);
        const ratio = (arr.length - 1) / (targetLength - 1);

        for (let i = 0; i < targetLength; i++) {
            const srcIdx = i * ratio;
            const lower = Math.floor(srcIdx);
            const upper = Math.min(Math.ceil(srcIdx), arr.length - 1);
            const frac = srcIdx - lower;
            result[i] = arr[lower] * (1 - frac) + arr[upper] * frac;
        }
        return result;
    },

    // Shape similarity (normalized envelope comparison at fixed length)
    shapeSimilarity(envelope1, envelope2) {
        const fixedLen = 50;
        const shape1 = this.normalize(this.resample(Array.from(envelope1), fixedLen));
        const shape2 = this.normalize(this.resample(Array.from(envelope2), fixedLen));

        let totalDiff = 0;
        for (let i = 0; i < fixedLen; i++) {
            totalDiff += Math.abs(shape1[i] - shape2[i]);
        }
        const avgDiff = totalDiff / fixedLen;
        return Math.max(0, 1 - avgDiff);
    },

    // Cosine similarity on resampled envelopes
    cosineSimilarity(envelope1, envelope2) {
        const targetLen = 50;
        const a = this.resample(Array.from(envelope1), targetLen);
        const b = this.resample(Array.from(envelope2), targetLen);

        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < targetLen; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dotProduct / denom;
    },

    // Correlation with resampling
    correlationResampled(envelope1, envelope2) {
        const targetLen = Math.max(envelope1.length, envelope2.length);
        const norm1 = this.normalize(this.resample(Array.from(envelope1), targetLen));
        const norm2 = this.normalize(this.resample(Array.from(envelope2), targetLen));

        if (targetLen < 3) return 0;

        const meanA = norm1.reduce((s, x) => s + x, 0) / targetLen;
        const meanB = norm2.reduce((s, x) => s + x, 0) / targetLen;

        let numerator = 0, denomA = 0, denomB = 0;
        for (let i = 0; i < targetLen; i++) {
            const diffA = norm1[i] - meanA;
            const diffB = norm2[i] - meanB;
            numerator += diffA * diffB;
            denomA += diffA * diffA;
            denomB += diffB * diffB;
        }

        const denom = Math.sqrt(denomA * denomB);
        return denom === 0 ? 0 : numerator / denom;
    },

    // Combined similarity using multiple strategies
    computeSimilarity(envelope1, envelope2, returnDiagnostics = false) {
        const len1 = envelope1.length;
        const len2 = envelope2.length;
        const durationRatio = Math.min(len1, len2) / Math.max(len1, len2);

        if (len1 < 3 || len2 < 3) {
            if (returnDiagnostics) {
                return { similarity: 0, diagnostics: { error: 'Audio too short' } };
            }
            return 0;
        }

        const resampled = this.correlationResampled(envelope1, envelope2);
        const shape = this.shapeSimilarity(envelope1, envelope2);
        const cosine = this.cosineSimilarity(envelope1, envelope2);

        const energy1 = envelope1.reduce((s, x) => s + x, 0) / len1;
        const energy2 = envelope2.reduce((s, x) => s + x, 0) / len2;
        const energyRatio = Math.min(energy1, energy2) / Math.max(energy1, energy2 || 0.001);

        const isMobile = this.isMobileDevice();
        const energyGateThreshold = isMobile ? 0.25 : 0.3;
        let similarity;
        if (energyRatio < energyGateThreshold) {
            similarity = energyRatio;
        } else {
            similarity = cosine * (0.7 + 0.3 * energyRatio);
        }

        if (returnDiagnostics) {
            return {
                similarity,
                diagnostics: {
                    resampled,
                    shape,
                    cosine,
                    energyRatio,
                    durationRatio,
                    templateLength: len1,
                    sampleLength: len2
                }
            };
        }

        return similarity;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AudioUtils;
}

