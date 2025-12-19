// Mantra Counter App
// Uses Web Audio API for audio pattern matching

class MantraCounter {
    constructor() {
        // Audio context and nodes
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.sourceNode = null;
        this.scriptProcessor = null;

        // State
        this.isRecordingTemplate = false;
        this.isListening = false;
        this.templateBuffer = null;
        this.templateEnvelope = null;
        this.templateDuration = 0;
        this.goalReached = false;

        // Counter state
        this.count = 0; // Always start at 0 on page load
        this.goal = 33; // Default goal
        this.lastMatchTime = 0;
        this.inCooldown = false; // Prevent double counting

        // Settings
        this.similarityThreshold = 0.75; // 75% - works well with cosine + energy weighting
        this.debounceTime = 3000; // ms - increased to prevent double counting
        this.matchCooldown = 4000; // ms - ignore all detections for this long after a match
        this.micSensitivity = 1.0; // Gain multiplier for mic input
        this.gainNode = null; // Audio gain node

        // Recording buffers
        this.recordingChunks = [];
        this.audioBuffer = [];

        // Test mode
        this.testMode = false;
        this.testPhase = null; // 'template' | 'repetition'
        this.testRepetitions = [];
        this.testRepetitionCount = 0;

        // DOM elements
        this.elements = {};

        // Waveform visualization
        this.waveformCanvas = null;
        this.waveformCtx = null;
        this.animationId = null;

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadState();
        this.setupCanvas();
    }

    cacheElements() {
        this.elements = {
            goalInput: document.getElementById('goal-input'),
            setGoalBtn: document.getElementById('set-goal-btn'),
            currentCount: document.getElementById('current-count'),
            goalDisplay: document.getElementById('goal-display'),
            progressBar: document.getElementById('progress-bar'),
            progressPercent: document.getElementById('progress-percent'),
            status: document.getElementById('status'),
            mainActionBtn: document.getElementById('main-action-btn'),
            resetCounterBtn: document.getElementById('reset-counter-btn'),
            resetMantraBtn: document.getElementById('reset-mantra-btn'),
            manualIncrementBtn: document.getElementById('manual-increment-btn'),
            waveform: document.getElementById('waveform'),
            testModeToggle: document.getElementById('test-mode-toggle'),
            testControls: document.querySelector('.test-controls'),
            runTestBtn: document.getElementById('run-test-btn'),
            testResults: document.getElementById('test-results'),
            thresholdSlider: document.getElementById('threshold-slider'),
            thresholdValue: document.getElementById('threshold-value'),
            debounceSlider: document.getElementById('debounce-slider'),
            debounceValue: document.getElementById('debounce-value'),
            sensitivitySlider: document.getElementById('sensitivity-slider'),
            sensitivityValue: document.getElementById('sensitivity-value'),
            matchLog: document.getElementById('match-log')
        };

        // Button state tracking
        this.buttonState = 'record'; // 'record' | 'confirm' | 'listening' | 'stop'

        // Initialize button state
        if (this.templateEnvelope) {
            this.buttonState = 'listening';
            this.elements.resetMantraBtn.style.display = 'inline-block';
        }
        // Show reset counter button if count > 0 (though it should always be 0 on load now)
        if (this.count > 0) {
            this.elements.resetCounterBtn.style.display = 'inline-block';
        }
        this.updateMainButton();
    }

