// Simple Testing Dashboard - Uses Pre-defined Scenarios
// No AI dependency - just dropdown selection and code-based assertions

import React, { useState } from 'react';
import { Play, CheckCircle, XCircle, AlertTriangle, Clock, ChevronDown, FlaskConical } from 'lucide-react';
import { logger } from '../utils/logger';
import {
    runPredefinedTest,
    getAvailableScenarios,
    runAllTests
} from '../utils/testing/simpleTestRunner';
import type { SimpleTestResult } from '../utils/testing/simpleTestRunner';

// Group scenarios by pool type in the picker so it reads as segmented lists,
// not one long flat dropdown.
const POOL_TYPE_ORDER = ['SQUARES', 'BRACKET', 'NFL_PLAYOFFS', 'PROPS', 'NFL_PICKEM', 'NFL_SURVIVOR', 'NFL_MARGIN'];
const POOL_TYPE_LABELS: Record<string, string> = {
    SQUARES: 'Squares',
    BRACKET: 'Bracket (March Madness)',
    NFL_PLAYOFFS: 'NFL Playoffs',
    PROPS: 'Prop Bets',
    NFL_PICKEM: "NFL Pick'em",
    NFL_SURVIVOR: 'NFL Survivor',
    NFL_MARGIN: 'NFL Margin',
};

