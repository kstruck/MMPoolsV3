import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import type { User } from '../types';
import { dbService } from '../services/dbService';
import { auth } from '../firebase';
import { authService } from '../services/authService';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';

import { Save, User as UserIcon, Phone, Twitter, Facebook, Linkedin, Globe, Instagram, Loader, Copy, Users, Link as LinkIcon, Edit2, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface UserProfileProps {
    user: User;
    onUpdate: (updatedUser: User) => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ user, onUpdate }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [formData, setFormData] = useState<Partial<User>>({
        name: user.name,
        phone: user.phone || '',
        smsOptIn: user.smsOptIn || false,
        socialLinks: {
            twitter: user.socialLinks?.twitter || '',
            instagram: user.socialLinks?.instagram || '',
            facebook: user.socialLinks?.facebook || '',
            linkedin: user.socialLinks?.linkedin || '',
            other: user.socialLinks?.other || '',
        },
        paymentHandles: {
            venmo: user.paymentHandles?.venmo || '',
            zelle: user.paymentHandles?.zelle || '',
        }
    });

    const [isSaving, setIsSaving] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Email Change State
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [emailUpdateLoading, setEmailUpdateLoading] = useState(false);
    const [passwordError, setPasswordError] = useState('');

    useEffect(() => {
        // Reset form when user prop changes
        setFormData({
            name: user.name,
            phone: user.phone || '',
            smsOptIn: user.smsOptIn || false,
            socialLinks: {
                twitter: user.socialLinks?.twitter || '',
                instagram: user.socialLinks?.instagram || '',
                facebook: user.socialLinks?.facebook || '',
                linkedin: user.socialLinks?.linkedin || '',
                other: user.socialLinks?.other || '',
            },
            paymentHandles: {
                venmo: user.paymentHandles?.venmo || '',
                zelle: user.paymentHandles?.zelle || '',
            }
        });
    }, [user]);

    const handleSocialChange = (key: keyof NonNullable<User['socialLinks']>, value: string) => {
        setFormData(prev => ({
            ...prev,
            socialLinks: {
                ...prev.socialLinks,
                [key]: value
            }
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setMessage(null);

        try {
            const updatedUser = {
                ...user,
                name: formData.name || user.name,
                phone: formData.phone || '',
                smsOptIn: formData.smsOptIn || false,
                socialLinks: formData.socialLinks,
                paymentHandles: formData.paymentHandles
            };

            await dbService.saveUser(updatedUser);
            onUpdate(updatedUser);
            setMessage({ type: 'success', text: 'Profile updated successfully!' });
        } catch (error) {
            logger.error('Error saving profile:', error);
            setMessage({ type: 'error', text: 'Failed to save changes. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleEmailUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError('');
        if (!newEmail || !currentPassword) {
            setPasswordError('Both new email and current password are required.');
            return;
        }

        setEmailUpdateLoading(true);
        setMessage(null);

        try {
            // Re-authenticate and set pending email
            await authService.requestEmailUpdate(newEmail, currentPassword);

            // Trigger SMS security alert
            if (user.phone && user.smsOptIn) {
                const functions = getFunctions();
                const sendSecuritySMSAlert = httpsCallable(functions, 'sendSecuritySMSAlert');
                try {
                    await sendSecuritySMSAlert();
                    logger.log('Security SMS alert sent');
                } catch (smsError) {
                    logger.warn('Failed to send security SMS:', smsError);
                }
            }

            setMessage({ type: 'success', text: `Verification link sent to ${newEmail}! Check your inbox and verify the link before the change takes effect.` });
            setShowEmailModal(false);
            setNewEmail('');
            setCurrentPassword('');

            // Note: Since email updates require clicking the link, we don't update local state or db right now.
        } catch (error: any) {
            logger.error('Error updating email:', error);
            if (error.code === 'auth/wrong-password') {
                setPasswordError('Incorrect current password.');
            } else if (error.code === 'auth/email-already-in-use') {
                setPasswordError('This email is already in use by another account.');
            } else if (error.code === 'auth/requires-recent-login') {
                setPasswordError('This operation requires recent authentication. Please log out and log back in, then try again.');
            } else {
                setPasswordError(error.message || 'Failed to update email. Ensure your current password is correct and the new email is valid.');
            }
        } finally {
            setEmailUpdateLoading(false);
        }
    };

    const handleResendVerification = async () => {
        setIsVerifying(true);
        setMessage(null);
        try {
            if (auth.currentUser) {
                await authService.sendVerificationEmail(auth.currentUser);
                setMessage({ type: 'success', text: 'Verification email sent! Please check your inbox (and spam folder).' });
            } else {
                setMessage({ type: 'error', text: 'Authentication session missing. Please refresh the page.' });
            }
        } catch (error) {
            logger.error('Error sending verification email:', error);
            setMessage({ type: 'error', text: 'Failed to send verification email. Please try again later.' });
        } finally {
            setIsVerifying(false);
        }
    };

    const fullReferralLink = `${window.location.origin}/?ref=${user.id}`;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8 flex flex-col items-center">

            <div className="max-w-3xl w-full space-y-8 mb-10">
                {/* Header */}
                <div className="flex items-center gap-6 pb-6 border-b border-slate-800">
                    <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center border-2 border-slate-700 shadow-xl overflow-hidden">
                        <UserIcon size={40} className="text-slate-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-white mb-1">Your Profile</h1>
                        <p className="text-slate-400">Manage your account details and public links.</p>
                    </div>
                </div>

                {message && (
                    <div className={`p-4 rounded-lg flex items-center justify-center font-bold ${message.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                        {message.text}
                    </div>
                )}

                {/* Referral Section */}
                <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Users size={100} className="text-indigo-500" />
                    </div>
                    <h3 className="text-indigo-400 font-bold text-sm uppercase mb-4 flex items-center gap-2">
                        <Users size={16} /> Referral Program
                    </h3>

                    <div className="max-w-xl relative z-10">
                        <p className="text-slate-300 mb-4 text-sm">
                            Share your unique link to earn referral credit!
                        </p>
                        <div className="flex gap-2">
                            <code className="flex-grow bg-slate-950/50 border border-indigo-500/30 rounded-lg p-3 text-xs md:text-sm font-mono text-indigo-300 truncate">
                                {fullReferralLink}
                            </code>
                            <button
                                onClick={() => { navigator.clipboard.writeText(fullReferralLink); toast.success('Link copied to clipboard!'); }}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white p-3 rounded-lg transition-colors"
                            >
                                <Copy size={18} />
                            </button>
                        </div>
                        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 font-bold">
                            <LinkIcon size={12} /> Your Referrals: <span className="text-white">{0}</span> {/* Placeholder for referral count */}
                        </div>
                    </div>
                </div>

                {/* Admin Claims Sync helper */}
                {user.role === 'SUPER_ADMIN' && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 relative overflow-hidden">
                        <h3 className="text-amber-400 font-bold text-sm uppercase mb-2 flex items-center gap-2">
                            🛡️ Admin Claims Sync Required
                        </h3>
                        <p className="text-slate-300 mb-4 text-sm">
                            Your database profile has the <strong>SUPER_ADMIN</strong> role, but your browser Auth session claims need to be synchronized. Click the button below to sync claims and update your permission token.
                        </p>
                        <button
                            onClick={async () => {
                                try {
                                    const res = await dbService.syncMyClaims();
                                    if (res.success) {
                                        if (auth.currentUser) {
                                            await auth.currentUser.getIdToken(true);
                                        }
                                        toast.success(`Success: Admin claims synced! Your role is verified as ${res.role}.`);
                                        // Let the toast register before the reload wipes the page
                                        setTimeout(() => window.location.reload(), 1200);
                                    } else {
                                        toast.error(`Sync failed: ${res.message}`);
                                    }
                                } catch (err: any) {
                                    toast.error(getUserMessage(err, 'Error syncing claims.'));
                                }
                            }}
                            className="bg-amber-600 hover:bg-amber-505 bg-amber-500 text-black font-extrabold px-5 py-2.5 rounded-lg text-sm transition-colors shadow-lg shadow-amber-500/20"
                        >
                            Sync Admin Token Claims
                        </button>
                    </div>
                )}


                {/* My Entries Quick Link */}
                <div className="bg-slate-800/50 rounded-xl p-6 flex justify-between items-center border border-slate-700">
                    <div>
                        <h3 className="font-bold text-white text-lg">My Entries</h3>
                        <p className="text-slate-400 text-sm">View all pools you have joined.</p>
                    </div>
                    <button onClick={() => navigate('/participant')} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-lg font-bold text-sm transition-colors border border-slate-600">
                        View Entries
                    </button>
                </div>

                {/* Email Preferences (informational — the control surface is the tokenized link in email footers) */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-4 tracking-wider flex items-center gap-2">
                        <Mail size={14} /> Email Preferences
                    </h3>
                    <p className="text-slate-400 text-sm mb-4">
                        You control which emails we send you, by category:
                    </p>
                    <ul className="space-y-2 mb-4">
                        <li className="text-sm text-slate-300">
                            <span className="font-bold text-white">Reminders</span>
                            <span className="text-slate-400"> — pool lock countdowns, pick deadlines, and payment reminders.</span>
                        </li>
                        <li className="text-sm text-slate-300">
                            <span className="font-bold text-white">Results</span>
                            <span className="text-slate-400"> — winner announcements, recaps, and post-game summaries.</span>
                        </li>
                        <li className="text-sm text-slate-300">
                            <span className="font-bold text-white">Announcements</span>
                            <span className="text-slate-400"> — commissioner broadcasts, waitlist openings, and invites.</span>
                        </li>
                    </ul>
                    <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-xs text-slate-400 leading-relaxed">
                        To change these (or unsubscribe from everything), open the <span className="text-slate-300 font-bold">Unsubscribe / email preferences</span> link
                        in the footer of any email we've sent you. That link is personalized and secure, so it works without logging in.
                        Transactional emails (receipts, security notices) are always delivered.
                    </div>
                </div>

                {/* Main Form */}
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 md:p-8 shadow-xl">
                    <h2 className="text-slate-500 text-xs font-bold uppercase mb-6 tracking-wider border-b border-slate-700 pb-2">Basic Information</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-300">Display Name</label>
                                <div className="relative">
                                    <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                        placeholder="Your Name"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-300">Email <span className="text-slate-600 font-normal text-xs">(Requires Verification to Change)</span></label>
                                <div className="flex gap-2">
                                    <div className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-400 cursor-not-allowed">
                                        {user.email || 'No Email'}
                                    </div>
                                    {user.provider === 'password' && (
                                        <button
                                            type="button"
                                            onClick={() => setShowEmailModal(true)}
                                            className="bg-slate-700/50 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors border border-slate-600 truncate flex items-center gap-2"
                                        >
                                            <Edit2 size={16} /> Change
                                        </button>
                                    )}
                                </div>
                                {!user.emailVerified && (
                                    <div className="flex items-center gap-2 mt-2">
                                        <button
                                            type="button"
                                            onClick={handleResendVerification}
                                            disabled={isVerifying}
                                            className="text-xs text-amber-400 hover:text-amber-300 underline font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-wait"
                                        >
                                            {isVerifying ? (
                                                <><Loader size={12} className="animate-spin" /> Sending...</>
                                            ) : (
                                                'Email not verified. Click to resend link.'
                                            )}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-300">Phone Number <span className="text-slate-500 font-normal text-xs">(Optional)</span></label>
                                <div className="relative">
                                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                        placeholder="+1 (555) 000-0000"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer group bg-slate-800/50 p-3 rounded-lg border border-slate-700 hover:border-indigo-500/50 transition-colors w-fit">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={formData.smsOptIn || false}
                                        onChange={(e) => setFormData({ ...formData, smsOptIn: e.target.checked })}
                                    />
                                    <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">Opt-in to SMS Notifications</span>
                                    <span className="text-xs text-slate-500">Receive important pool updates and reminders via text message.</span>
                                </div>
                            </label>
                        </div>

                        {/* Payment Info */}
                        <div className="pt-4">
                            <h2 className="text-slate-500 text-xs font-bold uppercase mb-6 tracking-wider border-b border-slate-700 pb-2">Payment Info <span className="text-slate-600 font-normal normal-case">(Pre-fills when you create pools)</span></h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-300 flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#008CFF]" fill="currentColor"><path d="M19.424 3.27c.663 0 1.194.585 1.194 1.302 0 .716-.536 1.218-1.194 1.218h-4.456c-.557 0-1.097.494-1.207 1.086l-1.9 9.674c-.11.592-.65 1.086-1.207 1.086H7.18c-.663 0-1.194-.586-1.194-1.303s.531-1.218 1.194-1.218h3.474c.557 0 1.097-.494 1.207-1.086l1.9-9.673c.11-.592.65-1.086 1.207-1.086h4.456z" /></svg>
                                        Venmo Handle
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.paymentHandles?.venmo || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, venmo: e.target.value } })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                        placeholder="@YourVenmoHandle"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-300 flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-purple-500" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                                        Zelle Email/Phone
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.paymentHandles?.zelle || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, zelle: e.target.value } })}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                        placeholder="your@email.com or phone"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Social Links */}
                        <div className="pt-4">
                            <h2 className="text-slate-500 text-xs font-bold uppercase mb-6 tracking-wider border-b border-slate-700 pb-2">Social Links <span className="text-slate-600 font-normal normal-case">(All Optional)</span></h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <Twitter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.twitter}
                                        onChange={(e) => handleSocialChange('twitter', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                        placeholder="X / Twitter Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Instagram size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.instagram}
                                        onChange={(e) => handleSocialChange('instagram', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                        placeholder="Instagram Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Facebook size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.facebook}
                                        onChange={(e) => handleSocialChange('facebook', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                        placeholder="Facebook Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Linkedin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.linkedin}
                                        onChange={(e) => handleSocialChange('linkedin', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                        placeholder="LinkedIn Profile URL"
                                    />
                                </div>
                                <div className="relative md:col-span-2">
                                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.other}
                                        onChange={(e) => handleSocialChange('other', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                        placeholder="Other Website / Portfolio URL"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="pt-4 flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/')}
                                className="px-6 py-2.5 rounded-lg text-slate-400 font-bold hover:text-white transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-lg font-bold shadow-lg shadow-indigo-500/25 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                            >
                                {isSaving ? <Loader size={20} className="animate-spin" /> : <Save size={20} />}
                                Save Changes
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Email Change Modal */}
            {showEmailModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full shadow-2xl relative overflow-hidden">
                        {/* Decorative glow */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>

                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <Edit2 size={20} className="text-indigo-400" />
                            Update Email Address
                        </h3>
                        <p className="text-sm text-slate-400 mb-6">
                            For security purposes, please provide your current password and your new email address.
                            A verification link will be sent to the new email.
                        </p>
                        <form onSubmit={handleEmailUpdate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-300 mb-1">New Email</label>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    placeholder="new.email@example.com"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-300 mb-1">Current Password</label>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>

                            {passwordError && (
                                <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg border border-red-500/20 font-medium">
                                    {passwordError}
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-3 border-t border-slate-700 mt-6 md:mt-8">
                                <button
                                    type="button"
                                    onClick={() => { setShowEmailModal(false); setPasswordError(''); }}
                                    className="px-4 py-2 rounded-lg text-slate-400 font-bold hover:text-white transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={emailUpdateLoading}
                                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-all"
                                >
                                    {emailUpdateLoading && <Loader size={16} className="animate-spin" />}
                                    Send Verification
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
