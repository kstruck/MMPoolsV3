import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import {
    Bot, Play, CheckCircle, AlertTriangle,
    Terminal, RefreshCw, ChevronRight, Activity, Bug, FileText, X, Check
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
    const [showFullReport, setShowFullReport] = useState(false);

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
            logger.error("Test execution failed:", error);
        } finally {
            setIsRunning(false);
            setIsGenerating(false);
        }
    };

    const renderOverview = () => (
        <div className="space-y-6">
            <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                <h2 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-4 flex items-center gap-2">
                    <Bot className="w-6 h-6 text-gold-600 dark:text-gold-400" />
                    AI-Enhanced Testing Dashboard
                </h2>
                <p className="text-muted font-body mb-6">
                    Use Gemini AI to intelligently generate test scenarios, validate logic, and create comprehensive reports for all pool types.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.keys(TEST_SCENARIOS).map((type) => (
                        <button
                            key={type}
                            onClick={() => setActiveTab(type as PoolType)}
                            className="p-4 bg-surface hover:bg-card border border-line hover:border-gold-500/40 rounded-lg text-left transition-all duration-150 group"
                        >
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-display font-bold uppercase text-[color:var(--text)]">{type}</span>
                                <ChevronRight className="w-4 h-4 text-faint group-hover:text-gold-600 dark:group-hover:text-gold-400" />
                            </div>
                            <div className="text-xs text-muted font-body num">
                                {(TEST_SCENARIOS[type as PoolType] || []).length} Preset Scenarios
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
            <div className="bg-card p-6 rounded-xl border border-line shadow-card">
                <div className="flex items-center gap-2 mb-4">
                    <Bot className={`w-5 h-5 text-gold-600 dark:text-gold-400 ${isGenerating ? 'animate-pulse' : ''}`} />
                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)]">AI Scenario Generator</h3>
                </div>

                <div className="flex gap-4 mb-4">
                    <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder={`Describe a test scenario (e.g., "Create a ${activeTab} pool where everyone picks mostly chalk but one user picks a massive upset...")`}
                        className="flex-1 bg-surface border border-line rounded-lg p-4 text-[color:var(--text)] font-body resize-none focus:ring-2 focus:ring-navy-600 focus:border-transparent min-h-[100px]"
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-muted font-body text-sm">Mode:</span>
                        <div className="flex bg-surface rounded-lg p-1 border border-line">
                            <button
                                onClick={() => setTestMode('dry-run')}
                                className={`px-3 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${testMode === 'dry-run' ? 'bg-navy-800 text-white' : 'text-muted hover:text-[color:var(--text)]'}`}
                            >
                                Dry Run
                            </button>
                            <button
                                onClick={() => setTestMode('actual')}
                                className={`px-3 py-1 rounded text-xs font-display font-bold uppercase tracking-[0.05em] transition-colors duration-150 ${testMode === 'actual' ? 'bg-brandred-600 text-white' : 'text-muted hover:text-[color:var(--text)]'}`}
                            >
                                Actual
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={handleRunTest}
                        disabled={isRunning || !aiPrompt.trim()}
                        className={`px-6 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] flex items-center gap-2 transition-all duration-150 ${isRunning
                            ? 'bg-surface border border-line text-faint cursor-not-allowed'
                            : 'bg-brandred-600 hover:bg-brandred-500 text-white shadow-red-cta hover:-translate-y-px'
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

                <div className="mt-4 flex flex-wrap gap-2">
                    {(Array.isArray(suggestions) ? suggestions : []).map((s, i) => (
                        <button
                            key={i}
                            onClick={() => setAiPrompt(s)}
                            className="text-xs font-body px-3 py-1 bg-surface hover:bg-card border border-line hover:border-gold-500/40 rounded-full text-gold-700 dark:text-gold-400 transition-colors duration-150"
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {/* Scenario Details (if generated) */}
                {currentScenario && (
                    <div className="mt-6 p-4 bg-surface rounded-lg border border-line">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] text-sm flex items-center gap-2">
                                <Bot className="w-3 h-3 text-gold-600 dark:text-gold-400" />
                                Generated Scenario: {currentScenario.scenarioName}
                            </h4>
                            <span className="text-xs text-muted font-body num">{(currentScenario.testUsers || []).length} Users • {currentScenario.poolType}</span>
                        </div>
                        <p className="text-xs text-muted font-body italic mb-3">"{currentScenario.description}"</p>
                        <div className="bg-navy-950 p-3 rounded border border-[rgba(230,206,150,0.16)] font-mono text-xs text-gold-300 overflow-x-auto num">
                            {JSON.stringify(currentScenario, null, 2)}
                        </div>
                    </div>
                )}
            </div>

            {/* Results Section */}
            {(currentResult || isRunning) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Left: Execution Log */}
                    <div className="bg-card rounded-xl border border-line shadow-card overflow-hidden">
                        <div className="p-4 bg-surface border-b border-line flex justify-between items-center">
                            <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-muted" />
                                Execution Log
                            </h3>
                            {currentResult && (
                                <span className={`text-xs px-2 py-1 rounded font-display font-bold uppercase tracking-[0.08em] ${currentResult.status === 'success' ? 'bg-[#E4F5EC] text-[#0F7B4A] border border-[#BEE7D0]' : 'bg-brandred-600/5 text-brandred-600 border border-brandred-600/40'}`}>
                                    {currentResult.status.toUpperCase()}
                                </span>
                            )}
                        </div>
                        <div className="p-4 h-[400px] overflow-y-auto space-y-2 font-mono text-sm">
                            {!currentResult && isRunning && (
                                <div className="flex flex-col items-center justify-center h-full text-faint gap-4">
                                    <RefreshCw className="w-8 h-8 animate-spin" />
                                    <p>Orchestrating test with AI...</p>
                                </div>
                            )}

                            {(Array.isArray(currentResult?.steps) ? currentResult.steps : []).map((step, i) => (
                                <div key={i} className="flex gap-2">
                                    <span className={step.status === 'success' ? 'text-[#0F7B4A]' : 'text-brandred-600'}>
                                        {step.status === 'success' ? <Check className="w-3.5 h-3.5 mt-0.5" /> : <X className="w-3.5 h-3.5 mt-0.5" />}
                                    </span>
                                    <span className="text-[color:var(--text)]">{step.step}:</span>
                                    <span className="text-muted">{step.message}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: AI Analysis */}
                    <div className="space-y-6">
                        {/* Validation */}
                        <div className="bg-card rounded-xl border border-line shadow-card overflow-hidden">
                            <div className="p-4 bg-surface border-b border-line">
                                <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                    <Activity className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                                    AI Validation
                                </h3>
                            </div>
                            <div className="p-4">
                                {validationResult ? (
                                    <div>
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className={`p-3 rounded-full ${validationResult.passed ? 'bg-[#0F7B4A]/10' : 'bg-brandred-600/10'}`}>
                                                {validationResult.passed ? (
                                                    <CheckCircle className={`w-6 h-6 ${validationResult.passed ? 'text-[#0F7B4A]' : 'text-brandred-600'}`} />
                                                ) : (
                                                    <AlertTriangle className="w-6 h-6 text-brandred-600" />
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-lg font-display font-bold uppercase text-[color:var(--text)]">
                                                    {validationResult.passed ? 'Validation Passed' : 'Issues Detected'}
                                                </div>
                                                <div className="text-sm text-muted font-body num">
                                                    Confidence Score: {validationResult.confidence}%
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            {(Array.isArray(validationResult.findings) ? validationResult.findings : []).map((f, i) => (
                                                <div key={i} className={`p-3 rounded-lg text-sm font-body border ${f.type === 'success' ? 'bg-[#0F7B4A]/10 border-[#0F7B4A]/30 text-[#0F7B4A]' :
                                                    f.type === 'error' ? 'bg-brandred-600/5 border-brandred-600/40 text-brandred-600' :
                                                        'bg-gold-500/10 border-gold-500/40 text-gold-700 dark:text-gold-400'
                                                    }`}>
                                                    <div className="font-display font-bold uppercase tracking-[0.05em] mb-1 flex items-center gap-2">
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
                                    <div className="text-center text-faint font-body py-8">
                                        Validation pending completion...
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* AI Report */}
                        {report && (
                            <div className="bg-card rounded-xl border border-line shadow-card overflow-hidden">
                                <div className="p-4 bg-surface border-b border-line">
                                    <h3 className="font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-gold-600 dark:text-gold-400" />
                                        AI Report
                                    </h3>
                                </div>
                                <div className="p-4 text-muted font-body text-sm prose dark:prose-invert max-w-none">
                                    <ReactMarkdown>
                                        {`### ${report.executiveSummary || 'Report Generated'}\n\n**Key Findings**\n${(Array.isArray(report.keyFindings) ? report.keyFindings : []).map(k => `- ${k}`).join('\n')}`}
                                    </ReactMarkdown>
                                    <button
                                        className="mt-4 w-full py-2 bg-navy-800 hover:bg-navy-700 rounded text-xs font-display font-bold uppercase tracking-[0.05em] text-white transition-colors duration-150"
                                        onClick={() => setShowFullReport(true)}
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
                        className={`px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm whitespace-nowrap transition-all duration-150 ${activeTab === tab
                            ? 'bg-brandred-600 text-white shadow-red-cta'
                            : 'bg-card text-muted hover:bg-surface hover:text-[color:var(--text)] border border-line'
                            }`}
                    >
                        {tab.replace('_', ' ')}
                    </button>
                ))}
            </div>

            {activeTab === 'OVERVIEW' ? renderOverview() : renderPoolTest()}

            {/* Full Report Modal */}
            {report && (
                <ReportModal
                    isOpen={showFullReport}
                    onClose={() => setShowFullReport(false)}
                    report={report}
                />
            )}
        </div>
    );
};