export const SimpleTestingDashboard: React.FC = () => {
    const [selectedScenario, setSelectedScenario] = useState<string>('');
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<SimpleTestResult | null>(null);
    const [allResults, setAllResults] = useState<SimpleTestResult[] | null>(null);

    const scenarios = getAvailableScenarios();
    logger.log('Available Scenarios:', scenarios); // Debug: Check if new scenarios are loaded

    const handleRunSingle = async () => {
        if (!selectedScenario) return;
        setIsRunning(true);
        setResult(null);
        setAllResults(null);

        try {
            const testResult = await runPredefinedTest(selectedScenario);
            setResult(testResult);
        } catch (error: unknown) {
            setResult({
                scenarioId: selectedScenario,
                scenarioName: 'Error',
                status: 'ERROR',
                duration: 0,
                validation: null,
                error: error instanceof Error ? error.message : String(error),
                steps: []
            });
        } finally {
            setIsRunning(false);
        }
    };

    const handleRunAll = async () => {
        setIsRunning(true);
        setResult(null);
        setAllResults(null);

        try {
            const results = await runAllTests();
            setAllResults(results.results);
        } catch (error: unknown) {
            logger.error('Run all tests failed:', error);
        } finally {
            setIsRunning(false);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'PASS': return <CheckCircle className="w-5 h-5 text-[#0F7B4A]" />;
            case 'FAIL': return <XCircle className="w-5 h-5 text-brandred-600" />;
            case 'ERROR': return <AlertTriangle className="w-5 h-5 text-gold-600 dark:text-gold-400" />;
            default: return <Clock className="w-5 h-5 text-muted" />;
        }
    };

    const getStatusBg = (status: string) => {
        switch (status) {
            case 'PASS': return 'bg-[#0F7B4A]/10 border-[#0F7B4A]/30';
            case 'FAIL': return 'bg-brandred-600/5 border-brandred-600/40';
            case 'ERROR': return 'bg-gold-500/10 border-gold-500/40';
            default: return 'bg-surface border-line';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2 flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-gold-600 dark:text-gold-400" /> Pre-defined Test Scenarios
                </h2>
                <p className="text-muted font-body text-sm mb-6">
                    Select a test scenario from the dropdown or run all tests. No AI required - fast and reliable.
                </p>

                {/* Controls */}
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <select
                            value={selectedScenario}
                            onChange={(e) => setSelectedScenario(e.target.value)}
                            className="w-full bg-surface border border-line rounded-lg px-4 py-3 text-[color:var(--text)] font-body appearance-none cursor-pointer focus:ring-2 focus:ring-navy-600"
                        >
                            <option value="">Select a scenario...</option>
                            {POOL_TYPE_ORDER.filter(pt => scenarios.some(s => s.poolType === pt)).map(pt => (
                                <optgroup key={pt} label={POOL_TYPE_LABELS[pt] ?? pt}>
                                    {scenarios.filter(s => s.poolType === pt).map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted pointer-events-none" />
                    </div>

                    <button
                        onClick={handleRunSingle}
                        disabled={isRunning || !selectedScenario}
                        className={`px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-all duration-150 ${isRunning || !selectedScenario
                            ? 'bg-surface border border-line text-faint cursor-not-allowed'
                            : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-red-cta hover:-translate-y-px'
                            }`}
                    >
                        <Play className="w-4 h-4" />
                        Run Selected
                    </button>

                    <button
                        onClick={handleRunAll}
                        disabled={isRunning}
                        className={`px-6 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-all duration-150 ${isRunning
                            ? 'bg-surface border border-line text-faint cursor-not-allowed'
                            : 'bg-gold-foil text-navy-900 hover:brightness-105 hover:-translate-y-px'
                            }`}
                    >
                        <Play className="w-4 h-4" />
                        Run All (<span className="num">{scenarios.length}</span>)
                    </button>
                </div>

                {/* Explain the selected scenario: what it does + why. */}
                {selectedScenario && (() => {
                    const s = scenarios.find(sc => sc.id === selectedScenario);
                    if (!s) return null;
                    return (
                        <div className="mt-4 bg-surface border border-line rounded-lg p-4">
                            <p className="text-[10px] font-display font-bold uppercase tracking-[0.08em] text-muted mb-1">{POOL_TYPE_LABELS[s.poolType] ?? s.poolType} · what this tests</p>
                            <p className="text-sm text-[color:var(--text)] font-body">{s.description}</p>
                        </div>
                    );
                })()}

                {isRunning && (
                    <div className="mt-4 flex items-center gap-2 font-body text-gold-700 dark:text-gold-400">
                        <div className="animate-spin w-4 h-4 border-2 border-gold-500 border-t-transparent rounded-full"></div>
                        Running test...
                    </div>
                )}
            </div>

            {/* Single Result */}
            {result && (
                <div className={`p-6 rounded-xl border ${getStatusBg(result.status)}`}>
                    <div className="flex items-center gap-3 mb-4">
                        {getStatusIcon(result.status)}
                        <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)]">{result.scenarioName}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.08em] ${result.status === 'PASS' ? 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]' :
                            result.status === 'FAIL' ? 'bg-brandred-600/5 text-brandred-600 border border-brandred-600/40' :
                                'bg-gold-500/10 text-gold-700 dark:text-gold-400 border border-gold-500/40'
                            }`}>
                            {result.status}
                        </span>
                        <span className="text-muted font-body text-sm ml-auto num">{result.duration}ms</span>
                    </div>

                    {result.error && (
                        <div className="bg-brandred-600/5 border border-brandred-600/40 rounded-lg p-4 mb-4">
                            <p className="text-brandred-600 text-sm font-mono">{result.error}</p>
                        </div>
                    )}

                    {result.validation && (
                        <div className="space-y-2">
                            <p className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] mb-3">{result.validation.summary}</p>
                            {result.validation.results.map((r, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm font-body">
                                    {r.passed
                                        ? <CheckCircle className="w-4 h-4 text-[#0F7B4A] mt-0.5 flex-shrink-0" />
                                        : <XCircle className="w-4 h-4 text-brandred-600 mt-0.5 flex-shrink-0" />
                                    }
                                    <span className={r.passed ? 'text-[color:var(--text)]' : 'text-brandred-600'}>
                                        {r.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {result.poolId && (
                        <p className="text-faint font-body text-xs mt-4 num">Pool ID: {result.poolId}</p>
                    )}
                </div>
            )}

            {/* All Results */}
            {allResults && (
                <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                    <h3 className="text-lg font-display font-bold uppercase text-[color:var(--text)] mb-4">All Test Results</h3>
                    <div className="space-y-3">
                        {allResults.map((r, i) => (
                            <div key={i} className={`p-4 rounded-lg border ${getStatusBg(r.status)} flex items-center gap-4`}>
                                {getStatusIcon(r.status)}
                                <div className="flex-1">
                                    <p className="font-display font-bold uppercase text-[color:var(--text)]">{r.scenarioName}</p>
                                    {r.validation && (
                                        <p className="text-xs text-muted font-body">{r.validation.summary}</p>
                                    )}
                                    {/* Show detailed failures if failed */}
                                    {r.status === 'FAIL' && r.validation && (
                                        <div className="mt-2 space-y-1 bg-brandred-600/5 p-2 rounded border border-brandred-600/40">
                                            {r.validation.results.filter((res: { passed: boolean }) => !res.passed).map((res: { message: string }, idx: number) => (
                                                <p key={idx} className="text-xs font-body text-brandred-600 flex items-start gap-1">
                                                    <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                                    {res.message}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    {r.error && (
                                        <p className="text-xs font-body text-brandred-600">{r.error}</p>
                                    )}
                                </div>
                                <span className="text-muted font-body text-sm num">{r.duration}ms</span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-line flex gap-6 text-sm font-body">
                        <span className="text-[#0F7B4A] flex items-center gap-1.5"><CheckCircle className="w-4 h-4" /> <span className="num">{allResults.filter(r => r.status === 'PASS').length}</span> Passed</span>
                        <span className="text-brandred-600 flex items-center gap-1.5"><XCircle className="w-4 h-4" /> <span className="num">{allResults.filter(r => r.status === 'FAIL').length}</span> Failed</span>
                        <span className="text-gold-700 dark:text-gold-400 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> <span className="num">{allResults.filter(r => r.status === 'ERROR').length}</span> Errors</span>
                    </div>
                </div>
            )}
        </div>
    );
};
