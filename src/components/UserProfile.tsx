import React, { useState, useEffect } from 'react';
import type { User } from '../types';
import { dbService } from '../services/dbService';
import { authService } from '../services/authService';
import { Save, User as UserIcon, Phone, Twitter, Facebook, Linkedin, Globe, Instagram, Loader, Copy, Users, Link as LinkIcon } from 'lucide-react';
import { Footer } from './Footer';

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
            // Update Firestore
            await dbService.updateUser(user.id, formData);

            // Sync to Firebase Auth (Display Name)
            if (formData.name && formData.name !== user.name) {
                await authService.updateProfile(formData.name);
            }

            onUpdate({ ...user, ...formData });
            setMessage({ type: 'success', text: 'Profile updated successfully!' });

            // Clear success message after 3s
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error("Failed to update profile", error);
            setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div>
            <div className="max-w-2xl mx-auto p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="bg-slate-950 p-6 border-b border-slate-800 flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-500/20">
                            {user.picture ? <img src={user.picture} alt={user.name} className="w-full h-full rounded-full object-cover" /> : user.name.charAt(0)}
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-white">Your Profile</h2>
                            <p className="text-slate-400 text-sm">Manage your account details and public links.</p>
                        </div>
                    </div>

                    {/* Referral Program Section */}
                    <div className="p-6 border-b border-slate-800 bg-gradient-to-r from-indigo-900/20 to-purple-900/20">
                        <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <Users size={16} /> Referral Program
                        </h3>
                        <div className="bg-slate-950 rounded-lg p-4 border border-indigo-500/20">
                            <p className="text-xs text-slate-400 mb-3">Share your unique link to earn referral credit!</p>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-indigo-300 font-mono truncate">
                                    {`${window.location.origin}/?ref=${user.referralCode || user.id}`}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(`${window.location.origin}/?ref=${user.referralCode || user.id}`);
                                        alert('Link copied!');
                                    }}
                                    className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                                    title="Copy Link"
                                >
                                    <Copy size={18} />
                                </button>
                            </div>
                            <div className="mt-4 flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-2">
                                    <LinkIcon size={14} className="text-slate-500" />
                                    <span className="text-slate-400">Your Referrals: </span>
                                    <span className="text-white font-bold">{user.referralCount || 0}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dashboard Link Banner */}
                    <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                        <div>
                            <h3 className="text-sm font-bold text-white">My Entries</h3>
                            <p className="text-xs text-slate-400">View all pools you have joined.</p>
                        </div>
                        <button onClick={() => window.location.hash = '#participant'} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">
                            View Entries
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-6 space-y-6">
                        {message && (
                            <div className={`p-4 rounded-lg text-sm font-bold ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                {message.text}
                            </div>
                        )}

                        {/* Basic Info */}
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">Basic Information</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Display Name</label>
                                    <div className="relative">
                                        <UserIcon size={16} className="absolute left-3 top-3 text-slate-500" />
                                        <input
                                            type="text"
                                            required
                                            value={formData.name || ''}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                            placeholder="Your Name"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Email <span className="text-slate-600 text-xs ml-1">(Read Only)</span></label>
                                    <div className="relative opacity-60 cursor-not-allowed">
                                        <input
                                            type="email"
                                            disabled
                                            value={user.email}
                                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-slate-400"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">Phone Number <span className="text-slate-500 text-xs font-normal">(Optional)</span></label>
                                    <div className="relative">
                                        <Phone size={16} className="absolute left-3 top-3 text-slate-500" />
                                        <input
                                            type="tel"
                                            value={formData.phone || ''}
                                            onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                            placeholder="+1 (555) 000-0000"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Social Links */}
                        <div className="space-y-4 pt-2">
                            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">Social Links <span className="text-xs text-slate-600 normal-case ml-2">(All Optional)</span></h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative group">
                                    <Twitter size={16} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-sky-400 transition-colors" />
                                    <input
                                        type="text"
                                        value={formData.socialLinks?.twitter || ''}
                                        onChange={e => handleSocialChange('twitter', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition-all placeholder:text-slate-600"
                                        placeholder="X / Twitter Profile URL"
                                    />
                                </div>

                                <div className="relative group">
                                    <Instagram size={16} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-pink-500 transition-colors" />
                                    <input
                                        type="text"
                                        value={formData.socialLinks?.instagram || ''}
                                        onChange={e => handleSocialChange('instagram', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-all placeholder:text-slate-600"
                                        placeholder="Instagram Profile URL"
                                    />
                                </div>

                                <div className="relative group">
                                    <Facebook size={16} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-blue-500 transition-colors" />
                                    <input
                                        type="text"
                                        value={formData.socialLinks?.facebook || ''}
                                        onChange={e => handleSocialChange('facebook', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all placeholder:text-slate-600"
                                        placeholder="Facebook Profile URL"
                                    />
                                </div>

                                <div className="relative group">
                                    <Linkedin size={16} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-blue-600 transition-colors" />
                                    <input
                                        type="text"
                                        value={formData.socialLinks?.linkedin || ''}
                                        onChange={e => handleSocialChange('linkedin', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-white focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-all placeholder:text-slate-600"
                                        placeholder="LinkedIn Profile URL"
                                    />
                                </div>

                                <div className="relative group md:col-span-2">
                                    <Globe size={16} className="absolute left-3 top-3 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                                    <input
                                        type="text"
                                        value={formData.socialLinks?.other || ''}
                                        onChange={e => handleSocialChange('other', e.target.value)}
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
            <Footer />
        </div>
    );
};
