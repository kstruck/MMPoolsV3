import React, { useState } from 'react';
import { X, Lock, Unlock, Save, Loader } from 'lucide-react';
import type { PlayoffPool } from '../../types';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface PlayoffSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    pool: PlayoffPool;
}

export const PlayoffSettingsModal: React.FC<PlayoffSettingsModalProps> = ({ isOpen, onClose, pool }) => {
    const [name, setName] = useState(pool.name);
    const [isLocked, setIsLocked] = useState(pool.isLocked);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        setSuccess(false);

        try {
            const poolRef = doc(db, 'pools', pool.id);
            await updateDoc(poolRef, {
                name,
                isLocked,
                updatedAt: Date.now()
            });

            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                onClose();
            }, 1000);
        } catch (err: any) {
            console.error("Error updating pool:", err);
            setError("Failed to update settings. Please try again.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-800">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <SettingsIcon /> Pool Settings
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6 overflow-y-auto">

                    {/* Pool Name */}
                    <div>
                        <label className="block text-slate-400 text-sm font-bold uppercase mb-2">Pool Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>

                    {/* Locking Status */}
                    <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                        <label className="block text-slate-400 text-sm font-bold uppercase mb-3">Pool Status</label>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setIsLocked(false)}
                                className={`flex-1 py-3 px-4 rounded-lg font-bold border transition-all flex items-center justify-center gap-2
                                    ${!isLocked
                                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'}`}
                            >
                                <Unlock size={18} /> Open
                            </button>
                            <button
                                onClick={() => setIsLocked(true)}
                                className={`flex-1 py-3 px-4 rounded-lg font-bold border transition-all flex items-center justify-center gap-2
                                    ${isLocked
                                        ? 'bg-rose-500/10 border-rose-500 text-rose-400'
                                        : 'bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500'}`}
                            >
                                <Lock size={18} /> Locked
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-3">
                            {isLocked
                                ? "Pool is currently LOCKED. Players cannot submit or edit entries."
                                : "Pool is OPEN. Players can submit and edit their entries."}
                        </p>
                    </div>

                    {/* Danger Zone / Advanced Config could go here */}

                    {/* Feedback */}
                    {error && (
                        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg text-sm font-bold text-center">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-sm font-bold text-center">
                            Settings Saved Successfully!
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-800 bg-slate-900/50 rounded-b-xl flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 text-slate-400 hover:text-white font-bold transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-indigo-900/20 flex items-center gap-2 disabled:opacity-50 transition-all"
                    >
                        {isSaving ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

const SettingsIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
);
