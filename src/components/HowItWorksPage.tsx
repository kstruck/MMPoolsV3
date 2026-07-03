import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';
import { HelpCircle, CheckCircle, Shield, Trophy, LayoutGrid, BookOpen, AlertCircle, Mail, Sparkles, Zap, Star, Lightbulb, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { isSuperAdmin } from '../utils/auth';
import { emailService } from '../services/emailService';
import { logger } from '../utils/logger';
import { Input, Select, FieldLabel, Checkbox, Button } from './ui';

interface Props {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

type Sport = 'brackets' | 'squares' | 'survivor' | 'pickem' | 'margin' | 'playoffs' | 'props';
type ViewMode = 'overview' | 'strategy' | 'faq' | 'contact';

/* ─────────────────────────────────────────── DATA ─────────────────────────────────────────── */

const POOL_TYPES = [
    { id: 'brackets' as Sport, name: 'NCAA Brackets', icon: Trophy },
    { id: 'squares' as Sport, name: 'Gameday Squares', icon: LayoutGrid },
    { id: 'survivor' as Sport, name: 'Survivor Pools', icon: Zap },
    { id: 'pickem' as Sport, name: "Weekly Pick'em", icon: Star },
    { id: 'margin' as Sport, name: 'Margin Pools', icon: Sparkles },
    { id: 'playoffs' as Sport, name: 'Playoff Challenge', icon: Trophy },
    { id: 'props' as Sport, name: 'Side Hustle Props', icon: HelpCircle },
];

const poolData: Record<Sport, {
    title: string;
    description: string;
    stepsTitle: string;
    steps: { title: string; desc: string }[];
    strategyTitle: string;
    strategySections: { title: string; content: string }[];
    faqs: { q: string; a: string }[];
    fairness: string;
    ctaText: string;
}> = {
    brackets: {
        title: 'NCAA Bracket Pools',
        description: 'Compete against friends or coworkers and climb the leaderboard as March Madness unfolds. Simply pick your winners and watch the chaos.',
        stepsTitle: 'The Bracket Playbook',
        steps: [
            { title: "1. Create or Join a Pool", desc: "Start your own bracket pool or join one using a share link." },
            { title: "2. Fill Out Your Bracket", desc: "Pick a winner for every game in the NCAA Tournament — from the Round of 64 through the Championship." },
            { title: "3. Lock Before Tip-Off", desc: "All brackets must be submitted before the first game starts. No changes allowed once the tournament begins." },
            { title: "4. Earn Escalating Points", desc: "Each correct pick earns points. Later rounds are worth more (e.g., Round 1 = 1pt, Round 2 = 2pt, ..., Final = 32pt)." },
            { title: "5. Climb the Standings", desc: "Follow your ranking in real time and use the 'Who to Root For' simulator to see which outcomes benefit your bracket the most." }
        ],
        strategyTitle: 'How to Build a Winning Bracket',
        strategySections: [
            { title: 'Balance Favorites and Upsets', content: 'Do not pick too many heavy upsets, but do not send all four #1 seeds to the Final Four. Historically, at least one #12 seed upsets a #5 seed almost every year.' },
            { title: 'Value of the Champion', content: 'Picking the correct national champion is worth up to 32 points—equal to a perfect first round. Spend extra time analyzing who has the defense and depth to win it all.' },
            { title: 'Leverage Pool Size', content: 'In small pools (< 20 entries), play it safe and pick favorites. In massive pools (> 100 entries), you must make a few bold upset picks to differentiate your bracket.' }
        ],
        faqs: [
            { q: "How is scoring calculated?", a: "Standard scoring awards 1, 2, 4, 8, 16, and 32 points per correct pick from the Round of 64 through the Championship. Commissioners can customize this scoring during setup." },
            { q: "What is 'Who to Root For'?", a: "It is an advanced simulator that calculates every remaining tournament combination to show you exactly which team results will maximize your leaderboard rank." },
            { q: "Can I edit my picks after the tournament starts?", a: "No. Once the first game of the tournament tips off, all brackets lock permanently to maintain fairness." }
        ],
        fairness: 'All participants submit their independent picks before the lock deadline. The Firestore backend timestamps and locks every bracket, ensuring no late entries or editing.',
        ctaText: 'Create a Bracket Pool'
    },
    squares: {
        title: 'Super Bowl & Gameday Squares',
        description: 'Classic 10x10 grid game perfect for the Super Bowl, MNF, or Thanksgiving. Zero sports knowledge required — pure luck and high-suspense fun.',
        stepsTitle: 'The Grid Game Plan',
        steps: [
            { title: "1. Join a Grid Pool", desc: "Access the pool via the commissioner's invite link." },
            { title: "2. Claim Your Squares", desc: "Look at the 10x10 grid and select any available square(s) you'd like to buy." },
            { title: "3. Lock and Randomize", desc: "When the grid is full or the game is about to start, the pool locks, and the system randomly assigns numbers 0-9 to the rows and columns." },
            { title: "4. Get Your Numbers", desc: "Your square now has two coordinates — one for the Home Team and one for the Away Team." },
            { title: "5. Watch the Quarter Scores", desc: "At the end of Q1, Halftime, Q3, and the Final score, match the last digit of each team's score to the grid. The intersecting square wins!" }
        ],
        strategyTitle: 'Understanding Square Probabilities',
        strategySections: [
            { title: 'Analyzing Key Numbers', content: 'In football, certain numbers are much more common endings due to touchdowns (7 pts) and field goals (3 pts). The numbers 0, 7, 3, and 4 are highly coveted, while 2, 5, and 9 are historically rarer.' },
            { title: 'Multiple Grid Entries', content: 'Buying multiple squares spread across different sectors increases your coverage, giving you different number combinations and multiple routes to a payout.' },
            { title: 'Rolling Over Empty Squares', content: 'If a quarter ends and the matching square is empty, the pot typically rolls over to the next quarter or is split among the active players. Check your commissioner\'s custom rules!' }
        ],
        faqs: [
            { q: "When are row and column numbers assigned?", a: "Numbers are randomized by the system only AFTER the pool locks. This guarantees that no player can select specific numbers in advance, keeping the game 100% fair." },
            { q: "Can I host a grid for sports other than NFL?", a: "Absolutely! Gameday Squares can be customized for college basketball, soccer, or any sport with structured quarter/half scores." },
            { q: "What happens in Overtime?", a: "By default, the Final Score prize includes overtime. The score after overtime determines the final winner." }
        ],
        fairness: 'The random 0-9 number assignment is handled by a secure server-side cryptographic algorithm after the grid locks, preventing any commissioner tampering.',
        ctaText: 'Create a Squares Pool'
    },
    survivor: {
        title: 'NFL Survivor Pools',
        description: 'Pick one winner each week. If they win, you advance. If they lose or tie, you take a strike. You can never select the same team twice.',
        stepsTitle: 'The Survivor Roadmap',
        steps: [
            { title: "1. Select One Team Weekly", desc: "Pick one NFL team you are confident will win their matchup in the upcoming week." },
            { title: "2. Lock Your Selection", desc: "Submit your pick before that team's kickoff or the pool weekly deadline." },
            { title: "3. Avoid the Strike", desc: "If your chosen team wins, you survive to the next week. A loss or tie gives you a strike." },
            { title: "4. The One-and-Done Constraint", desc: "Once you select a team, you cannot pick them again for the rest of the season. Plan ahead!" },
            { title: "5. Last Person Standing", desc: "The pool continues week by week until only one active player remains." }
        ],
        strategyTitle: 'How to Outlast Your Pool',
        strategySections: [
            { title: 'The Future Value Trap', content: 'Do not burn heavy favorites (like Chiefs or 49ers) in Week 1 against weak opponents if you can save them for key home matchups later in the season.' },
            { title: 'Monitor Point Spreads', content: 'Always check the Vegas point spreads. Focus on teams favored by 7+ points to guarantee high statistical probability of advancing.' },
            { title: 'Contrarian Strategy', content: 'If 80% of your pool is picking one massive favorite, consider picking a different strong team. If the popular favorite gets upset, 80% of your competitors are knocked out instantly!' }
        ],
        faqs: [
            { q: "What happens in a tie?", a: "By default, a tie counts as a strike/elimination. However, pool managers can customize this to count as a survival or utilize tiebreaker rules." },
            { q: "Can I change my pick?", a: "Yes, you can edit your weekly selection up until the game's individual kickoff time." },
            { q: "What are mulligans and buy-backs?", a: "A commissioner can enable Mulligans, which allow players to survive their first strike, or Buy-Backs to re-enter the pool prior to Week 4." }
        ],
        fairness: 'All picks are hidden from other participants until kickoff of the selected game, preventing copycat picks and preserving strategic play.',
        ctaText: 'Create a Survivor Pool'
    },
    pickem: {
        title: "Weekly NFL Pick'em",
        description: 'Choose winners for all NFL games every week. Compete on weekly leaderboards or build a cumulative score to win the seasonal crown.',
        stepsTitle: "Pick'em Playbook",
        steps: [
            { title: "1. Fill Out Weekly Picks", desc: "Select the winning team for every scheduled NFL game in the active week." },
            { title: "2. Assign Confidence Ranks (Optional)", desc: "If enabled, rank your picks 1 to N. Correct picks award points equal to the assigned rank." },
            { title: "3. Submit Before Deadlines", desc: "Submit your sheet. Deadlines can be set per-game (rolling) or locked on Thursday." },
            { title: "4. Track Standings", desc: "Watch the leaderboard update live as games conclude. Compete for weekly and seasonal prizes." }
        ],
        strategyTitle: "Maximizing Your Pick'em Score",
        strategySections: [
            { title: 'Confidence Ranking Logic', content: 'In confidence pools, place your highest weights (e.g., 14, 15, 16) on absolute locks. Save your 1, 2, and 3-point weights for risky toss-up matchups.' },
            { title: 'Fading the Public', content: 'To climb a large leaderboard, find games where the public is heavily backing one team, but the Vegas odds indicate a close game. Picking the underdog gives you huge leverage.' },
            { title: 'Tracking Injuries and Weather', content: 'Check late-week injury reports and weather forecasts. High wind or heavy rain favors strong running teams and negates high-flying pass offenses.' }
        ],
        faqs: [
            { q: "What is the difference between Standard and Confidence?", a: "Standard pools award 1 point per correct pick. Confidence pools require you to rank games, awarding points equal to the rank assigned to the winning pick." },
            { q: "What happens if I miss a game?", a: "Any unpicked game that kicks off is automatically marked as incorrect. Always submit placeholder picks early and edit them later!" },
            { q: "How do tiebreakers work?", a: "The tiebreaker is usually the predicted total combined score of the Monday Night Football game. The closest prediction wins the week." }
        ],
        fairness: 'All participant picks are encrypted and hidden until kickoff of each respective game, ensuring no one can adjust picks based on other players\' selections.',
        ctaText: "Create a Pick'em Pool"
    },
    margin: {
        title: 'NFL Margin Pools',
        description: 'Select one team per week. Your weekly score is their actual margin of victory or defeat. Highest total point differential wins.',
        stepsTitle: 'Margin Pool Mechanics',
        steps: [
            { title: "1. Pick One Team Weekly", desc: "Choose exactly one NFL team that you think will win by a large margin." },
            { title: "2. One-and-Done Restriction", desc: "Just like Survivor, once you select a team, you cannot pick them again for the rest of the season." },
            { title: "3. Accumulate Points", desc: "If your team wins, you gain points equal to their margin of victory (e.g., win 31-17 = +14 points)." },
            { title: "4. Deduct Points for Losses", desc: "If your team loses, you receive negative points equal to the opponent\'s margin of victory (e.g., lose 10-24 = -14 points)." },
            { title: "5. Total Standings Wins", desc: "The participant with the highest cumulative point differential at the end of the season wins the league." }
        ],
        strategyTitle: 'Optimal Margin Pool Strategy',
        strategySections: [
            { title: 'Blowout Targeting', content: 'Look for mismatch weeks. If a top team is hosting a struggling squad with a rookie quarterback, their implied victory margin is massive—this is the time to strike.' },
            { title: 'Conserve Top Teams', content: 'Do not waste a high-tier offensive team on a close divisional rivalry. Save them for matchups where they are heavily favored to win big.' },
            { title: 'Recovering from Negative Weeks', content: 'A single bad loss can set you back significantly. If you are behind, target high-variance, high-reward offenses to catch up in the standings.' }
        ],
        faqs: [
            { q: "What is the maximum points I can earn in a week?", a: "There is no cap! Your score is the literal difference in the final game score. If a team wins by 40 points, you get +40 points." },
            { q: "What happens if a game ends in a tie?", a: "A tie score results in 0 points awarded for that week." },
            { q: "Can I skip a week?", a: "If you fail to make a selection, you will be penalized with the worst margin of the week (typically -20 or more depending on rules)." }
        ],
        fairness: 'Picks lock automatically at kickoff of the selected game, and points are computed instantly using official NFL statistics from our Firestore scoring engine.',
        ctaText: 'Create a Margin Pool'
    },
    playoffs: {
        title: 'NFL Playoff Challenge',
        description: 'Rank the 14 NFL playoff teams prior to Wild Card weekend. Earn points as your ranked teams win, amplified by progressive round multipliers.',
        stepsTitle: 'Playoff Ranking Strategy',
        steps: [
            { title: "1. Rank all 14 Playoff Teams", desc: "Before Wild Card kickoff, rank the 14 playoff teams from 1 (lowest confidence) to 14 (highest confidence)." },
            { title: "2. Lock Rankings", desc: "All rankings lock permanently before the first game of Wild Card weekend." },
            { title: "3. Earn Round Points", desc: "When one of your ranked teams wins a game, you receive points equal to their assigned rank." },
            { title: "4. Apply Round Multipliers", desc: "Points are multiplied by the playoff round (Wild Card = 1x, Divisional = 2x, Conference = 4x, Super Bowl = 8x)." },
            { title: "5. Accumulate and Win", desc: "The player with the highest total points after the Super Bowl is crowned champion." }
        ],
        strategyTitle: 'Winning the Playoff Challenge',
        strategySections: [
            { title: 'The Super Bowl Anchor', content: 'Your 13 and 14-point ranks MUST be reserved for the two teams you predict will reach the Super Bowl. If your 14-point team loses in the Wild Card, you lose a massive chunk of your potential points.' },
            { title: 'Target Conference Multipliers', content: 'Because the multipliers escalate rapidly (4x and 8x), focus your strategy on the deep rounds. A correct pick in the Conference round is worth far more than multiple first-round picks.' },
            { title: 'Underdog Seed Bonuses', content: 'If enabled, picking a lower seed to win grants bonus points. Use this to boost your scores if you predict a Wild Card upset.' }
        ],
        faqs: [
            { q: "Do I make new picks each week?", a: "No. You submit one set of rankings for all 14 teams at the beginning, which covers the entire playoffs. The strategy is predicting the entire brackets in advance!" },
            { q: "What happens when a team is eliminated?", a: "That team can no longer earn points. Their rank remains locked, and you collect no further points from them." },
            { q: "How do bye-week teams affect my strategy?", a: "The #1 seeds do not play in the Wild Card round, meaning they cannot earn you Wild Card points. However, they are highly likely to reach deep rounds where multipliers are higher." }
        ],
        fairness: 'Rankings are locked securely at kickoff of the first Wild Card matchup, preventing any updates once game outcomes are known.',
        ctaText: 'Create a Playoff Challenge'
    },
    props: {
        title: 'Side Hustle (Props Only)',
        description: 'Host custom sports question sheets for any sporting event (Super Bowl, golf majors, Oscars). Players make predictions, and automated scoring ranks the winner.',
        stepsTitle: 'Side Hustle Playbook',
        steps: [
            { title: "1. Create Your Question Sheet", desc: "The commissioner designs a sheet of custom questions (e.g., game winner, player touchdowns, etc.)." },
            { title: "2. Set Custom Point Weights", desc: "Assign point values to each question based on difficulty (e.g., easy = 1pt, hard = 5pt)." },
            { title: "3. Players Submit Answers", desc: "Participants answer all questions before the event kicks off." },
            { title: "4. Watch the Live Updates", desc: "As the event plays out, correct answers are checked off, updating the leaderboard in real time." },
            { title: "5. Win the Side Hustle", desc: "The participant with the highest point accumulation at the end of the sheet wins." }
        ],
        strategyTitle: 'Winning Props Pools',
        strategySections: [
            { title: 'Study player matchups', content: 'Study player-on-player statistics and weather details before answering player prop questions. Look for imbalances in defensive schemes.' },
            { title: 'Differentiate on high-weight props', content: 'In massive prop sheets, look for high-point questions where the public is split. Going against the grain on a 5-point question can skyrocket you past the field.' },
            { title: 'Double-check entry requirements', content: 'Review deadlines and scoring weights. Make sure you do not leave any questions unanswered, as blank questions always receive 0 points.' }
        ],
        faqs: [
            { q: "Can this be used for non-sporting events?", a: "Absolutely! The Side Hustle Props pool is fully customizable. You can use it for the Academy Awards, TV series finales, political elections, or office trivia." },
            { q: "How are correct answers recorded?", a: "The pool commissioner marks the correct answers in their Admin Dashboard, which instantly updates and tallies standings for all participants." },
            { q: "Is there a limit to how many questions I can add?", a: "No. You can create small 5-question sheets or extensive 50-question Super Bowl prop booklets." }
        ],
        fairness: 'Participant predictions lock instantly at the designated event start time, ensuring no answers can be altered as outcomes occur.',
        ctaText: 'Create a Props Pool'
    }
};

/* ────────────────────────────────────────── COMPONENT ────────────────────────────────────────── */

/* Marketing/help page is navy chrome end-to-end — always dark in both themes. */

export const HowItWorksPage: React.FC<Props> = (props) => {
    const [searchParams, setSearchParams] = useSearchParams();

    // Read Query Params
    const activeSport = (searchParams.get('sport') as Sport) || 'brackets';
    const activeView = (searchParams.get('view') as ViewMode) || 'overview';

    // Support Form State
    const [supportData, setSupportData] = useState({
        name: '',
        email: '',
        supportType: '',
        message: '',
        sendCopy: false
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeSport, activeView]);

    const handleSportChange = (sport: Sport) => {
        setSearchParams({ sport, view: activeView });
    };

    const handleViewChange = (view: ViewMode) => {
        setSearchParams({ sport: activeSport, view });
    };

    const activeData = poolData[activeSport] || poolData.brackets;

    // Handle Support Form Submit
    const handleSupportSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus('idle');

        try {
            const emailBody = `
Support Request via Unified Help Center
Name: ${supportData.name}
Email: ${supportData.email}
Topic: ${supportData.supportType}

Message:
${supportData.message}

---
Sent via March Melee Pools Central FAQ Support Form
            `;

            await emailService.sendEmail(
                'support@marchmeleepools.com',
                `Help Center Support: ${supportData.supportType}`,
                emailBody,
                undefined,
                { replyTo: supportData.email }
            );

            if (supportData.sendCopy) {
                await emailService.sendEmail(
                    supportData.email,
                    `Copy: Your March Melee Pools Support Ticket`,
                    `Thank you for contacting March Melee Pools support. Here is a copy of your request:\n\n${emailBody}\n\nWe will get back to you within 48 hours.`
                );
            }

            setSubmitStatus('success');
            setSupportData({ name: '', email: '', supportType: '', message: '', sendCopy: false });
        } catch (error) {
            logger.error('Help Center Support form error:', error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const chromeCard = 'bg-navy-900 border border-[rgba(230,206,150,0.16)]';
    const textareaClass =
        'w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none resize-none';

    return (
        <div className="bg-navy-950 min-h-screen text-[#EDF1F8] font-body flex flex-col">
            <Header {...props} />

            {/* Title / Hero */}
            <div className="relative overflow-hidden bg-navy-900 border-b border-[rgba(230,206,150,0.16)]">
                <div className={`absolute top-0 left-0 w-full h-full bg-gradient-to-b from-navy-600/10 to-transparent pointer-events-none`} />
                <div className="max-w-7xl mx-auto px-6 py-12 md:py-16 relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-display font-bold uppercase text-xs tracking-[0.16em] bg-gold-500/10 border border-gold-500/25 text-gold-400 mb-4">
                        <BookOpen size={12} /> Help Center & Knowledge Base
                    </div>
                    <h1 className="font-display font-extrabold uppercase text-3xl md:text-5xl text-white leading-[0.95]">
                        Pool Guides &{' '}
                        <span className="text-gold-400">
                            Knowledge Hub
                        </span>
                    </h1>
                    <p className="text-base md:text-lg font-body text-[#9FB0CC] max-w-2xl mt-4">
                        Everything you need to know about setting up, running, and winning your office or social pools. Check out rules, strategies, FAQs, or contact our support team.
                    </p>
                </div>
            </div>

            {/* Main Area */}
            <main className="max-w-7xl mx-auto px-4 md:px-6 py-12 flex-grow w-full">
                <div className="flex flex-col lg:flex-row gap-8">

                    {/* Sidebar Navigation (Pool Types) */}
                    <div className="w-full lg:w-64 shrink-0">
                        <div className={`${chromeCard} p-4 rounded-2xl sticky top-28 space-y-2`}>
                            <h3 className="font-display font-bold uppercase text-xs tracking-[0.08em] text-[#7C8BA6] px-3 mb-4">Select Pool Type</h3>
                            {POOL_TYPES.map((type) => {
                                const IconComp = type.icon;
                                const isSelected = activeSport === type.id;
                                return (
                                    <button
                                        key={type.id}
                                        onClick={() => handleSportChange(type.id)}
                                        className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left font-display font-bold uppercase tracking-[0.05em] text-sm transition-all group ${
                                            isSelected
                                                ? 'bg-navy-800 text-white border-l-4 border-gold-500 shadow-md'
                                                : 'text-[#9FB0CC] hover:text-white hover:bg-navy-900/60'
                                        }`}
                                    >
                                        <IconComp size={16} className={`${isSelected ? 'text-gold-400' : 'text-[#7C8BA6] group-hover:text-[#9FB0CC]'}`} />
                                        {type.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Content Pane */}
                    <div className="flex-grow">
                        {/* Sub Navigation (View Modes) */}
                        <div className={`flex ${chromeCard} p-1.5 rounded-2xl gap-1 mb-8`}>
                            {[
                                { id: 'overview' as ViewMode, label: 'How it Works', icon: BookOpen },
                                { id: 'strategy' as ViewMode, label: 'Strategy Guide', icon: Lightbulb },
                                { id: 'faq' as ViewMode, label: 'FAQs & Rules', icon: MessageCircle },
                                { id: 'contact' as ViewMode, label: 'Contact Support', icon: Mail }
                            ].map((tab) => {
                                const isViewSelected = activeView === tab.id;
                                const TabIcon = tab.icon;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => handleViewChange(tab.id)}
                                        className={`flex-grow md:flex-grow-0 inline-flex items-center justify-center gap-1.5 px-4 md:px-6 py-3 rounded-xl font-display font-bold uppercase tracking-[0.05em] text-xs md:text-sm text-center transition-all ${
                                            isViewSelected
                                                ? 'bg-gold-foil text-navy-900 shadow-[0_6px_16px_rgba(140,109,51,0.28)]'
                                                : 'text-[#9FB0CC] hover:text-white hover:bg-navy-800'
                                        }`}
                                    >
                                        <TabIcon size={14} /> {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* VIEW 1: OVERVIEW */}
                        {activeView === 'overview' && (
                            <div className="space-y-12">
                                <div className="border-b border-[rgba(230,206,150,0.16)] pb-6">
                                    <h2 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-[0.95] text-white mb-3">{activeData.title} Overview</h2>
                                    <p className="font-body text-[#9FB0CC] text-base leading-relaxed">{activeData.description}</p>
                                </div>

                                <div className="space-y-6">
                                    <h3 className="font-display font-bold uppercase text-lg tracking-[0.08em] text-white">{activeData.stepsTitle}</h3>
                                    <div className="space-y-4">
                                        {activeData.steps.map((step, idx) => (
                                            <div key={idx} className={`flex gap-4 items-start p-5 rounded-2xl ${chromeCard} hover:border-gold-500/40 transition-all`}>
                                                <div className="bg-gold-500/15 text-gold-400 font-display font-extrabold text-lg w-10 h-10 rounded-full flex items-center justify-center shrink-0 border border-gold-500/25 num">
                                                    {idx + 1}
                                                </div>
                                                <div>
                                                    <h4 className="font-display font-bold uppercase text-lg text-white mb-1">{step.title}</h4>
                                                    <p className="font-body text-[#9FB0CC] text-sm leading-relaxed">{step.desc}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-gold-500/10 border border-gold-500/25 rounded-2xl p-6 flex gap-4">
                                    <Shield className="text-gold-400 shrink-0 mt-0.5" size={28} />
                                    <div>
                                        <h4 className="font-display font-bold uppercase text-white mb-2">Fairness Guarantee</h4>
                                        <p className="text-sm font-body text-[#9FB0CC] leading-relaxed">{activeData.fairness}</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* VIEW 2: STRATEGY GUIDE */}
                        {activeView === 'strategy' && (
                            <div className="space-y-8">
                                <div className="border-b border-[rgba(230,206,150,0.16)] pb-6">
                                    <h2 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-[0.95] text-white mb-3">{activeData.strategyTitle}</h2>
                                    <p className="font-body text-[#9FB0CC] text-sm italic">Master optimal game theory and secure seasonal or tournament leverage.</p>
                                </div>

                                <div className="space-y-8">
                                    {activeData.strategySections.map((section, idx) => (
                                        <div key={idx} className={`p-6 md:p-8 ${chromeCard} rounded-3xl space-y-3`}>
                                            <div className="flex items-center gap-2">
                                                <div className="h-2 w-2 rounded-full bg-gold-500" />
                                                <h4 className="font-display font-bold uppercase text-xl text-white">{section.title}</h4>
                                            </div>
                                            <p className="font-body text-[#EDF1F8] text-base leading-relaxed pl-4 border-l border-[rgba(230,206,150,0.16)]">{section.content}</p>
                                        </div>
                                    ))}
                                </div>

                                {/* Custom Content for Brackets Guide from the original Article */}
                                {activeSport === 'brackets' && (
                                    <div className={`mt-12 ${chromeCard} p-8 rounded-3xl space-y-6`}>
                                        <h3 className="font-display font-bold uppercase text-xl text-white">Running a Charity Tournament Bracket</h3>
                                        <p className="font-body text-[#9FB0CC] text-sm leading-relaxed">
                                            Charity pools are incredibly popular in 2026. Setting up a Charity Bracket is simple: designate a fixed percentage (e.g., 50% or 100%) of entries to be directly donated to a 501(c)(3) charity. The platform tracks collection transparently, so everyone in your Slack or email chain can see the cumulative impact.
                                        </p>
                                        <p className="font-body text-[#9FB0CC] text-sm leading-relaxed">
                                            Ensure that you communicate the charity details, deadline locks, and receipt verifications early on to foster trust and excitement.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* VIEW 3: FAQ */}
                        {activeView === 'faq' && (
                            <div className="space-y-8">
                                <div className="border-b border-[rgba(230,206,150,0.16)] pb-6">
                                    <h2 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-[0.95] text-white mb-3">Frequently Asked Questions</h2>
                                    <p className="font-body text-[#9FB0CC] text-sm">Have rules questions? Review the comprehensive answers below.</p>
                                </div>

                                <div className="grid gap-4">
                                    {activeData.faqs.map((faq, i) => (
                                        <details key={i} className={`group ${chromeCard} rounded-xl overflow-hidden transition-all`}>
                                            <summary className="flex justify-between items-center p-6 cursor-pointer font-display font-bold uppercase text-white hover:bg-navy-800/60 transition-colors list-none">
                                                {faq.q}
                                                <span className="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
                                            </summary>
                                            <div className="px-6 pb-6 font-body text-[#9FB0CC] text-sm leading-relaxed border-t border-[rgba(230,206,150,0.16)] pt-4">
                                                {faq.a}
                                            </div>
                                        </details>
                                    ))}
                                </div>

                                <div className={`p-6 ${chromeCard} rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4 mt-12`}>
                                    <div>
                                        <h4 className="font-display font-bold uppercase text-white mb-1">Didn't find your answer?</h4>
                                        <p className="text-xs font-body text-[#9FB0CC]">Our technical customer service team is standing by to resolve any issue.</p>
                                    </div>
                                    <button
                                        onClick={() => handleViewChange('contact')}
                                        className="font-display font-bold uppercase tracking-[0.05em] text-xs text-white bg-brandred-600 hover:bg-brandred-500 px-4 py-2.5 rounded-md transition-all duration-150 hover:-translate-y-px shadow-red-cta"
                                    >
                                        Open Support Ticket
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* VIEW 4: CONTACT SUPPORT */}
                        {activeView === 'contact' && (
                            <div className="space-y-8">
                                <div className="border-b border-[rgba(230,206,150,0.16)] pb-6">
                                    <h2 className="font-display font-extrabold uppercase text-2xl md:text-3xl leading-[0.95] text-white mb-3">Contact Technical Support</h2>
                                    <p className="font-body text-[#9FB0CC] text-sm">Send us a ticket, and our support representatives will respond within 48 hours.</p>
                                </div>

                                {/* Form Alerts */}
                                {submitStatus === 'success' && (
                                    <div className="bg-[#0F7B4A]/15 border border-[#0F7B4A]/40 rounded-2xl p-6 flex gap-3">
                                        <CheckCircle className="text-emerald-400 shrink-0" size={24} />
                                        <div>
                                            <h4 className="font-display font-bold uppercase text-white mb-1">Message Sent Successfully!</h4>
                                            <p className="font-body text-[#9FB0CC] text-sm">Thank you. We have received your query and will reply within 48 hours.</p>
                                        </div>
                                    </div>
                                )}

                                {submitStatus === 'error' && (
                                    <div className="bg-brandred-600/15 border border-brandred-600/35 rounded-2xl p-6 flex gap-3">
                                        <AlertCircle className="text-brandred-500 shrink-0" size={24} />
                                        <div>
                                            <h4 className="font-display font-bold uppercase text-white mb-1">Failed to Send Message</h4>
                                            <p className="font-body text-[#9FB0CC] text-sm">Something went wrong. Please check your network connection or try again.</p>
                                        </div>
                                    </div>
                                )}

                                <form onSubmit={handleSupportSubmit} className={`${chromeCard} rounded-3xl p-6 md:p-8 space-y-6`}>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <FieldLabel className="text-[#EDF1F8]">Your Name</FieldLabel>
                                            <Input
                                                type="text"
                                                required
                                                value={supportData.name}
                                                onChange={(e) => setSupportData({ ...supportData, name: e.target.value })}
                                                placeholder="John Doe"
                                            />
                                        </div>
                                        <div>
                                            <FieldLabel className="text-[#EDF1F8]">Your Email</FieldLabel>
                                            <Input
                                                type="email"
                                                required
                                                value={supportData.email}
                                                onChange={(e) => setSupportData({ ...supportData, email: e.target.value })}
                                                placeholder="john@example.com"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <FieldLabel className="text-[#EDF1F8]">Inquiry Category</FieldLabel>
                                        <Select
                                            required
                                            value={supportData.supportType}
                                            onChange={(e) => setSupportData({ ...supportData, supportType: e.target.value })}
                                        >
                                            <option value="">Select category...</option>
                                            <option value="Technical Issue">Technical Issue</option>
                                            <option value="Question About a Pool">Question About a Pool</option>
                                            <option value="Payment/Billing">Payment / Billing</option>
                                            <option value="Feature Request">Feature Request</option>
                                            <option value="Other">Other</option>
                                        </Select>
                                    </div>

                                    <div>
                                        <FieldLabel className="text-[#EDF1F8]">Your Message</FieldLabel>
                                        <textarea
                                            required
                                            rows={6}
                                            value={supportData.message}
                                            onChange={(e) => setSupportData({ ...supportData, message: e.target.value })}
                                            className={textareaClass}
                                            placeholder="Detail your question or issue..."
                                        />
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <Checkbox
                                            id="sendCopy"
                                            checked={supportData.sendCopy}
                                            onChange={(e) => setSupportData({ ...supportData, sendCopy: e.target.checked })}
                                            className="mt-1"
                                        />
                                        <label htmlFor="sendCopy" className="text-xs font-body text-[#9FB0CC] cursor-pointer">
                                            Send me a confirmation copy of this ticket for my records
                                        </label>
                                    </div>

                                    <Button
                                        type="submit"
                                        variant="primary"
                                        size="md"
                                        disabled={isSubmitting}
                                        className="w-full"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                Sending Request...
                                            </>
                                        ) : (
                                            <>
                                                <Mail size={18} />
                                                Send Ticket
                                            </>
                                        )}
                                    </Button>
                                </form>
                            </div>
                        )}

                        {/* CTA Box (Active for overview/strategy/faq views) */}
                        {activeView !== 'contact' && (
                            <div className={`mt-16 ${chromeCard} rounded-3xl p-8 text-center relative overflow-hidden group`}>
                                <div className="absolute inset-0 bg-gold-500/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
                                <div className="relative z-10">
                                    <h3 className="font-display font-extrabold uppercase text-2xl leading-[0.95] text-white mb-2">Ready to kick off your pool?</h3>
                                    <p className="text-sm font-body text-[#9FB0CC] mb-8 max-w-lg mx-auto">
                                        Create a free {activeData.title} now. Live score boards, automatic payouts, and automated standings. Zero spreadsheet headaches.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                        <button
                                            onClick={isSuperAdmin(props.user) ? props.onCreatePool : undefined}
                                            disabled={!isSuperAdmin(props.user)}
                                            className="inline-flex items-center justify-center gap-2 bg-brandred-600 text-white hover:bg-brandred-500 px-8 py-3.5 rounded-md font-display font-bold uppercase tracking-[0.05em] text-sm transition-all duration-150 hover:-translate-y-px shadow-red-cta disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                                            title={isSuperAdmin(props.user) ? `Create a ${activeData.title}` : "Commissioners can host soon"}
                                        >
                                            {activeData.ctaText}
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                                        </button>
                                        <button
                                            onClick={() => window.location.href = '/browse'}
                                            className="px-8 py-3.5 bg-navy-800 hover:bg-navy-700 text-white font-display font-bold uppercase tracking-[0.05em] text-sm rounded-md transition-all"
                                        >
                                            Join a Public Pool
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
