import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';

export const AnimatedArtworkAlbum: React.FC = () => {
    const { currentSong } = useAppStore();
    const coverArt = currentSong.coverArt;

    if (!coverArt) return null;

    return (
        <div className="animated-artwork-album-wrapper" role="presentation">
            <AnimatePresence mode="wait">
                <motion.div
                    key={coverArt}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="animated-artwork-album-card"
                >
                    <img
                        src={coverArt}
                        alt={`${currentSong.title} cover`}
                        className="animated-artwork-album-img"
                        draggable={false}
                    />
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
