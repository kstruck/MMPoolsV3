import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { HelpCircle, CheckCircle, Shield, Trophy, LayoutGrid } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

interface Props {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

type Sport = 'squares' | 'brackets';

/* ─────────────────────────────────────────── DATA ─────────────────────────────────────────── */

const squaresSteps = [
    { title: "1. Join a Pool", desc: "Find a pool link from your friend, office manager, or community group." },
    { title: "2. Pick Your Squares", desc: "You'll see a 10×10 grid. Choose any empty square(s) you like." },
    { title: "3. Lock the Grid", desc: 'Once all squares are filled (or the deadline hits), the pool is "locked."' },
    { title: "4. Assign Numbers", desc: "The system randomly assigns numbers (0–9) to every row and column." },
    { title: "5. Check Your Numbers", desc: "Your square now corresponds to two numbers: one for the Home Team and one for the Away Team." },
    { title: "6. Watch the Game", desc: "Relax and enjoy. You don't need to track stats or players." },
    { title: "7. Check the Score", desc: "At the end of each quarter, look at the <strong>last digit</strong> of each team's score." },
    { title: "8. Find the Winner", desc: "Match those last digits to the grid. If they intersect at your square, you win!" },
    { title: "9. Celebrate", desc: "Winners are typically determined after Q1, Halftime, Q3, and the Final score." }
];

const bracketSteps = [
    { title: "1. Create or Join a Pool", desc: "Start your own bracket pool or join one from a friend, office, or community group using a share link." },
    { title: "2. Fill Out Your Bracket", desc: "Pick a winner for every game in the NCAA Tournament — from the Round of 64 through the National Championship." },
    { title: "3. Lock Before Tip-Off", desc: "All brackets must be submitted before the first game starts. No changes allowed once the tournament begins." },
    { title: "4. Earn Points for Correct Picks", desc: "Each correct pick earns points. Later rounds are worth more — a correct Final Four pick is worth far more than a first-round pick." },
    { title: "5. Watch the Madness Unfold", desc: "Follow the games and watch the upsets shake up the leaderboard. Root for your picks and track your progress in real time." },
    { title: "6. Climb the Leaderboard", desc: 'Your total points are ranked against everyone in the pool. The "Who to Root For" feature shows which remaining games matter most to your standing.' },
    { title: "7. Win Prizes", desc: "When the championship game ends, final standings determine payouts based on your pool's prize structure." }
];

const squaresFaqs = [
    { q: "How do I know what square I own?", a: "Log in to your pool. Your name will be written inside your square(s). Once the grid is locked, you can also see your assigned numbers on the top and left axes." },
    { q: "Can I buy multiple squares?", a: "Yes! Most organizers allow players to grab as many squares as they want to increase their odds." },
    { q: "When are numbers assigned?", a: 'Numbers are essentially "drawn from a hat" by the system only AFTER the pool is closed/locked. This guarantees fairness.' },
    { q: "What happens if the grid doesn't fill?", a: 'The game goes on! If a winning score lands on an empty square, the prize typically "rolls over" to the next quarter or is split. Your organizer decides the specific rule.' },
    { q: "Do I need to understand the sport?", a: 'Nope. This is a game of chance based on numbers. You can root for your numbers (e.g., "I need the score to stay ending in 5!") without knowing the teams.' },
    { q: "What happens in Overtime?", a: 'Almost all pools use the "Final Score" for the last prize. This means if the game goes to overtime, the score after overtime determines the final winner.' },
    { q: "Is this legal?", a: "Laws vary by location. Social pools among friends are often legal, but always check your local regulations. We provide the platform for fun and do not handle money." }
];

const bracketFaqs = [
    { q: "How is scoring calculated?", a: "Most pools award escalating points per round — for example 1, 2, 4, 8, 16, and 32 points from the Round of 64 through the Championship. Pool managers can customize scoring when they create the pool." },
    { q: "Can I submit multiple brackets?", a: "That depends on the pool rules. The manager sets whether each participant can submit one or multiple brackets when creating the pool." },
    { q: "When do brackets lock?", a: "Brackets lock before the first game of the tournament tips off. Once locked, no changes are allowed — everyone is committed to their picks." },
    { q: "What happens with upsets?", a: "Upsets are what make March Madness exciting! If a team you picked gets eliminated, you lose all future points from that pick. Balancing safe picks with upset potential is key strategy." },
    { q: "How do tiebreakers work?", a: "If two or more participants finish with the same total score, tiebreakers are applied based on the pool's rules — commonly the predicted championship game total score." },
    { q: "What is 'Who to Root For'?", a: "It's a real-time analytics feature that shows you exactly which team outcomes in upcoming games would help or hurt your ranking. It takes the guesswork out of who to cheer for." },
    { q: "Can I run a charity bracket pool?", a: "Absolutely! When creating a pool, you can designate a percentage of entries for charity. The platform tracks contributions so everyone sees the impact." }
];

/* ────────────────────────────────────────── COMPONENT ────────────────────────────────────────── */

export const HowItWorksPage: React.FC<Props> = (props) => {
    const [searchParams, setSearchParams] = useSearchParams();
    const initialSport = (searchParams.get('sport') as Sport) || 'brackets';
    const [activeSport, setActiveSport] = useState<Sport>(initialSport);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeSport]);

    const handleSportChange = (sport: Sport) => {
        setActiveSport(sport);
        setSearchParams({ sport });
    };

    const steps = activeSport === 'squares' ? squaresSteps : bracketSteps;
    const faqs = activeSport === 'squares' ? squaresFaqs : bracketFaqs;
    const accentColor = activeSport === 'squares' ? 'indigo' : 'orange';

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
            <Header {...props} />

            <main className="max-w-4xl mx-auto px-6 py-12">
                {/* Hero */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl md:text-6xl font-black text-slate-900 dark:text-white mb-6 tracking-tight">
                        How{' '}
                        <span className={activeSport === 'squares' ? 'text-indigo-600 dark:text-indigo-400' : 'text-orange-600 dark:text-orange-400'}>
                            {activeSport === 'squares' ? 'Squares Pools' : 'Bracket Pools'}
                        </span>{' '}
                        Work
                    </h1>
                    <p className="text-xl text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
                        {activeSport === 'squares'
                            ? "Welcome to the easiest way to add excitement to the big game. Whether you're a die-hard fan or just here for the snacks, a Squares Pool gives everyone a fair shot at winning."
                            : "Fill out your bracket, compete against friends or coworkers, and climb the leaderboard as March Madness unfolds. No spreadsheets required — just pick your winners and watch the chaos."
                        }
                    </p>
                </div>

                {/* Sport Tabs */}
                <div className="flex justify-center mb-16">
                    <div className="inline-flex bg-white dark:bg-slate-900 rounded-2xl p-1.5 border border-slate-200 dark:border-slate-800 shadow-sm gap-1">
                        <button
                            onClick={() => handleSportChange('brackets')}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${activeSport === 'brackets'
                                    ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                        >
                            <Trophy size={16} />
                            NCAA Bracket Pools
                        </button>
                        <button
                            onClick={() => handleSportChange('squares')}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${activeSport === 'squares'
                                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'
                                }`}
                        >
                            <LayoutGrid size={16} />
                            Super Bowl Squares
                        </button>
                    </div>
                </div>

                {/* Steps */}
                <div className="grid gap-8 mb-20">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-800 pb-4">
                        {activeSport === 'squares' ? 'The Game Plan' : 'The Bracket Playbook'}
                    </h2>

                    <div className="space-y-6">
                        {steps.map((step, idx) => (
                            <div key={idx} className="flex gap-4 items-start p-4 rounded-xl hover:bg-white dark:hover:bg-slate-900 border border-transparent hover:border-slate-200 dark:hover:border-slate-800 transition-all">
                                <div className={`${accentColor === 'indigo'
                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                                        : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                                    } font-black text-xl w-10 h-10 rounded-full flex items-center justify-center shrink-0`}>
                                    {idx + 1}
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1">{step.title}</h3>
                                    <p className="text-slate-600 dark:text-slate-400" dangerouslySetInnerHTML={{ __html: step.desc }}></p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Example — Squares */}
                {activeSport === 'squares' && (
                    <div className="bg-slate-100 dark:bg-slate-900 rounded-3xl p-8 mb-20 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                            <HelpCircle className="text-emerald-500" /> Quick Example
                        </h2>
                        <p className="text-lg mb-6 text-slate-700 dark:text-slate-300">
                            Let's say you picked a square. After the grid is locked, your square gets <strong className="text-indigo-600 dark:text-indigo-400">Home: 7</strong> and <strong className="text-rose-500">Away: 3</strong>.
                        </p>
                        <div className="bg-white dark:bg-slate-950 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <ul className="space-y-4">
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <span>
                                        <strong>The Game Score:</strong> At the end of the 1st Quarter, the score is <span className="font-mono bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">Home 17 - Away 3</span>.
                                    </span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <div>
                                        <strong>The Magic Digits:</strong> We only care about the last digit.
                                        <div className="flex gap-4 mt-2 text-sm font-mono">
                                            <div className="bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1 rounded text-indigo-700 dark:text-indigo-300">Home 1<strong>7</strong> → 7</div>
                                            <div className="bg-rose-50 dark:bg-rose-900/20 px-3 py-1 rounded text-rose-700 dark:text-rose-300">Away <strong>3</strong> → 3</div>
                                        </div>
                                    </div>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <span>
                                        <strong>The Result:</strong> Your numbers match perfectly (Home 7, Away 3). <span className="text-emerald-500 font-bold">You win the 1st Quarter prize!</span>
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* Example — Brackets */}
                {activeSport === 'brackets' && (
                    <div className="bg-slate-100 dark:bg-slate-900 rounded-3xl p-8 mb-20 border border-slate-200 dark:border-slate-800">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                            <HelpCircle className="text-emerald-500" /> Quick Example
                        </h2>
                        <p className="text-lg mb-6 text-slate-700 dark:text-slate-300">
                            You filled out your bracket before the tournament started. Here's how scoring works as the games play out:
                        </p>
                        <div className="bg-white dark:bg-slate-950 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <ul className="space-y-4">
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <span>
                                        <strong>Round of 64:</strong> You picked <span className="font-mono bg-orange-50 dark:bg-orange-900/20 px-2 py-0.5 rounded text-orange-700 dark:text-orange-300">(12) Drake</span> to upset <span className="font-mono bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">(5) Memphis</span> — and they win! <span className="text-emerald-500 font-bold">+1 point.</span>
                                    </span>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <div>
                                        <strong>Points Escalate:</strong> Correct picks are worth more in each round.
                                        <div className="flex flex-wrap gap-2 mt-2 text-sm font-mono">
                                            <div className="bg-orange-50 dark:bg-orange-900/20 px-3 py-1 rounded text-orange-700 dark:text-orange-300">R64: 1 pt</div>
                                            <div className="bg-orange-50 dark:bg-orange-900/20 px-3 py-1 rounded text-orange-700 dark:text-orange-300">R32: 2 pts</div>
                                            <div className="bg-orange-50 dark:bg-orange-900/20 px-3 py-1 rounded text-orange-700 dark:text-orange-300">Sweet 16: 4 pts</div>
                                            <div className="bg-orange-50 dark:bg-orange-900/20 px-3 py-1 rounded text-orange-700 dark:text-orange-300">Elite 8: 8 pts</div>
                                            <div className="bg-amber-50 dark:bg-amber-900/20 px-3 py-1 rounded text-amber-700 dark:text-amber-300">Final 4: 16 pts</div>
                                            <div className="bg-amber-50 dark:bg-amber-900/20 px-3 py-1 rounded text-amber-700 dark:text-amber-300 font-bold">Championship: 32 pts</div>
                                        </div>
                                    </div>
                                </li>
                                <li className="flex items-center gap-3">
                                    <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                                    <span>
                                        <strong>The Result:</strong> After 6 rounds, your total points are tallied. The highest score across all participants wins the pool. <span className="text-emerald-500 font-bold">Picking the champion correctly is huge!</span>
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>
                )}

                {/* FAQ Section */}
                <div className="mb-20">
                    <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-8 text-center">Frequently Asked Questions</h2>
                    <div className="grid gap-4">
                        {faqs.map((faq, i) => (
                            <details key={`${activeSport}-${i}`} className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                                <summary className="flex justify-between items-center p-6 cursor-pointer font-bold text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors list-none">
                                    {faq.q}
                                    <span className="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
                                </summary>
                                <div className="px-6 pb-6 text-slate-600 dark:text-slate-400 leading-relaxed border-t border-slate-100 dark:border-slate-800 pt-4">
                                    {faq.a}
                                </div>
                            </details>
                        ))}
                    </div>
                </div>

                {/* Fairness */}
                <div className={`flex gap-4 p-6 rounded-xl mb-20 border ${activeSport === 'squares'
                        ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                        : 'bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800'
                    }`}>
                    <Shield className={activeSport === 'squares' ? 'text-amber-500' : 'text-orange-500'} size={32} />
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white mb-2">Fairness Guarantee</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                            {activeSport === 'squares'
                                ? <>You pick your square's location on the grid, but you <strong>don't pick the numbers</strong>. Numbers are randomized <em>after</em> the grid is filled. This ensures pure luck — no one can snag the "best numbers" ahead of time.</>
                                : <>Every participant fills out their bracket independently before the first game tips off. Once brackets lock, <strong>no changes are allowed</strong>. The platform tracks scores automatically so there's no manual math or room for human error.</>
                            }
                        </p>
                    </div>
                </div>

                {/* CTA */}
                <div className="text-center py-12 bg-slate-900 rounded-3xl relative overflow-hidden">
                    <div className="relative z-10">
                        <h2 className="text-3xl font-black text-white mb-6">Ready to play?</h2>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <button onClick={props.onCreatePool} className={`px-8 py-4 font-bold rounded-xl transition-all hover:scale-105 shadow-xl text-white ${activeSport === 'squares'
                                    ? 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/20'
                                    : 'bg-orange-500 hover:bg-orange-600 shadow-orange-900/20'
                                }`}>
                                {activeSport === 'squares' ? 'Create a Squares Pool' : 'Create a Bracket Pool'}
                            </button>
                            <button onClick={() => window.location.href = '/browse'} className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all backdrop-blur-sm border border-white/10">
                                Join a Public Pool
                            </button>
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