    bindEvents() {
        this.elements.setGoalBtn.addEventListener('click', () => this.setGoal());
        this.elements.mainActionBtn.addEventListener('click', () => this.handleMainAction());
        this.elements.resetCounterBtn.addEventListener('click', () => this.resetCounter());
        this.elements.resetMantraBtn.addEventListener('click', () => this.resetMantra());
        this.elements.manualIncrementBtn.addEventListener('click', () => this.manualIncrement());

        this.elements.testModeToggle.addEventListener('change', (e) => {
            this.testMode = e.target.checked;
            this.elements.testControls.style.display = this.testMode ? 'block' : 'none';
        });

        this.elements.runTestBtn.addEventListener('click', () => this.runTest());

        this.elements.thresholdSlider.addEventListener('input', (e) => {
            this.similarityThreshold = parseFloat(e.target.value);
            this.elements.thresholdValue.textContent = this.similarityThreshold.toFixed(2);
        });

        this.elements.debounceSlider.addEventListener('input', (e) => {
            this.debounceTime = parseInt(e.target.value);
            this.elements.debounceValue.textContent = this.debounceTime;
        });

        const cooldownSlider = document.getElementById('cooldown-slider');
        const cooldownValue = document.getElementById('cooldown-value');
        if (cooldownSlider && cooldownValue) {
            cooldownSlider.addEventListener('input', (e) => {
                this.matchCooldown = parseInt(e.target.value);
                cooldownValue.textContent = this.matchCooldown;
            });
        }

        if (this.elements.sensitivitySlider && this.elements.sensitivityValue) {
            this.elements.sensitivitySlider.addEventListener('input', (e) => {
                this.micSensitivity = parseFloat(e.target.value);
                this.elements.sensitivityValue.textContent = this.micSensitivity.toFixed(1);
                // Update gain node if it exists
                if (this.gainNode) {
                    this.gainNode.gain.value = this.micSensitivity;
                }
            });
        }

        // Enter key for goal input
        this.elements.goalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.setGoal();
        });
    }

    setupCanvas() {
        this.waveformCanvas = this.elements.waveform;
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.resizeCanvas();

        // Re-resize on window resize
        window.addEventListener('resize', () => {
            this.resizeCanvas();
        });
    }

    resizeCanvas() {
        if (!this.waveformCanvas || !this.waveformCtx) return;
        this.waveformCanvas.width = this.waveformCanvas.offsetWidth * window.devicePixelRatio;
        this.waveformCanvas.height = this.waveformCanvas.offsetHeight * window.devicePixelRatio;
        this.waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    // State persistence
    loadState() {
        const saved = localStorage.getItem('mantraCounter');
        if (saved) {
            const state = JSON.parse(saved);
            // Only load goal, not count (count always starts at 0)
            this.goal = state.goal || 33;
        }
        // Update input field with loaded goal
        this.elements.goalInput.value = this.goal;
        this.updateDisplay();
    }

    saveState() {
        // Only save goal, not count (count resets on reload)
        localStorage.setItem('mantraCounter', JSON.stringify({
            goal: this.goal
        }));
    }

    // Goal management
    setGoal() {
        const newGoal = parseInt(this.elements.goalInput.value) || 33;
        this.goal = Math.max(1, newGoal);
        this.elements.goalInput.value = this.goal;

        // Reset goal reached flag if count is below new goal
        if (this.count < this.goal) {
            this.goalReached = false;
        }

        this.updateDisplay();
        this.saveState();
    }

    // Display updates
    updateDisplay() {
        this.elements.currentCount.textContent = this.count;
        this.elements.goalDisplay.textContent = this.goal;

        const percent = Math.min(100, (this.count / this.goal) * 100);
        this.elements.progressBar.style.width = `${percent}%`;
        this.elements.progressPercent.textContent = `${Math.round(percent)}%`;
    }

    setStatus(message, className = '') {
        this.elements.status.textContent = message;
        this.elements.status.className = 'status' + (className ? ` ${className}` : '');
    }

    logMatch(score) {
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = `
            <span class="timestamp">${time}</span>
            <span>Match detected</span>
            <span class="score ${score < 0.8 ? 'low' : ''}">${(score * 100).toFixed(1)}%</span>
        `;
        this.elements.matchLog.insertBefore(entry, this.elements.matchLog.firstChild);

        // Keep only last 50 entries
        while (this.elements.matchLog.children.length > 50) {
            this.elements.matchLog.removeChild(this.elements.matchLog.lastChild);
        }
    }

    // Detect if we're on a mobile device
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 768 && 'ontouchstart' in window);
    }

    // Audio initialization
    async initAudio() {
        if (this.audioContext) {
            // Resume audio context if suspended (required for iOS)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            // Update gain if already initialized
            if (this.gainNode) {
                this.gainNode.gain.value = this.micSensitivity;
            }
            return;
        }

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Mobile devices often ignore audio constraints, so we make them optional
            const isMobile = this.isMobileDevice();
            const audioConstraints = isMobile ? {
                // On mobile, let the browser use its defaults (often better for mobile mics)
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                // But try to get high quality
                sampleRate: 48000,
                channelCount: 1
            } : {
                // On desktop, disable processing for raw audio
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints
            });

            // Resume audio context (required for iOS)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Add gain node for sensitivity control
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.micSensitivity;

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = isMobile ? 0.5 : 0.3; // More smoothing on mobile

            // Connect: source -> gain -> analyser
            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(this.analyser);

            console.log('Audio initialized successfully', {
                isMobile,
                sampleRate: this.audioContext.sampleRate,
                state: this.audioContext.state,
                constraints: audioConstraints
            });

            // Show helpful message for mobile users
            if (isMobile) {
                console.log('Mobile device detected - using mobile-optimized audio settings');
                console.log('Tip: If detection is not working well, try adjusting the Mic Sensitivity slider');
            }
        } catch (err) {
            console.error('Error initializing audio:', err);
            this.setStatus('Error: Could not access microphone');
            throw err;
        }
    }

    // Main action button handler
    handleMainAction() {
        switch (this.buttonState) {
            case 'record':
                this.startRecordingTemplate();
                break;
            case 'confirm':
                this.confirmTemplate();
                break;
            case 'listening':
                this.startListening();
                break;
            case 'stop':
                this.stopListening();
                break;
        }
    }

    updateMainButton() {
        const btn = this.elements.mainActionBtn;
        switch (this.buttonState) {
            case 'record':
                btn.textContent = 'Record';
                btn.className = 'btn-record';
                btn.disabled = false;
                break;
            case 'confirm':
                btn.textContent = 'Confirm';
                btn.className = 'btn-record recording';
                btn.disabled = false;
                break;
            case 'listening':
                btn.textContent = 'Start';
                btn.className = 'btn-record';
                btn.disabled = false;
                break;
            case 'stop':
                btn.textContent = 'Stop';
                btn.className = 'btn-record listening';
                btn.disabled = false;
                break;
        }
    }

    // Template recording
    async startRecordingTemplate() {
        await this.initAudio();

        // Ensure audio context is running (required for iOS)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            console.log('Audio context resumed for recording');
        }

        this.isRecordingTemplate = true;
        this.audioBuffer = [];

        this.buttonState = 'confirm';
        this.updateMainButton();
        this.elements.resetMantraBtn.style.display = 'none';
        this.setStatus('Recording mantra... Click to confirm when done', 'recording');

        // Start capturing audio samples
        this.startCapturing();
        this.startVisualization();
    }

    startCapturing() {
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        const capture = () => {
            if (!this.isRecordingTemplate && !this.isListening) return;

            this.analyser.getFloatTimeDomainData(dataArray);

            if (this.isRecordingTemplate) {
                // Store samples for template
                this.audioBuffer.push(...dataArray);
            }

            requestAnimationFrame(capture);
        };

        capture();
    }

    confirmTemplate() {
        if (this.audioBuffer.length === 0) {
            this.setStatus('No audio recorded. Try again.');
            return;
        }

        this.isRecordingTemplate = false;

        // Process and trim the recorded template
        const rawBuffer = new Float32Array(this.audioBuffer);
        const trimmed = this.trimSilence(rawBuffer);

        this.templateBuffer = trimmed.data;
        this.templateEnvelope = this.extractEnvelope(this.templateBuffer);
        this.templateDuration = trimmed.trimmedDuration;

        console.log(`Template recorded: ${trimmed.originalDuration.toFixed(2)}s → ${trimmed.trimmedDuration.toFixed(2)}s (trimmed)`);
        console.log('Template envelope length:', this.templateEnvelope.length);

        // Update UI
        this.buttonState = 'listening';
        this.updateMainButton();
        this.elements.resetMantraBtn.style.display = 'inline-block';
        this.elements.resetCounterBtn.style.display = 'inline-block';

        this.setStatus(`Mantra saved: ${this.templateDuration.toFixed(1)}s. Click to start listening.`);
        this.stopVisualization();
    }

    // Trim silence from start and end of audio buffer
    trimSilence(audioData, threshold = 0.02) {
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
                startIndex = Math.max(0, rmsValues[i].index - windowSize); // Include a bit before
                break;
            }
        }

        for (let i = rmsValues.length - 1; i >= 0; i--) {
            if (rmsValues[i].rms > threshold) {
                endIndex = Math.min(audioData.length, rmsValues[i].index + windowSize * 2); // Include a bit after
                break;
            }
        }

        const trimmed = audioData.slice(startIndex, endIndex);
        const trimmedDuration = trimmed.length / this.audioContext.sampleRate;
        const originalDuration = audioData.length / this.audioContext.sampleRate;

        console.log(`Trimmed: ${originalDuration.toFixed(1)}s → ${trimmedDuration.toFixed(1)}s (removed ${(originalDuration - trimmedDuration).toFixed(1)}s silence)`);

        return {
            data: trimmed,
            originalDuration,
            trimmedDuration,
            silenceRemoved: originalDuration - trimmedDuration
        };
    }

    // Envelope extraction - extracts amplitude envelope from audio
    extractEnvelope(audioData, windowSize = 1024) {
        const envelope = [];
        for (let i = 0; i < audioData.length; i += windowSize) {
            const slice = audioData.slice(i, Math.min(i + windowSize, audioData.length));
            // RMS (root mean square) for energy
            const rms = Math.sqrt(slice.reduce((sum, x) => sum + x * x, 0) / slice.length);
            envelope.push(rms);
        }
        return new Float32Array(envelope);
    }

    // Normalize array to 0-1 range
    normalize(arr) {
        const max = Math.max(...arr);
        const min = Math.min(...arr);
        const range = max - min;
        if (range === 0) return arr.map(() => 0);
        return arr.map(x => (x - min) / range);
    }

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
    }

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
    }

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
    }

    // Correlation with resampling (stretch to match lengths)
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
    }

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

        // Compute multiple strategies
        const resampled = this.correlationResampled(envelope1, envelope2);
        const shape = this.shapeSimilarity(envelope1, envelope2);
        const cosine = this.cosineSimilarity(envelope1, envelope2);

        // Energy check - compare average energy levels
        const energy1 = envelope1.reduce((s, x) => s + x, 0) / len1;
        const energy2 = envelope2.reduce((s, x) => s + x, 0) / len2;
        const energyRatio = Math.min(energy1, energy2) / Math.max(energy1, energy2 || 0.001);

        // Use cosine as primary, with energy gating to filter noise
        // If energy ratio is very low (< 30%), it's likely background noise, not a real mantra
        // On mobile, be slightly more lenient with energy gating due to different mic characteristics
        const isMobile = this.isMobileDevice();
        const energyGateThreshold = isMobile ? 0.25 : 0.3;
        let similarity;
        if (energyRatio < energyGateThreshold) {
            similarity = energyRatio; // Return very low score for noise
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

    // Listening mode
    async startListening() {
        if (!this.templateEnvelope) {
            this.setStatus('No template recorded');
            return;
        }

        await this.initAudio();

        // Ensure audio context is running (required for iOS)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            console.log('Audio context resumed for listening');
        }

        this.isListening = true;
        this.buttonState = 'stop';
        this.updateMainButton();
        this.setStatus('Listening for mantras...', 'listening');

        this.startVisualization();
        this.startDetection();
    }

    startDetection() {
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        // Sliding window buffer - store enough samples for template duration + margin
        // We'll continuously check the last N seconds where N = template duration
        const windowSamples = Math.ceil(this.templateBuffer.length * 2); // Store 2x template for lookback
        let slidingBuffer = new Float32Array(windowSamples);
        let bufferIndex = 0;

        // Continuous matching state
        const isMobile = this.isMobileDevice();
        let matchStreak = 0; // How many consecutive frames had high similarity
        // Mobile may need slightly lower streak requirement due to different audio characteristics
        const minMatchStreak = isMobile ? 6 : 8; // Require sustained match (increased to prevent counting on transitions)
        const checkInterval = 10; // Check every N frames (not every frame for performance)
        let frameCount = 0;

        // Track energy levels to detect transitions
        let recentEnergies = [];
        const energyHistorySize = 20;

        // Energy-based activity detection (but don't wait for silence)
        // Mobile devices may have different audio levels, so adjust threshold
        const minEnergyThreshold = isMobile ? 0.002 : 0.005; // Lower threshold for mobile

        const detect = () => {
            if (!this.isListening) return;

            this.analyser.getFloatTimeDomainData(dataArray);

            // Calculate current RMS for activity detection (with sensitivity applied)
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);

            // Track energy history to detect transitions
            recentEnergies.push(rms);
            if (recentEnergies.length > energyHistorySize) {
                recentEnergies.shift();
            }

            // Calculate energy trend (is it dropping rapidly? = transition)
            const avgRecentEnergy = recentEnergies.reduce((a, b) => a + b, 0) / recentEnergies.length;
            const recentMax = Math.max(...recentEnergies);
            const energyDrop = recentMax > 0 ? (recentMax - avgRecentEnergy) / recentMax : 0;
            const isTransitioning = energyDrop > 0.3 && recentEnergies.length >= 10; // Significant drop = transition

            // Add to sliding buffer
            for (let i = 0; i < dataArray.length; i++) {
                slidingBuffer[bufferIndex % windowSamples] = dataArray[i];
                bufferIndex++;
            }

            frameCount++;

            // Only check for matches periodically (not every frame) and when there's some activity
            // Skip during transitions (loud->soft) to prevent counting on humming
            if (frameCount % checkInterval === 0 && rms > minEnergyThreshold && !isTransitioning) {
                const now = Date.now();

                // Skip if in cooldown
                if (this.inCooldown) {
                    matchStreak = 0; // Reset streak during cooldown
                    requestAnimationFrame(detect);
                    return;
                }

                // Extract the most recent window (last template duration worth of samples)
                const windowStart = bufferIndex - this.templateBuffer.length;
                const windowEnd = bufferIndex;

                // Extract segment from sliding buffer
                const segment = new Float32Array(this.templateBuffer.length);
                for (let i = 0; i < this.templateBuffer.length; i++) {
                    const idx = (windowStart + i + windowSamples) % windowSamples;
                    segment[i] = slidingBuffer[idx];
                }

                // Check similarity
                const segmentEnvelope = this.extractEnvelope(segment);
                const similarity = this.computeSimilarity(this.templateEnvelope, segmentEnvelope);

                // Debug logging for mobile (helps diagnose detection issues)
                // Only log every 100 frames to avoid spam
                if (isMobile && frameCount % (checkInterval * 10) === 0) {
                    console.log('Detection check:', {
                        rms: rms.toFixed(4),
                        similarity: (similarity * 100).toFixed(1) + '%',
                        threshold: (this.similarityThreshold * 100).toFixed(1) + '%',
                        streak: matchStreak,
                        inCooldown: this.inCooldown
                    });
                }

                // Track match streak - need sustained high similarity
                if (similarity >= this.similarityThreshold) {
                    matchStreak++;

                    // Only trigger match after sustained high similarity
                    // This prevents counting during transitions (loud->soft) or brief matches
                    if (matchStreak >= minMatchStreak &&
                        now - this.lastMatchTime > this.debounceTime) {

                        console.log(`Match detected! Similarity: ${(similarity * 100).toFixed(1)}%, Streak: ${matchStreak}`);
                        this.lastMatchTime = now;
                        this.onMatch(similarity);
                        matchStreak = 0; // Reset after match
                    }
                } else {
                    // Reset streak if similarity drops
                    if (matchStreak > 0) {
                        matchStreak = Math.max(0, matchStreak - 1); // Gradual decay
                    }
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    }

    onMatch(score) {
        // Enter cooldown to prevent double counting
        this.inCooldown = true;

        this.count++;
        this.updateDisplay();
        // Don't save count (it resets on reload)
        this.logMatch(score);

        // Show reset counter button if count > 0
        if (this.count > 0) {
            this.elements.resetCounterBtn.style.display = 'inline-block';
        }

        console.log(`Match! Count: ${this.count}, Score: ${(score * 100).toFixed(1)}%`);

        // Visual feedback
        this.elements.currentCount.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.elements.currentCount.style.transform = 'scale(1)';
        }, 200);

        // Check if goal reached
        if (this.count >= this.goal && !this.goalReached) {
            this.goalReached = true;
            this.setStatus(`Goal reached! ${this.count}/${this.goal}`, 'listening');
            // Wait for silence before celebrating
            this.waitForSilenceThenCelebrate();
        }

        // Exit cooldown after matchCooldown period
        setTimeout(() => {
            this.inCooldown = false;
            console.log('Cooldown ended - ready for next detection');
        }, this.matchCooldown);
    }

    stopListening() {
        this.isListening = false;
        this.buttonState = 'listening';
        this.updateMainButton();
        this.setStatus('Listening stopped');
        this.stopVisualization();

        // Stop media stream to turn off mic
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Clean up audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
            this.gainNode = null;
            this.sourceNode = null;
            this.analyser = null;
        }
    }

    resetCounter() {
        this.count = 0;
        this.goalReached = false;
        this.updateDisplay();
        // Hide reset button when count is 0
        this.elements.resetCounterBtn.style.display = 'none';
        this.setStatus('Counter reset');
    }

    manualIncrement() {
        this.count++;
        this.updateDisplay();
        this.logMatch(1.0); // Log as 100% match for manual increments

        // Show reset counter button if count > 0
        if (this.count > 0) {
            this.elements.resetCounterBtn.style.display = 'inline-block';
        }

        // Visual feedback
        this.elements.currentCount.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.elements.currentCount.style.transform = 'scale(1)';
        }, 200);

        // Check if goal reached
        if (this.count >= this.goal && !this.goalReached) {
            this.goalReached = true;
            this.setStatus(`Goal reached! ${this.count}/${this.goal}`, 'listening');
            this.celebrateCompletion(true); // true = keep visible (no auto-hide)
        }
    }

    resetMantra() {
        if (confirm('Reset mantra template? You will need to record it again.')) {
            this.stopListening();
            this.templateBuffer = null;
            this.templateEnvelope = null;
            this.templateDuration = 0;
            this.audioBuffer = [];

            this.buttonState = 'record';
            this.updateMainButton();
            this.elements.resetMantraBtn.style.display = 'none';
            this.elements.resetCounterBtn.style.display = 'none';

            this.setStatus('Ready to record mantra template');
        }
    }

    // Visualization
    startVisualization() {
        // Ensure canvas is properly sized
        this.resizeCanvas();

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isRecordingTemplate && !this.isListening) {
                this.clearCanvas();
                return;
            }

            this.animationId = requestAnimationFrame(draw);

            this.analyser.getByteTimeDomainData(dataArray);

            const width = this.waveformCanvas.offsetWidth;
            const height = this.waveformCanvas.offsetHeight;

            this.waveformCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            this.waveformCtx.fillRect(0, 0, width, height);

            this.waveformCtx.lineWidth = 2;
            this.waveformCtx.strokeStyle = this.isRecordingTemplate ? '#e94560' : '#4ade80';
            this.waveformCtx.beginPath();

            const sliceWidth = width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * height) / 2;

                if (i === 0) {
                    this.waveformCtx.moveTo(x, y);
                } else {
                    this.waveformCtx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            this.waveformCtx.lineTo(width, height / 2);
            this.waveformCtx.stroke();
        };

        draw();
    }

    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.clearCanvas();
    }

    clearCanvas() {
        const width = this.waveformCanvas.offsetWidth;
        const height = this.waveformCanvas.offsetHeight;
        this.waveformCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.waveformCtx.fillRect(0, 0, width, height);
    }

    // Test mode - interactive button-driven recording
    async runTest() {
        this.testRepetitions = [];
        this.testRepEnvelopes = []; // Store envelopes for export
        this.testCurrentRep = 0;
        this.testResolve = null;

        await this.initAudio();

        this.elements.testResults.innerHTML = `
            <div class="test-instructions">
                <p><strong>Step 1:</strong> Record your template mantra</p>
                <p class="test-hint">Tip: Start chanting right away, stop recording right after you finish</p>
                <button id="test-record-btn" class="btn-primary">Start Recording</button>
                <button id="test-stop-btn" class="btn-danger" disabled>Stop Recording</button>
            </div>
            <div id="test-status"></div>
        `;

        const recordBtn = document.getElementById('test-record-btn');
        const stopBtn = document.getElementById('test-stop-btn');
        const statusDiv = document.getElementById('test-status');

        // Phase 1: Record template
        await this.recordTestPhase(recordBtn, stopBtn, statusDiv, 'template');

        // Trim silence from template
        const templateRaw = new Float32Array(this.audioBuffer);
        const templateTrimmed = this.trimSilence(templateRaw);
        this.templateBuffer = templateTrimmed.data;
        this.templateEnvelope = this.extractEnvelope(this.templateBuffer);
        this.templateDuration = templateTrimmed.trimmedDuration;

        statusDiv.innerHTML = `
            <div class="test-result pass">
                <strong>Template:</strong> ${templateTrimmed.trimmedDuration.toFixed(1)}s
                (trimmed ${templateTrimmed.silenceRemoved.toFixed(1)}s silence)
            </div>
        `;

        // Phase 2: Record 5 repetitions
        for (let i = 0; i < 5; i++) {
            this.elements.testResults.querySelector('.test-instructions p').innerHTML =
                `<strong>Step ${i + 2}:</strong> Record repetition ${i + 1} of 5`;

            await this.recordTestPhase(recordBtn, stopBtn, statusDiv, 'repetition', i);

            // Trim silence from repetition
            const repRaw = new Float32Array(this.audioBuffer);
            const repTrimmed = this.trimSilence(repRaw);
            const repEnvelope = this.extractEnvelope(repTrimmed.data);

            // Store envelope for export
            this.testRepEnvelopes.push(repEnvelope);

            // Get similarity with diagnostics
            const result = this.computeSimilarity(this.templateEnvelope, repEnvelope, true);
            const similarity = result.similarity;
            const diag = result.diagnostics;

            this.testRepetitions.push({
                index: i + 1,
                similarity,
                duration: repTrimmed.trimmedDuration,
                diagnostics: diag
            });

            const isPassed = similarity >= this.similarityThreshold;
            const durationDiff = Math.abs(repTrimmed.trimmedDuration - this.templateDuration);
            const durationWarning = durationDiff > 2 ? '⚠️ duration differs' : '';

            statusDiv.innerHTML += `
                <div class="test-result ${isPassed ? 'pass' : 'fail'}">
                    <div><strong>Rep ${i + 1}:</strong> ${(similarity * 100).toFixed(1)}% ${isPassed ? '✓' : '✗'}</div>
                    <div class="test-diagnostics">
                        Duration: ${repTrimmed.trimmedDuration.toFixed(1)}s (template: ${this.templateDuration.toFixed(1)}s) ${durationWarning}<br>
                        Duration match: ${(diag.durationRatio * 100).toFixed(0)}% |
                        Energy match: ${(diag.energyRatio * 100).toFixed(0)}%
                    </div>
                </div>
            `;

            console.log(`Repetition ${i + 1}:`, diag);
        }

        // Phase 3: Show final results
        this.analyzeTestResults();
    }

    recordTestPhase(recordBtn, stopBtn, statusDiv, phase, repIndex = 0) {
        return new Promise((resolve) => {
            this.audioBuffer = [];

            const startRecording = async () => {
                this.audioBuffer = [];
                this.isRecordingTemplate = true;
                this.startCapturing();
                this.startVisualization();

                recordBtn.disabled = true;
                stopBtn.disabled = false;
                recordBtn.textContent = 'Recording...';
            };

            const stopRecording = () => {
                this.isRecordingTemplate = false;
                this.stopVisualization();

                recordBtn.disabled = false;
                stopBtn.disabled = true;
                recordBtn.textContent = 'Start Recording';

                // Clean up listeners
                recordBtn.removeEventListener('click', startRecording);
                stopBtn.removeEventListener('click', stopRecording);

                resolve();
            };

            recordBtn.addEventListener('click', startRecording);
            stopBtn.addEventListener('click', stopRecording);
        });
    }

    analyzeTestResults() {
        const passed = this.testRepetitions.filter(r => r.similarity >= this.similarityThreshold).length;

        this.elements.testResults.querySelector('.test-instructions').innerHTML = `
            <h4>Test Complete!</h4>
            <div style="margin-top: 1rem; font-weight: bold;">
                <div>Passed: ${passed}/5 (threshold: ${(this.similarityThreshold * 100).toFixed(0)}%)</div>
                <div style="color: ${passed >= 4 ? '#4ade80' : '#ef4444'}; margin-top: 0.5rem;">
                    ${passed >= 4 ? '✓ Test PASSED - Detection is working!' : '✗ Test FAILED - Try adjusting threshold or re-record'}
                </div>
            </div>
            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button id="test-again-btn" class="btn-secondary">Run Test Again</button>
                <button id="export-fixtures-btn" class="btn-primary">Export as Test Fixtures</button>
            </div>
        `;

        document.getElementById('test-again-btn').addEventListener('click', () => this.runTest());
        document.getElementById('export-fixtures-btn').addEventListener('click', () => this.exportTestFixtures());
    }

    exportTestFixtures() {
        // Convert Float32Arrays to regular arrays for JSON serialization
        const fixtures = {
            version: 1,
            sampleRate: this.audioContext.sampleRate,
            createdAt: new Date().toISOString(),
            template: {
                // Store envelope (much smaller than raw audio)
                envelope: Array.from(this.templateEnvelope),
                duration: this.templateDuration
            },
            repetitions: this.testRepetitions.map((rep, i) => ({
                index: rep.index,
                envelope: Array.from(this.testRepEnvelopes[i]),
                duration: rep.duration,
                expectedMatch: true // All reps should match the template
            }))
        };

        // Download as JSON
        const blob = new Blob([JSON.stringify(fixtures, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mantra-test-fixtures.json';
        a.click();
        URL.revokeObjectURL(url);

        console.log('Exported test fixtures:', fixtures);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Wait for silence before celebrating (so user can finish their chant)
    waitForSilenceThenCelebrate() {
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        const silenceThreshold = 0.01;
        let silenceFrames = 0;
        const requiredSilenceFrames = 60; // ~1 second of silence

        const checkSilence = () => {
            if (!this.isListening) {
                // If stopped listening, celebrate immediately
                this.celebrateCompletion(false); // Auto-hide after 5 seconds
                return;
            }

            this.analyser.getFloatTimeDomainData(dataArray);
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);

            if (rms < silenceThreshold) {
                silenceFrames++;
                if (silenceFrames >= requiredSilenceFrames) {
                    this.celebrateCompletion(false); // Auto-hide after 5 seconds
                    return;
                }
            } else {
                silenceFrames = 0; // Reset if sound detected
            }

            requestAnimationFrame(checkSilence);
        };

        checkSilence();
    }

    // Celebration effect when goal is reached
    celebrateCompletion(keepVisible = false) {
        // Stop listening and turn off mic (only if actually listening)
        if (this.isListening) {
            this.stopListening();
        }

        const overlay = document.getElementById('completion-overlay');
        const completionCount = document.getElementById('completion-count');
        const dismissBtn = document.getElementById('dismiss-completion-btn');

        if (!overlay) return;

        completionCount.textContent = `${this.count} mantras completed`;

        // Show overlay
        overlay.style.display = 'flex';
        overlay.classList.add('active');

        // Track if user wants to keep it visible
        let userKeepVisible = keepVisible; // Start with passed parameter
        let autoHideTimer = null;

        // Dismiss button handler
        const dismiss = () => {
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 1000);
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
            }
        };

        if (dismissBtn) {
            dismissBtn.onclick = dismiss;
        }

        // Play zen chime sound
        this.playCompletionSound().catch(err => {
            console.warn('Completion sound failed:', err);
        });

        // Create particles
        this.createParticles();

        // Auto-hide after 5 seconds (unless keepVisible is true or user toggles it)
        if (!keepVisible) {
            autoHideTimer = setTimeout(() => {
                if (!userKeepVisible) {
                    dismiss();
                }
            }, 5000);
        }

        // Click anywhere on overlay to toggle keep visible
        overlay.onclick = (e) => {
            // Don't toggle if clicking the dismiss button
            if (e.target === dismissBtn || dismissBtn.contains(e.target)) {
                return;
            }
            // Toggle keep visible
            userKeepVisible = !userKeepVisible;
            if (userKeepVisible) {
                // Cancel auto-hide
                if (autoHideTimer) {
                    clearTimeout(autoHideTimer);
                    autoHideTimer = null;
                }
                overlay.style.cursor = 'pointer';
            } else {
                // Restart auto-hide
                autoHideTimer = setTimeout(() => {
                    dismiss();
                }, 5000);
                overlay.style.cursor = 'default';
            }
        };
    }

    async playCompletionSound() {
        // If audio context is closed or doesn't exist, create a new one just for the sound
        let audioContext = this.audioContext;
        let shouldCleanup = false;

        if (!audioContext || audioContext.state === 'closed') {
            // Create a temporary audio context just for the completion sound
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            shouldCleanup = true;
            console.log('Created new audio context for completion sound');
        }

        try {
            // Resume audio context if suspended (required for iOS)
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('Audio context resumed for completion sound');
            }

            // Create a gentle gong-like sound with fade in/out
            // Using multiple harmonics for a rich, resonant sound
            const baseFreq = 220; // A3 - lower, more mellow
            const harmonics = [
                { freq: baseFreq, amplitude: 0.15, delay: 0 },
                { freq: baseFreq * 2, amplitude: 0.12, delay: 50 },
                { freq: baseFreq * 3, amplitude: 0.08, delay: 100 },
                { freq: baseFreq * 4.76, amplitude: 0.06, delay: 150 }, // Approximate 5th harmonic
            ];

            const duration = 2.5; // Longer, more meditative
            const fadeInTime = 0.4;
            const fadeOutTime = 1.8;

            harmonics.forEach((harmonic, i) => {
                setTimeout(() => {
                    try {
                        const osc = audioContext.createOscillator();
                        const gain = audioContext.createGain();

                        // Use a mix of sine and triangle for warmer tone
                        osc.type = i === 0 ? 'sine' : 'triangle';
                        osc.frequency.setValueAtTime(harmonic.freq, audioContext.currentTime);

                        const now = audioContext.currentTime;

                        // Fade in
                        gain.gain.setValueAtTime(0, now);
                        gain.gain.linearRampToValueAtTime(harmonic.amplitude, now + fadeInTime);

                        // Hold
                        gain.gain.setValueAtTime(harmonic.amplitude, now + fadeInTime);

                        // Fade out (long, gentle decay)
                        gain.gain.exponentialRampToValueAtTime(0.001, now + fadeOutTime);

                        osc.connect(gain);
                        gain.connect(audioContext.destination);

                        osc.start(now);
                        osc.stop(now + duration);
                    } catch (err) {
                        console.warn('Error playing harmonic:', err);
                    }
                }, harmonic.delay);
            });

            // Clean up temporary audio context after sound finishes (if we created one)
            if (shouldCleanup) {
                setTimeout(() => {
                    try {
                        if (audioContext && audioContext.state !== 'closed') {
                            audioContext.close().catch(console.error);
                        }
                    } catch (err) {
                        console.warn('Error closing temporary audio context:', err);
                    }
                }, duration * 1000 + 500); // Wait for sound to finish + buffer
            }
        } catch (err) {
            console.warn('Error playing completion sound:', err);
            // Clean up temporary audio context on error
            if (shouldCleanup && audioContext && audioContext.state !== 'closed') {
                audioContext.close().catch(console.error);
            }
        }
    }

    createParticles() {
        const particlesContainer = document.getElementById('particles');
        if (!particlesContainer) return;

        particlesContainer.innerHTML = '';

        const particleCount = 30;
        const colors = ['#e94560', '#4ade80', '#fbbf24', '#60a5fa', '#a78bfa'];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';

            const size = Math.random() * 8 + 4;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const startX = Math.random() * 100;
            const startY = Math.random() * 100;
            const duration = Math.random() * 2 + 3;
            const delay = Math.random() * 0.5;

            // Random direction for particle
            const angle = Math.random() * Math.PI * 2;
            const distance = 100 + Math.random() * 100;
            const dx = Math.cos(angle) * distance;
            const dy = Math.sin(angle) * distance;

            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.background = color;
            particle.style.left = `${startX}%`;
            particle.style.top = `${startY}%`;
            particle.style.animationDelay = `${delay}s`;
            particle.style.animationDuration = `${duration}s`;
            particle.style.setProperty('--dx', `${dx}px`);
            particle.style.setProperty('--dy', `${dy}px`);

            particlesContainer.appendChild(particle);
        }
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.mantraCounter = new MantraCounter();
});

