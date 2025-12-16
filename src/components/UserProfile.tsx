import React, { useState, useEffect } from 'react';
import type { User } from '../types';
import { dbService } from '../services/dbService';
import { authService } from '../services/authService';
import { Save, User as UserIcon, Phone, Twitter, Facebook, Linkedin, Globe, Instagram, Loader, Copy, Users, Link as LinkIcon } from 'lucide-react';

interface UserProfileProps {
    user: User;
    onUpdate: (updatedUser: User) => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ user, onUpdate }) => {
    const [formData, setFormData] = useState<Partial<User>>({
        name: user.name,
        phone: user.phone || '',
        socialLinks: {
            twitter: user.socialLinks?.twitter || '',
            instagram: user.socialLinks?.instagram || '',
            facebook: user.socialLinks?.facebook || '',
            linkedin: user.socialLinks?.linkedin || '',
            other: user.socialLinks?.other || '',
        }
    });

    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        // Reset form when user prop changes
        setFormData({
            name: user.name,
            phone: user.phone || '',
            socialLinks: {
                twitter: user.socialLinks?.twitter || '',
                instagram: user.socialLinks?.instagram || '',
                facebook: user.socialLinks?.facebook || '',
                linkedin: user.socialLinks?.linkedin || '',
                other: user.socialLinks?.other || '',
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
                socialLinks: formData.socialLinks
            };

            await dbService.saveUser(updatedUser);
            onUpdate(updatedUser);
            setMessage({ type: 'success', text: 'Profile updated successfully!' });
        } catch (error) {
            console.error('Error saving profile:', error);
            setMessage({ type: 'error', text: 'Failed to save changes. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    const fullReferralLink = `${window.location.origin}/?ref=${user.id}`;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8 flex flex-col items-center">

            <div className="max-w-3xl w-full space-y-8 mb-10">
                {/* Header */}
                <div className="flex items-center gap-6 pb-6 border-b border-slate-800">
                    <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center border-2 border-slate-700 shadow-xl overflow-hidden">
                        {user.photoURL ? (
                            <img src={user.photoURL} alt={user.name} className="w-full h-full object-cover" />
                        ) : (
                            <UserIcon size={40} className="text-slate-500" />
                        )}
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
                                onClick={() => { navigator.clipboard.writeText(fullReferralLink); alert('Link copied!'); }}
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

                {/* My Entries Quick Link */}
                <div className="bg-slate-800/50 rounded-xl p-6 flex justify-between items-center border border-slate-700">
                    <div>
                        <h3 className="font-bold text-white text-lg">My Entries</h3>
                        <p className="text-slate-400 text-sm">View all pools you have joined.</p>
                    </div>
                    <button onClick={() => window.location.hash = '#participant'} className="bg-slate-700 hover:bg-slate-600 text-white px-5 py-2 rounded-lg font-bold text-sm transition-colors border border-slate-600">
                        View Entries
                    </button>
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
                                <label className="text-sm font-bold text-slate-300">Email <span className="text-slate-600 font-normal text-xs">(Read Only)</span></label>
                                <div className="w-full bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-400 cursor-not-allowed">
                                    {user.email || 'No Email'}
                                </div>
                            </div>
                        </div>

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
                                onClick={() => window.location.hash = '#admin'}
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
        </div>
    );
};
