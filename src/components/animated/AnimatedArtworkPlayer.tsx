import React from 'react';
import { Header } from '../player/Header';

export const AnimatedArtworkPlayer: React.FC = () => {
    return (
        <div className="animated-artwork-top-player" role="region" aria-label="Playback controls">
            <Header />
        </div>
    );
};
