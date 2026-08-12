import React from 'react';
import { CaretRightOutlined, PauseOutlined } from '@ant-design/icons';

export default function PlaybackPlayToggle({ isPaused, onPlay, onStop }) {
    return (
        <div className="playOrStop">
            {isPaused ? (
                <CaretRightOutlined
                    className="cursor"
                    aria-label="播放"
                    role="button"
                    onClick={onPlay}
                />
            ) : (
                <PauseOutlined
                    className="cursor"
                    aria-label="暂停"
                    role="button"
                    onClick={onStop}
                />
            )}
        </div>
    );
}
