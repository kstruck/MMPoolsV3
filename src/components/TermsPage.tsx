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

export const TermsPage: React.FC<Props> = (props) => {
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            <Header {...props} />

            {/* Content */}
            <div className="max-w-4xl mx-auto px-6 py-16">
                <h1 className="text-4xl font-black text-slate-900 dark:text-white mb-4">Terms of Service</h1>
                <p className="text-slate-500 dark:text-slate-400 mb-12">Last Updated: December 13, 2025</p>

                <div className="prose dark:prose-invert max-w-none space-y-8">
                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">1. Acceptance of Terms</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            By accessing or using March Melee Pools ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not use the Service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">2. Use License</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                            We grant you a limited, non-exclusive, non-transferable license to use the Service for personal or organizational purposes. You may not:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Modify or copy the Service materials</li>
                            <li>Use the Service for commercial purposes without authorization</li>
                            <li>Attempt to reverse engineer any aspect of the Service</li>
                            <li>Remove any copyright or proprietary notations</li>
                            <li>Transfer the materials to another person or entity</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">3. User Responsibilities</h2>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 mt-6">3.1 Account Security</h3>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
                        </p>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 mt-6">3.2 Accurate Information</h3>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            You agree to provide accurate, current, and complete information when creating pools or participating in the Service.
                        </p>

                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2 mt-6">3.3 Prohibited Conduct</h3>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Using the Service for any illegal purpose</li>
                            <li>Harassing, threatening, or defrauding other users</li>
                            <li>Attempting to gain unauthorized access to the Service</li>
                            <li>Uploading malicious code or viruses</li>
                            <li>Scraping or data mining without permission</li>
                        </ul>
                    </section>

                    <section className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-xl p-6">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">4. Gambling Disclaimer</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                            <strong>Important Legal Notice:</strong> March Melee Pools provides a platform for organizing sports pools. We do not facilitate gambling directly.
                        </p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Pool managers are responsible for ensuring compliance with local gambling laws</li>
                            <li>We do not handle money transactions or payouts</li>
                            <li>Users must be 18 years or older to use this Service</li>
                            <li>The Service is intended for social, entertainment purposes</li>
                            <li>By using the Service, you acknowledge that you are responsible for understanding and complying with applicable laws in your jurisdiction</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">5. Pool Management</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                            Pool managers ("Managers") have the following responsibilities:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Accurately recording participant information and payments</li>
                            <li>Fairly distributing winnings according to stated rules</li>
                            <li>Ensuring pool rules comply with local laws</li>
                            <li>Resolving disputes among participants</li>
                        </ul>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mt-4">
                            March Melee Pools is not responsible for disputes between pool managers and participants.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">6. Intellectual Property</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            The Service and its original content, features, and functionality are owned by March Melee Pools and are protected by international copyright, trademark, and other intellectual property laws.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">7. Limitation of Liability</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                            To the maximum extent permitted by law, March Melee Pools shall not be liable for:
                        </p>
                        <ul className="list-disc pl-6 space-y-2 text-slate-600 dark:text-slate-400">
                            <li>Any indirect, incidental, special, or consequential damages</li>
                            <li>Loss of profits, data, or goodwill</li>
                            <li>Service interruptions or errors</li>
                            <li>Disputes between users</li>
                            <li>Actions taken by pool managers</li>
                        </ul>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed mt-4">
                            Our total liability shall not exceed the amount paid by you (if any) for using the Service in the past 12 months.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">8. Disclaimer of Warranties</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            The Service is provided "as is" and "as available" without warranties of any kind, either express or implied. We do not guarantee that the Service will be uninterrupted, secure, or error-free.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">9. Dispute Resolution</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            Any disputes arising from these Terms or the Service shall be resolved through binding arbitration in accordance with the laws of the jurisdiction where March Melee Pools is registered, except where prohibited by law.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">10. Termination</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We reserve the right to terminate or suspend your account and access to the Service at our sole discretion, without notice, for conduct that we believe violates these Terms or is harmful to other users or the Service.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">11. Changes to Terms</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            We reserve the right to modify these Terms at any time. Material changes will be notified via email or a prominent notice on the Service. Continued use after changes constitutes acceptance of the modified Terms.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">12. Contact Information</h2>
                        <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                            For questions about these Terms, please contact:
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
