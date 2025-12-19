// Celebration effects for goal completion

const Celebration = {
    // Play a zen chime sound
    async playCompletionSound(existingAudioContext = null) {
        let audioContext = existingAudioContext;
        let shouldCleanup = false;

        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            shouldCleanup = true;
        }

        try {
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const baseFreq = 220;
            const harmonics = [
                { freq: baseFreq, amplitude: 0.15, delay: 0 },
                { freq: baseFreq * 2, amplitude: 0.12, delay: 50 },
                { freq: baseFreq * 3, amplitude: 0.08, delay: 100 },
                { freq: baseFreq * 4.76, amplitude: 0.06, delay: 150 },
            ];

            const duration = 2.5;
            const fadeInTime = 0.4;
            const fadeOutTime = 1.8;

            harmonics.forEach((harmonic, i) => {
                setTimeout(() => {
                    try {
                        const osc = audioContext.createOscillator();
                        const gain = audioContext.createGain();

                        osc.type = i === 0 ? 'sine' : 'triangle';
                        osc.frequency.setValueAtTime(harmonic.freq, audioContext.currentTime);

                        const now = audioContext.currentTime;

                        gain.gain.setValueAtTime(0, now);
                        gain.gain.linearRampToValueAtTime(harmonic.amplitude, now + fadeInTime);
                        gain.gain.setValueAtTime(harmonic.amplitude, now + fadeInTime);
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

            if (shouldCleanup) {
                setTimeout(() => {
                    try {
                        if (audioContext && audioContext.state !== 'closed') {
                            audioContext.close().catch(console.error);
                        }
                    } catch (err) {
                        console.warn('Error closing temporary audio context:', err);
                    }
                }, duration * 1000 + 500);
            }
        } catch (err) {
            console.warn('Error playing completion sound:', err);
            if (shouldCleanup && audioContext && audioContext.state !== 'closed') {
                audioContext.close().catch(console.error);
            }
        }
    },

    // Create floating particles
    createParticles(containerId = 'particles') {
        const particlesContainer = document.getElementById(containerId);
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
    },

    // Show the completion overlay
    showOverlay(count, audioContext = null, keepVisible = false, onDismiss = null) {
        const overlay = document.getElementById('completion-overlay');
        const completionCount = document.getElementById('completion-count');
        const dismissBtn = document.getElementById('dismiss-completion-btn');

        if (!overlay) return;

        completionCount.textContent = `${count} mantras completed`;

        overlay.style.display = 'flex';
        overlay.classList.add('active');

        let userKeepVisible = keepVisible;
        let autoHideTimer = null;

        const dismiss = () => {
            overlay.classList.remove('active');
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 1000);
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
            }
            if (onDismiss) onDismiss();
        };

        if (dismissBtn) {
            dismissBtn.onclick = dismiss;
        }

        this.playCompletionSound(audioContext).catch(console.warn);
        this.createParticles();

        if (!keepVisible) {
            autoHideTimer = setTimeout(() => {
                if (!userKeepVisible) {
                    dismiss();
                }
            }, 5000);
        }

        overlay.onclick = (e) => {
            if (e.target === dismissBtn || (dismissBtn && dismissBtn.contains(e.target))) {
                return;
            }
            userKeepVisible = !userKeepVisible;
            if (userKeepVisible) {
                if (autoHideTimer) {
                    clearTimeout(autoHideTimer);
                    autoHideTimer = null;
                }
                overlay.style.cursor = 'pointer';
            } else {
                autoHideTimer = setTimeout(() => {
                    dismiss();
                }, 5000);
                overlay.style.cursor = 'default';
            }
        };
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Celebration;
}

