import React, { useState } from 'react';
import type { User } from '../types';
import { Header } from './Header';
import { Footer } from './Footer';
import { db } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { CheckCircle, Shield, Sparkles, Star, Zap, ArrowRight, LayoutGrid, Users, AlertCircle } from 'lucide-react';
import { logger } from '../utils/logger';

interface PricingPageProps {
    user?: User | null;
    isManager?: boolean;
    onLogin: () => void;
    onSignup: () => void;
    onLogout?: () => void;
    onCreatePool?: () => void;
    isLoggedIn: boolean;
}

export const PricingPage: React.FC<PricingPageProps> = ({ user, isManager = false, onLogin, onLogout, onCreatePool }) => {
    // Waitlist Form State
    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        poolSize: '',
        interest: '',
        customNote: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus('idle');

        try {
            // Write to Firestore waitlist collection
            await addDoc(collection(db, 'waitlist_leads'), {
                name: formData.name,
                email: formData.email,
                poolSize: formData.poolSize,
                interest: formData.interest,
                customNote: formData.customNote,
                userId: user?.id || 'anonymous',
                registeredAt: serverTimestamp()
            });

            setSubmitStatus('success');
            setFormData({
                name: user?.name || '',
                email: user?.email || '',
                poolSize: '',
                interest: '',
                customNote: ''
            });
        } catch (error) {
            logger.error('Waitlist submission error:', error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen text-slate-100 font-sans selection:bg-orange-500 selection:text-white bg-slate-950 flex flex-col">
            <Header
                user={user || null}
                isManager={isManager}
                onOpenAuth={onLogin}
                onLogout={onLogout || (() => { })}
                onCreatePool={onCreatePool}
            />

            {/* Hero Header */}
            <section className="relative overflow-hidden pt-16 pb-12 border-b border-slate-900">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none">
                    <div className="absolute top-10 right-0 w-[400px] h-[400px] rounded-full blur-[120px] bg-indigo-500/10"></div>
                    <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-[120px] bg-orange-500/5"></div>
                </div>

                <div className="max-w-4xl mx-auto px-6 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-6 shadow-sm bg-orange-500/15 border border-orange-500/20">
                        <Sparkles size={14} className="text-orange-400 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-orange-400">Commissioner Hub</span>
                    </div>

                    <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight mb-6 leading-tight">
                        Host Your Own Pools <br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-indigo-400">Coming Soon!</span>
                    </h1>
                    
                    <p className="text-base md:text-lg max-w-2xl mx-auto mb-6 text-slate-400 leading-relaxed">
                        We are building the ultimate automated platform for pool commissioners. Set up private bracket pools, survivor grids, squares, and weekly confidence challenges in seconds.
                    </p>
                </div>
            </section>

            {/* Content & Bento Grid */}
            <section className="py-16 max-w-7xl mx-auto px-6 w-full flex-grow">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    
                    {/* Left Side: Bento Feature Showcases */}
                    <div className="lg:col-span-7 space-y-6">
                        <h2 className="text-2xl font-black text-white mb-2 flex items-center gap-2">
                            <Star className="text-amber-400" size={24} /> Premium Commissioner Features Included
                        </h2>
                        <p className="text-slate-400 text-sm mb-6">Our upcoming self-hosting subscription will equip you with standard-setting league operator tools:</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            
                            {/* Feature 1 */}
                            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-3">
                                <div className="p-3 bg-orange-500/10 border border-orange-500/20 text-orange-400 rounded-xl w-fit">
                                    <LayoutGrid size={20} />
                                </div>
                                <h3 className="font-bold text-white">Custom Branding</h3>
                                <p className="text-xs text-slate-400 leading-relaxed">Customize your pool landing pages with your league's logo, cover image, and dedicated commission welcome boards.</p>
                            </div>

                            {/* Feature 2 */}
                            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-3">
                                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl w-fit">
                                    <CheckCircle size={20} />
                                </div>
                                <h3 className="font-bold text-white">Payment Tracking</h3>
                                <p className="text-xs text-slate-400 leading-relaxed">Mark users as paid with one checkmark. Automatically lock out unpaid brackets or squares before kickoff dates.</p>
                            </div>

                            {/* Feature 3 */}
                            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-3">
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl w-fit">
                                    <Zap size={20} />
                                </div>
                                <h3 className="font-bold text-white">Automated SMS Reminders</h3>
                                <p className="text-xs text-slate-400 leading-relaxed">Integrate Twilio and Courier alerts. Automatically text players who haven't completed picks as deadlines lock.</p>
                            </div>

                            {/* Feature 4 */}
                            <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-900 hover:border-slate-800 transition-colors space-y-3">
                                <div className="p-3 bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-400 rounded-xl w-fit">
                                    <Users size={20} />
                                </div>
                                <h3 className="font-bold text-white">AI Commissioner Recaps</h3>
                                <p className="text-xs text-slate-400 leading-relaxed">Let our AI analyze weekly margins, upsets, and scores to auto-generate trash-talk posts and league newsletters.</p>
                            </div>
                        </div>

                        {/* Social proof or charity callout */}
                        <div className="p-6 rounded-2xl bg-gradient-to-r from-orange-950/20 to-indigo-950/20 border border-indigo-500/10 flex items-start gap-4">
                            <Shield className="text-indigo-400 shrink-0 mt-0.5" size={24} />
                            <div>
                                <h4 className="font-bold text-white text-sm">Charity-Friendly Platforms</h4>
                                <p className="text-xs text-slate-400 leading-relaxed mt-1">
                                    Running a charity pool? We waive creation fees entirely for designated charity campaigns. Collect donations and track total contributions with custom dashboards.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right Side: Waitlist Sign-up Portal */}
                    <div className="lg:col-span-5 bg-slate-900 border border-slate-850 p-6 md:p-8 rounded-3xl space-y-6">
                        <div className="space-y-2">
                            <h2 className="text-xl font-black text-white flex items-center gap-2">
                                <Users className="text-orange-400" size={22} /> VIP Host Waitlist
                            </h2>
                            <p className="text-xs text-slate-400">Join the list of pool operators getting priority early access and exclusive discounted pricing when our Host Plan launches.</p>
                        </div>

                        {/* Success State */}
                        {submitStatus === 'success' ? (
                            <div className="bg-emerald-950/20 border border-emerald-500/30 p-6 rounded-2xl text-center space-y-4 animate-in fade-in duration-500">
                                <div className="w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-500/20 flex items-center justify-center mx-auto text-emerald-400">
                                    <CheckCircle size={32} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-emerald-100 text-lg">You're on the list!</h3>
                                    <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                                        Thank you for signing up for the VIP Commissioner early-access waitlist. We will notify you at your registered email address as soon as private hosting launches.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {submitStatus === 'error' && (
                                    <div className="p-4 bg-red-950/20 border border-red-500/30 rounded-xl flex gap-2 text-xs text-red-400">
                                        <AlertCircle size={16} />
                                        <span>Error registering. Please check details and try again.</span>
                                    </div>
                                )}

                                {/* Name */}
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Your Name</label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                        placeholder="Kevin H."
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Email Address</label>
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                        placeholder="kevin@example.com"
                                    />
                                </div>

                                {/* Expected Pool Size */}
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Expected League/Pool Size</label>
                                    <select
                                        required
                                        value={formData.poolSize}
                                        onChange={(e) => setFormData({ ...formData, poolSize: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                    >
                                        <option value="">Choose size...</option>
                                        <option value="Small (<20 players)">Small (&lt;20 players)</option>
                                        <option value="Medium (20-100 players)">Medium (20-100 players)</option>
                                        <option value="Large (100-500 players)">Large (100-500 players)</option>
                                        <option value="Enterprise (500+ players)">Enterprise (500+ players)</option>
                                    </select>
                                </div>

                                {/* Interest Option */}
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Primary Pool Type of Interest</label>
                                    <select
                                        required
                                        value={formData.interest}
                                        onChange={(e) => setFormData({ ...formData, interest: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 text-sm outline-none focus:ring-2 focus:ring-orange-500/50"
                                    >
                                        <option value="">Select pool type...</option>
                                        <option value="Bracket Pools">Bracket Pools</option>
                                        <option value="Super Bowl / MNF Squares">Super Bowl / MNF Squares</option>
                                        <option value="NFL Survivor Pools">NFL Survivor Pools</option>
                                        <option value="Weekly Pick'em Pools">Weekly Pick'em Pools</option>
                                        <option value="NFL Margin Pools">NFL Margin Pools</option>
                                        <option value="Custom Props Sheets">Custom Props Sheets</option>
                                        <option value="Multiple Formats">Multiple Formats</option>
                                    </select>
                                </div>

                                {/* Custom Note */}
                                <div>
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">League Name / Notes (Optional)</label>
                                    <textarea
                                        rows={2}
                                        value={formData.customNote}
                                        onChange={(e) => setFormData({ ...formData, customNote: e.target.value })}
                                        className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
                                        placeholder="Office Football League..."
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full bg-gradient-to-r from-orange-500 to-indigo-600 hover:from-orange-600 hover:to-indigo-750 text-white font-bold py-3.5 rounded-xl text-sm transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                            Submitting...
                                        </>
                                    ) : (
                                        <>
                                            Join VIP Waitlist
                                            <ArrowRight size={14} />
                                        </>
                                    )}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            </section>

            <Footer />
        </div>
    );
};
