// Detection modes for mantra counting
// Supports both energy-based (breath) and pattern-matching modes

const Detection = {
    // Energy-based detection: counts on silence (deep breaths between chants)
    // Best for slow, sustained chants like "Ohhhhmmm"
    startEnergyDetection(analyser, onMatch, isListening) {
        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        let state = 'waiting';

        const isMobile = AudioUtils.isMobileDevice();
        const loudThreshold = isMobile ? 0.008 : 0.012;
        const transitionThreshold = isMobile ? 0.002 : 0.003;
        const silenceThreshold = isMobile ? 0.0008 : 0.001;

        const minChantDuration = 500;
        const minSilenceDuration = 600;
        const debounceTime = 800;

        let chantStartTime = 0;
        let silenceStartTime = 0;
        let lastCountTime = 0;
        let hasHadLoudSound = false;

        const detect = () => {
            if (!isListening()) return;

            analyser.getFloatTimeDomainData(dataArray);
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);
            const now = Date.now();

            if (now - lastCountTime < debounceTime) {
                requestAnimationFrame(detect);
                return;
            }

            if (state === 'waiting') {
                if (rms > loudThreshold) {
                    state = 'chanting';
                    chantStartTime = now;
                    silenceStartTime = 0;
                    hasHadLoudSound = true;
                    console.log(`Chant started (rms: ${rms.toFixed(4)})`);
                }
            } else if (state === 'chanting') {
                if (rms > loudThreshold) {
                    silenceStartTime = 0;
                    hasHadLoudSound = true;
                } else if (rms > transitionThreshold) {
                    silenceStartTime = 0;
                } else if (rms > silenceThreshold) {
                    if (silenceStartTime === 0) {
                        silenceStartTime = now;
                    }
                } else {
                    if (silenceStartTime === 0) {
                        silenceStartTime = now;
                    }

                    const silenceDuration = now - silenceStartTime;
                    const chantDuration = silenceStartTime > 0 ? silenceStartTime - chantStartTime : now - chantStartTime;

                    if (silenceDuration >= minSilenceDuration &&
                        chantDuration >= minChantDuration &&
                        hasHadLoudSound) {
                        console.log(`Chant completed (${chantDuration.toFixed(0)}ms chant, ${silenceDuration.toFixed(0)}ms silence)`);
                        onMatch(1.0);
                        lastCountTime = now;
                        state = 'waiting';
                        chantStartTime = 0;
                        silenceStartTime = 0;
                        hasHadLoudSound = false;
                    }
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    },

    // Pattern-matching detection: compares audio to a recorded template
    // Best for specific mantras where you want to match a particular sound pattern
    startPatternDetection(analyser, templateEnvelope, templateBuffer, settings, onMatch, isListening) {
        const bufferLength = analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        const windowSamples = Math.ceil(templateBuffer.length * 2);
        let slidingBuffer = new Float32Array(windowSamples);
        let bufferIndex = 0;

        const isMobile = AudioUtils.isMobileDevice();
        let matchStreak = 0;
        const minMatchStreak = isMobile ? 6 : 8;
        const checkInterval = 10;
        let frameCount = 0;

        let recentEnergies = [];
        const energyHistorySize = 20;
        const minEnergyThreshold = isMobile ? 0.002 : 0.005;

        let lastMatchTime = 0;
        let inCooldown = false;

        const detect = () => {
            if (!isListening()) return;

            analyser.getFloatTimeDomainData(dataArray);
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);

            recentEnergies.push(rms);
            if (recentEnergies.length > energyHistorySize) {
                recentEnergies.shift();
            }

            const avgRecentEnergy = recentEnergies.reduce((a, b) => a + b, 0) / recentEnergies.length;
            const recentMax = Math.max(...recentEnergies);
            const energyDrop = recentMax > 0 ? (recentMax - avgRecentEnergy) / recentMax : 0;
            const isTransitioning = energyDrop > 0.3 && recentEnergies.length >= 10;

            for (let i = 0; i < dataArray.length; i++) {
                slidingBuffer[bufferIndex % windowSamples] = dataArray[i];
                bufferIndex++;
            }

            frameCount++;

            if (frameCount % checkInterval === 0 && rms > minEnergyThreshold && !isTransitioning) {
                const now = Date.now();

                if (inCooldown) {
                    matchStreak = 0;
                    requestAnimationFrame(detect);
                    return;
                }

                const windowStart = bufferIndex - templateBuffer.length;
                const segment = new Float32Array(templateBuffer.length);
                for (let i = 0; i < templateBuffer.length; i++) {
                    const idx = (windowStart + i + windowSamples) % windowSamples;
                    segment[i] = slidingBuffer[idx];
                }

                const segmentEnvelope = AudioUtils.extractEnvelope(segment);
                const similarity = AudioUtils.computeSimilarity(templateEnvelope, segmentEnvelope);

                if (similarity >= settings.similarityThreshold) {
                    matchStreak++;

                    if (matchStreak >= minMatchStreak &&
                        now - lastMatchTime > settings.debounceTime) {
                        console.log(`Match detected! Similarity: ${(similarity * 100).toFixed(1)}%, Streak: ${matchStreak}`);
                        lastMatchTime = now;
                        onMatch(similarity);
                        matchStreak = 0;

                        // Enter cooldown
                        inCooldown = true;
                        setTimeout(() => {
                            inCooldown = false;
                        }, settings.matchCooldown);
                    }
                } else {
                    if (matchStreak > 0) {
                        matchStreak = Math.max(0, matchStreak - 1);
                    }
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Detection;
}

