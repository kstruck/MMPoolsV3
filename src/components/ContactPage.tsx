import React, { useState } from 'react';
import { Mail, MessageSquare, CheckCircle, AlertCircle, Phone, MapPin, Clock } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { emailService } from '../services/emailService';
import { logger } from '../utils/logger';
import type { User } from '../types';

interface ContactPageProps {
    user: User | null;
    onLogin: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

type Subject = 'General Inquiry' | 'Pool Management' | 'Technical Issue' | 'Partnership / Press' | 'Feature Request' | 'Payment / Billing' | 'Other';

const SUBJECTS: Subject[] = [
    'General Inquiry',
    'Pool Management',
    'Technical Issue',
    'Partnership / Press',
    'Feature Request',
    'Payment / Billing',
    'Other',
];

export const ContactPage: React.FC<ContactPageProps> = ({
    user, onLogin, onLogout, onCreatePool
}) => {
    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        subject: '' as Subject | '',
        message: '',
        sendCopy: false,
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setStatus('idle');
        try {
            const body = `Contact Form Submission\n\nName: ${formData.name}\nEmail: ${formData.email}\nSubject: ${formData.subject}\n\nMessage:\n${formData.message}\n\n---\nSent via March Melee Pools Contact Page`;
            await emailService.sendEmail(
                'support@marchmeleepools.com',
                `Contact: ${formData.subject}`,
                body,
                undefined,
                { replyTo: formData.email }
            );
            if (formData.sendCopy) {
                await emailService.sendEmail(
                    formData.email,
                    `Copy of your message: ${formData.subject}`,
                    `Hi ${formData.name},\n\nThanks for reaching out to March Melee Pools! Here's a copy of your message:\n\n${body}\n\nWe typically respond within 48 business hours.\n\n— The March Melee Team`
                );
            }
            setStatus('success');
            setFormData({ name: '', email: '', subject: '', message: '', sendCopy: false });
        } catch (err) {
            logger.error('ContactPage submit error:', err);
            setStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClass = 'w-full px-4 py-3 bg-slate-950 border border-slate-700/60 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm';

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
            <Header user={user} isManager={false} onOpenAuth={onLogin} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="flex-1">
                {/* Hero */}
                <div className="relative overflow-hidden bg-gradient-to-b from-indigo-950/60 to-slate-950 border-b border-slate-800">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.15),transparent)]" />
                    <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
                        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-4 py-1.5 mb-6">
                            <MessageSquare size={14} className="text-indigo-400" />
                            <span className="text-xs font-semibold text-indigo-300 uppercase tracking-widest">Get In Touch</span>
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black text-white mb-4 leading-tight">
                            We'd love to<br />
                            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">hear from you.</span>
                        </h1>
                        <p className="text-lg text-slate-400 max-w-xl mx-auto">
                            Questions, feedback, or partnership inquiries — we're real people who read every message.
                        </p>
                    </div>
                </div>

                <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-3 gap-12">
                    {/* Sidebar Info */}
                    <div className="lg:col-span-1 space-y-8">
                        <div>
                            <h2 className="text-lg font-bold text-white mb-4">Other ways to reach us</h2>
                            <div className="space-y-4">
                                <a href="mailto:support@marchmeleepools.com" className="flex items-start gap-3 group">
                                    <div className="w-9 h-9 bg-indigo-500/10 border border-indigo-500/20 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                                        <Mail size={16} className="text-indigo-400" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Email</p>
                                        <p className="text-sm text-slate-300 group-hover:text-white transition-colors">support@marchmeleepools.com</p>
                                    </div>
                                </a>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-violet-500/10 border border-violet-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <Clock size={16} className="text-violet-400" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Response Time</p>
                                        <p className="text-sm text-slate-300">Within 48 business hours</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <MapPin size={16} className="text-emerald-400" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">Based in</p>
                                        <p className="text-sm text-slate-300">United States 🇺🇸</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-center shrink-0">
                                        <Phone size={16} className="text-amber-400" />
                                    </div>
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">SMS / Text</p>
                                        <p className="text-sm text-slate-300">(980) 375-4395</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
                            <h3 className="text-sm font-bold text-white mb-2">🚀 Quick Help</h3>
                            <p className="text-xs text-slate-400 mb-3">Most common questions are answered in our support guide.</p>
                            <a href="/support" className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-2 transition-colors">
                                Visit Support Center →
                            </a>
                        </div>
                    </div>

                    {/* Contact Form */}
                    <div className="lg:col-span-2">
                        {status === 'success' && (
                            <div className="mb-6 bg-emerald-900/20 border border-emerald-500/30 rounded-xl p-5 flex items-start gap-3">
                                <CheckCircle className="text-emerald-400 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h3 className="font-bold text-emerald-100 mb-1">Message sent!</h3>
                                    <p className="text-sm text-emerald-300">We'll get back to you within 48 business hours. Check your inbox for a confirmation.</p>
                                </div>
                            </div>
                        )}
                        {status === 'error' && (
                            <div className="mb-6 bg-rose-900/20 border border-rose-500/30 rounded-xl p-5 flex items-start gap-3">
                                <AlertCircle className="text-rose-400 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h3 className="font-bold text-rose-100 mb-1">Something went wrong</h3>
                                    <p className="text-sm text-rose-300">Please try again or email us directly at support@marchmeleepools.com.</p>
                                </div>
                            </div>
                        )}

                        <form
                            onSubmit={handleSubmit}
                            className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 space-y-5"
                        >
                            <div className="grid sm:grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        Full Name <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className={inputClass}
                                        placeholder="Jane Smith"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        Email Address <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        className={inputClass}
                                        placeholder="jane@example.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Subject <span className="text-rose-500">*</span>
                                </label>
                                <select
                                    required
                                    value={formData.subject}
                                    onChange={(e) => setFormData({ ...formData, subject: e.target.value as Subject })}
                                    className={inputClass}
                                >
                                    <option value="">Select a subject...</option>
                                    {SUBJECTS.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                                    Message <span className="text-rose-500">*</span>
                                </label>
                                <textarea
                                    required
                                    rows={7}
                                    value={formData.message}
                                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                    className={`${inputClass} resize-none`}
                                    placeholder="Tell us what's on your mind..."
                                />
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    id="sendCopy"
                                    type="checkbox"
                                    checked={formData.sendCopy}
                                    onChange={(e) => setFormData({ ...formData, sendCopy: e.target.checked })}
                                    className="w-4 h-4 text-indigo-600 bg-slate-950 border-slate-700 rounded focus:ring-indigo-500"
                                />
                                <label htmlFor="sendCopy" className="text-sm text-slate-400 cursor-pointer">
                                    Send me a copy of this message
                                </label>
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white py-4 rounded-xl font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Mail size={18} />
                                        Send Message
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
