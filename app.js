// Mantra Counter App
// Main application logic and UI management

class MantraCounter {
    constructor() {
        // Audio context and nodes
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.sourceNode = null;
        this.gainNode = null;

        // State
        this.isRecordingTemplate = false;
        this.isListening = false;
        this.templateBuffer = null;
        this.templateEnvelope = null;
        this.templateDuration = 0;
        this.goalReached = false;

        // Counter state
        this.count = 0;
        this.goal = 33;
        this.lastMatchTime = 0;

        // Detection mode: 'energy' or 'pattern'
        this.detectionMode = 'energy';

        // Settings (for pattern mode)
        this.similarityThreshold = 0.75;
        this.debounceTime = 3000;
        this.matchCooldown = 4000;
        this.micSensitivity = 1.0;

        // Recording buffers
        this.audioBuffer = [];

        // Test mode
        this.testMode = false;
        this.testRepetitions = [];
        this.testRepEnvelopes = [];

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
        this.updateModeUI();
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
            detectionModeSelect: document.getElementById('detection-mode'),
            patternSettings: document.getElementById('pattern-settings'),
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

        // Button state: energy mode starts ready, pattern mode needs recording
        this.buttonState = this.detectionMode === 'energy' ? 'listening' : 'record';

        if (this.templateEnvelope) {
            this.elements.resetMantraBtn.style.display = 'inline-block';
        }
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

        // Detection mode toggle
        if (this.elements.detectionModeSelect) {
            this.elements.detectionModeSelect.addEventListener('change', (e) => {
                this.detectionMode = e.target.value;
                this.updateModeUI();
                this.saveState();
            });
        }

        if (this.elements.testModeToggle) {
            this.elements.testModeToggle.addEventListener('change', (e) => {
                this.testMode = e.target.checked;
                if (this.elements.testControls) {
                    this.elements.testControls.style.display = this.testMode ? 'block' : 'none';
                }
            });
        }

        if (this.elements.runTestBtn) {
            this.elements.runTestBtn.addEventListener('click', () => this.runTest());
        }

        if (this.elements.thresholdSlider) {
            this.elements.thresholdSlider.addEventListener('input', (e) => {
                this.similarityThreshold = parseFloat(e.target.value);
                this.elements.thresholdValue.textContent = this.similarityThreshold.toFixed(2);
            });
        }

        if (this.elements.debounceSlider) {
            this.elements.debounceSlider.addEventListener('input', (e) => {
                this.debounceTime = parseInt(e.target.value);
                this.elements.debounceValue.textContent = this.debounceTime;
            });
        }

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
                if (this.gainNode) {
                    this.gainNode.gain.value = this.micSensitivity;
                }
            });
        }

        this.elements.goalInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.setGoal();
        });
    }

    updateModeUI() {
        // Show/hide pattern-specific settings
        if (this.elements.patternSettings) {
            this.elements.patternSettings.style.display =
                this.detectionMode === 'pattern' ? 'block' : 'none';
        }

        // Update button state based on mode
        if (this.detectionMode === 'energy') {
            this.buttonState = 'listening';
            this.elements.resetMantraBtn.style.display = 'none';
            this.setStatus('Ready - Click Start to begin energy-based detection');
        } else {
            if (this.templateEnvelope) {
                this.buttonState = 'listening';
                this.elements.resetMantraBtn.style.display = 'inline-block';
                this.setStatus('Template ready - Click Start to begin pattern matching');
            } else {
                this.buttonState = 'record';
                this.elements.resetMantraBtn.style.display = 'none';
                this.setStatus('Record your mantra template first');
            }
        }
        this.updateMainButton();
    }

    setupCanvas() {
        this.waveformCanvas = this.elements.waveform;
        if (!this.waveformCanvas) return;
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        if (!this.waveformCanvas || !this.waveformCtx) return;
        this.waveformCanvas.width = this.waveformCanvas.offsetWidth * window.devicePixelRatio;
        this.waveformCanvas.height = this.waveformCanvas.offsetHeight * window.devicePixelRatio;
        this.waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    loadState() {
        const saved = localStorage.getItem('mantraCounter');
        if (saved) {
            const state = JSON.parse(saved);
            this.goal = state.goal || 33;
            this.detectionMode = state.detectionMode || 'energy';
        }
        this.elements.goalInput.value = this.goal;
        if (this.elements.detectionModeSelect) {
            this.elements.detectionModeSelect.value = this.detectionMode;
        }
        this.updateDisplay();
    }

    saveState() {
        localStorage.setItem('mantraCounter', JSON.stringify({
            goal: this.goal,
            detectionMode: this.detectionMode
        }));
    }

    setGoal() {
        const newGoal = parseInt(this.elements.goalInput.value) || 33;
        this.goal = Math.max(1, newGoal);
        this.elements.goalInput.value = this.goal;
        if (this.count < this.goal) {
            this.goalReached = false;
        }
        this.updateDisplay();
        this.saveState();
    }

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
        while (this.elements.matchLog.children.length > 50) {
            this.elements.matchLog.removeChild(this.elements.matchLog.lastChild);
        }
    }

    async initAudio() {
        if (this.audioContext) {
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            if (this.gainNode) {
                this.gainNode.gain.value = this.micSensitivity;
            }
            return;
        }

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            const isMobile = AudioUtils.isMobileDevice();
            const audioConstraints = isMobile ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
            } : {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            };

            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints
            });

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = this.micSensitivity;

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = isMobile ? 0.5 : 0.3;

            this.sourceNode.connect(this.gainNode);
            this.gainNode.connect(this.analyser);

            console.log('Audio initialized', { isMobile, sampleRate: this.audioContext.sampleRate });
        } catch (err) {
            console.error('Error initializing audio:', err);
            this.setStatus('Error: Could not access microphone');
            throw err;
        }
    }

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

    async startRecordingTemplate() {
        await this.initAudio();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isRecordingTemplate = true;
        this.audioBuffer = [];

        this.buttonState = 'confirm';
        this.updateMainButton();
        this.elements.resetMantraBtn.style.display = 'none';
        this.setStatus('Recording mantra... Click to confirm when done', 'recording');

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

        const rawBuffer = new Float32Array(this.audioBuffer);
        const trimmed = AudioUtils.trimSilence(rawBuffer, this.audioContext.sampleRate);

        this.templateBuffer = trimmed.data;
        this.templateEnvelope = AudioUtils.extractEnvelope(this.templateBuffer);
        this.templateDuration = trimmed.trimmedDuration;

        console.log(`Template: ${trimmed.originalDuration.toFixed(2)}s → ${trimmed.trimmedDuration.toFixed(2)}s`);

        this.buttonState = 'listening';
        this.updateMainButton();
        this.elements.resetMantraBtn.style.display = 'inline-block';
        this.elements.resetCounterBtn.style.display = 'inline-block';

        this.setStatus(`Mantra saved: ${this.templateDuration.toFixed(1)}s. Click Start to begin.`);
        this.stopVisualization();
    }

    async startListening() {
        await this.initAudio();
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isListening = true;
        this.buttonState = 'stop';
        this.updateMainButton();

        const modeName = this.detectionMode === 'energy' ? 'energy/breath' : 'pattern matching';
        this.setStatus(`Listening (${modeName})...`, 'listening');

        this.startVisualization();

        // Start the appropriate detection mode
        if (this.detectionMode === 'energy') {
            Detection.startEnergyDetection(
                this.analyser,
                (score) => this.onMatch(score),
                () => this.isListening
            );
        } else {
            if (!this.templateEnvelope) {
                this.setStatus('No template recorded. Record one first.');
                this.stopListening();
                return;
            }
            Detection.startPatternDetection(
                this.analyser,
                this.templateEnvelope,
                this.templateBuffer,
                {
                    similarityThreshold: this.similarityThreshold,
                    debounceTime: this.debounceTime,
                    matchCooldown: this.matchCooldown
                },
                (score) => this.onMatch(score),
                () => this.isListening
            );
        }
    }

    onMatch(score) {
        this.count++;
        this.updateDisplay();
        this.logMatch(score);

        if (this.count > 0) {
            this.elements.resetCounterBtn.style.display = 'inline-block';
        }

        console.log(`Count: ${this.count}`);

        this.elements.currentCount.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.elements.currentCount.style.transform = 'scale(1)';
        }, 200);

        if (this.count >= this.goal && !this.goalReached) {
            this.goalReached = true;
            this.setStatus(`Goal reached! ${this.count}/${this.goal}`, 'listening');
            this.waitForSilenceThenCelebrate();
        }
    }

    stopListening() {
        this.isListening = false;
        this.buttonState = 'listening';
        this.updateMainButton();
        this.setStatus('Listening stopped');
        this.stopVisualization();

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

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
        this.elements.resetCounterBtn.style.display = 'none';
        this.setStatus('Counter reset');
    }

    manualIncrement() {
        this.count++;
        this.updateDisplay();
        this.logMatch(1.0);

        if (this.count > 0) {
            this.elements.resetCounterBtn.style.display = 'inline-block';
        }

        this.elements.currentCount.style.transform = 'scale(1.2)';
        setTimeout(() => {
            this.elements.currentCount.style.transform = 'scale(1)';
        }, 200);

        if (this.count >= this.goal && !this.goalReached) {
            this.goalReached = true;
            this.setStatus(`Goal reached! ${this.count}/${this.goal}`, 'listening');
            Celebration.showOverlay(this.count, this.audioContext, true);
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

    startVisualization() {
        this.resizeCanvas();
        if (!this.analyser) return;

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
        if (!this.waveformCanvas || !this.waveformCtx) return;
        const width = this.waveformCanvas.offsetWidth;
        const height = this.waveformCanvas.offsetHeight;
        this.waveformCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        this.waveformCtx.fillRect(0, 0, width, height);
    }

    waitForSilenceThenCelebrate() {
        if (!this.analyser) {
            Celebration.showOverlay(this.count, this.audioContext, false, () => this.stopListening());
            return;
        }

        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        const silenceThreshold = 0.01;
        let silenceFrames = 0;
        const requiredSilenceFrames = 60;

        const checkSilence = () => {
            if (!this.isListening) {
                Celebration.showOverlay(this.count, this.audioContext, false, () => this.stopListening());
                return;
            }

            this.analyser.getFloatTimeDomainData(dataArray);
            const rms = Math.sqrt(dataArray.reduce((sum, x) => sum + x * x, 0) / dataArray.length);

            if (rms < silenceThreshold) {
                silenceFrames++;
                if (silenceFrames >= requiredSilenceFrames) {
                    Celebration.showOverlay(this.count, this.audioContext, false, () => this.stopListening());
                    return;
                }
            } else {
                silenceFrames = 0;
            }

            requestAnimationFrame(checkSilence);
        };

        checkSilence();
    }

    // Test mode methods
    async runTest() {
        this.testRepetitions = [];
        this.testRepEnvelopes = [];

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

        await this.recordTestPhase(recordBtn, stopBtn, statusDiv, 'template');

        const templateRaw = new Float32Array(this.audioBuffer);
        const templateTrimmed = AudioUtils.trimSilence(templateRaw, this.audioContext.sampleRate);
        this.templateBuffer = templateTrimmed.data;
        this.templateEnvelope = AudioUtils.extractEnvelope(this.templateBuffer);
        this.templateDuration = templateTrimmed.trimmedDuration;

        statusDiv.innerHTML = `
            <div class="test-result pass">
                <strong>Template:</strong> ${templateTrimmed.trimmedDuration.toFixed(1)}s
                (trimmed ${templateTrimmed.silenceRemoved.toFixed(1)}s silence)
            </div>
        `;

        for (let i = 0; i < 5; i++) {
            this.elements.testResults.querySelector('.test-instructions p').innerHTML =
                `<strong>Step ${i + 2}:</strong> Record repetition ${i + 1} of 5`;

            await this.recordTestPhase(recordBtn, stopBtn, statusDiv, 'repetition', i);

            const repRaw = new Float32Array(this.audioBuffer);
            const repTrimmed = AudioUtils.trimSilence(repRaw, this.audioContext.sampleRate);
            const repEnvelope = AudioUtils.extractEnvelope(repTrimmed.data);

            this.testRepEnvelopes.push(repEnvelope);

            const result = AudioUtils.computeSimilarity(this.templateEnvelope, repEnvelope, true);
            const similarity = result.similarity;
            const diag = result.diagnostics;

            this.testRepetitions.push({
                index: i + 1,
                similarity,
                duration: repTrimmed.trimmedDuration,
                diagnostics: diag
            });

            const isPassed = similarity >= this.similarityThreshold;

            statusDiv.innerHTML += `
                <div class="test-result ${isPassed ? 'pass' : 'fail'}">
                    <div><strong>Rep ${i + 1}:</strong> ${(similarity * 100).toFixed(1)}% ${isPassed ? '✓' : '✗'}</div>
                    <div class="test-diagnostics">
                        Duration: ${repTrimmed.trimmedDuration.toFixed(1)}s (template: ${this.templateDuration.toFixed(1)}s)
                    </div>
                </div>
            `;
        }

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
                    ${passed >= 4 ? '✓ Test PASSED' : '✗ Test FAILED - Try adjusting threshold'}
                </div>
            </div>
            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                <button id="test-again-btn" class="btn-secondary">Run Test Again</button>
                <button id="export-fixtures-btn" class="btn-primary">Export Fixtures</button>
            </div>
        `;

        document.getElementById('test-again-btn').addEventListener('click', () => this.runTest());
        document.getElementById('export-fixtures-btn').addEventListener('click', () => this.exportTestFixtures());
    }

    exportTestFixtures() {
        const fixtures = {
            version: 1,
            sampleRate: this.audioContext.sampleRate,
            createdAt: new Date().toISOString(),
            template: {
                envelope: Array.from(this.templateEnvelope),
                duration: this.templateDuration
            },
            repetitions: this.testRepetitions.map((rep, i) => ({
                index: rep.index,
                envelope: Array.from(this.testRepEnvelopes[i]),
                duration: rep.duration,
                expectedMatch: true
            }))
        };

        const blob = new Blob([JSON.stringify(fixtures, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mantra-test-fixtures.json';
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    window.mantraCounter = new MantraCounter();
});
