'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import LiveProgressTracker from '@/components/LiveProgressTracker';

export default function GmailSyncPage() {
    const router = useRouter();
    const { data: session, status } = useSession();

    // Search State
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7); // Default to last 7 days
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [subject, setSubject] = useState('Java'); // Default provided by user

    // Destination Settings
    const [destType, setDestType] = useState('new'); // 'new' or 'existing'
    const [newFolderName, setNewFolderName] = useState('Java'); // Match subject by default
    const [existingFolderId, setExistingFolderId] = useState('');
    const [existingFolders, setExistingFolders] = useState([]);
    const [isLoadingFolders, setIsLoadingFolders] = useState(false);

    useEffect(() => {
        if (status === 'authenticated') {
            loadFolders();
        }
    }, [status]);

    const loadFolders = async () => {
        setIsLoadingFolders(true);
        try {
            const res = await fetch('/api/drive/folders');
            const data = await res.json();
            if (data.folders) setExistingFolders(data.folders);
        } catch (e) {
            console.error("Failed to load folders:", e);
        }
        setIsLoadingFolders(false);
    };

    // Results State
    const [candidates, setCandidates] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSyncingAll, setIsSyncingAll] = useState(false);
    const [processedCount, setProcessedCount] = useState(0);

    // Review Window (Mismatches)
    const [mismatches, setMismatches] = useState([]); // { candidate, suggestedRole }
    const [showReview, setShowReview] = useState(false);

    const checkMismatch = (detectedRole, targetRole) => {
        if (!targetRole || !detectedRole) return false;
        const target = targetRole.toLowerCase();
        const detected = detectedRole.toLowerCase();
        return !detected.includes(target); // Basic fuzzy check
    };

    // Terminal State
    const [logs, setLogs] = useState([
        { time: new Date().toLocaleTimeString(), type: 'success', message: '📡 Gmail Forensic Engine Ready.' }
    ]);

    // Redirect if not logged in
    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        }
    }, [status, router]);

    const handleSearch = async () => {
        setIsSearching(true);
        setCandidates([]);
        setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            type: 'info',
            message: `🔍 Scanning Gmail from ${startDate} to ${endDate}...`
        }]);

        try {
            const res = await fetch('/api/gmail/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate, subject })
            });
            const data = await res.json();

            if (data.success) {
                setCandidates(data.candidates || []);
                setLogs(prev => [...prev, {
                    time: new Date().toLocaleTimeString(),
                    type: 'success',
                    message: `✅ Found ${data.totalFound} messages. ${data.uniqueCount} are NEW candidates.`
                }]);
            } else {
                throw new Error(data.error || 'Search failed');
            }
        } catch (error) {
            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(),
                type: 'error',
                message: `❌ Search Error: ${error.message}`
            }]);
        } finally {
            setIsSearching(false);
        }
    };

    const handleProcessAll = async () => {
        if (candidates.length === 0) return;
        setIsProcessing(true);
        setMismatches([]);
        let localMismatches = [];

        setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            type: 'success',
            message: `🚀 Launching Scout & Batch Sync for ${candidates.length} candidates...`
        }]);

        const newCandidates = [...candidates];
        const batchSize = 10;
        let resolvedFolderId = existingFolderId || '';

        // [RULE 1] Scout first if it's a new folder
        if (destType === 'new' && newFolderName) {
            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(),
                type: 'info',
                message: `🔍 [Scout] Ensuring folder exists: ${newFolderName}...`
            }]);

            try {
                const scoutRes = await fetch('/api/drive/ensure-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderName: newFolderName })
                });
                const scoutData = await scoutRes.json();
                if (scoutData.folderId) {
                    resolvedFolderId = scoutData.folderId;
                    setLogs(prev => [...prev, {
                        time: new Date().toLocaleTimeString(),
                        type: 'success',
                        message: `🛡️ [Scout] Folder Confirmed! Starting Top-to-Bottom Batching...`
                    }]);
                }
            } catch (e) {
                console.error("Scout Failed:", e);
                setLogs(prev => [...prev, {
                    time: new Date().toLocaleTimeString(),
                    type: 'error',
                    message: `⚠️ Scout failed. Processing with best effort...`
                }]);
            }
        }

        // [RULE 2] Strict Top-to-Bottom Batching
        for (let i = 0; i < newCandidates.length; i += batchSize) {
            const currentBatch = newCandidates.slice(i, i + batchSize);

            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(),
                type: 'info',
                message: `⚡ Batch [${Math.floor(i / batchSize) + 1}/${Math.ceil(newCandidates.length / batchSize)}] (${currentBatch.length} resumes)...`
            }]);

            const batchPromises = currentBatch.map(async (cand, index) => {
                const globalIndex = i + index;
                // Minor staggering for network smoothness
                await new Promise(r => setTimeout(r, index * 150));

                try {
                    const res = await fetch('/api/gmail/process-single', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messageId: cand.id,
                            emailDate: cand.date,
                            targetFolderName: resolvedFolderId ? '' : newFolderName, // Only send name if ID failed
                            targetFolderId: resolvedFolderId,
                            keyOffset: globalIndex
                        })
                    });
                    const result = await res.json();

                    if (result.success && result.details) {
                        const primaryRes = result.details[0]?.candidate;
                        const sessionRole = destType === 'new' ? newFolderName : (existingFolders.find(f => f.id === existingFolderId)?.name || 'General');

                        if (primaryRes && checkMismatch(primaryRes.Role, sessionRole)) {
                            const foundRoleClean = primaryRes.Role ? primaryRes.Role.split('(')[0].trim() : 'Unknown';
                            const existingMatch = existingFolders.find(f =>
                                f.name.toLowerCase().includes(foundRoleClean.toLowerCase()) ||
                                foundRoleClean.toLowerCase().includes(f.name.toLowerCase())
                            );

                            const mismatchObj = {
                                id: Math.random().toString(36).substr(2, 9),
                                candidate: primaryRes.Name,
                                foundRole: primaryRes.Role || 'Unknown',
                                suggestedFolder: foundRoleClean,
                                folderLink: result.details[0]?.folder || result.folder,
                                targetType: existingMatch ? 'existing' : 'new',
                                targetValue: existingMatch ? existingMatch.name : foundRoleClean,
                                status: 'queued'
                            };

                            localMismatches.push(mismatchObj);
                            setMismatches(prev => [...prev, mismatchObj]);

                            setLogs(prev => [...prev, {
                                time: new Date().toLocaleTimeString(),
                                type: 'warning',
                                message: `👁️ Mismatch: ${primaryRes.Name} is a ${primaryRes.Role}.`
                            }]);
                        }
                    }

                    if (result.success) {
                        const primaryCandidate = result.details[0]?.candidate || {};
                        setLogs(prev => [...prev, {
                            time: new Date().toLocaleTimeString(),
                            type: 'success',
                            message: `✅ Saved: ${primaryCandidate.Name || 'Candidate'}.`
                        }]);
                        newCandidates[globalIndex].processed = true;
                        newCandidates[globalIndex].fullData = primaryCandidate;
                        newCandidates[globalIndex].folder = result.details[0]?.folder || result.folder;
                        setCandidates([...newCandidates]);
                    }
                } catch (error) {
                    console.error("Single Process Error:", error);
                }
            });

            await Promise.all(batchPromises);
        }

        setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            type: 'success',
            message: `🏁 Sync Finished! Processed ${newCandidates.length} candidates top-to-bottom.`
        }]);

        setIsProcessing(false);

        if (localMismatches.length > 0) {
            setLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(),
                type: 'info',
                message: `📢 Opening Elite Traffic Controller for ${localMismatches.length} mismatches...`
            }]);
            await loadFolders();
            setShowReview(true);
        }
    };

    const handleBulkMove = async () => {
        setIsProcessing(true);
        const list = [...mismatches];

        // [TURBO] Parallelize all move requests simultaneously
        const movePromises = list.map(async (m, i) => {
            if (m.status === 'done') return;

            // Update status to 'moving' instantly for each item
            list[i].status = 'moving';
            setMismatches([...list]);

            try {
                const res = await fetch('/api/drive/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        folderLink: m.folderLink,
                        targetFolderName: m.targetValue
                    })
                });
                const data = await res.json();

                if (data.success) {
                    list[i].status = 'done';
                } else {
                    list[i].status = 'error';
                }
            } catch (e) {
                list[i].status = 'error';
                console.error("[TURBO MOVE ERROR]:", e);
            }
            // Update UI state for each completed move
            setMismatches([...list]);
        });

        await Promise.all(movePromises);
        setIsProcessing(false);

        // Auto-close modal if everything finished successfully
        if (list.every(m => m.status === 'done')) {
            setTimeout(() => setShowReview(false), 2000);
        }
    };

    if (status === 'loading') return <div style={{ padding: '50px', textAlign: 'center' }}>Loading Session...</div>;

    return (
        <div style={{
            background: '#f8fafc',
            minHeight: '100vh',
            fontFamily: '"Inter", sans-serif',
            color: '#1e293b',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                .btn { transition: all 0.2s; cursor: pointer; border: none; font-weight: 700; }
                .btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.1); }
                .btn:active:not(:disabled) { transform: translateY(0); }
                .card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
                .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
            `}</style>

            {/* HEADER */}
            <div style={{
                background: '#0f172a',
                padding: '24px 40px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'white',
                borderBottom: '4px solid #6366f1'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '800', letterSpacing: '-0.5px' }}>📥 Batch Gmail Sync</h1>
                    <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>Ingest candidates directly from your inbox without the extension.</p>
                </div>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.2)',
                        padding: '10px 20px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        fontWeight: '700',
                        fontSize: '13px'
                    }}
                >
                    Back to Dashboard
                </button>
            </div>

            {/* Elite Traffic Controller Modal */}
            {showReview && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.8)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    padding: '20px'
                }}>
                    <div style={{
                        background: 'white',
                        width: '100%',
                        maxWidth: '900px',
                        borderRadius: '24px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        maxHeight: '85vh'
                    }}>
                        <div style={{
                            padding: '24px 32px',
                            background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                            color: 'white',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>🚦 Elite Traffic Controller</h2>
                                <p style={{ margin: '4px 0 0', opacity: 0.9, fontSize: '0.9rem' }}>
                                    Found {mismatches.length} candidates that don't match your search. Redirect them now.
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <button
                                    onClick={() => loadFolders()}
                                    disabled={isLoadingFolders}
                                    style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
                                >
                                    {isLoadingFolders ? '🔄' : 'Refresh Folders'}
                                </button>
                                <button
                                    onClick={() => setShowReview(false)}
                                    style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Decide Later
                                </button>
                            </div>
                        </div>

                        <div style={{ padding: '0', overflowY: 'auto', flex: 1 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ position: 'sticky', top: 0, background: '#f8fafc', zIndex: 10 }}>
                                    <tr>
                                        <th style={{ padding: '16px 32px', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Candidate / Found Role</th>
                                        <th style={{ padding: '16px 32px', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Redirect Destination</th>
                                        <th style={{ padding: '16px 32px', borderBottom: '1px solid #e2e8f0', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mismatches.map((m, idx) => (
                                        <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                                            <td style={{ padding: '20px 32px' }}>
                                                <div style={{ fontWeight: 700, color: '#1e293b' }}>{m.candidate}</div>
                                                <div style={{ fontSize: '0.85rem', color: '#6366f1', fontWeight: 600 }}>🔍 AI Says: {m.foundRole}</div>
                                            </td>
                                            <td style={{ padding: '20px 32px' }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <select
                                                        value={m.targetType}
                                                        onChange={(e) => {
                                                            const newList = [...mismatches];
                                                            newList[idx].targetType = e.target.value;
                                                            if (e.target.value === 'existing' && !existingFolders.some(f => f.name === m.targetValue)) {
                                                                newList[idx].targetValue = existingFolders[0]?.name || 'General';
                                                            }
                                                            setMismatches(newList);
                                                        }}
                                                        style={{ padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', outline: 'none' }}
                                                    >
                                                        <option value="existing">Existing Folder</option>
                                                        <option value="new">Create New</option>
                                                    </select>

                                                    {m.targetType === 'existing' ? (
                                                        <select
                                                            value={m.targetValue}
                                                            onChange={(e) => {
                                                                const newList = [...mismatches];
                                                                newList[idx].targetValue = e.target.value;
                                                                setMismatches(newList);
                                                            }}
                                                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', outline: 'none', flex: 1, fontWeight: 600 }}
                                                        >
                                                            {existingFolders.map(f => (
                                                                <option key={f.id} value={f.name}>{f.name}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={m.targetValue}
                                                            onChange={(e) => {
                                                                const newList = [...mismatches];
                                                                newList[idx].targetValue = e.target.value;
                                                                setMismatches(newList);
                                                            }}
                                                            placeholder="Folder Name..."
                                                            style={{ padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', outline: 'none', flex: 1, fontWeight: 600 }}
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ padding: '20px 32px', textAlign: 'center' }}>
                                                {m.status === 'queued' && <span style={{ padding: '4px 12px', background: '#f1f5f9', color: '#64748b', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>QUEUED</span>}
                                                {m.status === 'moving' && <span style={{ padding: '4px 12px', background: '#e0f2fe', color: '#0ea5e9', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }} className="animate-pulse">MOVING...</span>}
                                                {m.status === 'done' && <span style={{ padding: '4px 12px', background: '#dcfce7', color: '#16a34a', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>DONE ✅</span>}
                                                {m.status === 'error' && <span style={{ padding: '4px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700 }}>FAILED</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ padding: '24px 32px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                            <button
                                onClick={handleBulkMove}
                                disabled={isProcessing || mismatches.every(m => m.status === 'done')}
                                style={{
                                    padding: '12px 32px',
                                    background: '#1e293b',
                                    color: 'white',
                                    borderRadius: '12px',
                                    fontWeight: 700,
                                    border: 'none',
                                    cursor: (isProcessing || mismatches.every(m => m.status === 'done')) ? 'not-allowed' : 'pointer',
                                    opacity: (isProcessing || mismatches.every(m => m.status === 'done')) ? 0.6 : 1,
                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                                }}
                            >
                                {isProcessing ? 'Processing...' : 'Apply All Redirects 🚀'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ flex: 1, padding: '32px 40px', display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) 450px', gap: '32px', height: 'calc(100vh - 84px)', overflow: 'hidden' }}>

                {/* LEFT: COMMAND CENTER & RESULTS */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', overflow: 'hidden' }}>

                    {/* DESTINATION SETTINGS */}
                    <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', marginBottom: '16px', display: 'block' }}>📍 Destination Settings (Shared Drive)</label>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div
                                onClick={() => setDestType('new')}
                                style={{
                                    padding: '16px',
                                    border: `2px solid ${destType === 'new' ? '#6366f1' : '#e2e8f0'}`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    background: destType === 'new' ? '#f5f7ff' : 'white'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                    <input type="radio" checked={destType === 'new'} readOnly style={{ marginRight: '10px' }} />
                                    <span style={{ fontWeight: '700', fontSize: '14px' }}>Create New Folder</span>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Enter folder name (e.g. Java)"
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    disabled={destType !== 'new'}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '6px',
                                        fontSize: '13px'
                                    }}
                                />
                            </div>

                            <div
                                onClick={() => setDestType('existing')}
                                style={{
                                    padding: '16px',
                                    border: `2px solid ${destType === 'existing' ? '#6366f1' : '#e2e8f0'}`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    background: destType === 'existing' ? '#f5f7ff' : 'white'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                                    <input type="radio" checked={destType === 'existing'} readOnly style={{ marginRight: '10px' }} />
                                    <span style={{ fontWeight: '700', fontSize: '14px' }}>Move to Existing Folder</span>
                                </div>
                                <select
                                    value={existingFolderId}
                                    onChange={(e) => setExistingFolderId(e.target.value)}
                                    disabled={destType !== 'existing' || isLoadingFolders}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        border: '1px solid #cbd5e1',
                                        borderRadius: '6px',
                                        fontSize: '13px'
                                    }}
                                >
                                    <option value="">{isLoadingFolders ? 'Loading...' : '-- Select Folder --'}</option>
                                    {existingFolders.map(f => (
                                        <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* SEARCH CONTROLS */}
                    <div className="card" style={{ padding: '24px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.5fr) 1fr 1fr auto', gap: '16px', alignItems: 'flex-end' }}>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Subject Line to Search</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Gmail Data should fetch"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px' }}
                                />
                            </div>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px' }}
                                />
                            </div>
                            <button
                                className="btn"
                                onClick={handleSearch}
                                disabled={isSearching || isProcessing}
                                style={{
                                    background: '#6366f1',
                                    color: 'white',
                                    padding: '12px 30px',
                                    borderRadius: '10px',
                                    fontSize: '14px',
                                    opacity: (isSearching || isProcessing) ? 0.7 : 1
                                }}
                            >
                                {isSearching ? 'Scanning...' : 'Scan Inbox'}
                            </button>
                        </div>
                        <div style={{ marginTop: '12px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                            *Strictly scanning for emails with <strong>attachments</strong> matching your Subject line above.
                        </div>
                    </div>

                    {/* CANDIDATE LIST */}
                    <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <span style={{ fontWeight: '800', color: '#1e293b' }}>Sync Targets</span>
                                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                                    {candidates.length} Detected
                                </span>
                            </div>
                            <button
                                className="btn"
                                onClick={handleProcessAll}
                                disabled={candidates.length === 0 || isProcessing || isSearching}
                                style={{
                                    background: '#10b981',
                                    color: 'white',
                                    padding: '8px 20px',
                                    borderRadius: '8px',
                                    fontSize: '13px',
                                    boxShadow: '0 4px 10px rgba(16, 185, 129, 0.2)',
                                    opacity: (candidates.length === 0 || isProcessing) ? 0.5 : 1
                                }}
                            >
                                {isProcessing ? 'Processing Batch...' : 'Begin Batch Ingestion'}
                            </button>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                            {candidates.length === 0 ? (
                                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>💡</div>
                                    <p style={{ fontWeight: '600' }}>Waiting for scan results.</p>
                                    <p style={{ fontSize: '13px' }}>Emails must include: <strong>"Gmail Data should fetch"</strong></p>
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                                            <th style={{ textAlign: 'left', padding: '8px', color: '#64748b', textTransform: 'uppercase' }}>Candidate / Role</th>
                                            <th style={{ textAlign: 'left', padding: '8px', color: '#64748b', textTransform: 'uppercase', width: '40px' }}>Exp</th>
                                            <th style={{ textAlign: 'left', padding: '8px', color: '#64748b', textTransform: 'uppercase' }}>Contact</th>
                                            <th style={{ textAlign: 'left', padding: '8px', color: '#64748b', textTransform: 'uppercase' }}>Links</th>
                                            <th style={{ textAlign: 'center', padding: '8px', color: '#64748b', textTransform: 'uppercase', width: '60px' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {candidates.map((cand, idx) => {
                                            const data = cand.fullData || {};
                                            return (
                                                <tr key={cand.id} style={{ borderBottom: '1px solid #f1f5f9', background: cand.processed ? '#f0fdf4' : 'transparent' }}>
                                                    <td style={{ padding: '8px' }}>
                                                        <div style={{ fontWeight: '800', color: '#334155' }}>{data.Name || 'Awaiting Sync...'}</div>
                                                        <div style={{ fontSize: '10px', color: '#64748b' }}>{data.Role || cand.subject}</div>
                                                    </td>
                                                    <td style={{ padding: '8px', fontWeight: '700' }}>{data['Years of Experience'] || '—'}</td>
                                                    <td style={{ padding: '8px' }}>
                                                        <div style={{ fontWeight: '600', color: '#6366f1' }}>{data.Email || cand.from.split('<')[1]?.slice(0, -1) || cand.from}</div>
                                                        <div style={{ fontSize: '10px', color: '#64748b' }}>{data.Phone || 'N/A'}</div>
                                                    </td>
                                                    <td style={{ padding: '8px' }}>
                                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                            {cand.processed ? (
                                                                <>
                                                                    <a href={cand.folder} target="_blank" style={{ color: '#6366f1', textDecoration: 'none', border: '1px solid #e0e7ff', padding: '1px 4px', borderRadius: '3px' }}>Drive</a>
                                                                    {data.LinkedIn && <a href={data.LinkedIn} target="_blank" style={{ color: '#6366f1', textDecoration: 'none', border: '1px solid #e0e7ff', padding: '1px 4px', borderRadius: '3px' }}>LinkedIn</a>}
                                                                    <a href={`https://mail.google.com/mail/u/0/#inbox/${cand.threadId}`} target="_blank" style={{ color: '#64748b', textDecoration: 'none', border: '1px solid #f1f5f9', padding: '1px 4px', borderRadius: '3px' }}>Thread</a>
                                                                </>
                                                            ) : '—'}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '8px', textAlign: 'center' }}>
                                                        {cand.processed ? (
                                                            <span style={{ color: '#10b981', fontWeight: '900', fontSize: '9px', background: '#dcfce7', padding: '2px 4px', borderRadius: '3px' }}>DONE</span>
                                                        ) : (
                                                            <span style={{ color: '#6366f1', fontWeight: '700', fontSize: '9px', border: '1px solid #e0e7ff', padding: '2px 4px', borderRadius: '3px' }}>READY</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT: LIVE TERMINAL */}
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <div className="card" style={{ flex: 1, overflow: 'hidden', background: '#0f172a', border: '1px solid #334155' }}>
                        <LiveProgressTracker
                            isAnalyzing={isProcessing || isSearching}
                            analysisLogs={logs}
                            totalCandidates={candidates.length}
                            processedCount={candidates.filter(c => c.processed).length}
                        />
                    </div>
                </div>

            </div>
        </div>
    );
}
