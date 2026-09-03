import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
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
        <div className="min-h-screen bg-navy-950 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Background ambient glow */}
            <div className="absolute inset-0 pointer-events-none">
                <div className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[180px] ${isBundle ? 'bg-gold-500/10' : 'bg-[#0F7B4A]/15'}`} />
                <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[140px] bg-gold-500/5" />
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
                                    ? 'bg-gold-500/15 border-gold-500/40 shadow-lg shadow-gold-500/10'
                                    : 'bg-[#0F7B4A]/20 border-[#0F7B4A]/50 shadow-lg shadow-[#0F7B4A]/15'
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
                                <CheckCircle size={52} className={isBundle ? 'text-gold-400' : 'text-[#4CC38A]'} strokeWidth={1.5} />
                            </motion.div>
                        </motion.div>

                        {/* Text Content */}
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.7, duration: 0.5 }}
                            className="space-y-3"
                        >
                            <h1 className="text-3xl md:text-4xl font-display font-extrabold uppercase leading-none text-white">
                                {isBundle ? 'Bundle Purchased!' : 'Payment Confirmed'}
                            </h1>
                            <p className="text-base font-body text-[#9FB0CC] max-w-sm mx-auto leading-relaxed">
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
                                className="text-[10px] text-[#9FB0CC]/50 font-mono truncate px-4"
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
                                className="inline-flex items-center gap-2 px-8 py-3.5 text-white font-display font-bold uppercase tracking-[0.05em] rounded-md text-sm transition duration-150 hover:-translate-y-px bg-brandred-600 hover:bg-brandred-500 shadow-[0_6px_16px_rgba(196,52,46,0.28)]"
                            >
                                {isBundle ? 'Go to My Dashboard' : 'Go to Pool Dashboard'}
                                <ArrowRight size={16} />
                            </Link>
                        </motion.div>

                        {/* Subtle radial pulse behind the checkmark */}
                        <motion.div
                            className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full -z-10 ${isBundle ? 'bg-gold-400/5' : 'bg-[#0F7B4A]/10'}`}
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
