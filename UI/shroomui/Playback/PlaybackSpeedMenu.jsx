import React from 'react';

const SPEEDS = ['0.5', '1.0', '2.0', '4.0'];

export default function PlaybackSpeedMenu({ value, onChange }) {
    return (
        <div>
            {SPEEDS.map((speed) => (
                <div
                    key={speed}
                    className="cursor"
                    style={{
                        color: value === speed ? '#0072EF' : '#E6EBF0',
                        fontWeight: 500,
                        padding: '4px 2px',
                    }}
                    onClick={() => onChange(speed)}
                >
                    {speed}X
                </div>
            ))}
        </div>
    );
}

export { SPEEDS };
