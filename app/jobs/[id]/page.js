'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function JobDetailPage() {
    const { id } = useParams();
    const router = useRouter();

    const [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        async function load() {
            setLoading(true);
            try {
                const res = await fetch('/api/jobs');
                const data = await res.json();
                const found = data.find(j => j.jobId === id);
                if (found) setJob(found);
                else setNotFound(true);
            } catch { setNotFound(true); }
            setLoading(false);
        }
        if (id) load();
    }, [id]);

    const mailtoLink = job
        ? `mailto:careers@innovcentric.com?subject=Application: ${encodeURIComponent(job.title)} (${job.jobId})&body=${encodeURIComponent(
            `Hello Innovcentric Team,\n\nI am applying for the ${job.title} position (${job.jobId}).\n\nAttached / shared below are my documents:\n- Resume\n- Passport Number / Copy\n- Driving Licence / State ID / Gov ID\n- Visa Copy\n\nName:\nPhone:\nLinkedIn:\n\nThank you.`
        )}`
        : '#';

    return (
        <div style={{ minHeight: '100vh', background: '#f0f2f8', fontFamily: '"Inter", system-ui, sans-serif' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                * { box-sizing: border-box; margin: 0; padding: 0; }
                .back-btn:hover { background: #f1f5f9 !important; }
                .apply-link { transition: all 0.2s; }
                .apply-link:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(22,163,74,0.35) !important; }
                .jd-body { font-size: 12px; color: #374151; line-height: 1.45; }
                .jd-body p { margin-bottom: 3px; }
                .jd-body ul, .jd-body ol { padding-left: 18px; margin: 3px 0 6px; }
                .jd-body li { margin-bottom: 1px; }
                .jd-body b, .jd-body strong { color: #111827; font-weight: 700; }
                .jd-body h1,.jd-body h2,.jd-body h3 { color: #111827; margin: 10px 0 4px; font-weight: 700; font-size: 13px; }
            `}</style>


            {loading ? (
                <div style={{ textAlign: 'center', padding: '80px', color: '#9ca3af', fontSize: '14px' }}>Loading…</div>
            ) : notFound || !job ? (
                <div style={{ textAlign: 'center', padding: '80px 24px' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔍</div>
                    <div style={{ fontSize: '18px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>Job not found</div>
                    <button onClick={() => router.push('/jobs')} style={{ background: '#6366f1', color: 'white', border: 'none', padding: '9px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', marginTop: '10px' }}>View All Jobs</button>
                </div>
            ) : (
                <>
                    {/* ── HERO ── */}
                    <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4c1d95 100%)', padding: '14px 18px 12px', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', top: '12px', right: '16px', zIndex: 10 }}>
                            <button className="back-btn" onClick={() => router.push('/jobs')} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', transition: 'all 0.15s', backdropFilter: 'blur(10px)' }}>
                                ← All Jobs
                            </button>
                        </div>
                        <div style={{ position: 'absolute', top: '-60px', right: '-60px', width: '260px', height: '260px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
                        <div style={{ position: 'relative' }}>
                            {/* ID + Title row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '20px', padding: '2px 9px' }}>
                                    <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: job.status === 'Closed' ? '#94a3b8' : '#34d399' }} />
                                    <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: '0.5px' }}>{job.jobId} · {job.status?.toUpperCase() || 'OPEN'}</span>
                                </div>
                                <h1 style={{ fontSize: '18px', fontWeight: '900', color: 'white', lineHeight: 1.2, margin: 0 }}>{job.title}</h1>
                            </div>
                            {/* Badges */}
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                {[
                                    { icon: '💼', label: job.type },
                                    { icon: '🏢', label: job.workMode || 'Remote' },
                                    { icon: '📍', label: job.location },
                                    job.rate && { icon: '💰', label: job.rate },
                                    job.exp && { icon: '🎓', label: job.exp },
                                ].filter(Boolean).map((b, i) => (
                                    <span key={i} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', color: 'white', padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>
                                        {b.icon} {b.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ── BODY: two-column ── */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '14px', padding: '14px 16px 40px', alignItems: 'start' }}>

                        {/* LEFT: Description */}
                        <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                            <div style={{ padding: '12px 18px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                                <h2 style={{ fontSize: '12px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Job Description</h2>
                                <div style={{ fontSize: '13px', color: '#15803d', fontWeight: '800' }}>
                                    📨 How to Apply: Send your Resume and required details & copies to <a href={mailtoLink} style={{ color: 'inherit', textDecoration: 'underline' }}>careers@innovcentric.com</a>
                                </div>
                            </div>
                            <div style={{ padding: '16px 20px' }}>
                                <div className="jd-body" dangerouslySetInnerHTML={{ __html: job.description }} />
                            </div>

                            {/* Must Have Skills */}
                            {job.mustHave && (
                                <div style={{ padding: '0 20px 24px 20px', borderTop: '1px dashed #e2e8f0', paddingTop: '16px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '800', color: '#4f46e5', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ width: '16px', height: '16px', background: '#eef2ff', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                                        </div>
                                        Must Have Skills / Highlights
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                        {job.mustHave.split(',').map((skill, i) => (
                                            <span key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', color: '#475569', padding: '3px 9px', borderRadius: '6px', fontSize: '11px', fontWeight: '600' }}>
                                                {skill.trim()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* RIGHT: Sidebar */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'sticky', top: '58px' }}>

                            {/* Quick Info card */}
                            <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                                <div style={{ background: '#1e1b4b', padding: '9px 14px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Job Details</div>
                                </div>
                                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {[
                                        { icon: '💼', label: 'Type', value: job.type },
                                        { icon: '🏢', label: 'Work Mode', value: job.workMode || 'Remote' },
                                        { icon: '📍', label: 'Location', value: job.location },
                                        job.rate && { icon: '💰', label: 'Rate', value: job.rate },
                                        job.exp && { icon: '🎓', label: 'Experience', value: job.exp },
                                    ].filter(Boolean).map((item, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{item.icon}</div>
                                            <div>
                                                <div style={{ fontSize: '9px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{item.label}</div>
                                                <div style={{ fontSize: '12px', color: '#111827', fontWeight: '700' }}>{item.value}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Required Documents card */}
                            <div style={{ background: 'white', borderRadius: '14px', border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                                <div style={{ background: '#0f172a', padding: '9px 14px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: '800', color: 'white', textTransform: 'uppercase', letterSpacing: '0.8px' }}>📋 Required Documents</span>
                                </div>
                                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                    {[
                                        { icon: '📄', label: 'Resume', color: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
                                        { icon: '🛂', label: 'Passport Number / Copy', color: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
                                        { icon: '🪪', label: 'Driving Licence / State ID / Gov ID', color: '#fefce8', border: '#fde68a', text: '#b45309' },
                                        { icon: '📋', label: 'Visa Copy', color: '#fdf4ff', border: '#e9d5ff', text: '#7e22ce' },
                                    ].map((item, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px', background: item.color, border: `1px solid ${item.border}`, borderRadius: '7px', padding: '6px 9px' }}>
                                            <span style={{ fontSize: '13px', flexShrink: 0 }}>{item.icon}</span>
                                            <span style={{ fontSize: '10px', color: item.text, fontWeight: '700', lineHeight: 1.3 }}>{item.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
