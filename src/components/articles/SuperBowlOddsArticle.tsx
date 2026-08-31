import React, { useEffect } from 'react';
import { Link } from 'react-router';
import { Trophy } from 'lucide-react';

export const SuperBowlOddsArticle: React.FC = () => {

    // Scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
        document.title = "Super Bowl Squares Odds: Best & Worst Numbers According to Data";

        // Update Meta Description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute('content', "Discover the mathematical odds behind Super Bowl squares. Learn which numbers historically win the most quarters and which digits you want to avoid based on NFL data.");
        } else {
            const meta = document.createElement('meta');
            meta.name = "description";
            meta.content = "Discover the mathematical odds behind Super Bowl squares. Learn which numbers historically win the most quarters and which digits you want to avoid based on NFL data.";
            document.head.appendChild(meta);
        }
    }, []);

    return (
        <div className="bg-navy-950 min-h-screen text-[#9FB0CC] font-body selection:bg-gold-500/30">
            {/* Hero Section */}
            <div className="relative overflow-hidden bg-navy-900 border-b border-[rgba(230,206,150,0.16)]">
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-navy-800/40 to-transparent pointer-events-none" />
                <div className="max-w-4xl mx-auto px-6 py-20 relative z-10">
                    <div className="inline-block px-3 py-1 bg-gold-500/10 border border-gold-500/25 rounded-full text-gold-400 text-xs font-display font-bold uppercase tracking-[0.08em] mb-6">
                        Data & Analytics
                    </div>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-extrabold uppercase text-[#EDF1F8] mb-6 leading-[0.95]">
                        Super Bowl Squares Odds: <span className="text-gold-400">The Data-Driven Guide</span> to Winning Your Pool
                    </h1>
                    <p className="text-xl text-[#9FB0CC] max-w-2xl leading-relaxed">
                        Stop relying on luck. We analyzed decades of NFL scores to uncover the "Big Six" numbers that dominate the grid.
                    </p>
                </div>
            </div>

            {/* Content Container */}
            <div className="max-w-3xl mx-auto px-6 py-12">
                <article className="prose prose-invert prose-lg md:prose-xl max-w-none prose-headings:font-display prose-headings:font-bold prose-headings:uppercase prose-headings:text-[#EDF1F8] prose-p:text-[#9FB0CC] prose-a:text-gold-400 hover:prose-a:text-gold-300 prose-strong:text-[#EDF1F8] prose-img:rounded-xl prose-img:border prose-img:border-[rgba(230,206,150,0.16)] prose-img:shadow-2xl">

                    <p className="lead text-lg md:text-xl text-[#9FB0CC] mb-8">
                        Super Bowl Sunday isn't just about the big game, the halftime show, or the commercials. For millions of fans, it’s about the 10x10 grid hanging on the wall at the party or hosted online: <strong>Super Bowl Squares</strong>.
                    </p>

                    <p>
                        While drawing numbers out of a hat is pure luck, the results of the football game are not random. Because of the unique way football scoring works—touchdowns (6 points + 1 extra point) and field goals (3 points)—certain final digits appear far more frequently than others.
                    </p>

                    <p>
                        By analyzing historical NFL data, we can determine the exact probabilities of winning combinations. Whether you are running a pool or just hoping your numbers hit, understanding these odds is the difference between blind hope and an informed strategy.
                    </p>

                    <p>
                        Here is the definitive breakdown of the best and worst numbers for Super Bowl Squares, based on historical data.
                    </p>

                    <div className="my-12 p-8 bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl">
                        <h2 className="text-2xl font-display font-bold uppercase text-[#EDF1F8] mb-4 mt-0">The Science of Football Scoring</h2>
                        <p>
                            If NFL scores were random, every number from 0 to 9 would have a 10% chance of being the final digit of a team's score. But football isn't random.
                        </p>
                        <ul className="space-y-2 mb-0">
                            <li className="flex items-start gap-3">
                                <span className="bg-[#0F7B4A]/15 text-[#3FBF7F] font-display font-bold num px-2 py-0.5 rounded text-sm mt-1">7</span>
                                <span>A touchdown with an extra point is 7.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="bg-[#0F7B4A]/15 text-[#3FBF7F] font-display font-bold num px-2 py-0.5 rounded text-sm mt-1">4</span>
                                <span>Two touchdowns are 14 (ending in 4).</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="bg-[#0F7B4A]/15 text-[#3FBF7F] font-display font-bold num px-2 py-0.5 rounded text-sm mt-1">1</span>
                                <span>Three touchdowns are 21 (ending in 1).</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="bg-navy-700/40 text-[#9FB0CC] font-display font-bold num px-2 py-0.5 rounded text-sm mt-1">3</span>
                                <span>A field goal is 3.</span>
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="bg-gold-500/10 text-gold-400 font-display font-bold num px-2 py-0.5 rounded text-sm mt-1">0</span>
                                <span>A touchdown and a field goal are 10 (ending in 0).</span>
                            </li>
                        </ul>
                    </div>

                    <h2>The "Big Six": The Premier Numbers to Own</h2>
                    <p>
                        If you draw any of the following six numbers, you have a statistical advantage over the rest of the pool. Historically, these digits represent the final score count in the vast majority of NFL games.
                    </p>
                    <p className="font-display font-bold uppercase text-xl text-[#EDF1F8] num">
                        The numbers, in descending order of historical frequency, are: 0, 7, 3, 4, 1, and 6.
                    </p>

                    <ul>
                        <li><strong>The Power of Zero and Seven:</strong> The numbers 0 and 7 are the undisputed kings of Super Bowl Squares. Because games often start 0-0, and touchdowns are worth 7 points, these two numbers dominate the first quarter and remain highly relevant throughout the game.</li>
                        <li><strong>The Field Goal Factor:</strong> The number 3 is the next most valuable asset, thanks to the commonality of field goals.</li>
                        <li><strong>The Next Tier:</strong> The numbers 4 (often resulting from two touchdowns, 14 points) and 1 (often resulting from three touchdowns, 21 points) are solid middle-tier holders.</li>
                    </ul>

                    <h3 className="text-xl font-display font-bold uppercase text-[#EDF1F8] mt-12 mb-6">Visualizing Single-Digit Frequency</h3>
                    <p>The chart below illustrates how frequently each individual digit (0-9) appears as a final digit in historical NFL scores. Note the dominance of the "Big Six."</p>

                    <figure>
                        <img
                            src="/images/squares-digit-frequency.webp"
                            loading="lazy"
                            width={1024}
                            height={558}
                            alt="Bar chart showing frequency of final score digits in NFL games. 0 and 7 are the highest bars."
                            className="w-full h-auto rounded-xl border border-[rgba(230,206,150,0.16)] shadow-lg"
                        />
                        <figcaption className="text-center text-sm text-[#9FB0CC]/70 mt-2 italic">Historical frequency of final digit scores (Data: NFL History)</figcaption>
                    </figure>

                    <h2>The Golden Combinations: Best Winning Pairs</h2>
                    <p>
                        While having a single good number is great, winning a square requires holding the right pair of numbers corresponding to the AFC and NFC teams at the end of a quarter.
                    </p>
                    <p>Based on decades of historical game results, certain combinations yield the highest probability of cashing out.</p>

                    <div className="grid md:grid-cols-2 gap-6 my-8 not-prose">
                        <div className="bg-gold-500/5 border border-gold-500/25 p-6 rounded-xl">
                            <h4 className="text-gold-400 font-display font-bold text-lg mb-2 uppercase tracking-[0.05em] flex items-center gap-2"><Trophy size={18} className="text-gold-400" /> The Champion Pair: <span className="num">0 - 0</span></h4>
                            <p className="text-[#9FB0CC] text-sm">
                                The 0-0 square is the single most valuable real estate on the entire grid. It is overwhelmingly likely to win the first quarter, as many Super Bowls start slow defensively. Even late in games, scores like 20-10 or 30-20 keep the 0-0 square alive.
                            </p>
                        </div>
                        <div className="bg-navy-900 p-6 rounded-xl border border-[rgba(230,206,150,0.16)]">
                            <h4 className="text-[#EDF1F8] font-display font-bold uppercase text-lg mb-2">Tier 1 Combinations</h4>
                            <p className="text-[#9FB0CC] text-xs mb-3">Combinations involving top three numbers (0, 7, 3)</p>
                            <div className="flex flex-wrap gap-2">
                                <span className="px-2 py-1 bg-navy-800 rounded text-[#EDF1F8] text-sm font-mono num border border-[rgba(230,206,150,0.16)]">7 - 0</span>
                                <span className="px-2 py-1 bg-navy-800 rounded text-[#EDF1F8] text-sm font-mono num border border-[rgba(230,206,150,0.16)]">3 - 0</span>
                                <span className="px-2 py-1 bg-navy-800 rounded text-[#EDF1F8] text-sm font-mono num border border-[rgba(230,206,150,0.16)]">7 - 3</span>
                            </div>
                        </div>
                    </div>

                    <h3>Visualizing Top Winning Pairs</h3>
                    <p>This heatmap highlights the most frequent final score combinations in NFL history. The "hotter" the color, the more likely that square is to win.</p>

                    <figure>
                        <img
                            src="/images/squares-heatmap.jpg"
                            loading="lazy"
                            width={1024}
                            height={1024}
                            alt="Heatmap showing probability of Super Bowl square combinations. 0-0, 7-0, 0-7, 3-0, 7-7 are highlighted in red/orange."
                            className="w-full h-auto rounded-xl border border-[rgba(230,206,150,0.16)] shadow-lg"
                        />
                        <figcaption className="text-center text-sm text-[#9FB0CC]/70 mt-2 italic">Probability Heatmap of Combinations</figcaption>
                    </figure>

                    <h2>The "Bad Beats": The Worst Numbers to Draw</h2>
                    <p>
                        Every pool has squares that seem doomed before kickoff. In football, these are the numbers that require unusual scoring events—like safeties (2 points), missed extra points, or a high volume of field goals—to hit.
                    </p>
                    <p>
                        If you draw these numbers, you are facing a steep uphill statistical battle: <strong>2, 5, 8, and 9</strong>.
                    </p>

                    <div className="bg-brandred-600/5 border-l-4 border-brandred-600 pl-6 py-2 my-6">
                        <p className="text-[#9FB0CC] italic mb-0">
                            The numbers 2 and 5 are notoriously difficult to hit. They often require a team to score a safety or miss an extra point after a touchdown, both of which are rare events in the modern NFL.
                        </p>
                    </div>

                    <p>
                        While 8 and 9 can sometimes appear in high-scoring affairs (e.g., 28 points, 49 points), they are statistically far less common than the primary numbers.
                    </p>

                    <h2>Quarter-by-Quarter Strategy Notes</h2>
                    <p>The value of your numbers shifts as the game progresses.</p>

                    <ul>
                        <li><strong>1st Quarter:</strong> This quarter is heavily biased toward low numbers. The 0-0 square is huge here. Combinations like 7-0 and 3-0 are also very common first-quarter winners.</li>
                        <li><strong>2nd Quarter (Halftime):</strong> Scoring often accelerates in the final two minutes before halftime. This brings numbers like 4 (14 points), 1 (21 points), and 7 (17 points) more into play.</li>
                        <li><strong>3rd Quarter:</strong> Often a lower-scoring quarter as teams adjust coming out of the locker room. The "Big Six" numbers usually hold steady here.</li>
                        <li><strong>4th Quarter (Final Score):</strong> The end of the game sees the most variance due to teams chasing points, two-point conversion attempts, or garbage-time touchdowns. While 0, 7, and 3 are still the best final numbers, the chaos of the 4th quarter gives a slight bump to rarer numbers like 8 or 5.</li>
                    </ul>

                    <hr className="border-[rgba(230,206,150,0.16)] my-12" />

                    <h2>Summary</h2>
                    <p>
                        While you can't control the numbers you draw in a standard randomized pool, understanding the odds makes the game more engaging. If you are lucky enough to land on the 0-0 intersection or hold a handful of 7s and 3s, history is on your side.
                    </p>
                    <p className="font-display font-bold uppercase text-[#EDF1F8] text-lg">Are you ready to test your luck against the data?</p>

                </article>

                {/* Call to Action Box */}
                <div className="mt-16 bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl p-8 text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gold-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                    <h3 className="text-2xl font-display font-extrabold uppercase text-[#EDF1F8] mb-4 relative z-10">Host Your Own Super Bowl Pool</h3>
                    <p className="text-[#9FB0CC] mb-8 max-w-lg mx-auto relative z-10">
                        Create a free Squares or Props pool for your friends, office, or party.
                        No paper sheets, no math—just fun.
                    </p>
                    <Link
                        to="/create-pool"
                        className="relative z-10 inline-flex items-center gap-2 bg-gold-foil text-navy-900 hover:brightness-105 px-8 py-4 rounded-xl font-display font-bold uppercase tracking-[0.05em] text-lg transition-all transform hover:scale-105 shadow-[0_6px_16px_rgba(140,109,51,0.28)]"
                    >
                        Create Your Pool Now
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                    </Link>
                </div>
            </div>
        </div>
    );
};
