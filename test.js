/**
 * Unit tests for mantra detection algorithm
 *
 * Run in browser: open test.html
 * Or run with Node.js: node test.js
 */

// Detection algorithm (extracted for testing)
const MantraDetector = {
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

    // Strategy 1: Original correlation (truncate to shorter)
    correlationTruncate(envelope1, envelope2) {
        const norm1 = this.normalize(Array.from(envelope1));
        const norm2 = this.normalize(Array.from(envelope2));

        const len = Math.min(norm1.length, norm2.length);
        if (len < 3) return 0;

        const a = norm1.slice(0, len);
        const b = norm2.slice(0, len);

        const meanA = a.reduce((s, x) => s + x, 0) / len;
        const meanB = b.reduce((s, x) => s + x, 0) / len;

        let numerator = 0, denomA = 0, denomB = 0;
        for (let i = 0; i < len; i++) {
            const diffA = a[i] - meanA;
            const diffB = b[i] - meanB;
            numerator += diffA * diffB;
            denomA += diffA * diffA;
            denomB += diffB * diffB;
        }

        const denom = Math.sqrt(denomA * denomB);
        return denom === 0 ? 0 : numerator / denom;
    },

    // Strategy 2: Correlation with resampling (stretch to match)
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

    // Strategy 3: Energy-based similarity (good for sustained sounds)
    energySimilarity(envelope1, envelope2, templateDuration, sampleDuration) {
        // Compare total energy, peak energy, and duration
        const energy1 = envelope1.reduce((s, x) => s + x, 0);
        const energy2 = envelope2.reduce((s, x) => s + x, 0);
        const peak1 = Math.max(...envelope1);
        const peak2 = Math.max(...envelope2);

        // Normalize energies by duration
        const normEnergy1 = energy1 / envelope1.length;
        const normEnergy2 = energy2 / envelope2.length;

        // Energy ratio (how similar is the average energy)
        const energyRatio = Math.min(normEnergy1, normEnergy2) / Math.max(normEnergy1, normEnergy2);

        // Peak ratio
        const peakRatio = Math.min(peak1, peak2) / Math.max(peak1, peak2);

        // Duration ratio
        const durationRatio = Math.min(templateDuration, sampleDuration) / Math.max(templateDuration, sampleDuration);

        // Combined score (weighted)
        return energyRatio * 0.4 + peakRatio * 0.3 + durationRatio * 0.3;
    },

    // Strategy 4: Shape similarity (normalized envelope comparison)
    shapeSimilarity(envelope1, envelope2) {
        // Resample both to fixed length (50 points)
        const fixedLen = 50;
        const shape1 = this.normalize(this.resample(Array.from(envelope1), fixedLen));
        const shape2 = this.normalize(this.resample(Array.from(envelope2), fixedLen));

        // Mean absolute difference (inverted to be a similarity score)
        let totalDiff = 0;
        for (let i = 0; i < fixedLen; i++) {
            totalDiff += Math.abs(shape1[i] - shape2[i]);
        }
        const avgDiff = totalDiff / fixedLen;

        // Convert to similarity (0-1 scale)
        return Math.max(0, 1 - avgDiff);
    },

    // Strategy 5: Cosine similarity on resampled envelopes
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

    // Main similarity function - uses best strategy
    computeSimilarity(envelope1, envelope2, templateDuration = null, sampleDuration = null) {
        const len1 = envelope1.length;
        const len2 = envelope2.length;
        const durationRatio = Math.min(len1, len2) / Math.max(len1, len2);

        // Compute all strategies
        const strategies = {
            truncate: this.correlationTruncate(envelope1, envelope2),
            resampled: this.correlationResampled(envelope1, envelope2),
            shape: this.shapeSimilarity(envelope1, envelope2),
            cosine: this.cosineSimilarity(envelope1, envelope2),
        };

        if (templateDuration && sampleDuration) {
            strategies.energy = this.energySimilarity(envelope1, envelope2, templateDuration, sampleDuration);
        }

        // Energy ratio check - compare average energy levels
        const energy1 = envelope1.reduce((s, x) => s + x, 0) / len1;
        const energy2 = envelope2.reduce((s, x) => s + x, 0) / len2;
        const energyRatio = Math.min(energy1, energy2) / Math.max(energy1, energy2 || 0.001);
        strategies.energyRatio = energyRatio;

        // Use cosine as primary, with energy gating to filter noise
        // If energy ratio is very low (< 30%), it's likely background noise
        let similarity;
        if (energyRatio < 0.3) {
            similarity = energyRatio; // Return very low score for noise
        } else {
            similarity = strategies.cosine * (0.7 + 0.3 * energyRatio);
        }

        return {
            similarity,
            durationRatio,
            strategies
        };
    }
};

