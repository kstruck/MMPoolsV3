
import React from 'react';
import { Shield, Brain, Zap, Lock, Mail, Layout, Users, Trophy, MessageCircle, Smartphone } from 'lucide-react';
import { Header } from './Header';
import type { User } from '../types';
import { Footer } from './Footer';
import { isSuperAdmin } from '../utils/auth';

interface FeaturesPageProps {
    user: User | null;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

/* Marketing page is navy chrome end-to-end — always dark in both themes. */

export const FeaturesPage: React.FC<FeaturesPageProps> = ({ user, onOpenAuth, onLogout, onCreatePool }) => {
    return (
        <div className="min-h-screen bg-navy-950 text-white font-body">
            <Header user={user} onOpenAuth={onOpenAuth} onLogout={onLogout} />

            <main>
                {/* Hero Section */}
                <section className="relative overflow-hidden py-20 px-4 text-center">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gold-500/10 rounded-full blur-3xl -z-10"></div>
                    <div className="max-w-4xl mx-auto">
                        <span className="inline-block py-1 px-3 rounded-full bg-gold-500/10 border border-gold-500/25 text-gold-400 font-display font-bold uppercase text-sm tracking-[0.16em] mb-6 animate-fade-in-up">
                            The Ultimate Super Bowl Squares Platform
                        </span>
                        <h1 className="font-display font-extrabold uppercase text-5xl md:text-7xl text-white tracking-tight mb-8 leading-[0.9]">
                            Run Your Pool with <br />
                            <span className="text-gold-400">Confidence & Style</span>
                        </h1>
                        <p className="text-xl font-body text-[#9FB0CC] mb-10 max-w-2xl mx-auto leading-relaxed">
                            Experience the most advanced squares platform ever built.
                            Featuring AI-driven dispute resolution, military-grade audit logs, and real-time live scoring.
                        </p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button
                                onClick={isSuperAdmin(user) ? (user ? onCreatePool : onOpenAuth) : undefined}
                                disabled={!isSuperAdmin(user)}
                                className="bg-brandred-600 hover:bg-brandred-500 text-white px-8 py-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-lg transition-all duration-150 hover:-translate-y-px shadow-red-cta flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-brandred-600"
                                title={isSuperAdmin(user) ? "Create Your Pool" : "Pool creation is coming soon"}
                            >
                                <Trophy size={20} /> Create Your Pool
                            </button>
                            <button onClick={() => window.location.href = '/browse'} className="border-[1.5px] border-white/30 text-white hover:border-gold-500 hover:text-gold-300 bg-transparent px-8 py-4 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-lg transition-all duration-150 hover:-translate-y-px flex items-center justify-center gap-2">
                                <Layout size={20} /> Find a Pool
                            </button>
                        </div>
                    </div>
                </section>

                {/* Audit & Integrity */}
                <section className="py-20 px-4 bg-navy-900/60 border-y border-[rgba(230,206,150,0.16)]">
                    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
                        <div className="space-y-8">
                            <div className="inline-flex items-center gap-2 text-gold-400 font-display font-bold uppercase tracking-[0.16em] text-sm">
                                <Shield size={20} /> Integrity First
                            </div>
                            <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white">Fully Auditable & <br />Tamper-Proof.</h2>
                            <p className="font-body text-[#9FB0CC] text-lg leading-relaxed">
                                Gone are the days of "lost spreadhseets" or questionable number draws.
                                Our platform uses an immutable, append-only Audit Log for every critical action.
                            </p>
                            <ul className="space-y-4">
                                {[
                                    { title: 'Secure Number Generation', desc: 'Axis numbers are generated server-side using cryptographic RNG.', icon: <Lock className="text-gold-400" size={20} /> },
                                    { title: 'Public Audit Trail', desc: 'Any user can inspect the full timeline of events, ensuring 100% transparency.', icon: <Users className="text-[#9FB0CC]" size={20} /> },
                                    { title: 'Strict Permissions', desc: 'Even pool managers cannot alter numbers or locked grids once set.', icon: <Shield className="text-gold-400" size={20} /> }
                                ].map((item, i) => (
                                    <li key={i} className="flex gap-4">
                                        <div className="mt-1 bg-navy-950 p-2 rounded-lg border border-[rgba(230,206,150,0.16)]">{item.icon}</div>
                                        <div>
                                            <h3 className="font-display font-bold uppercase text-white">{item.title}</h3>
                                            <p className="font-body text-[#9FB0CC] text-sm">{item.desc}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 bg-gold-500/10 blur-3xl -z-10 rounded-full"></div>
                            <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl p-6 shadow-panel rotate-3 hover:rotate-0 transition-transform duration-500">
                                <div className="flex items-center justify-between mb-6 border-b border-[rgba(230,206,150,0.16)] pb-4">
                                    <h3 className="font-mono text-sm text-[#7C8BA6]">AUDIT_LOG_VIEWER_V1.0</h3>
                                    <span className="font-display font-bold uppercase text-xs tracking-[0.08em] bg-gold-500/15 text-gold-400 border border-gold-500/25 px-2 py-0.5 rounded">VIFIED_SECURE</span>
                                </div>
                                <div className="space-y-3 font-mono text-xs num">
                                    <div className="flex gap-3 text-[#9FB0CC]"><span className="text-[#7C8BA6]">14:02:01</span> <span>POOL_CREATED: ID_99281</span></div>
                                    <div className="flex gap-3 text-gold-400"><span className="text-[#7C8BA6]">15:30:10</span> <span>NUMBERS_GENERATED: [0,4,2,1...]</span></div>
                                    <div className="flex gap-3 text-[#9FB0CC]"><span className="text-[#7C8BA6]">15:30:11</span> <span>POOL_LOCKED_BY_SYSTEM</span></div>
                                    <div className="flex gap-3 text-brandred-500"><span className="text-[#7C8BA6]">18:45:22</span> <span>GAME_SCORE_UPDATE: (7-0)</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* AI Commissioner */}
                <section className="py-20 px-4">
                    <div className="max-w-5xl mx-auto text-center mb-16">
                        <div className="inline-flex items-center gap-2 text-gold-400 font-display font-bold uppercase tracking-[0.16em] text-sm mb-4">
                            <Brain size={20} /> Powered by Gemini AI
                        </div>
                        <h2 className="font-display font-extrabold uppercase text-4xl md:text-5xl leading-[0.95] text-white mb-6">Meet Your New <br />AI Commissioner.</h2>
                        <p className="text-xl font-body text-[#9FB0CC] max-w-2xl mx-auto">
                            A neutral, unbiased AI that settles disputes, explains winning squares, and answers player questions instantly.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] p-8 rounded-2xl hover:border-gold-500/40 transition-colors">
                            <MessageCircle className="text-gold-400 mb-6" size={40} />
                            <h3 className="font-display font-bold uppercase text-xl text-white mb-3">Dispute Resolution</h3>
                            <p className="font-body text-[#9FB0CC]">Players can ask "Did the numbers change?" or "Who won Q1?". The AI analyzes the audit log and provides fact-based answers.</p>
                        </div>
                        <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] p-8 rounded-2xl hover:border-gold-500/40 transition-colors">
                            <Trophy className="text-gold-400 mb-6" size={40} />
                            <h3 className="font-display font-bold uppercase text-xl text-white mb-3">Winner Explanations</h3>
                            <p className="font-body text-[#9FB0CC]">Confused by the grid? The AI generates plain-english breakdowns of exactly why a square won (e.g., "Score 7-3 -&gt; Digits 7 & 3").</p>
                        </div>
                        <div className="bg-navy-900 border border-[rgba(230,206,150,0.16)] p-8 rounded-2xl hover:border-gold-500/40 transition-colors">
                            <Zap className="text-[#9FB0CC] mb-6" size={40} />
                            <h3 className="font-display font-bold uppercase text-xl text-white mb-3">Zero Hallucinations</h3>
                            <p className="font-body text-[#9FB0CC]">Built with strict "Facts Only" protocols. If the data isn't in the Audit Log, the AI won't make it up.</p>
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Live Grid */}
                <section className="py-20 px-4 bg-navy-900/60 border-b border-[rgba(230,206,150,0.16)]">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-brandred-500 font-display font-bold uppercase tracking-[0.16em] text-sm">
                                <Layout size={20} /> The Main Event
                            </div>
                            <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white">Live 10x10 Grid. <br />No Refreshing Needed.</h2>
                            <p className="font-body text-[#9FB0CC] text-lg leading-relaxed">
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
                                    <li key={i} className="flex items-center gap-3 font-body text-[#EDF1F8]">
                                        <div className="w-1.5 h-1.5 rounded-full bg-brandred-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-brandred-600/20 rounded-2xl blur-xl group-hover:bg-brandred-600/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-live-grid.png"
                                alt="Live interactive Super Bowl squares grid showing real-time score updates and winning highlights"
                                className="relative rounded-xl shadow-panel border border-[rgba(230,206,150,0.16)] w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Scoreboard */}
                <section className="py-20 px-4 bg-navy-950 border-b border-[rgba(230,206,150,0.16)]">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row-reverse items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-gold-400 font-display font-bold uppercase tracking-[0.16em] text-sm">
                                <Zap size={20} /> Mission Control
                            </div>
                            <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white">Live Scoreboard & <br />Pool Stats.</h2>
                            <p className="font-body text-[#9FB0CC] text-lg leading-relaxed">
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
                                    <li key={i} className="flex items-center gap-3 font-body text-[#EDF1F8]">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gold-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-gold-500/20 rounded-2xl blur-xl group-hover:bg-gold-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-scoreboard.png"
                                alt="March Melee Pools dashboard with all-in-one view of scoreboard, payouts, and charity tracker"
                                className="relative rounded-xl shadow-panel border border-[rgba(230,206,150,0.16)] w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Scenarios */}
                <section className="py-20 px-4 bg-navy-900/60 border-b border-[rgba(230,206,150,0.16)]">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-gold-400 font-display font-bold uppercase tracking-[0.16em] text-sm">
                                <Brain size={20} /> Smart Math
                            </div>
                            <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white">Winning Scenarios <br />Calculator.</h2>
                            <p className="font-body text-[#9FB0CC] text-lg leading-relaxed">
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
                                    <li key={i} className="flex items-center gap-3 font-body text-[#EDF1F8]">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gold-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-gold-500/20 rounded-2xl blur-xl group-hover:bg-gold-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-scenarios.png"
                                alt="Super Bowl squares payout examples including quarter breakdowns and back-loaded jackpot"
                                className="relative rounded-xl shadow-panel border border-[rgba(230,206,150,0.16)] w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* Feature Deep Dive: Setup Wizard */}
                <section className="py-20 px-4 bg-navy-950 border-b border-[rgba(230,206,150,0.16)]">
                    <div className="max-w-6xl mx-auto flex flex-col md:flex-row-reverse items-center gap-12">
                        <div className="md:w-1/2 space-y-6">
                            <div className="inline-flex items-center gap-2 text-gold-400 font-display font-bold uppercase tracking-[0.16em] text-sm">
                                <Shield size={20} /> Commissioner Tools
                            </div>
                            <h2 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white">Setup in Seconds. <br />Manage with Ease.</h2>
                            <p className="font-body text-[#9FB0CC] text-lg leading-relaxed">
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
                                    <li key={i} className="flex items-center gap-3 font-body text-[#EDF1F8]">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gold-500"></div>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="md:w-1/2 relative group">
                            <div className="absolute -inset-4 bg-gold-500/20 rounded-2xl blur-xl group-hover:bg-gold-500/30 transition-colors duration-500"></div>
                            <img
                                src="/feature-setup-wizard.png"
                                alt="Easy Pool Setup Wizard for commissioners with customization options"
                                className="relative rounded-xl shadow-panel border border-[rgba(230,206,150,0.16)] w-full transform group-hover:scale-[1.01] transition-transform duration-500"
                            />
                        </div>
                    </div>
                </section>

                {/* More Features Grid */}
                <section className="py-20 px-4 bg-navy-900/60">
                    <div className="max-w-6xl mx-auto">
                        <div className="text-center mb-12">
                            <h2 className="font-display font-extrabold uppercase text-3xl leading-[0.95] text-white mb-4">And Much More...</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="bg-navy-950 p-6 rounded-xl border border-[rgba(230,206,150,0.16)] flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-400 mb-4">
                                    <Smartphone size={24} />
                                </div>
                                <h3 className="font-display font-bold uppercase text-lg text-white mb-2">Mobile Optimized</h3>
                                <p className="font-body text-[#9FB0CC] text-sm">Built for phones first. Checking your squares is as easy as checking your text messages.</p>
                            </div>
                            <div className="bg-navy-950 p-6 rounded-xl border border-[rgba(230,206,150,0.16)] flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-navy-700/50 flex items-center justify-center text-[#9FB0CC] mb-4">
                                    <Mail size={24} />
                                </div>
                                <h3 className="font-display font-bold uppercase text-lg text-white mb-2">Smart Notifications</h3>
                                <p className="font-body text-[#9FB0CC] text-sm">Automated email alerts for pool invites, pick confirmations, and winner announcements.</p>
                            </div>
                            <div className="bg-navy-950 p-6 rounded-xl border border-[rgba(230,206,150,0.16)] flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-gold-500/10 flex items-center justify-center text-gold-400 mb-4">
                                    <Lock size={24} />
                                </div>
                                <h3 className="font-display font-bold uppercase text-lg text-white mb-2">Private & Secure</h3>
                                <p className="font-body text-[#9FB0CC] text-sm">Password protect your pool and rely on enterprise-grade security for your data.</p>
                            </div>
                        </div>
                    </div>
                </section>
                <section className="py-20 text-center px-4">
                    <div className="max-w-3xl mx-auto bg-navy-900 border border-gold-500/35 rounded-3xl p-12 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-gold-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>

                        <h2 className="font-display font-extrabold uppercase text-3xl md:text-5xl leading-[0.95] text-white mb-6 relative z-10">Ready to Start?</h2>
                        <p className="font-body text-[#9FB0CC] text-lg mb-8 relative z-10">Create your pool in seconds. No spreadsheets, no stress.</p>

                        <button
                            onClick={isSuperAdmin(user) ? (user ? onCreatePool : onOpenAuth) : undefined}
                            disabled={!isSuperAdmin(user)}
                            className="bg-brandred-600 text-white px-8 py-3 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-lg hover:bg-brandred-500 transition-all duration-150 hover:-translate-y-px relative z-10 shadow-red-cta disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:bg-brandred-600"
                            title={isSuperAdmin(user) ? "Create Your Pool Free" : "Pool creation is coming soon"}
                        >
                            Create Your Pool Free
                        </button>
                    </div>
                </section>

            </main>
            <Footer />
        </div>
    );
};
