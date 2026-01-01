import React, { useState, useEffect } from 'react';
import {
    Bot, Play, CheckCircle, AlertTriangle,
    Terminal, RefreshCw, ChevronRight, Activity, Bug, FileText
} from 'lucide-react';
import { TEST_SCENARIOS, type PoolType, type TestResult } from '../utils/testing/testingOrchestrator';
import {
    runAIEnhancedTest,
    getSuggestedScenarios,
    type TestScenario,
    type ValidationResult,
    type TestReport
} from '../services/aiTestingService';
import ReactMarkdown from 'react-markdown';

export const TestingDashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | PoolType | 'CLEANUP'>('OVERVIEW');
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [testMode, setTestMode] = useState<'dry-run' | 'actual'>('dry-run');

    // Current Test State
    const [currentScenario, setCurrentScenario] = useState<TestScenario | null>(null);
    const [currentResult, setCurrentResult] = useState<TestResult | null>(null);
    const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
    const [report, setReport] = useState<TestReport | null>(null);

    // Suggested Prompts
    const [suggestions, setSuggestions] = useState<string[]>([]);

    useEffect(() => {
        if (activeTab !== 'OVERVIEW' && activeTab !== 'CLEANUP') {
            loadSuggestions(activeTab as PoolType);
        }
    }, [activeTab]);

    const loadSuggestions = async (type: PoolType) => {
        const s = await getSuggestedScenarios(type);
        setSuggestions(s);
    };

    const handleRunTest = async () => {
        if (!aiPrompt.trim() && activeTab !== 'OVERVIEW' && activeTab !== 'CLEANUP') {
            // Using a preset? For now, let's enforce AI prompt
            return;
        }

        setIsGenerating(true);
        setIsRunning(true);
        setCurrentScenario(null);
        setCurrentResult(null);
        setValidationResult(null);
        setReport(null);

        try {
            const result = await runAIEnhancedTest(
                activeTab as PoolType,
                aiPrompt,
                testMode
            );

            setCurrentScenario(result.scenario);
            setCurrentResult(result.testResult);
            setValidationResult(result.validation);
            setReport(result.report);

        } catch (error) {
            console.error("Test execution failed:", error);
        } finally {
            setIsRunning(false);
            setIsGenerating(false);
        }
    };

    const renderOverview = () => (
        <div className="space-y-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Bot className="w-6 h-6 text-indigo-400" />
                    AI-Enhanced Testing Dashboard
                </h2>
                <p className="text-slate-300 mb-6">
                    Use Gemini AI to intelligently generate test scenarios, validate logic, and create comprehensive reports for all pool types.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.keys(TEST_SCENARIOS).map((type) => (
                        <button
                            key={type}
                            onClick={() => setActiveTab(type as PoolType)}
                            className="p-4 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg text-left transition-all group"
                        >
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-bold text-white">{type}</span>
                                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-white" />
                            </div>
                            <div className="text-xs text-slate-400">
                                {TEST_SCENARIOS[type as PoolType].length} Preset Scenarios
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderPoolTest = () => (
        <div className="space-y-6">
            {/* AI Input Section */}
            <div className="bg-slate-800 p-6 rounded-xl border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                <div className="flex items-center gap-2 mb-4">
                    <Bot className={`w-5 h-5 text-indigo-400 ${isGenerating ? 'animate-pulse' : ''}`} />
                    <h3 className="font-bold text-white">AI Scenario Generator</h3>
                </div>

                <div className="flex gap-4 mb-4">
                    <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={`Describe a test scenario (e.g., "Create a ${activeTab} pool where everyone picks mostly chalk but one user picks a massive upset...")`}
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-4 text-white resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[100px]"
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-sm">Mode:</span>
                        <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
                            <button
                                onClick={() => setTestMode('dry-run')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${testMode === 'dry-run' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                Dry Run
                            </button>
                            <button
                                onClick={() => setTestMode('actual')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${testMode === 'actual' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                Actual
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleRunTest}
                        disabled={isRunning || !aiPrompt.trim()}
                        className={`px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all ${isRunning
                                ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                            }`}
                    >
                        {isRunning ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Running Test...
                            </>
                        ) : (
                            <>
                                <Play className="w-4 h-4" />
                                Generate & Run Test
                            </>
                        )}
                    </button>
                </div>

                {/* Suggestions */}
                <div className="mt-4 flex flex-wrap gap-2">
                    {suggestions.map((s, i) => (
                        <button
                            key={i}
                            onClick={() => setAiPrompt(s)}
                            className="text-xs px-3 py-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-full text-indigo-300 transition-colors"
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {/* Scenario Details (if generated) */}
                {currentScenario && (
                    <div className="mt-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-white text-sm flex items-center gap-2">
                                <Bot className="w-3 h-3 text-indigo-400" />
                                Generated Scenario: {currentScenario.scenarioName}
                            </h4>
                            <span className="text-xs text-slate-400">{currentScenario.testUsers.length} Users • {currentScenario.poolType}</span>
                        </div>
                        <p className="text-xs text-slate-400 italic mb-3">"{currentScenario.description}"</p>
                        <div className="bg-black p-3 rounded border border-slate-800 font-mono text-xs text-green-400 overflow-x-auto">
                            {JSON.stringify(currentScenario, null, 2)}
                        </div>
                    </div>
                )}
            </div>

            {/* Results Section */}
            {(currentResult || isRunning) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: Execution Log */}
                    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                        <div className="p-4 bg-slate-900 border-b border-slate-700 flex justify-between items-center">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-slate-400" />
                                Execution Log
                            </h3>
                            {currentResult && (
                                <span className={`text-xs px-2 py-1 rounded font-bold ${currentResult.status === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {currentResult.status.toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div className="p-4 h-[400px] overflow-y-auto space-y-2 font-mono text-sm">
                            {!currentResult && isRunning && (
                                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4">
                                    <RefreshCw className="w-8 h-8 animate-spin" />
                                    <p>Orchestrating test with AI...</p>
                                </div>
                            )}
                            {currentResult?.steps.map((step, i) => (
                                <div key={i} className="flex gap-2">
                                    <span className={step.status === 'success' ? 'text-green-500' : 'text-red-500'}>
                                        {step.status === 'success' ? '✓' : '✗'}
                                    </span>
                                    <span className="text-slate-300">{step.step}:</span>
                                    <span className="text-slate-400">{step.message}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: AI Analysis */}
                    <div className="space-y-6">
                        {/* Validation */}
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <div className="p-4 bg-slate-900 border-b border-slate-700">
                                <h3 className="font-bold text-white flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-indigo-400" />
                                    AI Validation
                                </h3>
                            </div>
                            <div className="p-4">
                                {validationResult ? (
                                    <div>
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className={`p-3 rounded-full ${validationResult.passed ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                                {validationResult.passed ? (
                                                    <CheckCircle className={`w-6 h-6 ${validationResult.passed ? 'text-green-400' : 'text-red-400'}`} />
                                                ) : (
                                                    <AlertTriangle className="w-6 h-6 text-red-400" />
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-lg font-bold text-white">
                                                    {validationResult.passed ? 'Validation Passed' : 'Issues Detected'}
                                                </div>
                                                <div className="text-sm text-slate-400">
                                                    Confidence Score: {validationResult.confidence}%
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            {validationResult.findings.map((f, i) => (
                                                <div key={i} className={`p-3 rounded-lg text-sm border ${f.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-300' :
                                                        f.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                                                            'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                                    }`}>
                                                    <div className="font-bold mb-1 flex items-center gap-2">
                                                        {f.type === 'success' && <CheckCircle className="w-3 h-3" />}
                                                        {f.type === 'error' && <Bug className="w-3 h-3" />}
                                                        {f.message}
                                                    </div>
                                                    {f.evidence && (
                                                        <div className="opacity-80 text-xs pl-5 border-l border-current ml-1">
                                                            {f.evidence}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center text-slate-500 py-8">
                                        Validation pending completion...
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AI Report */}
                        {report && (
                            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                                <div className="p-4 bg-slate-900 border-b border-slate-700">
                                    <h3 className="font-bold text-white flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-purple-400" />
                                        AI Report
                                    </h3>
                                </div>
                                <div className="p-4 text-slate-300 text-sm prose prose-invert max-w-none">
                                    <ReactMarkdown>
                                        {`### ${report.executiveSummary}\n\n**Key Findings**\n${report.keyFindings.map(k => `- ${k}`).join('\n')}`}
                                    </ReactMarkdown>
                                    <button
                                        className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white transition-colors"
                                        onClick={() => {/* Open full report modal */ }}
                                    >
                                        View Full Report
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <div className="flex gap-4 mb-6 overflow-x-auto pb-2">
                {['OVERVIEW', 'SQUARES', 'BRACKET', 'NFL_PLAYOFFS', 'PROPS', 'CLEANUP'].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab as any)}
                        className={`px-4 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-all ${activeTab === tab
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700'
                            }`}
                    >
                        {tab.replace('_', ' ')}
                    </button>
                ))}
            </div>

            {activeTab === 'OVERVIEW' ? renderOverview() : renderPoolTest()}
        </div>
    );
};
