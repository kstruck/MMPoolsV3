// Simple Testing Dashboard - Uses Pre-defined Scenarios
// No AI dependency - just dropdown selection and code-based assertions

import React, { useState } from 'react';
import { Play, CheckCircle, XCircle, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import {
    runPredefinedTest,
    getAvailableScenarios,
    runAllTests
} from '../utils/testing/simpleTestRunner';
import type { SimpleTestResult } from '../utils/testing/simpleTestRunner';

export const SimpleTestingDashboard: React.FC = () => {
    const [selectedScenario, setSelectedScenario] = useState<string>('');
    const [isRunning, setIsRunning] = useState(false);
    const [result, setResult] = useState<SimpleTestResult | null>(null);
    const [allResults, setAllResults] = useState<SimpleTestResult[] | null>(null);

    const scenarios = getAvailableScenarios();

    const handleRunSingle = async () => {
        if (!selectedScenario) return;
        setIsRunning(true);
        setResult(null);
        setAllResults(null);

        try {
            const testResult = await runPredefinedTest(selectedScenario);
            setResult(testResult);
        } catch (error: any) {
            setResult({
                scenarioId: selectedScenario,
                scenarioName: 'Error',
                status: 'ERROR',
                duration: 0,
                validation: null,
                error: error.message,
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
        } catch (error: any) {
            console.error('Run all tests failed:', error);
        } finally {
            setIsRunning(false);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'PASS': return <CheckCircle className="w-5 h-5 text-green-400" />;
            case 'FAIL': return <XCircle className="w-5 h-5 text-red-400" />;
            case 'ERROR': return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
            default: return <Clock className="w-5 h-5 text-slate-400" />;
        }
    };

    const getStatusBg = (status: string) => {
        switch (status) {
            case 'PASS': return 'bg-green-500/10 border-green-500/30';
            case 'FAIL': return 'bg-red-500/10 border-red-500/30';
            case 'ERROR': return 'bg-yellow-500/10 border-yellow-500/30';
            default: return 'bg-slate-500/10 border-slate-500/30';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                <h2 className="text-xl font-bold text-white mb-2">🧪 Pre-defined Test Scenarios</h2>
                <p className="text-slate-400 text-sm mb-6">
                    Select a test scenario from the dropdown or run all tests. No AI required - fast and reliable.
                </p>

                {/* Controls */}
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <select
                            value={selectedScenario}
                            onChange={(e) => setSelectedScenario(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white appearance-none cursor-pointer focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Select a scenario...</option>
                            {scenarios.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                    </div>

                    <button
                        onClick={handleRunSingle}
                        disabled={isRunning || !selectedScenario}
                        className={`px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all ${isRunning || !selectedScenario
                            ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                    >
                        <Play className="w-4 h-4" />
                        Run Selected
                    </button>

                    <button
                        onClick={handleRunAll}
                        disabled={isRunning}
                        className={`px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all ${isRunning
                            ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            : 'bg-amber-600 hover:bg-amber-500 text-white'
                            }`}
                    >
                        <Play className="w-4 h-4" />
                        Run All ({scenarios.length})
                    </button>
                </div>

                {isRunning && (
                    <div className="mt-4 flex items-center gap-2 text-indigo-400">
                        <div className="animate-spin w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full"></div>
                        Running test...
                    </div>
                )}
            </div>

            {/* Single Result */}
            {result && (
                <div className={`p-6 rounded-xl border ${getStatusBg(result.status)}`}>
                    <div className="flex items-center gap-3 mb-4">
                        {getStatusIcon(result.status)}
                        <h3 className="text-lg font-bold text-white">{result.scenarioName}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${result.status === 'PASS' ? 'bg-green-500/20 text-green-400' :
                            result.status === 'FAIL' ? 'bg-red-500/20 text-red-400' :
                                'bg-yellow-500/20 text-yellow-400'
                            }`}>
                            {result.status}
                        </span>
                        <span className="text-slate-400 text-sm ml-auto">{result.duration}ms</span>
                    </div>

                    {result.error && (
                        <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4 mb-4">
                            <p className="text-red-300 text-sm font-mono">{result.error}</p>
                        </div>
                    )}

                    {result.validation && (
                        <div className="space-y-2">
                            <p className="text-white font-bold mb-3">{result.validation.summary}</p>
                            {result.validation.results.map((r, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm">
                                    {r.passed
                                        ? <CheckCircle className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                                        : <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                                    }
                                    <span className={r.passed ? 'text-slate-300' : 'text-red-300'}>
                                        {r.message}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {result.poolId && (
                        <p className="text-slate-500 text-xs mt-4">Pool ID: {result.poolId}</p>
                    )}
                </div>
            )}

            {/* All Results */}
            {allResults && (
                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4">All Test Results</h3>
                    <div className="space-y-3">
                        {allResults.map((r, i) => (
                            <div key={i} className={`p-4 rounded-lg border ${getStatusBg(r.status)} flex items-center gap-4`}>
                                {getStatusIcon(r.status)}
                                <div className="flex-1">
                                    <p className="font-bold text-white">{r.scenarioName}</p>
                                    {r.validation && (
                                        <p className="text-xs text-slate-400">{r.validation.summary}</p>
                                    )}
                                    {/* Show detailed failures if failed */}
                                    {r.status === 'FAIL' && r.validation && (
                                        <div className="mt-2 space-y-1 bg-red-950/30 p-2 rounded border border-red-500/20">
                                            {r.validation.results.filter((res: any) => !res.passed).map((res: any, idx: number) => (
                                                <p key={idx} className="text-xs text-red-300 flex items-start gap-1">
                                                    <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                                    {res.message}
                                                </p>
                                            ))}
                                        </div>
                                    )}
                                    {r.error && (
                                        <p className="text-xs text-red-400">{r.error}</p>
                                    )}
                                </div>
                                <span className="text-slate-400 text-sm">{r.duration}ms</span>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-700 flex gap-6 text-sm">
                        <span className="text-green-400">✅ {allResults.filter(r => r.status === 'PASS').length} Passed</span>
                        <span className="text-red-400">❌ {allResults.filter(r => r.status === 'FAIL').length} Failed</span>
                        <span className="text-yellow-400">⚠️ {allResults.filter(r => r.status === 'ERROR').length} Errors</span>
                    </div>
                </div>
            )}
        </div>
    );
};
