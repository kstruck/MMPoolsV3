import React, { useState } from 'react';
import { ArrowLeft, Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { Footer } from './Footer';
import { emailService } from '../services/emailService';

export const SupportPage: React.FC = () => {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        supportType: '',
        message: '',
        sendCopy: false
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const supportTypes = [
        'Technical Issue',
        'Question About a Pool',
        'Payment/Billing',
        'Feature Request',
        'Other'
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitStatus('idle');

        try {
            // Send support email
            const emailBody = `
Support Request from ${formData.name}

Email: ${formData.email}
Type: ${formData.supportType}

Message:
${formData.message}

---
Sent via March Melee Pools Support Form
      `;

            await emailService.sendEmail(
                'support@marchmeleepools.com',
                `Support Request: ${formData.supportType}`,
                emailBody,
                undefined,
                { replyTo: formData.email }
            );

            // Send copy to user if requested
            if (formData.sendCopy) {
                await emailService.sendEmail(
                    formData.email,
                    `Copy: Your Support Request - ${formData.supportType}`,
                    `Thank you for contacting March Melee Pools support. This is a copy of your request:\n\n${emailBody}\n\nWe aim to respond within 48 hours.`
                );
            }

            setSubmitStatus('success');
            setFormData({ name: '', email: '', supportType: '', message: '', sendCopy: false });
        } catch (error) {
            console.error('Support form error:', error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            {/* Header */}
            <nav className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <button
                        onClick={() => window.location.hash = '#'}
                        className="flex items-center gap-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        <ArrowLeft size={20} />
                        <span className="font-bold">Back to Home</span>
                    </button>
                </div>
            </nav>

            {/* Content */}
            <div className="max-w-3xl mx-auto px-6 py-16">
                <div className="text-center mb-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 dark:bg-indigo-900/20 rounded-full mb-4">
                        <Mail className="text-indigo-600 dark:text-indigo-400" size={32} />
                    </div>
                    <h1 className="text-4xl font-black text-slate-900 dark:text-white mb-4">Contact Support</h1>
                    <p className="text-lg text-slate-600 dark:text-slate-400">
                        We're here to help! Send us a message and we'll respond within 48 hours.
                    </p>
                </div>

                {/* Success Message */}
                {submitStatus === 'success' && (
                    <div className="mb-8 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-xl p-6 flex items-start gap-3">
                        <CheckCircle className="text-emerald-600 dark:text-emerald-400 shrink-0" size={24} />
                        <div>
                            <h3 className="font-bold text-emerald-900 dark:text-emerald-100 mb-1">Message Sent Successfully!</h3>
                            <p className="text-emerald-700 dark:text-emerald-300 text-sm">
                                Thank you for contacting us. We'll get back to you within 48 hours.
                            </p>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {submitStatus === 'error' && (
                    <div className="mb-8 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/30 rounded-xl p-6 flex items-start gap-3">
                        <AlertCircle className="text-rose-600 dark:text-rose-400 shrink-0" size={24} />
                        <div>
                            <h3 className="font-bold text-rose-900 dark:text-rose-100 mb-1">Error Sending Message</h3>
                            <p className="text-rose-700 dark:text-rose-300 text-sm">
                                Something went wrong. Please try again or email us directly.
                            </p>
                        </div>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 space-y-6">
                    {/* Name */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                            Your Name <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent outline-none transition-all"
                            placeholder="John Doe"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                            Your Email <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="email"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent outline-none transition-all"
                            placeholder="john@example.com"
                        />
                    </div>

                    {/* Support Type */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                            Support Type <span className="text-rose-500">*</span>
                        </label>
                        <select
                            required
                            value={formData.supportType}
                            onChange={(e) => setFormData({ ...formData, supportType: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent outline-none transition-all"
                        >
                            <option value="">Select a type...</option>
                            {supportTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>

                    {/* Message */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                            Message <span className="text-rose-500">*</span>
                        </label>
                        <textarea
                            required
                            rows={6}
                            value={formData.message}
                            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent outline-none transition-all resize-none"
                            placeholder="Please describe your issue or question in detail..."
                        />
                    </div>

                    {/* Send Copy Checkbox */}
                    <div className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            id="sendCopy"
                            checked={formData.sendCopy}
                            onChange={(e) => setFormData({ ...formData, sendCopy: e.target.checked })}
                            className="mt-1 w-4 h-4 text-indigo-600 bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 rounded focus:ring-indigo-500"
                        />
                        <label htmlFor="sendCopy" className="text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                            Send me a copy of this message for my records
                        </label>
                    </div>

                    {/* SLA Notice */}
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl p-4">
                        <p className="text-sm text-indigo-900 dark:text-indigo-100 font-medium">
                            <strong>Response Time:</strong> We aim to respond to all support requests within 48 hours during business days.
                        </p>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 text-white py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isSubmitting ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Sending...
                            </>
                        ) : (
                            <>
                                <Mail size={20} />
                                Send Message
                            </>
                        )}
                    </button>
                </form>
            </div>

            <Footer />
        </div>
    );
};
