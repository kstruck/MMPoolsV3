import React from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { User } from '../types';

interface Props {
    user: User | null;
    isManager?: boolean;
    onOpenAuth: () => void;
    onLogout: () => void;
    onCreatePool: () => void;
}

export const PrivacyPage: React.FC<Props> = (props) => {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <Header {...props} />

            {/* Content */}
            <div className="max-w-4xl mx-auto px-6 py-16">
                <h1 className="text-4xl font-black text-slate-900 dark:text-white mb-4">Privacy Policy</h1>
                <p className="text-slate-500 dark:text-slate-400 mb-12">Last Updated: December 13, 2025</p>

                <div className="prose dark:prose-invert max-w-none space-y-8">
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">1. Introduction</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            Welcome to March Melee Pools ("we," "our," or "us"). We are committed to protecting your privacy and ensuring the security of your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">2. Information We Collect</h2>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 mt-6">2.1 Information You Provide</h3>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li><strong>Account Information:</strong> Name, email address, profile picture</li>
                            <li><strong>Pool Information:</strong> Pool settings, participant data, payment records</li>
                            <li><strong>Communications:</strong> Support requests, feedback, and correspondence</li>
                        </ul>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 mt-6">2.2 Automatically Collected Information</h3>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li><strong>Usage Data:</strong> Pages viewed, features used, time spent on platform</li>
                            <li><strong>Device Information:</strong> Browser type, operating system, IP address</li>
                            <li><strong>Cookies:</strong> We use essential cookies for authentication and preferences</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">3. How We Use Your Information</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">We use your information to:</p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Provide and maintain our services</li>
                            <li>Process transactions and manage pools</li>
                            <li>Send service-related notifications</li>
                            <li>Improve our platform and user experience</li>
                            <li>Prevent fraud and ensure security</li>
                            <li>Comply with legal obligations</li>
                        </ul>
                    </section>

                    <section className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-500/30 rounded-xl p-6">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">4. We Never Sell Your Data</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-semibold">
                            <strong>Important:</strong> We do not and will never sell, rent, or trade your personal information to third parties for marketing purposes. Your data is yours, and we respect that.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">5. Data Sharing and Disclosure</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">We may share your information only in the following circumstances:</p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li><strong>With Your Consent:</strong> When you explicitly authorize us to share information</li>
                            <li><strong>Service Providers:</strong> Third-party services that help us operate (Firebase, Google Analytics) under strict confidentiality agreements</li>
                            <li><strong>Legal Requirements:</strong> When required by law or to protect our legal rights</li>
                            <li><strong>Business Transfers:</strong> In connection with a merger, sale, or acquisition (you will be notified)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">6. Data Security</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We implement industry-standard security measures to protect your personal information, including encryption, secure authentication, and regular security audits. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">7. Your Rights</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">Depending on your location, you may have the following rights:</p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li><strong>Access:</strong> Request a copy of your personal data</li>
                            <li><strong>Correction:</strong> Update or correct your information</li>
                            <li><strong>Deletion:</strong> Request deletion of your account and data</li>
                            <li><strong>Data Portability:</strong> Receive your data in a portable format</li>
                            <li><strong>Opt-Out:</strong> Unsubscribe from marketing communications</li>
                        </ul>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mt-4">
                            To exercise these rights, contact us at <a href="mailto:support@marchmeleepools.com" className="text-indigo-600 dark:text-indigo-400 hover:underline">support@marchmeleepools.com</a>.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">8. Cookies and Tracking</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We use cookies and similar technologies for authentication, preferences, and analytics. You can control cookies through your browser settings, but disabling them may affect functionality.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">9. Children's Privacy</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            Our services are not directed to individuals under 18. We do not knowingly collect personal information from children. If you believe we have collected information from a child, please contact us immediately.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">10. Changes to This Policy</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the "Last Updated" date.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">11. Google User Data & Limited Use</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                            March Melee Pools' use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-indigo-600 dark:text-indigo-400 hover:underline" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.
                        </p>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            Specifically:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400 mt-2">
                            <li>We only request appropriate scopes (profile, email) to authenticate your identity.</li>
                            <li>We do not transfer this data to third-party AI models.</li>
                            <li>We do not sell this data to advertisers or data brokers.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">12. Contact Us</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            If you have questions about this Privacy Policy, please contact us at:
                        </p>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mt-4">
                            <strong>Email:</strong> <a href="mailto:support@marchmeleepools.com" className="text-indigo-600 dark:text-indigo-400 hover:underline">support@marchmeleepools.com</a>
                        </p>
                    </section>
                </div>
            </div>

            <Footer />
        </div>
    );
};