// Test runner
class TestRunner {
    constructor() {
        this.results = [];
        this.fixtures = null;
    }

    async loadFixtures(path = './mantra-test-fixtures.json') {
        try {
            const response = await fetch(path);
            this.fixtures = await response.json();
            console.log('Loaded fixtures:', this.fixtures.createdAt);
            return true;
        } catch (e) {
            console.error('Failed to load fixtures:', e);
            return false;
        }
    }

    test(name, fn) {
        try {
            const result = fn();
            this.results.push({ name, passed: result.passed, details: result.details });
            const icon = result.passed ? '✓' : '✗';
            console.log(`${icon} ${name}`, result.details || '');
        } catch (e) {
            this.results.push({ name, passed: false, error: e.message });
            console.log(`✗ ${name}`, e.message);
        }
    }

    summary() {
        const passed = this.results.filter(r => r.passed).length;
        const total = this.results.length;
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Results: ${passed}/${total} passed`);
        return { passed, total, results: this.results };
    }

    // Run all detection tests
    async runAll() {
        if (!this.fixtures) {
            const loaded = await this.loadFixtures();
            if (!loaded) {
                console.error('Cannot run tests without fixtures. Record and export fixtures first.');
                return null;
            }
        }

        const template = this.fixtures.template.envelope;
        const reps = this.fixtures.repetitions;

        console.log('\n' + '='.repeat(50));
        console.log('MANTRA DETECTION TESTS');
        console.log('='.repeat(50));
        console.log(`Template duration: ${this.fixtures.template.duration.toFixed(2)}s`);
        console.log(`Repetitions: ${reps.length}`);
        console.log('');

        // Test 1: All repetitions should have positive correlation with template
        this.test('All reps have positive correlation', () => {
            const scores = reps.map(rep =>
                MantraDetector.computeSimilarity(template, rep.envelope).similarity
            );
            const allPositive = scores.every(s => s > 0);
            return {
                passed: allPositive,
                details: `scores: [${scores.map(s => (s * 100).toFixed(1) + '%').join(', ')}]`
            };
        });

        // Test 2: All repetitions should pass at 50% threshold (very lenient)
        this.test('All reps pass at 50% threshold', () => {
            const threshold = 0.5;
            const scores = reps.map(rep =>
                MantraDetector.computeSimilarity(template, rep.envelope).similarity
            );
            const passing = scores.filter(s => s >= threshold).length;
            return {
                passed: passing === reps.length,
                details: `${passing}/${reps.length} passed at ${threshold * 100}%`
            };
        });

        // Test 3: At least 4/5 should pass at 60% threshold
        this.test('At least 4/5 pass at 60% threshold', () => {
            const threshold = 0.6;
            const scores = reps.map(rep =>
                MantraDetector.computeSimilarity(template, rep.envelope).similarity
            );
            const passing = scores.filter(s => s >= threshold).length;
            return {
                passed: passing >= 4,
                details: `${passing}/${reps.length} passed at ${threshold * 100}%`
            };
        });

        // Test 4: At least 4/5 should pass at 80% threshold (good quality match)
        this.test('At least 4/5 pass at 80% threshold', () => {
            const threshold = 0.8;
            const scores = reps.map(rep =>
                MantraDetector.computeSimilarity(template, rep.envelope).similarity
            );
            const passing = scores.filter(s => s >= threshold).length;
            return {
                passed: passing >= 4,
                details: `${passing}/${reps.length} passed at ${threshold * 100}%`
            };
        });

        // Test 5: Duration ratios should be reasonable (within 50% of template)
        this.test('Duration ratios within reasonable range', () => {
            const templateDur = this.fixtures.template.duration;
            const ratios = reps.map(rep => rep.duration / templateDur);
            const reasonable = ratios.every(r => r > 0.5 && r < 2.0);
            return {
                passed: reasonable,
                details: `ratios: [${ratios.map(r => r.toFixed(2)).join(', ')}]`
            };
        });

        // Test 6: Find optimal threshold where all pass
        this.test('Find optimal threshold', () => {
            const scores = reps.map(rep =>
                MantraDetector.computeSimilarity(template, rep.envelope).similarity
            );
            const minScore = Math.min(...scores);
            const recommendedThreshold = Math.floor(minScore * 100) / 100 - 0.05; // 5% buffer
            return {
                passed: true,
                details: `min score: ${(minScore * 100).toFixed(1)}%, recommended threshold: ${(recommendedThreshold * 100).toFixed(0)}%`
            };
        });

        // Test 7: Algorithm should be consistent (same input = same output)
        this.test('Algorithm is deterministic', () => {
            const rep = reps[0];
            const score1 = MantraDetector.computeSimilarity(template, rep.envelope).similarity;
            const score2 = MantraDetector.computeSimilarity(template, rep.envelope).similarity;
            return {
                passed: score1 === score2,
                details: `score1: ${score1}, score2: ${score2}`
            };
        });

        // Test 8: Test with simulated "noise" (low-amplitude random envelope, like background noise)
        this.test('Low-energy noise should score low', () => {
            // Simulate low-amplitude background noise (10% of typical mantra energy)
            const avgTemplateEnergy = template.reduce((s, x) => s + x, 0) / template.length;
            const noise = Array.from({ length: template.length }, () => Math.random() * avgTemplateEnergy * 0.1);
            const result = MantraDetector.computeSimilarity(template, noise);
            return {
                passed: result.similarity < 0.5, // Low energy noise should score low due to energy weighting
                details: `noise score: ${(result.similarity * 100).toFixed(1)}%, energyRatio: ${(result.strategies.energyRatio * 100).toFixed(0)}%`
            };
        });

        // Test 9: Self-similarity should be 100%
        this.test('Template self-similarity is 100%', () => {
            const score = MantraDetector.computeSimilarity(template, template).similarity;
            return {
                passed: Math.abs(score - 1.0) < 0.001,
                details: `self-similarity: ${(score * 100).toFixed(2)}%`
            };
        });

        // Detailed breakdown with all strategies
        console.log('\n' + '-'.repeat(50));
        console.log('DETAILED SIMILARITY SCORES BY STRATEGY:');
        console.log('-'.repeat(50));

        const strategyNames = ['truncate', 'resampled', 'shape', 'cosine', 'energy'];
        const strategyScores = {};
        strategyNames.forEach(s => strategyScores[s] = []);

        reps.forEach((rep, i) => {
            const result = MantraDetector.computeSimilarity(
                template,
                rep.envelope,
                this.fixtures.template.duration,
                rep.duration
            );

            console.log(`\nRep ${i + 1} (${rep.duration.toFixed(2)}s):`);
            for (const [name, score] of Object.entries(result.strategies)) {
                console.log(`  ${name}: ${(score * 100).toFixed(1)}%`);
                if (strategyScores[name]) strategyScores[name].push(score);
            }
            console.log(`  COMBINED: ${(result.similarity * 100).toFixed(1)}%`);
        });

        // Strategy comparison
        console.log('\n' + '-'.repeat(50));
        console.log('STRATEGY COMPARISON (min score across all reps):');
        console.log('-'.repeat(50));
        for (const [name, scores] of Object.entries(strategyScores)) {
            if (scores.length > 0) {
                const min = Math.min(...scores);
                const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                console.log(`${name}: min=${(min * 100).toFixed(1)}%, avg=${(avg * 100).toFixed(1)}%`);
            }
        }

        return this.summary();
    }
}

// Export for use in browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MantraDetector, TestRunner };
}

// Auto-run if in browser with fixtures
if (typeof window !== 'undefined') {
    window.MantraDetector = MantraDetector;
    window.TestRunner = TestRunner;

    // Add test runner to global for console access
    window.runTests = async () => {
        const runner = new TestRunner();
        return await runner.runAll();
    };
}

