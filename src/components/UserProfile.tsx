import { OverlayRoot } from './ui/OverlayRoot';
import { logger } from '../utils/logger';
import React, { useState, useEffect } from 'react';
import type { User } from '../types';
import { dbService } from '../services/dbService';
import { auth } from '../firebase';
import { authService } from '../services/authService';
import { useToast } from './ui/Toast';
import { getUserMessage } from '../utils/errorMessages';
import { historyService } from '../services/historyService';
import type { SeasonHistoryEntry } from '../services/historyService';
import { formatDeadline } from '../utils/formatTime';

import { Save, User as UserIcon, Phone, Twitter, Facebook, Linkedin, Globe, Instagram, Loader, Copy, Users, Link as LinkIcon, Edit2, Mail, ShieldAlert, Trophy, Medal, History } from 'lucide-react';
import { useNavigate } from 'react-router';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface UserProfileProps {
    user: User;
    onUpdate: (updatedUser: User) => void;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th"... */
const ordinal = (n: number): string => {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
};

/** Tailwind classes for the rank badge — gold/silver/bronze for the podium. */
const rankBadgeClasses = (rank: number): string => {
    if (rank === 1) return 'bg-gold-foil text-navy-900 border-transparent';
    if (rank === 2) return 'bg-navy-600/15 text-navy-700 dark:text-[#9FB0CC] border-line';
    if (rank === 3) return 'bg-gold-700/15 text-gold-700 dark:text-gold-400 border-gold-700/30';
    return 'bg-surface text-muted border-line';
};

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
            cashapp: user.paymentHandles?.cashapp || '',
            paypal: user.paymentHandles?.paypal || '',
            googlePay: user.paymentHandles?.googlePay || '',
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

    // Season History (written by the backend on pool completion)
    const [seasonHistory, setSeasonHistory] = useState<SeasonHistoryEntry[]>([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    useEffect(() => {
        if (!user.id) return;
        const unsubscribe = historyService.subscribeToSeasonHistory(user.id, (entries) => {
            setSeasonHistory(entries);
            setHistoryLoaded(true);
        });
        return unsubscribe;
    }, [user.id]);

    // Summary metrics
    const championships = seasonHistory.filter(e => e.isChampion).length;
    const podiumFinishes = seasonHistory.filter(e => e.finalRank >= 1 && e.finalRank <= 3).length;
    const bestFinish = seasonHistory.length > 0
        ? Math.min(...seasonHistory.map(e => e.finalRank))
        : null;
    const podiumRate = seasonHistory.length > 0
        ? Math.round((podiumFinishes / seasonHistory.length) * 100)
        : null;

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
                cashapp: user.paymentHandles?.cashapp || '',
                paypal: user.paymentHandles?.paypal || '',
                googlePay: user.paymentHandles?.googlePay || '',
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
        <div className="min-h-screen bg-page text-[color:var(--text)] font-body p-4 md:p-8 flex flex-col items-center">

            <div className="max-w-3xl w-full space-y-8 mb-10">
                {/* Header */}
                <div className="flex items-center gap-6 pb-6 border-b border-line">
                    <div className="w-20 h-20 bg-card rounded-full flex items-center justify-center border-2 border-line shadow-card overflow-hidden">
                        <UserIcon size={40} className="text-faint" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-extrabold uppercase leading-none text-[color:var(--text)] mb-1">Your Profile</h1>
                        <p className="text-muted">Manage your account details and public links.</p>
                    </div>
                </div>

                {message && (
                    <div className={`p-4 rounded-lg flex items-center justify-center font-bold border ${message.type === 'success' ? 'bg-[#E4F5EC] text-[#0F7B4A] border-[#BEE7D0]' : 'bg-[#FCEEED] text-brandred-600 border-brandred-500'}`}>
                        {message.text}
                    </div>
                )}

                {/* Referral Section */}
                <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Users size={100} className="text-gold-500" />
                    </div>
                    <h3 className="text-gold-600 font-display font-bold text-sm uppercase tracking-[0.08em] mb-4 flex items-center gap-2">
                        <Users size={16} /> Referral Program
                    </h3>

                    <div className="max-w-xl relative z-10">
                        <p className="text-[color:var(--text)] mb-4 text-sm">
                            Share your unique link to earn referral credit!
                        </p>
                        <div className="flex gap-2">
                            <code className="flex-grow bg-surface border border-gold-500/30 rounded-lg p-3 text-xs md:text-sm font-mono text-gold-700 dark:text-gold-400 truncate">
                                {fullReferralLink}
                            </code>
                            <button
                                onClick={() => { navigator.clipboard.writeText(fullReferralLink); toast.success('Link copied to clipboard!'); }}
                                className="bg-navy-800 hover:bg-navy-700 text-white p-3 rounded-lg transition-colors duration-150"
                            >
                                <Copy size={18} />
                            </button>
                        </div>
                        <div className="mt-4 flex items-center gap-2 text-xs text-muted font-display font-bold uppercase tracking-[0.08em]">
                            <LinkIcon size={12} /> Your Referrals: <span className="text-[color:var(--text)] num">{0}</span> {/* Placeholder for referral count */}
                        </div>
                    </div>
                </div>

                {/* Admin Claims Sync helper */}
                {user.role === 'SUPER_ADMIN' && (
                    <div className="bg-gold-500/10 border border-gold-500/30 rounded-xl p-6 relative overflow-hidden">
                        <h3 className="text-gold-600 font-display font-bold text-sm uppercase tracking-[0.08em] mb-2 flex items-center gap-2">
                            <ShieldAlert size={16} /> Admin Claims Sync Required
                        </h3>
                        <p className="text-[color:var(--text)] mb-4 text-sm">
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
                            className="bg-gold-foil hover:brightness-105 text-navy-900 font-display font-bold uppercase tracking-[0.05em] px-5 py-2.5 rounded-lg text-sm transition-all duration-150 shadow-[0_6px_16px_rgba(140,109,51,0.28)]"
                        >
                            Sync Admin Token Claims
                        </button>
                    </div>
                )}


                {/* My Entries Quick Link */}
                <div className="bg-card rounded-xl p-6 flex justify-between items-center border border-line shadow-card">
                    <div>
                        <h3 className="font-display font-bold uppercase text-[color:var(--text)] text-lg">My Entries</h3>
                        <p className="text-muted text-sm">View all pools you have joined.</p>
                    </div>
                    <button onClick={() => navigate('/participant')} className="bg-navy-800 hover:bg-navy-700 text-white px-5 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors duration-150">
                        View Entries
                    </button>
                </div>

                {/* Season History */}
                <div className="bg-card border border-line rounded-xl p-6">
                    <h3 className="text-muted text-xs font-display font-bold uppercase mb-4 tracking-[0.08em] flex items-center gap-2">
                        <History size={14} /> Season History
                    </h3>

                    {!historyLoaded ? (
                        <div className="flex items-center gap-2 text-muted text-sm py-4">
                            <Loader size={16} className="animate-spin" /> Loading your record...
                        </div>
                    ) : seasonHistory.length === 0 ? (
                        <div className="text-center py-8">
                            <Trophy size={32} className="mx-auto text-faint mb-3" />
                            <p className="text-muted text-sm">
                                Your completed pools will show up here — finish a season to start your record.
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* Summary strip */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                                <div className="bg-surface border border-line rounded-lg p-3 text-center">
                                    <div className="text-2xl font-display font-bold text-[color:var(--text)] num">{seasonHistory.length}</div>
                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mt-1">Pools Completed</div>
                                </div>
                                <div className="bg-surface border border-line rounded-lg p-3 text-center">
                                    <div className="text-2xl font-display font-bold text-gold-600 dark:text-gold-400 flex items-center justify-center gap-1 num">
                                        {championships > 0 && <Trophy size={18} />}{championships}
                                    </div>
                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mt-1">Championships</div>
                                </div>
                                <div className="bg-surface border border-line rounded-lg p-3 text-center">
                                    <div className="text-2xl font-display font-bold text-[color:var(--text)] num">{bestFinish !== null ? ordinal(bestFinish) : '—'}</div>
                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mt-1">Best Finish</div>
                                </div>
                                <div className="bg-surface border border-line rounded-lg p-3 text-center">
                                    <div className="text-2xl font-display font-bold text-[color:var(--text)] num">{podiumRate !== null ? `${podiumRate}%` : '—'}</div>
                                    <div className="text-xs text-muted font-display font-bold uppercase tracking-[0.08em] mt-1">Podium Rate</div>
                                </div>
                            </div>

                            {/* Per-pool list */}
                            <ul className="space-y-2">
                                {seasonHistory.map((entry) => (
                                    <li
                                        key={entry.poolId}
                                        className={`flex items-center justify-between gap-3 rounded-lg p-3 border ${entry.isChampion ? 'bg-gold-500/10 border-gold-500/30' : 'bg-surface border-line'}`}
                                    >
                                        <div className="min-w-0">
                                            <div className="font-body font-bold text-[color:var(--text)] text-sm truncate flex items-center gap-2">
                                                {entry.isChampion && <Trophy size={13} className="text-gold-600 dark:text-gold-400 shrink-0" aria-label="Champion" />}
                                                <span className="truncate">{entry.poolName} · {entry.season}</span>
                                            </div>
                                            <div className="text-xs text-muted mt-0.5 truncate num">
                                                {entry.entryName && <span className="text-faint">{entry.entryName} — </span>}
                                                Finished {ordinal(entry.finalRank)} of {entry.totalEntries}
                                                {typeof entry.points === 'number' && <span> · {entry.points} pts</span>}
                                                <span className="text-faint"> · {formatDeadline(entry.completedAt)}</span>
                                            </div>
                                        </div>
                                        <div className={`shrink-0 flex items-center gap-1 text-xs font-display font-bold uppercase px-2.5 py-1 rounded-full border num ${rankBadgeClasses(entry.finalRank)}`}>
                                            {entry.finalRank <= 3 && <Medal size={12} />}
                                            {ordinal(entry.finalRank)}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>

                {/* Email Preferences (informational — the control surface is the tokenized link in email footers) */}
                <div className="bg-card border border-line rounded-xl p-6 shadow-card">
                    <h3 className="text-muted text-xs font-display font-bold uppercase mb-4 tracking-[0.08em] flex items-center gap-2">
                        <Mail size={14} /> Email Preferences
                    </h3>
                    <p className="text-muted text-sm mb-4">
                        You control which emails we send you, by category:
                    </p>
                    <ul className="space-y-2 mb-4">
                        <li className="text-sm text-[color:var(--text)]">
                            <span className="font-bold text-[color:var(--text)]">Reminders</span>
                            <span className="text-muted"> — pool lock countdowns, pick deadlines, and payment reminders.</span>
                        </li>
                        <li className="text-sm text-[color:var(--text)]">
                            <span className="font-bold text-[color:var(--text)]">Results</span>
                            <span className="text-muted"> — winner announcements, recaps, and post-game summaries.</span>
                        </li>
                        <li className="text-sm text-[color:var(--text)]">
                            <span className="font-bold text-[color:var(--text)]">Announcements</span>
                            <span className="text-muted"> — commissioner broadcasts, waitlist openings, and invites.</span>
                        </li>
                    </ul>
                    <div className="bg-surface border border-line rounded-lg p-3 text-xs text-muted leading-relaxed">
                        To change these (or unsubscribe from everything), open the <span className="text-[color:var(--text)] font-bold">Unsubscribe / email preferences</span> link
                        in the footer of any email we've sent you. That link is personalized and secure, so it works without logging in.
                        Transactional emails (receipts, security notices) are always delivered.
                    </div>
                </div>

                {/* Main Form */}
                <div className="bg-card border border-line rounded-xl p-6 md:p-8 shadow-card">
                    <h2 className="text-muted text-xs font-display font-bold uppercase mb-6 tracking-[0.08em] border-b border-line pb-2">Basic Information</h2>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">Display Name</label>
                                <div className="relative">
                                    <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="Your Name"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">Email <span className="text-faint font-body font-normal normal-case text-xs">(Requires Verification to Change)</span></label>
                                <div className="flex gap-2">
                                    <div className="w-full bg-surface border border-line rounded-md px-3.5 py-2.5 text-muted cursor-not-allowed">
                                        {user.email || 'No Email'}
                                    </div>
                                    {user.provider === 'password' && (
                                        <button
                                            type="button"
                                            onClick={() => setShowEmailModal(true)}
                                            className="border-[1.5px] border-navy-800 text-navy-800 hover:bg-navy-800 hover:text-white dark:border-[color:var(--line)] dark:text-[color:var(--text)] dark:hover:bg-white/10 dark:hover:text-white px-4 py-2 rounded-lg font-display font-bold uppercase tracking-[0.05em] text-sm transition-colors duration-150 truncate flex items-center gap-2"
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
                                            className="text-xs text-gold-600 hover:text-gold-500 underline font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-wait"
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
                                <label className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">Phone Number <span className="text-faint font-normal text-xs">(Optional)</span></label>
                                <div className="relative">
                                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="+1 (555) 000-0000"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer group bg-surface p-3 rounded-lg border border-line hover:border-navy-600/50 transition-colors w-fit">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={formData.smsOptIn || false}
                                        onChange={(e) => setFormData({ ...formData, smsOptIn: e.target.checked })}
                                    />
                                    <div className="w-11 h-6 bg-line peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-navy-800 dark:peer-checked:bg-gold-600"></div>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-display font-bold uppercase tracking-[0.05em] text-[color:var(--text)] transition-colors">Opt-in to SMS Notifications</span>
                                    <span className="text-xs text-faint">Receive important pool updates and reminders via text message.</span>
                                </div>
                            </label>
                        </div>

                        {/* Payment Info */}
                        <div className="pt-4">
                            <h2 className="text-muted text-xs font-display font-bold uppercase mb-6 tracking-[0.08em] border-b border-line pb-2">Payment Info <span className="text-faint font-body font-normal normal-case">(Pre-fills when you create pools)</span></h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#008CFF]" fill="currentColor"><path d="M19.424 3.27c.663 0 1.194.585 1.194 1.302 0 .716-.536 1.218-1.194 1.218h-4.456c-.557 0-1.097.494-1.207 1.086l-1.9 9.674c-.11.592-.65 1.086-1.207 1.086H7.18c-.663 0-1.194-.586-1.194-1.303s.531-1.218 1.194-1.218h3.474c.557 0 1.097-.494 1.207-1.086l1.9-9.673c.11-.592.65-1.086 1.207-1.086h4.456z" /></svg>
                                        Venmo Handle
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.paymentHandles?.venmo || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, venmo: e.target.value } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="@YourVenmoHandle"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] flex items-center gap-2">
                                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#6D1ED4]" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                                        Zelle Email/Phone
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.paymentHandles?.zelle || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, zelle: e.target.value } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="your@email.com or phone"
                                    />
                                </div>
                                {/* The pool wizard collects FIVE handles; this panel stored two,
                                    so Cash App / PayPal / Google Pay could be learned from a pool
                                    but never corrected here — write-only fields. Added 2026-08-06
                                    alongside the wizard prefill. */}
                                <div className="space-y-2">
                                    <label htmlFor="profile-cashapp" className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">
                                        Cash App Cashtag
                                    </label>
                                    <input
                                        id="profile-cashapp"
                                        type="text"
                                        value={formData.paymentHandles?.cashapp || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, cashapp: e.target.value } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="$YourCashtag"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="profile-paypal" className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">
                                        PayPal
                                    </label>
                                    <input
                                        id="profile-paypal"
                                        type="text"
                                        value={formData.paymentHandles?.paypal || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, paypal: e.target.value } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="paypal.me/you"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="profile-googlepay" className="text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)]">
                                        Google Pay Email/Phone
                                    </label>
                                    <input
                                        id="profile-googlepay"
                                        type="text"
                                        value={formData.paymentHandles?.googlePay || ''}
                                        onChange={(e) => setFormData({ ...formData, paymentHandles: { ...formData.paymentHandles, googlePay: e.target.value } })}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="your@email.com or phone"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Social Links */}
                        <div className="pt-4">
                            <h2 className="text-muted text-xs font-display font-bold uppercase mb-6 tracking-[0.08em] border-b border-line pb-2">Social Links <span className="text-faint font-body font-normal normal-case">(All Optional)</span></h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <Twitter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.twitter}
                                        onChange={(e) => handleSocialChange('twitter', e.target.value)}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="X / Twitter Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Instagram size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.instagram}
                                        onChange={(e) => handleSocialChange('instagram', e.target.value)}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="Instagram Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Facebook size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.facebook}
                                        onChange={(e) => handleSocialChange('facebook', e.target.value)}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="Facebook Profile URL"
                                    />
                                </div>
                                <div className="relative">
                                    <Linkedin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.linkedin}
                                        onChange={(e) => handleSocialChange('linkedin', e.target.value)}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                        placeholder="LinkedIn Profile URL"
                                    />
                                </div>
                                <div className="relative md:col-span-2">
                                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                                    <input
                                        type="url"
                                        value={formData.socialLinks?.other}
                                        onChange={(e) => handleSocialChange('other', e.target.value)}
                                        className="w-full rounded-md border-[1.5px] border-line bg-page pl-10 pr-4 py-2.5 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
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
                                className="px-6 py-2.5 rounded-lg text-muted font-display font-bold uppercase tracking-[0.05em] hover:text-[color:var(--text)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-md font-display font-bold uppercase tracking-[0.05em] shadow-[0_6px_16px_rgba(196,52,46,0.28)] transition-all duration-150 hover:-translate-y-px flex items-center gap-2"
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
                <OverlayRoot id="profile-update-email" label="Update email address" onEscape={() => { if (!emailUpdateLoading) { setShowEmailModal(false); setPasswordError(''); } }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-card border border-line rounded-xl p-6 max-w-md w-full shadow-panel relative overflow-hidden">
                        {/* Decorative glow */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-gold-foil"></div>

                        <h3 className="text-xl font-display font-bold uppercase text-[color:var(--text)] mb-2 flex items-center gap-2">
                            <Edit2 size={20} className="text-gold-500" />
                            Update Email Address
                        </h3>
                        <p className="text-sm text-muted mb-6">
                            For security purposes, please provide your current password and your new email address.
                            A verification link will be sent to the new email.
                        </p>
                        <form onSubmit={handleEmailUpdate} className="space-y-4">
                            <div>
                                <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-1">New Email</label>
                                <input
                                    type="email"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="new.email@example.com"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-[12px] font-display font-bold uppercase tracking-[0.08em] text-[color:var(--text)] mb-1">Current Password</label>
                                <input
                                    type="password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full rounded-md border-[1.5px] border-line bg-page px-3.5 py-2 font-body text-[15px] text-[color:var(--text)] placeholder:text-faint transition-colors focus:border-navy-600 focus:bg-surface focus:outline-none"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>

                            {passwordError && (
                                <div className="text-brandred-600 text-sm p-3 bg-[#FCEEED] rounded-lg border border-brandred-500 font-medium">
                                    {passwordError}
                                </div>
                            )}

                            <div className="pt-4 flex justify-end gap-3 border-t border-line mt-6 md:mt-8">
                                <button
                                    type="button"
                                    onClick={() => { setShowEmailModal(false); setPasswordError(''); }}
                                    className="px-4 py-2 rounded-lg text-muted font-display font-bold uppercase tracking-[0.05em] hover:text-[color:var(--text)] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={emailUpdateLoading}
                                    className="bg-brandred-600 hover:bg-brandred-500 disabled:opacity-50 text-white px-6 py-2 rounded-md font-display font-bold uppercase tracking-[0.05em] shadow-[0_6px_16px_rgba(196,52,46,0.28)] flex items-center gap-2 transition-all duration-150"
                                >
                                    {emailUpdateLoading && <Loader size={16} className="animate-spin" />}
                                    Send Verification
                                </button>
                            </div>
                        </form>
                    </div>
                </OverlayRoot>
            )}
        </div>
    );
};
