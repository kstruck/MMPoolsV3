import { logger } from '../utils/logger';
import React, { useState } from 'react';
import { Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { emailService } from '../services/emailService';
import { Input, Select, FieldLabel, Checkbox, Button } from './ui';

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
            logger.error('Support form error:', error);
            setSubmitStatus('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    const labelCls = 'text-[#EDF1F8]';
    const textareaClass =
        'w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-3 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none resize-none';

    /* Marketing/support page is navy chrome end-to-end — always dark in both themes. */
    return (
        <div className="min-h-screen bg-navy-950 text-[#EDF1F8] font-body">
            {/* Content */}
            <div className="max-w-3xl mx-auto px-6 py-16">
                <div className="text-center mb-12">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gold-500/10 border border-gold-500/25 rounded-full mb-4">
                        <Mail className="text-gold-400" size={32} />
                    </div>
                    <h1 className="font-display font-extrabold uppercase text-4xl leading-[0.95] text-white mb-4">Contact Support</h1>
                    <p className="text-lg font-body text-[#9FB0CC]">
                        We're here to help! Send us a message and we'll respond within 48 hours.
                    </p>
                </div>

                {/* Success Message */}
                {submitStatus === 'success' && (
                    <div className="mb-8 bg-[#0F7B4A]/15 border border-[#0F7B4A]/40 rounded-xl p-6 flex items-start gap-3">
                        <CheckCircle className="text-emerald-400 shrink-0" size={24} />
                        <div>
                            <h3 className="font-display font-bold uppercase text-white mb-1">Message Sent Successfully!</h3>
                            <p className="text-[#9FB0CC] text-sm">
                                Thank you for contacting us. We'll get back to you within 48 hours.
                            </p>
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {submitStatus === 'error' && (
                    <div className="mb-8 bg-brandred-600/15 border border-brandred-600/35 rounded-xl p-6 flex items-start gap-3">
                        <AlertCircle className="text-brandred-500 shrink-0" size={24} />
                        <div>
                            <h3 className="font-display font-bold uppercase text-white mb-1">Error Sending Message</h3>
                            <p className="text-[#9FB0CC] text-sm">
                                Something went wrong. Please try again or email us directly.
                            </p>
                        </div>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-navy-900 border border-[rgba(230,206,150,0.16)] rounded-2xl p-8 space-y-6">
                    {/* Name */}
                    <div>
                        <FieldLabel className={labelCls}>
                            Your Name <span className="text-brandred-500">*</span>
                        </FieldLabel>
                        <Input
                            type="text"
                            required
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="John Doe"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <FieldLabel className={labelCls}>
                            Your Email <span className="text-brandred-500">*</span>
                        </FieldLabel>
                        <Input
                            type="email"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            placeholder="john@example.com"
                        />
                    </div>

                    {/* Support Type */}
                    <div>
                        <FieldLabel className={labelCls}>
                            Support Type <span className="text-brandred-500">*</span>
                        </FieldLabel>
                        <Select
                            required
                            value={formData.supportType}
                            onChange={(e) => setFormData({ ...formData, supportType: e.target.value })}
                        >
                            <option value="">Select a type...</option>
                            {supportTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </Select>
                    </div>

                    {/* Message */}
                    <div>
                        <FieldLabel className={labelCls}>
                            Message <span className="text-brandred-500">*</span>
                        </FieldLabel>
                        <textarea
                            required
                            rows={6}
                            value={formData.message}
                            onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                            className={textareaClass}
                            placeholder="Please describe your issue or question in detail..."
                        />
                    </div>

                    {/* Send Copy Checkbox */}
                    <div className="flex items-start gap-3">
                        <Checkbox
                            id="sendCopy"
                            checked={formData.sendCopy}
                            onChange={(e) => setFormData({ ...formData, sendCopy: e.target.checked })}
                            className="mt-1"
                        />
                        <label htmlFor="sendCopy" className="text-sm font-body text-[#9FB0CC] cursor-pointer">
                            Send me a copy of this message for my records
                        </label>
                    </div>

                    {/* SLA Notice */}
                    <div className="bg-navy-950 border border-gold-500/25 rounded-xl p-4">
                        <p className="text-sm font-body text-[#EDF1F8]">
                            <strong>Response Time:</strong> We aim to respond to all support requests within 48 hours during business days.
                        </p>
                    </div>

                    {/* Submit Button */}
                    <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        disabled={isSubmitting}
                        className="w-full"
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
                    </Button>
                </form>
            </div>
        </div>
    );
};
