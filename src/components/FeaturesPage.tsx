
import React from 'react';
import { Shield, Brain, Zap, Lock, Mail, Layout, Users, Trophy, MessageCircle, Smartphone } from 'lucide-react';
import { Header } from './Header';
import type { User } from '../types';
import { Footer } from './Footer';

interface FeaturesPageProps {
    user: User | null;
    onOpenAuth: () => void;
    onLogout: () => void;
}

export const FeaturesPage: React.FC<FeaturesPageProps> = ({ user, onOpenAuth, onLogout }) => {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} />

            <main>
                {/* Hero Section */}
                <section className="relative overflow-hidden py-20 px-4 text-center">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-3xl -z-10"></div>
                    <div className="max-w-4xl mx-auto">
                        <span className="inline-block py-1 px-3 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-sm font-bold uppercase tracking-wider mb-6 animate-fade-in-up">
                            The Ultimate Super Bowl Squares Platform
                        </span>
                        <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight mb-8 leading-tight">
                            Run Your Pool with <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400">Confidence & Style</span>
                        </h1>
                        <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                            Experience the most advanced squares platform ever built.
                            Featuring AI-driven dispute resolution, military-grade audit logs, and real-time live scoring.
                        </p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button onClick={onOpenAuth} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-xl font-bold text-lg transition-transform hover:scale-105 shadow-lg shadow-indigo-500/20 flex items-center gap-2">
                                <Trophy size={20} /> Create Your Pool
                            </button>
                            <button onClick={() => window.location.hash = '#browse'} className="bg-white hover:bg-slate-50 text-slate-900 px-8 py-4 rounded-xl font-bold text-lg border border-slate-200 transition-colors flex items-center gap-2">
                                <Layout size={20} /> Find a Pool
                            </button>
                        </div>
                    </div>
                </section>

                {/* Audit & Integrity */}
                <section className="py-20 px-4 bg-black/50 border-y border-slate-900">
                    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                        <div className="space-y-8">
                            <div className="inline-flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-wider text-sm">
                                <Shield size={20} /> Integrity First
                            </div>
                            <h2 className="text-4xl font-bold text-white">Fully Auditable & <br />Tamper-Proof.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed">
                                Gone are the days of "lost spreadhseets" or questionable number draws.
                                Our platform uses an immutable, append-only Audit Log for every critical action.
                            </p>
                            <ul className="space-y-4">
                                {[
                                    { title: 'Secure Number Generation', desc: 'Axis numbers are generated server-side using cryptographic RNG.', icon: <Lock className="text-emerald-400" size={20} /> },
                                    { title: 'Public Audit Trail', desc: 'Any user can inspect the full timeline of events, ensuring 100% transparency.', icon: <Users className="text-indigo-400" size={20} /> },
                                    { title: 'Strict Permissions', desc: 'Even pool managers cannot alter numbers or locked grids once set.', icon: <Shield className="text-rose-400" size={20} /> }
                                ].map((item, i) => (
                                    <li key={i} className="flex gap-4">
                                        <div className="mt-1 bg-slate-900 p-2 rounded-lg border border-slate-800">{item.icon}</div>
                                        <div>
                                            <h3 className="font-bold text-white">{item.title}</h3>
                                            <p className="text-slate-500 text-sm">{item.desc}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 bg-emerald-500/20 blur-3xl -z-10 rounded-full"></div>
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500">
                                <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
                                    <h3 className="font-mono text-sm text-slate-500">AUDIT_LOG_VIEWER_V1.0</h3>
                                    <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded">VIFIED_SECURE</span>
                                </div>
                                <div className="space-y-3 font-mono text-xs">
                                    <div className="flex gap-3 text-slate-500"><span className="text-slate-600">14:02:01</span> <span>POOL_CREATED: ID_99281</span></div>
                                    <div className="flex gap-3 text-emerald-400"><span className="text-slate-600">15:30:10</span> <span>NUMBERS_GENERATED: [0,4,2,1...]</span></div>
                                    <div className="flex gap-3 text-slate-500"><span className="text-slate-600">15:30:11</span> <span>POOL_LOCKED_BY_SYSTEM</span></div>
                                    <div className="flex gap-3 text-indigo-400"><span className="text-slate-600">18:45:22</span> <span>GAME_SCORE_UPDATE: (7-0)</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* AI Commissioner */}
                <section className="py-20 px-4">
                    <div className="max-w-5xl mx-auto text-center mb-16">
                        <div className="inline-flex items-center gap-2 text-indigo-400 font-bold uppercase tracking-wider text-sm mb-4">
                            <Brain size={20} /> Powered by Gemini AI
                        </div>
                        <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Meet Your New <br />AI Commissioner.</h2>
                        <p className="text-xl text-slate-400 max-w-2xl mx-auto">
                            A neutral, unbiased AI that settles disputes, explains winning squares, and answers player questions instantly.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl hover:bg-slate-900 transition-colors">
                            <MessageCircle className="text-indigo-400 mb-6" size={40} />
                            <h3 className="text-xl font-bold text-white mb-3">Dispute Resolution</h3>
                            <p className="text-slate-500">Players can ask "Did the numbers change?" or "Who won Q1?". The AI analyzes the audit log and provides fact-based answers.</p>
                        </div>
                        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl hover:bg-slate-900 transition-colors">
                            <Trophy className="text-amber-400 mb-6" size={40} />
                            <h3 className="text-xl font-bold text-white mb-3">Winner Explanations</h3>
                            <p className="text-slate-500">Confused by the grid? The AI generates plain-english breakdowns of exactly why a square won (e.g., "Score 7-3 -&gt; Digits 7 & 3").</p>
                        </div>
                        <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl hover:bg-slate-900 transition-colors">
                            <Zap className="text-blue-400 mb-6" size={40} />
                            <h3 className="text-xl font-bold text-white mb-3">Zero Hallucinations</h3>
                            <p className="text-slate-500">Built with strict "Facts Only" protocols. If the data isn't in the Audit Log, the AI won't make it up.</p>
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Live Grid */}
                <section className="py-20 px-4 bg-slate-900 border-b border-slate-800">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-rose-400 font-bold uppercase tracking-wider text-sm">
                                <Layout size={20} /> The Main Event
                            </div>
                            <h2 className="text-4xl font-bold text-white">Live 10x10 Grid. <br />No Refreshing Needed.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed">
                                Experience the action in real-time. As the game clock ticks and points are scored, your grid updates instantly.
                                Watch as winning squares light up and payouts are calculated automatically.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    "Automatic Quarter & Final Winners",
                                    "Player Name & Avatar Integration",
                                    "Mobile-Optimized Touch Interface",
                                    "Printable PDF Export Option"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-rose-500/20 rounded-2xl blur-xl group-hover:bg-rose-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-live-grid.png"
                                alt="Live interactive Super Bowl squares grid showing real-time score updates and winning highlights"
                                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Scoreboard */}
                <section className="py-20 px-4 bg-slate-950 border-b border-slate-800">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row-reverse items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-sky-400 font-bold uppercase tracking-wider text-sm">
                                <Zap size={20} /> Mission Control
                            </div>
                            <h2 className="text-4xl font-bold text-white">Live Scoreboard & <br />Pool Stats.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed">
                                Don't make your players switch apps. We integrate live game data directly into your pool dashboard.
                                Track possession, quarter scores, and game status without missing a beat.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    "Direct ESPN Data Feed (Zero Latency)",
                                    "Quarter-by-Quarter Score Tracking",
                                    "Live 'Current Winner' Indicator",
                                    "Integrated Charity Fundraising Tracker"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-sky-500/20 rounded-2xl blur-xl group-hover:bg-sky-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-scoreboard.png"
                                alt="March Melee Pools dashboard with all-in-one view of scoreboard, payouts, and charity tracker"
                                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Scenarios */}
                <section className="py-20 px-4 bg-slate-900 border-b border-slate-800">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-emerald-400 font-bold uppercase tracking-wider text-sm">
                                <Brain size={20} /> Smart Math
                            </div>
                            <h2 className="text-4xl font-bold text-white">Winning Scenarios <br />Calculator.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed">
                                "Who wins if the Chiefs score a TD?" Stop guessing. Our "If Score Next" tool calculates every possible outcome instantly.
                                It's the ultimate second-screen experience for your pool members.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    "Interactive 'What If' Adjusters",
                                    "Instant 'In The Money' Probability",
                                    "Visualize Payouts for Field Goals vs TDs",
                                    "Eliminate Confusion on Close Games"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-emerald-500/20 rounded-2xl blur-xl group-hover:bg-emerald-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-scenarios.png"
                                alt="Super Bowl squares payout examples including quarter breakdowns and back-loaded jackpot"
                                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Setup Wizard */}
                <section className="py-20 px-4 bg-slate-950 border-b border-slate-800">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row-reverse items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-amber-400 font-bold uppercase tracking-wider text-sm">
                                <Shield size={20} /> Commissioner Tools
                            </div>
                            <h2 className="text-4xl font-bold text-white">Setup in Seconds. <br />Manage with Ease.</h2>
                            <p className="text-slate-400 text-lg leading-relaxed">
                                You don't need a PhD to run a pool. Our guided Setup Wizard handles all the technical details—from
                                assigning random numbers to defining custom payout rules.
                            </p>
                            <ul className="space-y-3">
                                {[
                                    "Customizable Square Costs & Payout Allocation",
                                    "Password Protection for Private Pools",
                                    "Automated Email Invites & Reminder System",
                                    "CSV Export of All Participant Data"
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3 text-slate-300">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-amber-500/20 rounded-2xl blur-xl group-hover:bg-amber-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-setup-wizard.png"
                                alt="Easy Pool Setup Wizard for commissioners with customization options"
                                className="relative rounded-xl shadow-2xl border border-slate-700 w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* More Features Grid */}
                <section className="py-20 px-4 bg-slate-900">
                    <div className="max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold text-white mb-4">And Much More...</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 mb-4">
                                    <Smartphone size={24} />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2">Mobile Optimized</h3>
                                <p className="text-slate-400 text-sm">Built for phones first. Checking your squares is as easy as checking your text messages.</p>
                            </div>
                            <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 mb-4">
                                    <Mail size={24} />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2">Smart Notifications</h3>
                                <p className="text-slate-400 text-sm">Automated email alerts for pool invites, pick confirmations, and winner announcements.</p>
                            </div>
                            <div className="bg-slate-950 p-6 rounded-xl border border-slate-800 flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-400 mb-4">
                                    <Lock size={24} />
                                </div>
                                <h3 className="text-lg font-bold text-white mb-2">Private & Secure</h3>
                                <p className="text-slate-400 text-sm">Password protect your pool and rely on enterprise-grade security for your data.</p>
                            </div>
                        </div>
                    </div>
                </section>
                <section className="py-20 text-center px-4">
                    <div className="max-w-3xl mx-auto bg-indigo-600 rounded-3xl p-12 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

                        <h2 className="text-3xl md:text-5xl font-black text-white mb-6 relative z-10">Ready to Start?</h2>
                        <p className="text-indigo-100 text-lg mb-8 relative z-10">Create your pool in seconds. No spreadsheets, no stress.</p>

                        <button onClick={onOpenAuth} className="bg-white text-indigo-600 px-8 py-3 rounded-xl font-bold text-lg hover:bg-indigo-50 transition-colors relative z-10 shadow-xl">
                            Create Your Pool Free
                        </button>
                    </div>
                </section>

            </main>
            <Footer />
        </div>
    );
};


