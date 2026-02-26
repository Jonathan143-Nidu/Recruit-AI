import React, { useState, useEffect } from 'react';

/**
 * LIVE PROGRESS TRACKER (Draft Concept)
 * 
 * This is a standalone component designed to replace the "Blank Screen" 
 * during the analysis phase. It provides visual feedback to the user.
 * 
 * HOW IT WORKS (Future Implementation):
 * 1. When 'Working' starts, this component is displayed.
 * 2. It listens to a 'status' stream or updates from the main page.
 * 3. It displays a progress bar and a "Console-style" log of activities.
 */

const LiveProgressTracker = ({ totalCandidates, processedCount, currentStatus, details }) => {
    const progress = Math.round((processedCount / totalCandidates) * 100) || 0;
    const logRef = React.useRef(null);

    // Auto-scroll to bottom of logs
    React.useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [details]);

    return (
        <div style={{
            padding: '40px',
            background: '#f8fafc',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            fontFamily: '"Inter", sans-serif'
        }}>
            {/* Header Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '800', color: '#1e293b' }}>
                        AI Analysis in Progress
                    </h2>
                    <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '14px' }}>
                        Processing: {processedCount} of {totalCandidates} candidates
                    </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '32px', fontWeight: '900', color: '#6366f1' }}>{progress}%</span>
                </div>
            </div>

            {/* Main Progress Bar */}
            <div style={{
                width: '100%',
                height: '12px',
                background: '#e2e8f0',
                borderRadius: '10px',
                overflow: 'hidden'
            }}>
                <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #6366f1 0%, #a855f7 100%)',
                    transition: 'width 0.5s ease-out',
                    boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)'
                }} />
            </div>

            {/* Live Activity Feed (The "Terminal" Look) */}
            <div
                ref={logRef}
                style={{
                    flex: 1,
                    background: '#0f172a',
                    borderRadius: '16px',
                    padding: '24px',
                    color: '#34d399', // Emerald green text
                    fontFamily: '"Fira Code", "Courier New", monospace',
                    fontSize: '12px',
                    overflowY: 'auto',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                    border: '1px solid #1e293b',
                    whiteSpace: 'pre-wrap', // Essential for Raw AI Response formatting
                    lineHeight: '1.6'
                }}
            >
                {details && details.length > 0 ? details.map((log, i) => (
                    <div key={i} style={{ marginBottom: '12px', borderBottom: '1px solid rgba(52, 211, 153, 0.1)', paddingBottom: '8px' }}>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '4px' }}>
                            <span style={{ color: '#94a3b8', opacity: 0.8, fontSize: '10px' }}>[{log.time}]</span>
                            <span style={{ color: log.type === 'success' ? '#34d399' : '#f43f5e', fontWeight: '800', letterSpacing: '0.5px', fontSize: '10px' }}>
                                {log.type.toUpperCase()}
                            </span>
                        </div>
                        <div style={{ color: log.type === 'report' ? '#e2e8f0' : '#34d399' }}>
                            {typeof log.message === 'object' ? JSON.stringify(log.message, null, 2) : log.message}
                        </div>
                    </div>
                )) : (
                    <div style={{ opacity: 0.5 }}>Waiting for AI Engine signals...</div>
                )}

                <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="status-pulse" style={{ width: '8px', height: '8px', background: '#34d399', borderRadius: '50%' }} />
                    <span style={{ fontWeight: 'bold' }}>{currentStatus || 'Processing...'}</span>
                </div>
            </div>

            {/* Information Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>Performance Mode</div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>Turbo Batch (7 Core)</div>
                </div>
                <div style={{ background: '#fff', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>Accuracy Engine</div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>Inch-to-Inch Reasoning</div>
                </div>
            </div>

            <style>{`
                .status-pulse {
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse {
                    0% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.4; transform: scale(1.1); }
                    100% { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
};

export default LiveProgressTracker;
