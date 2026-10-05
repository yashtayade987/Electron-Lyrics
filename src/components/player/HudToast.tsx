import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export const HudToast: React.FC = () => {
    const { hudMessage } = useAppStore();

    if (!hudMessage) return null;

    return (
        <div className="macos-hud-toast" role="status" aria-live="polite">
            <span className="hud-toast-text">{hudMessage}</span>
        </div>
    );
};
