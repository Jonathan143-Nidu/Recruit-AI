
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HistoryPage() {
    const router = useRouter();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchHistory = async () => {
            try {
                const response = await fetch('/api/history');
                const data = await response.json();
                if (data.history) {
                    setHistory(data.history);
                }
            } catch (error) {
                console.error("Failed to load history:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchHistory();
    }, []);

    const handleViewDetails = (item) => {
        // Save history item to session storage to replay it
        sessionStorage.setItem('matchJobDescription', item.jd);
        sessionStorage.setItem('matchResults', JSON.stringify(item.results));

        // Results contain candidate info, so we can likely reuse it for candidates
        // But match-results page expects separate 'candidates' in session storage.
        // We'll just filter item.results to extract basic candidate info if needed,
        // OR simply rely on 'results' being present in match-results page logic.
        // match-results page logic:
        // if (storedResults) setResults(...)
        // And rendering iterates 'results'. So we might not strictly need 'selectedCandidatesForMatch'.
        // BUT, if the user hits "Analyze" again on that page, it uses 'candidates'.
        // So we should reconstruct candidates from results.

        const reconstructedCandidates = item.results.map(r => ({
            Name: r.Name,
            Role: r.Role,
            "Years of Experience": r["Years of Experience"],
            Visa: r.Visa,
            Email: r.Email,
            Phone: r.Phone,
            Resume: r.Resume,
            LinkedIn: r.LinkedIn
        }));
        sessionStorage.setItem('selectedCandidatesForMatch', JSON.stringify(reconstructedCandidates));

        router.push('/match-results');
    };

    return (
        <div style={{ padding: '16px', fontFamily: 'Inter, sans-serif', maxWidth: '100%', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>📜 Analysis History</h1>
                <button
                    onClick={() => router.back()}
                    style={{ padding: '8px 16px', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', background: 'white' }}
                >
                    ← Back to Dashboard
                </button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Loading history...</div>
            ) : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <p style={{ color: '#64748b' }}>No analysis history found yet.</p>
                </div>
            ) : (
                <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                            <tr>
                                <th style={{ padding: '16px', width: '20%' }}>Processed By</th>
                                <th style={{ padding: '16px', width: '20%' }}>Date & Time</th>
                                <th style={{ padding: '16px' }}>Job Role (JD Summary)</th>
                                <th style={{ padding: '16px', textAlign: 'center' }}>Candidates</th>
                                <th style={{ padding: '16px', textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((item) => (
                                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s' }} className="hover:bg-slate-50">
                                    <td style={{ padding: '16px', color: '#334155', fontWeight: '500' }}>
                                        {item.processedBy || 'N/A'}
                                    </td>
                                    <td style={{ padding: '16px', color: '#64748b' }}>
                                        {new Date(item.timestamp).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '16px', fontWeight: '500', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {/* Truncate JD to first line or 50 chars */}
                                        {item.jd.split('\n')[0].substring(0, 60)}...
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '4px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                                            {item.count} Processed
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        <button
                                            onClick={() => handleViewDetails(item)}
                                            style={{
                                                padding: '8px 16px',
                                                background: '#2563eb',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontWeight: '500',
                                                fontSize: '13px'
                                            }}
                                        >
                                            View Report
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
