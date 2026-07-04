import React, { useState } from 'react';
import { Mail, MessageSquare, CheckCircle, AlertCircle, Phone, MapPin, Clock, Rocket } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { emailService } from '../services/emailService';
import { logger } from '../utils/logger';
import type { User } from '../types';
import { Input, Select, FieldLabel, Checkbox, Button } from './ui';

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

/* Marketing page is navy chrome end-to-end — always dark in both themes. */

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

    const labelCls = 'text-[color:var(--text)]';
    const textareaClass =
        'w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none resize-none';

    return (
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body flex flex-col">
            <Header user={user} isManager={false} onOpenAuth={onLogin} onLogout={onLogout} onCreatePool={onCreatePool} />

            <main className="flex-1">
                {/* Hero band — navy chrome (always dark) */}
                <div className="relative overflow-hidden bg-gradient-to-b from-navy-900 to-navy-950 border-b border-[rgba(230,206,150,0.16)]">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(230,206,150,0.10),transparent)]" />
                    <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
                        <div className="inline-flex items-center gap-2 bg-gold-500/10 border border-gold-500/25 rounded-full px-4 py-1.5 mb-6">
                            <MessageSquare size={14} className="text-gold-400" />
                            <span className="font-display font-bold uppercase text-xs tracking-[0.16em] text-gold-400">Get In Touch</span>
                        </div>
                        <h1 className="font-display font-extrabold uppercase text-5xl md:text-6xl text-white mb-4 leading-[0.9]">
                            We'd love to<br />
                            <span className="text-gold-400">hear from you.</span>
                        </h1>
                        <p className="text-lg font-body text-[#9FB0CC] max-w-xl mx-auto">
                            Questions, feedback, or partnership inquiries — we're real people who read every message.
                        </p>
                    </div>
                </div>

                <div className="max-w-6xl mx-auto px-6 py-16 grid lg:grid-cols-3 gap-12">
                    {/* Sidebar Info */}
                    <div className="lg:col-span-1 space-y-8">
                        <div>
                            <h2 className="font-display font-bold uppercase text-lg text-[color:var(--text)] mb-4">Other ways to reach us</h2>
                            <div className="space-y-4">
                                <a href="mailto:support@marchmeleepools.com" className="flex items-start gap-3 group">
                                    <div className="w-9 h-9 bg-gold-500/15 border border-gold-500/25 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-gold-500/20 transition-colors">
                                        <Mail size={16} className="text-gold-600 dark:text-gold-400" />
                                    </div>
                                    <div>
                                        <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-faint">Email</p>
                                        <p className="text-sm text-muted group-hover:text-[color:var(--text)] transition-colors">support@marchmeleepools.com</p>
                                    </div>
                                </a>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-navy-600/15 border border-line rounded-lg flex items-center justify-center shrink-0">
                                        <Clock size={16} className="text-navy-700 dark:text-[#9FB0CC]" />
                                    </div>
                                    <div>
                                        <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-faint">Response Time</p>
                                        <p className="text-sm text-muted">Within 48 business hours</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-gold-500/15 border border-gold-500/25 rounded-lg flex items-center justify-center shrink-0">
                                        <MapPin size={16} className="text-gold-600 dark:text-gold-400" />
                                    </div>
                                    <div>
                                        <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-faint">Based in</p>
                                        <p className="text-sm text-muted">United States</p>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3">
                                    <div className="w-9 h-9 bg-navy-600/15 border border-line rounded-lg flex items-center justify-center shrink-0">
                                        <Phone size={16} className="text-navy-700 dark:text-[#9FB0CC]" />
                                    </div>
                                    <div>
                                        <p className="font-display font-bold uppercase text-xs tracking-[0.08em] text-faint">SMS / Text</p>
                                        <p className="text-sm text-muted num">(980) 375-4395</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-card border border-line rounded-2xl p-5">
                            <h3 className="font-display font-bold uppercase text-sm text-[color:var(--text)] mb-2 flex items-center gap-1.5"><Rocket size={14} className="text-gold-600 dark:text-gold-400" /> Quick Help</h3>
                            <p className="text-xs text-muted mb-3">Most common questions are answered in our support guide.</p>
                            <a href="/support" className="font-display font-bold uppercase tracking-[0.05em] text-xs text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 underline underline-offset-2 transition-colors">
                                Visit Support Center →
                            </a>
                        </div>
                    </div>

                    {/* Contact Form */}
                    <div className="lg:col-span-2">
                        {status === 'success' && (
                            <div className="mb-6 bg-[#0F7B4A]/15 border border-[#0F7B4A]/40 rounded-xl p-5 flex items-start gap-3">
                                <CheckCircle className="text-[#0F7B4A] dark:text-emerald-400 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h3 className="font-display font-bold uppercase text-[color:var(--text)] mb-1">Message sent!</h3>
                                    <p className="text-sm text-muted">We'll get back to you within 48 business hours. Check your inbox for a confirmation.</p>
                                </div>
                            </div>
                        )}
                        {status === 'error' && (
                            <div className="mb-6 bg-brandred-600/15 border border-brandred-600/35 rounded-xl p-5 flex items-start gap-3">
                                <AlertCircle className="text-brandred-500 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h3 className="font-display font-bold uppercase text-[color:var(--text)] mb-1">Something went wrong</h3>
                                    <p className="text-sm text-muted">Please try again or email us directly at support@marchmeleepools.com.</p>
                                </div>
                            </div>
                        )}

                        <form
                            onSubmit={handleSubmit}
                            className="bg-card border border-line rounded-2xl p-8 space-y-5"
                        >
                            <div className="grid sm:grid-cols-2 gap-5">
                                <div>
                                    <FieldLabel className={labelCls}>
                                        Full Name <span className="text-brandred-500">*</span>
                                    </FieldLabel>
                                    <Input
                                        type="text"
                                        required
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="Jane Smith"
                                    />
                                </div>
                                <div>
                                    <FieldLabel className={labelCls}>
                                        Email Address <span className="text-brandred-500">*</span>
                                    </FieldLabel>
                                    <Input
                                        type="email"
                                        required
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        placeholder="jane@example.com"
                                    />
                                </div>
                            </div>

                            <div>
                                <FieldLabel className={labelCls}>
                                    Subject <span className="text-brandred-500">*</span>
                                </FieldLabel>
                                <Select
                                    required
                                    value={formData.subject}
                                    onChange={(e) => setFormData({ ...formData, subject: e.target.value as Subject })}
                                >
                                    <option value="">Select a subject...</option>
                                    {SUBJECTS.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </Select>
                            </div>

                            <div>
                                <FieldLabel className={labelCls}>
                                    Message <span className="text-brandred-500">*</span>
                                </FieldLabel>
                                <textarea
                                    required
                                    rows={7}
                                    value={formData.message}
                                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                                    className={textareaClass}
                                    placeholder="Tell us what's on your mind..."
                                />
                            </div>

                            <div className="flex items-center gap-3">
                                <Checkbox
                                    id="sendCopy"
                                    checked={formData.sendCopy}
                                    onChange={(e) => setFormData({ ...formData, sendCopy: e.target.checked })}
                                />
                                <label htmlFor="sendCopy" className="text-sm font-body text-muted cursor-pointer">
                                    Send me a copy of this message
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
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Mail size={18} />
                                        Send Message
                                    </>
                                )}
                            </Button>
                        </form>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
};