// Simple internal Modal Component to avoid state mess in main component
const ReportModal = ({ isOpen, onClose, report }: { isOpen: boolean; onClose: () => void; report: any }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy-950/80 backdrop-blur-sm">
            <div className="bg-card w-full max-w-4xl max-h-[90vh] rounded-2xl border border-line shadow-panel flex flex-col">
                <div className="p-6 border-b border-line flex justify-between items-center bg-surface rounded-t-2xl">
                    <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] flex items-center gap-2">
                        <FileText className="w-6 h-6 text-gold-600 dark:text-gold-400" />
                        Full AI Analysis
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-card rounded-full transition-colors duration-150">
                        <X className="w-5 h-5 text-muted" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 text-muted font-body prose dark:prose-invert max-w-none">
                    <ReactMarkdown>{report.detailedResults || "No details provided."}</ReactMarkdown>

                    <hr className="border-line my-6" />
                    <h4 className="text-[color:var(--text)] font-display font-bold uppercase tracking-[0.05em] mb-2">Technical Data</h4>
                    <pre className="bg-navy-950 p-4 rounded-lg text-xs font-mono text-gold-300 border border-[rgba(230,206,150,0.16)] overflow-x-auto num">
                        {JSON.stringify(report, null, 2)}
                    </pre>
                </div>
                <div className="p-6 border-t border-line bg-surface rounded-b-2xl flex justify-end">
                    <button onClick={onClose} className="px-6 py-2 bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] rounded-lg transition-colors duration-150">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};
