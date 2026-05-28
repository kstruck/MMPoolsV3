import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ArrowRight } from 'lucide-react';

export const PaymentSuccess: React.FC = () => {
    const [searchParams] = useSearchParams();
    const poolId = searchParams.get('poolId') || searchParams.get('poolid') || '';
    const sessionId = searchParams.get('session_id') || '';
    const [showContent, setShowContent] = useState(false);

    useEffect(() => {
        // Small delay so the animation plays after mount
        const timer = setTimeout(() => setShowContent(true), 200);
        return () => clearTimeout(timer);
    }, []);

    const normalizedPoolId = poolId.toLowerCase();
    const isBundle = 
        normalizedPoolId.startsWith('bundle_') || 
        normalizedPoolId.includes('bundle') || 
        normalizedPoolId.includes('buy_3') || 
        normalizedPoolId.includes('unlimited') || 
        (poolId.length > 0 && poolId.length !== 20);

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Background ambient glow */}
            <div className="absolute inset-0 pointer-events-none">
                <div className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[180px] ${isBundle ? 'bg-indigo-500/10' : 'bg-emerald-500/10'}`} />
                <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[140px] bg-indigo-500/5" />
            </div>

            <AnimatePresence>
                {showContent && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className="relative z-10 w-full max-w-md text-center space-y-8"
                    >
                        {/* Animated Checkmark */}
                        <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{
                                delay: 0.3,
                                type: 'spring',
                                stiffness: 200,
                                damping: 15,
                            }}
                            className={`mx-auto w-24 h-24 rounded-full border-2 flex items-center justify-center shadow-lg ${
                                isBundle 
                                    ? 'bg-indigo-500/15 border-indigo-500/30 shadow-lg shadow-indigo-500/10' 
                                    : 'bg-emerald-500/15 border-emerald-500/30 shadow-lg shadow-emerald-500/10'
                            }`}
                        >
                            <motion.div
                                initial={{ scale: 0, rotate: -90 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{
                                    delay: 0.5,
                                    type: 'spring',
                                    stiffness: 250,
                                    damping: 20,
                                }}
                            >
                                <CheckCircle size={52} className={isBundle ? 'text-indigo-400' : 'text-emerald-400'} strokeWidth={1.5} />
                            </motion.div>
                        </motion.div>

                        {/* Text Content */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.7, duration: 0.5 }}
                            className="space-y-3"
                        >
                            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                                {isBundle ? 'Bundle Purchased!' : 'Payment Confirmed'}
                            </h1>
                            <p className="text-base text-slate-400 max-w-sm mx-auto leading-relaxed">
                                {isBundle 
                                    ? 'Your Multi-Pool Bundle hosting credits have been successfully added to your account! You can now use them to create or activate premium pools.'
                                    : 'Your pool is now fully active! All premium features have been unlocked and are ready to use.'
                                }
                            </p>
                        </motion.div>

                        {/* Session Info (subtle) */}
                        {sessionId && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.9, duration: 0.4 }}
                                className="text-[10px] text-slate-600 font-mono truncate px-4"
                            >
                                Session: {sessionId}
                            </motion.div>
                        )}

                        {/* CTA Button */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 1.0, duration: 0.5 }}
                        >
                            <Link
                                to={isBundle ? '/' : poolId ? `/pool/${poolId}` : '/'}
                                className={`inline-flex items-center gap-2 px-8 py-3.5 text-white font-bold rounded-xl text-sm transition-all shadow-lg hover:scale-105 ${
                                    isBundle 
                                        ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-650 hover:to-purple-700 shadow-indigo-500/10 hover:shadow-indigo-500/20' 
                                        : 'bg-gradient-to-r from-emerald-500 to-indigo-600 hover:from-emerald-600 hover:to-indigo-700 shadow-emerald-500/10 hover:shadow-emerald-500/20'
                                }`}
                            >
                                {isBundle ? 'Go to My Dashboard' : 'Go to Pool Dashboard'}
                                <ArrowRight size={16} />
                            </Link>
                        </motion.div>

                        {/* Subtle radial pulse behind the checkmark */}
                        <motion.div
                            className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full -z-10 ${isBundle ? 'bg-indigo-400/5' : 'bg-emerald-400/5'}`}
                            animate={{
                                scale: [1, 1.4, 1],
                                opacity: [0.3, 0, 0.3],
                            }}
                            transition={{
                                duration: 3,
                                repeat: Infinity,
                                ease: 'easeInOut',
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
