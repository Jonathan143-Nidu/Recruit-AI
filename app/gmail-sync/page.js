'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function GmailSyncPage() {
    const router = useRouter();
    const { data: session, status } = useSession();

    // --- Search State ---
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    const [subject, setSubject] = useState('Java');

    // --- Destination Settings ---
    const [destType, setDestType] = useState('new'); // 'new' | 'existing'
    const [newFolderName, setNewFolderName] = useState('Java');
    const [existingFolderId, setExistingFolderId] = useState('');
    const [existingFolders, setExistingFolders] = useState([]);
    const [isLoadingFolders, setIsLoadingFolders] = useState(false);

    // --- Results & Processing ---
    const [candidates, setCandidates] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [logs, setLogs] = useState([]);

    // --- Elite Traffic Controller (Mismatches) ---
    const [mismatches, setMismatches] = useState([]);
    const [showReview, setShowReview] = useState(false);

    // Auth Redirect
    useEffect(() => {
        if (status === 'unauthenticated') router.push('/login');
        if (status === 'authenticated') loadFolders();
    }, [status, router]);

    const loadFolders = async () => {
        setIsLoadingFolders(true);
        try {
            const res = await fetch('/api/drive/folders');
            const data = await res.json();
            if (data.folders) setExistingFolders(data.folders);
        } catch (e) {
            console.error("Folders failed:", e);
        } finally {
            setIsLoadingFolders(false);
        }
    };

    const handleSearch = async () => {
        setIsSearching(true);
        setCandidates([]);
        setLogs(["Starting Gmail scan...", `Criteria: SUBJECT="${subject}"`, `Range: ${startDate} to ${endDate}`]);
        try {
            const res = await fetch('/api/gmail/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, endDate, subject })
            });
            const data = await res.json();
            if (data.success) {
                setCandidates(data.candidates || []);
                const logs = [`Found ${data.totalFoundInGmail || 0} matching in Gmail.`];
                if (data.totalFilterExcluded > 0) logs.push(`Excluded ${data.totalFilterExcluded} already processed.`);
                logs.push(`Ready for sync: ${data.candidatesCount || 0}`);
                setLogs(prev => [...prev.slice(-10), ...logs]);
            }
        } catch (e) {
            console.error("Search failed:", e);
            setLogs(prev => [...prev.slice(-10), "Error: Scan failed."]);
        } finally {
            setIsSearching(false);
        }
    };

    const checkMismatch = (detected, target) => {
        if (!detected || !target) return false;
        return !detected.toLowerCase().includes(target.toLowerCase());
    };

    const handleProcessAll = async () => {
        if (candidates.length === 0 || isProcessing) return;
        setIsProcessing(true);
        setMismatches([]);
        
        const currentCandidates = [...candidates];
        let resolvedFolderId = existingFolderId;

        // Auto-create folder if needed
        if (destType === 'new' && newFolderName) {
            try {
                const scout = await fetch('/api/drive/ensure-folder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderName: newFolderName })
                });
                const sData = await scout.json();
                if (sData.folderId) resolvedFolderId = sData.folderId;
            } catch (e) {
                console.error("Scout error:", e);
            }
        }

        const batchSize = 10;
        for (let i = 0; i < currentCandidates.length; i += batchSize) {
            const batch = currentCandidates.slice(i, i + batchSize);
            setLogs(prev => [...prev.slice(-10), `Processing batch ${Math.floor(i/batchSize) + 1}...`]);
            const promises = batch.map(async (cand, idx) => {
                const globalIdx = i + idx;
                
                // [FIX] Staggered start to prevent API rate limit spikes (800ms per candidate in batch)
                await new Promise(resolve => setTimeout(resolve, idx * 800));
                
                setLogs(prev => [...prev.slice(-10), `Processing: ${cand.from.split('<')[0].trim() || 'Candidate'}`]);
                try {
                    const res = await fetch('/api/gmail/process-single', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messageId: cand.id,
                            emailDate: cand.date,
                            targetFolderId: resolvedFolderId,
                            targetFolderName: resolvedFolderId ? '' : newFolderName
                        })
                    });
                    const result = await res.json();
                    if (result.success) {
                        const info = result.details?.[0]?.candidate || {};
                        setLogs(prev => [...prev.slice(-10), `Analyzed: ${info.Name || 'Unknown'}`]);
                        const targetLabel = destType === 'new' ? newFolderName : (existingFolders.find(f => f.id === existingFolderId)?.name || 'Target');
                        
                        if (info.Role && checkMismatch(info.Role, targetLabel)) {
                            const mismatch = {
                                id: Math.random().toString(36).substr(2, 9),
                                candidate: info.Name || 'Unknown',
                                foundRole: info.Role,
                                folderLink: result.details?.[0]?.folder || result.folder,
                                targetType: 'new',
                                targetValue: info.Role.split('(')[0].trim(),
                                status: 'queued'
                            };
                            setMismatches(prev => [...prev, mismatch]);
                        }

                        currentCandidates[globalIdx].fullData = info;
                        currentCandidates[globalIdx].folder = result.details?.[0]?.folder || result.folder;
                        currentCandidates[globalIdx].error = false;
                    } else {
                        currentCandidates[globalIdx].error = true;
                        setLogs(prev => [...prev.slice(-10), `Error: ${cand.from.split('<')[0].trim()} failed.`]);
                    }
                } catch (e) {
                    console.error("Process error:", e);
                    currentCandidates[globalIdx].error = true;
                    setLogs(prev => [...prev.slice(-10), `Network Error: ${cand.from.split('<')[0].trim()}`]);
                } finally {
                    // [FIX] ALWAYS mark as processed so the progress tracker reaches 100%
                    currentCandidates[globalIdx].processed = true;
                    setCandidates([...currentCandidates]);
                }
            });
            await Promise.all(promises);
        }

        // [LOG TO HISTORY] Record this sync session in the Analysis History table
        try {
            const finalCount = currentCandidates.filter(c => c.processed).length;
            if (finalCount > 0) {
                await fetch('/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jd: `GMAIL SYNC: "${subject}" (${startDate} to ${endDate})`,
                        count: finalCount,
                        results: currentCandidates.filter(c => c.processed).map(c => ({
                            Name: c.fullData?.Name || 'Unknown',
                            Role: c.fullData?.Role || subject,
                            Email: c.fullData?.Email || c.from,
                            Phone: c.fullData?.Phone || 'N/A',
                            Resume: c.folder,
                            LinkedIn: c.fullData?.LinkedIn || '',
                            "Years of Experience": c.fullData?.["Years of Experience"] || 'N/A',
                            Visa: c.fullData?.Visa || 'N/A'
                        })),
                        processedBy: session?.user?.email || 'Unknown User'
                    })
                });
                setLogs(prev => [...prev.slice(-10), "Sync session logged to History."]);
            }
        } catch (hErr) {
            console.error("Failed to log history:", hErr);
        }

        setIsProcessing(false);
        if (mismatches.length > 0) setShowReview(true);
    };

    const handleBulkMove = async () => {
        setIsProcessing(true);
        const list = [...mismatches];
        const moves = list.map(async (m, i) => {
            if (m.status === 'done') return;
            list[i].status = 'moving';
            setMismatches([...list]);
            try {
                const res = await fetch('/api/drive/move', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folderLink: m.folderLink, targetFolderName: m.targetValue })
                });
                const data = await res.json();
                list[i].status = data.success ? 'done' : 'error';
            } catch {
                list[i].status = 'error';
            }
            setMismatches([...list]);
        });
        await Promise.all(moves);
        setIsProcessing(false);
        if (list.every(x => x.status === 'done')) setTimeout(() => setShowReview(false), 2000);
    };

    const processedCount = candidates.filter(c => c.processed).length;
    const progressPercent = candidates.length > 0 ? Math.round((processedCount / candidates.length) * 100) : 0;

    return (
        <div style={{ background: '#ffffff', height: '100vh', fontFamily: '"Outfit", "Inter", sans-serif', color: '#1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap');
                .btn { transition: all 0.2s; cursor: pointer; border: none; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: inherit; }
                .btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); }
                .btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .card { background: white; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
                .sidebar-panel { width: 320px; border-right: 1px solid #e2e8f0; background: #f8fafc; padding: 20px 14px; display: flex; flex-direction: column; gap: 16px; height: calc(100vh - 72px); overflow: auto; overflow-x: hidden; }
                .input-field { width: 100%; background: white; border: 1px solid #cbd5e1; color: #1e293b; padding: 8px 12px; border-radius: 8px; outline: none; transition: all 0.2s; font-size: 14px; font-family: inherit; box-sizing: border-box; }
                .input-field:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1); }
                .selection-tile { padding: 12px; border: 2px solid #e2e8f0; border-radius: 12px; cursor: pointer; background: white; transition: all 0.2s; width: 100%; box-sizing: border-box; }
                .selection-tile.active { border-color: #6366f1; background: #f5f7ff; }
                .badge { padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; border: 1px solid transparent; text-decoration: none; display: inline-block; }
                .animate-pulse { animation: pulse 2s infinite; }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            `}</style>

            {/* TOP NAVIGATION */}
            <div style={{ height: '72px', borderBottom: '1px solid #e2e8f0', padding: '0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '36px', height: '36px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '800' }}>G</div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Batch Gmail Sync</h1>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>Clean Ingestion Engine</div>
                    </div>
                </div>
                <button onClick={() => router.push('/')} className="btn" style={{ background: '#f1f5f9', color: '#475569', padding: '8px 18px', borderRadius: '10px', fontSize: '13px' }}>Back to Dashboard</button>
            </div>

            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* LEFT SIDEBAR */}
                <div className="sidebar-panel">
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', margin: 0 }}>Folder Setting</label>
                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '2px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                <button onClick={() => setDestType('new')} style={{ padding: '4px 12px', borderRadius: '6px', border: 'none', fontSize: '10px', fontWeight: '800', cursor: 'pointer', background: destType === 'new' ? 'white' : 'transparent', color: destType === 'new' ? '#6366f1' : '#64748b', boxShadow: destType === 'new' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s' }}>NEW</button>
                                <button onClick={() => setDestType('existing')} style={{ padding: '4px 12px', borderRadius: '6px', border: 'none', fontSize: '10px', fontWeight: '800', cursor: 'pointer', background: destType === 'existing' ? 'white' : 'transparent', color: destType === 'existing' ? '#6366f1' : '#64748b', boxShadow: destType === 'existing' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none', transition: 'all 0.2s' }}>EXISTING</button>
                            </div>
                        </div>
                        <div style={{ background: 'white', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                            {destType === 'new' ? (
                                <input type="text" placeholder="Folder Name..." value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} className="input-field" />
                            ) : (
                                <select value={existingFolderId} onChange={(e) => setExistingFolderId(e.target.value)} disabled={isLoadingFolders} className="input-field">
                                    <option value="">-- Select Existing Folder --</option>
                                    {existingFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                            )}
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Subject Line</label>
                            <input type="text" placeholder="e.g. Java Screening" value={subject} onChange={(e) => setSubject(e.target.value)} className="input-field" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '8px' }}>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>From</label>
                                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" />
                            </div>
                            <div>
                                <label style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>To</label>
                                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" />
                            </div>
                        </div>
                    </div>

                    <button onClick={handleSearch} disabled={isSearching || isProcessing} className="btn" style={{ width: '100%', padding: '12px', background: '#6366f1', color: 'white', borderRadius: '12px', fontSize: '14px' }}>
                        {isSearching ? 'Scanning...' : 'Scan Inbox 🔎'}
                    </button>

                    {(isProcessing || progressPercent > 0) && (
                        <div style={{ marginTop: 'auto', padding: '16px 4px 8px', borderTop: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '10px' }}>
                                <div>
                                    <div style={{ fontSize: '10px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>AI Analysis in Progress</div>
                                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b' }}>Processing: {processedCount} of {candidates.length} candidates</div>
                                </div>
                                <div style={{ fontSize: '18px', fontWeight: '900', color: '#6366f1', lineHeight: '1' }}>{progressPercent}%</div>
                            </div>
                            <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '30px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', background: 'linear-gradient(90deg, #6366f1, #a855f7)', width: `${progressPercent}%`, transition: 'width 0.5s ease-out' }}></div>
                            </div>
                        </div>
                    )}

                    {/* MINI TERMINAL */}
                    <div style={{ marginTop: 'auto', background: '#0f172a', borderRadius: '12px', padding: '12px', height: '140px', overflowY: 'auto', border: '1px solid #1e293b', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', fontWeight: '800', marginBottom: '8px', borderBottom: '1px solid #1e293b', paddingBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Live Analysis</span>
                            <span style={{ color: '#10b981' }}>● ONLINE</span>
                        </div>
                        {logs.length === 0 ? (
                            <div style={{ color: '#475569', fontSize: '11px', fontStyle: 'italic' }}>Waiting for sync triggers...</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {logs.map((log, i) => (
                                    <div key={i} style={{ color: '#cbd5e1', fontSize: '10px', fontFamily: '"Fira Code", monospace', lineHeight: '1.4' }}>
                                        <span style={{ color: '#6366f1' }}>$</span> {log}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* MAIN AREA */}
                <div style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                        <div>
                            <h2 style={{ fontSize: '24px', fontWeight: '800', margin: 0 }}>Sync Targets</h2>
                            <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0' }}>{candidates.length} potential candidates detected.</p>
                        </div>
                        <button onClick={handleProcessAll} disabled={candidates.length === 0 || isProcessing || isSearching} className="btn" style={{ padding: '12px 28px', background: '#10b981', color: 'white', borderRadius: '12px', fontSize: '14px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)' }}>
                            {isProcessing ? 'Processing Batch...' : 'Begin Batch Ingestion 🚀'}
                        </button>
                    </div>

                    {candidates.length === 0 && !isSearching ? (
                        <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderRadius: '24px', border: '2px dashed #e2e8f0', color: '#64748b' }}>
                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📬</div>
                            <div style={{ fontSize: '17px', fontWeight: '700' }}>Inbox is clean.</div>
                            <p style={{ fontSize: '14px', marginTop: '8px' }}>Use the side panel to scan your Gmail.</p>
                        </div>
                    ) : (
                        <div className="card" style={{ overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                        <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>Candidate / Role</th>
                                        <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>Contact</th>
                                        <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0' }}>Links</th>
                                        <th style={{ padding: '16px 24px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {candidates.map((c) => {
                                        const d = c.fullData || {};
                                        const rowBackground = c.error ? '#fef2f2' : (c.processed ? '#f0fdf4' : 'transparent');
                                        return (
                                            <tr key={c.id} style={{ background: rowBackground, borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '20px 24px' }}>
                                                    <div style={{ fontWeight: '700', color: '#1e293b' }}>{d.Name || 'Detecting...'}</div>
                                                    <div style={{ fontSize: '12px', color: '#64748b' }}>{d.Role || c.subject}</div>
                                                </td>
                                                <td style={{ padding: '20px 24px' }}>
                                                    <div style={{ fontSize: '13px', fontWeight: '600' }}>{d.Email || c.from}</div>
                                                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{d.Phone || 'Pending...'}</div>
                                                </td>
                                                <td style={{ padding: '20px 24px' }}>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {c.processed && !c.error ? (
                                                            <>
                                                                <a href={c.folder} target="_blank" className="badge" style={{ color: '#10b981', background: '#ecfdf5' }}>DRIVE</a>
                                                                {d.LinkedIn && <a href={d.LinkedIn} target="_blank" className="badge" style={{ color: '#6366f1', background: '#f5f7ff' }}>LINKEDIN</a>}
                                                            </>
                                                        ) : (
                                                            <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>
                                                                {c.error ? 'Sync failed' : 'Pending sync...'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '20px 24px', textAlign: 'center' }}>
                                                    {c.error ? (
                                                        <span className="badge" style={{ color: '#ef4444', background: '#fef2f2' }}>FAILED ❌</span>
                                                    ) : c.processed ? (
                                                        <span className="badge" style={{ color: '#10b981', background: '#dcfce7' }}>SYNCED ✅</span>
                                                    ) : (
                                                        <span className="badge" style={{ color: '#94a3b8', background: '#f8fafc' }}>READY</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* REDIRECT CONTROLLER MODAL */}
            {showReview && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px' }}>
                    <div className="card" style={{ width: '100%', maxWidth: '900px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '24px 32px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '12px 12px 0 0' }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800' }}>🚦 Elite Traffic Controller</h2>
                                <p style={{ margin: '4px 0 0', opacity: 0.9, fontSize: '13px' }}>{mismatches.length} role-mismatches found.</p>
                            </div>
                            <button onClick={() => setShowReview(false)} className="btn" style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', borderRadius: '10px' }}>Close</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                                    <tr>
                                        <th style={{ padding: '16px 32px', textAlign: 'left', fontSize: '11px', fontWeight: '800', color: '#64748b' }}>Candidate</th>
                                        <th style={{ padding: '16px 32px', textAlign: 'left', fontSize: '11px', fontWeight: '800', color: '#64748b' }}>Route To</th>
                                        <th style={{ padding: '16px 32px', textAlign: 'center', fontSize: '11px', fontWeight: '800', color: '#64748b' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {mismatches.map((m, idx) => (
                                        <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '20px 32px' }}>
                                                <div style={{ fontWeight: '700' }}>{m.candidate}</div>
                                                <div style={{ fontSize: '12px', color: '#6366f1' }}>{m.foundRole}</div>
                                            </td>
                                            <td style={{ padding: '20px 32px' }}>
                                                <input type="text" value={m.targetValue} onChange={(e) => { const n = [...mismatches]; n[idx].targetValue = e.target.value; setMismatches(n); }} className="input-field" />
                                            </td>
                                            <td style={{ padding: '20px 32px', textAlign: 'center' }}>
                                                <span className="badge" style={{ color: m.status === 'done' ? '#10b981' : '#6366f1' }}>{m.status.toUpperCase()}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '24px 32px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
                            <button onClick={handleBulkMove} disabled={isProcessing} className="btn" style={{ padding: '12px 32px', background: '#1e293b', color: 'white', borderRadius: '10px' }}>Apply Redirects 🚀</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
