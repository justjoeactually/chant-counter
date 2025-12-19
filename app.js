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

        // Counter state
        this.count = 0;
        this.goal = 108;
        this.lastMatchTime = 0;

        // Settings
        this.similarityThreshold = 0.75; // 75% - works well with cosine + energy weighting
        this.debounceTime = 2000; // ms

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
            recordBtn: document.getElementById('record-btn'),
            confirmBtn: document.getElementById('confirm-btn'),
            startListeningBtn: document.getElementById('start-listening-btn'),
            stopListeningBtn: document.getElementById('stop-listening-btn'),
            resetBtn: document.getElementById('reset-btn'),
            recordingControls: document.querySelector('.recording-controls'),
            listeningControls: document.querySelector('.listening-controls'),
            waveform: document.getElementById('waveform'),
            testModeToggle: document.getElementById('test-mode-toggle'),
            testControls: document.querySelector('.test-controls'),
            runTestBtn: document.getElementById('run-test-btn'),
            testResults: document.getElementById('test-results'),
            thresholdSlider: document.getElementById('threshold-slider'),
            thresholdValue: document.getElementById('threshold-value'),
            debounceSlider: document.getElementById('debounce-slider'),
            debounceValue: document.getElementById('debounce-value'),
            matchLog: document.getElementById('match-log')
        };
    }

    bindEvents() {
        this.elements.setGoalBtn.addEventListener('click', () => this.setGoal());
        this.elements.recordBtn.addEventListener('click', () => this.startRecordingTemplate());
        this.elements.confirmBtn.addEventListener('click', () => this.confirmTemplate());
        this.elements.startListeningBtn.addEventListener('click', () => this.startListening());
        this.elements.stopListeningBtn.addEventListener('click', () => this.stopListening());
        this.elements.resetBtn.addEventListener('click', () => this.resetMantra());

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

        // Enter key for goal input
        this.elements.goalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.setGoal();
        });
    }

    setupCanvas() {
        this.waveformCanvas = this.elements.waveform;
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.waveformCanvas.width = this.waveformCanvas.offsetWidth * window.devicePixelRatio;
        this.waveformCanvas.height = this.waveformCanvas.offsetHeight * window.devicePixelRatio;
        this.waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    // State persistence
    loadState() {
        const saved = localStorage.getItem('mantraCounter');
        if (saved) {
            const state = JSON.parse(saved);
            this.count = state.count || 0;
            this.goal = state.goal || 108;
        }
        this.updateDisplay();
    }

    saveState() {
        localStorage.setItem('mantraCounter', JSON.stringify({
            count: this.count,
            goal: this.goal
        }));
    }

    // Goal management
    setGoal() {
        const newGoal = parseInt(this.elements.goalInput.value) || 108;
        this.goal = Math.max(1, newGoal);
        this.elements.goalInput.value = this.goal;
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

    // Audio initialization
    async initAudio() {
        if (this.audioContext) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.3;

            this.sourceNode.connect(this.analyser);

            console.log('Audio initialized successfully');
        } catch (err) {
            console.error('Error initializing audio:', err);
            this.setStatus('Error: Could not access microphone');
            throw err;
        }
    }

    // Template recording
    async startRecordingTemplate() {
        await this.initAudio();

        this.isRecordingTemplate = true;
        this.audioBuffer = [];

        this.elements.recordBtn.disabled = true;
        this.elements.confirmBtn.disabled = false;
        this.setStatus('Recording mantra... Click Confirm when done', 'recording');

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
        this.elements.recordBtn.disabled = false;
        this.elements.confirmBtn.disabled = true;
        this.elements.recordingControls.style.display = 'none';
        this.elements.listeningControls.style.display = 'flex';

        this.setStatus(`Mantra saved: ${this.templateDuration.toFixed(1)}s (trimmed ${trimmed.silenceRemoved.toFixed(1)}s silence). Ready to listen.`);
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
        let similarity;
        if (energyRatio < 0.3) {
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

        this.isListening = true;
        this.elements.startListeningBtn.disabled = true;
        this.elements.stopListeningBtn.disabled = false;
        this.setStatus('Listening for mantras...', 'listening');

        this.startVisualization();
        this.startDetection();
    }

    startDetection() {
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        // Sliding window buffer - store enough samples for template duration + margin
        const windowSamples = Math.ceil(this.templateBuffer.length * 1.5);
        let slidingBuffer = new Float32Array(windowSamples);
        let bufferIndex = 0;
        let silenceCounter = 0;
        const silenceThreshold = 0.01;
        const minSilenceFrames = 10; // Frames of silence to consider a gap

        let inSound = false;
        let soundStartIndex = 0;

        const detect = () => {
            if (!this.isListening) return;

            this.analyser.getFloatTimeDomainData(dataArray);

            // Calculate current RMS
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);

            // Add to sliding buffer
            for (let i = 0; i < dataArray.length; i++) {
                slidingBuffer[bufferIndex % windowSamples] = dataArray[i];
                bufferIndex++;
            }

            // Simple voice activity detection
            if (rms > silenceThreshold) {
                if (!inSound) {
                    inSound = true;
                    soundStartIndex = bufferIndex;
                }
                silenceCounter = 0;
            } else {
                silenceCounter++;

                // Sound ended - check for match
                if (inSound && silenceCounter >= minSilenceFrames) {
                    inSound = false;

                    // Extract the sound segment
                    const soundLength = bufferIndex - soundStartIndex;
                    if (soundLength > this.templateBuffer.length * 0.5) {
                        // Reconstruct the segment from sliding buffer
                        const segment = new Float32Array(Math.min(soundLength, windowSamples));
                        for (let i = 0; i < segment.length; i++) {
                            const idx = (soundStartIndex + i) % windowSamples;
                            segment[i] = slidingBuffer[idx];
                        }

                        // Check similarity
                        const segmentEnvelope = this.extractEnvelope(segment);
                        const similarity = this.computeSimilarity(this.templateEnvelope, segmentEnvelope);

                        console.log(`Sound detected - similarity: ${(similarity * 100).toFixed(1)}%`);

                        // Check if it's a match
                        const now = Date.now();
                        if (similarity >= this.similarityThreshold &&
                            now - this.lastMatchTime > this.debounceTime) {
                            this.lastMatchTime = now;
                            this.onMatch(similarity);
                        }
                    }
                }
            }

            requestAnimationFrame(detect);
        };

        detect();
    }

    onMatch(score) {
        this.count++;
        this.updateDisplay();
        this.saveState();
        this.logMatch(score);

        console.log(`Match! Count: ${this.count}, Score: ${(score * 100).toFixed(1)}%`);

        // Visual feedback
        this.elements.currentCount.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.elements.currentCount.style.transform = 'scale(1)';
        }, 200);

        // Check if goal reached
        if (this.count >= this.goal) {
            this.setStatus(`Goal reached! ${this.count}/${this.goal}`, 'listening');
        }
    }

    stopListening() {
        this.isListening = false;
        this.elements.startListeningBtn.disabled = false;
        this.elements.stopListeningBtn.disabled = true;
        this.setStatus('Listening stopped');
        this.stopVisualization();
    }

    resetMantra() {
        this.stopListening();
        this.templateBuffer = null;
        this.templateEnvelope = null;
        this.templateDuration = 0;
        this.audioBuffer = [];

        this.elements.recordingControls.style.display = 'flex';
        this.elements.listeningControls.style.display = 'none';
        this.elements.recordBtn.disabled = false;
        this.elements.confirmBtn.disabled = true;

        this.setStatus('Ready to record mantra template');
    }

    // Visualization
    startVisualization() {
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
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.mantraCounter = new MantraCounter();
});

