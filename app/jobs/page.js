'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ADMIN_EMAIL = 'careers@innovcentric.com';
const PAGE_SIZE = 50;
const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
const WORK_MODES = ['Remote', 'Onsite', 'Hybrid', 'Onsite or Hybrid'];
const EMPTY_FORM = { title: '', location: '', type: 'Full-time', workMode: 'Remote', exp: '', rate: '', description: '', status: 'Open', mustHave: '' };

export default function JobsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const isAdmin = status === 'authenticated' && session?.user?.email === ADMIN_EMAIL;

    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterType, setFilterType] = useState('');
    const [filterMode, setFilterMode] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [statusTab, setStatusTab] = useState('Open');
    const [page, setPage] = useState(1);

    // AI Sync States
    const [isExtracting, setIsExtracting] = useState(false);
    const [matchingLoading, setMatchingLoading] = useState(false);
    const [matches, setMatches] = useState([]);
    const [showMatches, setShowMatches] = useState(false);

    // Admin form
    const [showForm, setShowForm] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const descRef = useRef(null);

    // Populate rich text editor when form opens
    useEffect(() => {
        if (showForm && descRef.current) {
            descRef.current.innerHTML = formData.description || '';
        }
    }, [showForm]);

    const fetchJobs = async () => {
        setLoading(true);
        try {
            const baseUrl = isAdmin ? '/api/jobs?all=true' : '/api/jobs';
            const url = `${baseUrl}${isAdmin ? '&' : '?'}t=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            const data = await res.json();
            const sorted = Array.isArray(data) ? data.sort((a, b) => new Date(b.posted) - new Date(a.posted)) : [];
            setJobs(sorted);
        } catch { setJobs([]); }
        setLoading(false);
    };

    useEffect(() => { fetchJobs(); }, [isAdmin]);

    // Filter + search
    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return jobs.filter(j => {
            const matchQ = !q || [j.jobId, j.title, j.location, j.type, j.workMode, j.rate, j.exp, j.mustHave]
                .some(v => v && String(v).toLowerCase().includes(q));
            const matchType = !filterType || j.type === filterType;
            const matchMode = !filterMode || j.workMode === filterMode;
            const matchStatus = (j.status || 'Open') === statusTab;
            return matchQ && matchType && matchMode && matchStatus;
        });
    }, [jobs, search, filterType, filterMode, statusTab]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);
    const showingFrom = filtered.length === 0 ? 0 : startIdx + 1;
    const showingTo = Math.min(startIdx + PAGE_SIZE, filtered.length);

    // Admin actions
    const handleNewJob = () => { setEditingJob(null); setFormData(EMPTY_FORM); setShowForm(true); };
    const handleEdit = (job) => {
        setEditingJob(job);
        setFormData({ title: job.title, location: job.location, type: job.type, workMode: job.workMode || 'Remote', exp: job.exp || '', rate: job.rate || '', description: job.description, status: job.status || 'Open', mustHave: job.mustHave || '' });
        setShowForm(true);
    };
    const handleSave = async () => {
        const descHTML = descRef.current?.innerHTML?.trim() || '';
        if (!formData.title.trim() || !descHTML || descHTML === '<br>') return;
        const dataToSave = { ...formData, description: descHTML };
        setSaving(true);
        try {
            if (editingJob) {
                await fetch(`/api/jobs/${editingJob.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataToSave) });
            } else {
                await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dataToSave) });
            }
            setShowForm(false);
            fetchJobs();
        } finally { setSaving(false); }
    };
    const handleDelete = async (id) => {
        if (!confirm('Delete this job posting?')) return;
        await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
        fetchJobs();
    };
    const handleToggle = async (job) => {
        await fetch(`/api/jobs/${job.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !job.active }) });
        fetchJobs();
    };

    const handleAutoFill = async (text) => {
        if (!text || text.length < 50) return;
        setIsExtracting(true);
        try {
            const res = await fetch('/api/extract-fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobDescription: text })
            });
            const { data } = await res.json();
            if (data) {
                setFormData(p => ({
                    ...p,
                    title: data.jobTitle || p.title,
                    altTitles: data.altTitles || [],
                    location: data.location || p.location,
                    rate: data.rate || p.rate,
                    exp: data.expRange || p.exp,
                    type: data.workMode ? (data.workMode.includes('Contract') ? 'Contract' : 'Full-time') : p.type,
                    workMode: data.workMode || p.workMode,
                    mustHave: (data.skills && data.skills.length > 0) ? data.skills.join(', ') : (data.mustHave || p.mustHave),
                    description: text // Use raw text as base
                }));
                if (descRef.current) descRef.current.innerHTML = text.replace(/\n/g, '<br>');
                // Trigger match update
                handleFetchMatches({ ...formData, title: data.jobTitle, altTitles: data.altTitles || [], mustHave: (data.skills && data.skills.length > 0) ? data.skills.join(', ') : data.mustHave });
            }
        } catch (e) { console.error("Auto-fill failed", e); }
        finally { setIsExtracting(false); }
    };

    const handleFetchMatches = async (data = formData) => {
        if (!data.title) return;
        setMatchingLoading(true);
        try {
            const res = await fetch('/api/jobs/match', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobTitle: data.title,
                    mustHave: data.mustHave || '',
                    exp: data.exp || '',
                    location: data.location || ''
                })
            });
            const json = await res.json();
            setMatches(json.matches || []);
            setShowMatches(true);
        } catch (e) { console.error("Fetch matches failed", e); }
        finally { setMatchingLoading(false); }
    };

    const handleAICheck = (job) => {
        setEditingJob(job);
        setFormData({ ...job });
        setShowForm(true);
        handleFetchMatches(job);
    };

    const TYPE_COLORS = {
        'Full-time': '#16a34a',
        'Part-time': '#2563eb',
        'Contract': '#d97706',
        'Internship': '#7c3aed',
    };
    const MODE_COLORS = {
        'Remote': '#0891b2',
        'Onsite': '#dc2626',
        'Hybrid': '#7c3aed',
        'Onsite or Hybrid': '#d97706',
    };

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '"Inter", system-ui, sans-serif' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                * { box-sizing: border-box; }
                .job-row { transition: background 0.12s; cursor: pointer; }
                .job-row:hover { background: #eff6ff !important; }
                .btn-act { transition: all 0.15s; border: none; cursor: pointer; border-radius: 6px; font-weight: 600; font-size: 12px; padding: 5px 10px; }
                input:focus, select:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
                [contenteditable]:focus { outline: none; }
                [contenteditable] ul, [contenteditable] ol { padding-left: 20px; }
                .rte-toolbar button:hover { background: #e0e7ff !important; }
            `}</style>



            {/* Right Edge: Social Icons + Admin Controls */}
            <div style={{ position: 'absolute', top: '16px', right: '24px', zIndex: 1100, display: 'flex', gap: '10px', alignItems: 'center' }}>
                {/* Social Media Icons - visible to public visitors only */}
                {!isAdmin && (
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginRight: '6px' }}>
                        {/* LinkedIn */}
                        <a href="https://linkedin.com/company/innovcentrictx/" target="_blank" rel="noopener noreferrer" title="LinkedIn"
                            style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', cursor: 'pointer', textDecoration: 'none' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#0A66C2'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                            </svg>
                        </a>
                        {/* Instagram */}
                        <a href="https://www.instagram.com/innovcentricllc/" target="_blank" rel="noopener noreferrer" title="Instagram"
                            style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', cursor: 'pointer', textDecoration: 'none' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                            </svg>
                        </a>
                        {/* Facebook */}
                        <a href="https://www.facebook.com/Innovcentricllc" target="_blank" rel="noopener noreferrer" title="Facebook"
                            style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', cursor: 'pointer', textDecoration: 'none' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#1877F2'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                            </svg>
                        </a>
                        {/* WhatsApp */}
                        <a href="https://whatsapp.com/channel/0029VbANdoQD8SDw00YyPG2E" target="_blank" rel="noopener noreferrer" title="WhatsApp"
                            style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', cursor: 'pointer', textDecoration: 'none' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#25D366'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.transform = 'scale(1)'; }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .011 5.403.008 12.039c0 2.12.54 4.19 1.566 6.04L0 24l6.102-1.6c1.789.975 3.804 1.49 5.86 1.491h.005c6.634 0 12.037-5.404 12.04-12.04 0-3.213-1.252-6.234-3.525-8.508z" />
                            </svg>
                        </a>
                    </div>
                )}

                {status === 'loading' && <span style={{ fontSize: '11px', color: '#94a3b8' }}>Loading…</span>}
                {status === 'authenticated' && !isAdmin && (
                    <span style={{ fontSize: '11px', color: '#475569', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: '20px' }}>
                        {session?.user?.email}
                    </span>
                )}
                {isAdmin && (
                    <button onClick={handleNewJob} style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}>
                        <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> Post New Job
                    </button>
                )}
                {isAdmin && <a href="/" style={{ background: 'white', color: '#0f172a', padding: '8px 16px', borderRadius: '10px', textDecoration: 'none', fontSize: '13px', fontWeight: '700', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: '1px solid #e2e8f0' }}>← Dashboard</a>}
            </div>

            {/* ── HERO VIDEO ── */}
            {!search && (statusTab === 'Open' || statusTab === 'Closed') && (
                <div style={{ position: 'relative', height: '180px', overflow: 'hidden', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', objectFit: 'cover', transform: 'translate(-50%, -50%)', opacity: 1.0 }}
                    >
                        <source src="/hero-video.mp4" type="video/mp4" />
                    </video>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15, 23, 42, 0.4), rgba(15, 23, 42, 0.2))' }} />
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '40px', background: 'linear-gradient(to bottom, transparent, #f8fafc)' }} />

                    {/* Centered Controls Overlay */}
                    <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '800px', padding: '0 20px' }}>

                        {/* Status Tabs (Compact & Above Search) */}
                        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(12px)', padding: '3px', borderRadius: '10px', gap: '3px', border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                            {['Open', 'Closed'].map(t => (
                                <button key={t} onClick={() => { setStatusTab(t); setPage(1); }}
                                    style={{
                                        border: 'none', padding: '6px 14px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', cursor: 'pointer',
                                        background: statusTab === t ? 'white' : 'transparent',
                                        color: statusTab === t ? '#4f46e5' : 'rgba(255,255,255,0.9)',
                                        boxShadow: statusTab === t ? '0 4px 10px rgba(0,0,0,0.1)' : 'none',
                                        transition: 'all 0.2s'
                                    }}>
                                    {t.toUpperCase()} ({jobs.filter(j => (j.status || 'Open') === t).length})
                                </button>
                            ))}
                        </div>

                        {/* Search Bar Container */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', justifyContent: 'center' }}>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '14px', overflow: 'hidden', maxWidth: '500px', height: '48px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                                <div style={{ padding: '0 16px', color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                                    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                                </div>
                                <input
                                    value={search}
                                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    placeholder="Search for your next role..."
                                    style={{ flex: 1, border: 'none', outline: 'none', fontSize: '15px', color: '#0f172a', background: 'transparent', padding: '0' }}
                                />
                                <button onClick={() => setShowFilters(p => !p)} style={{
                                    height: '100%', padding: '0 24px', background: showFilters ? '#eef2ff' : 'transparent', border: 'none', borderLeft: '1px solid #e2e8f0',
                                    cursor: 'pointer', color: showFilters ? '#6366f1' : '#64748b', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '800'
                                }}>
                                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
                                    Filters
                                </button>
                            </div>
                        </div>

                        {/* Careers Email CTA */}
                        <p style={{ textAlign: 'center', marginTop: '10px', fontSize: '13px', color: 'rgba(0, 0, 0, 0.85)', fontWeight: '500', letterSpacing: '0.2px' }}>
                            Send your Resume and required details &amp; copies to{' '}
                            <a href="mailto:careers@innovcentric.com" style={{ color: '#000000ff', fontWeight: '700', textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                                careers@innovcentric.com
                            </a>
                        </p>

                        {showFilters && (
                            <div style={{ background: 'rgba(255,255,255,0.98)', backdropFilter: 'blur(10px)', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px 20px', display: 'flex', gap: '16px', flexWrap: 'wrap', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', animation: 'slideDown 0.2s ease-out' }}>
                                <style>{`
                                    @keyframes slideDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
                                `}</style>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '800' }}>Type:</label>
                                    <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} style={{ fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 10px', color: '#374151', background: 'white' }}>
                                        <option value="">All Types</option>
                                        {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '800' }}>Mode:</label>
                                    <select value={filterMode} onChange={e => { setFilterMode(e.target.value); setPage(1); }} style={{ fontSize: '12px', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '4px 10px', color: '#374151', background: 'white' }}>
                                        <option value="">All Modes</option>
                                        {WORK_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                {(filterType || filterMode) && (
                                    <button onClick={() => { setFilterType(''); setFilterMode(''); }} style={{ fontSize: '12px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '800' }}>✕ Clear</button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div style={{ padding: '24px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '8px' }}>

                    {/* ── COUNT + TABLE ── */}
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>

                        {/* Table */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                        {['Posted', 'Job ID', 'Role Name', 'Exp', 'Location', 'Must Have', 'Rate', 'Type', 'Mode', 'Status', 'Full JD', isAdmin && 'Actions'].filter(Boolean).map(h => (
                                            <th key={h} style={{
                                                padding: '8px 4px', textAlign: 'center', fontWeight: '700', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap',
                                                width: h === 'Posted' ? '55px' : h === 'Job ID' ? '40px' : h === 'Role Name' ? '50px' : h === 'Exp' ? '40px' : h === 'Location' ? '40px' : h === 'Must Have' ? '350px' : h === 'Rate' ? '30px' : h === 'Type' ? '20px' : h === 'Mode' ? '40px' : h === 'Status' ? '40px' : h === 'Full JD' ? '65px' : h === 'Actions' ? '90px' : undefined
                                            }}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr><td colSpan={isAdmin ? 12 : 11} style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', fontSize: '14px' }}>Loading jobs...</td></tr>
                                    ) : pageItems.length === 0 ? (
                                        <tr><td colSpan={isAdmin ? 12 : 11} style={{ textAlign: 'center', padding: '60px' }}>
                                            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
                                            <div style={{ fontSize: '15px', fontWeight: '600', color: '#475569' }}>No jobs found</div>
                                            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Try adjusting your search or filters</div>
                                        </td></tr>
                                    ) : pageItems.map((job, idx) => (
                                        <tr key={job.id} className="job-row"
                                            onClick={() => router.push(`/jobs/${job.jobId}`)}
                                            style={{ background: idx % 2 === 0 ? 'white' : '#fafafa', borderBottom: '1px solid #f1f5f9', opacity: isAdmin && !job.active ? 0.5 : 1 }}>
                                            <td style={{ padding: '11px 4px', color: '#94a3b8', fontSize: '11px', textAlign: 'center' }}>
                                                {job.posted ? new Date(job.posted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                                            </td>
                                            <td style={{ padding: '11px 4px', fontWeight: '600', color: '#6366f1', whiteSpace: 'nowrap', textAlign: 'center' }}>{job.jobId}</td>
                                            <td style={{ padding: '11px 4px', fontWeight: '600', color: '#0f172a', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>{job.title}</td>
                                            <td style={{ padding: '11px 4px', color: '#475569', textAlign: 'center' }}>{job.exp || '—'}</td>
                                            <td style={{ padding: '11px 4px', color: '#475569', textAlign: 'center' }}>{job.location}</td>
                                            <td title={job.mustHave || ''} style={{ padding: '11px 4px', color: '#64748b', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center', cursor: 'default' }}>{job.mustHave || '—'}</td>
                                            <td style={{ padding: '11px 4px', color: '#475569', fontWeight: '500', textAlign: 'center' }}>{job.rate || '—'}</td>
                                            <td style={{ padding: '11px 4px', textAlign: 'center' }}>
                                                <span style={{ background: (TYPE_COLORS[job.type] || '#64748b') + '18', color: TYPE_COLORS[job.type] || '#64748b', border: `1px solid ${TYPE_COLORS[job.type] || '#64748b'}30`, padding: '2px 6px', borderRadius: '12px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                                    {job.type}
                                                </span>
                                            </td>
                                            <td style={{ padding: '11px 4px', textAlign: 'center' }}>
                                                <span style={{ background: (MODE_COLORS[job.workMode] || '#64748b') + '18', color: MODE_COLORS[job.workMode] || '#64748b', border: `1px solid ${MODE_COLORS[job.workMode] || '#64748b'}30`, padding: '2px 6px', borderRadius: '12px', fontSize: '10px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                                                    {job.workMode || '—'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '11px 4px', textAlign: 'center' }}>
                                                <span style={{
                                                    background: job.status === 'Closed' ? '#f1f5f9' : '#f0fdf4',
                                                    color: job.status === 'Closed' ? '#64748b' : '#16a34a',
                                                    border: `1px solid ${job.status === 'Closed' ? '#e2e8f0' : '#bbf7d0'}`,
                                                    padding: '2px 6px', borderRadius: '12px', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase'
                                                }}>
                                                    {job.status || 'Open'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '11px 4px', textAlign: 'center' }}>
                                                <button className="btn-act" style={{ background: '#eef2ff', color: '#6366f1', whiteSpace: 'nowrap', border: '1px solid #c7d2fe' }}>
                                                    View JD
                                                </button>
                                            </td>
                                            {isAdmin && (
                                                <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button className="btn-act" onClick={() => handleAICheck(job)} style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: 'none' }}>AI</button>
                                                        <button className="btn-act" onClick={() => handleEdit(job)} style={{ background: '#eef2ff', color: '#6366f1' }}>Edit</button>
                                                        <button className="btn-act" onClick={() => handleToggle(job)} style={{ background: '#f1f5f9', color: '#64748b' }}>{job.active ? 'Hide' : 'Show'}</button>
                                                        <button className="btn-act" onClick={() => handleDelete(job.id)} style={{ background: '#fef2f2', color: '#ef4444' }}>Del</button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#cbd5e1' : '#374151', fontSize: '12px' }}>‹</button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                    <button key={p} onClick={() => setPage(p)} style={{ padding: '5px 10px', border: '1px solid', borderColor: currentPage === p ? '#6366f1' : '#e2e8f0', borderRadius: '6px', background: currentPage === p ? '#6366f1' : 'white', color: currentPage === p ? 'white' : '#374151', cursor: 'pointer', fontSize: '12px', fontWeight: currentPage === p ? '700' : '400' }}>{p}</button>
                                ))}
                                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', cursor: currentPage === totalPages ? 'default' : 'pointer', color: currentPage === totalPages ? '#cbd5e1' : '#374151', fontSize: '12px' }}>›</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── ADMIN: POST/EDIT JOB MODAL ── */}
                {showForm && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '24px' }}>
                        <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: showMatches ? '1100px' : '650px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxHeight: '94vh', overflow: 'hidden', display: 'flex', transition: 'max-width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }}>

                            {/* Left: Form Area */}
                            <div style={{ flex: 1, padding: '32px', overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>
                                            {editingJob ? '✏️ Edit Job' : '📝 Post New Job'}
                                        </h2>
                                        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748b' }}>AI-Powered Recruiter Control Center</p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button onClick={() => setShowMatches(p => !p)} style={{ background: '#f1f5f9', border: 'none', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', color: '#475569', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'} onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}>
                                            {showMatches ? 'Hide Matches ‹' : 'Show Matches ›'}
                                        </button>
                                        <button onClick={() => setShowForm(false)} style={{ background: 'transparent', border: 'none', padding: '6px', borderRadius: '50%', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }} title="Close">
                                            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                </div>

                                {!editingJob && (
                                    <div style={{ marginBottom: '24px', position: 'relative' }}>
                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>⚡ Magic Paste (Auto-Fill Form)</label>
                                        <textarea
                                            placeholder="Paste full Job Description here to instantly fill the form..."
                                            onChange={(e) => handleAutoFill(e.target.value)}
                                            style={{ width: '100%', height: '80px', padding: '12px', border: '2px dashed #e2e8f0', borderRadius: '10px', fontSize: '13px', background: '#f8fafc', transition: 'all 0.2s', outline: 'none' }}
                                            onFocus={(e) => e.target.style.borderColor = '#6366f1'}
                                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                        {isExtracting && (
                                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px' }}>
                                                <span style={{ fontSize: '12px', fontWeight: '700', color: '#6366f1' }}>🪄 Extracting Magic...</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                    {[
                                        { label: 'Job Title *', key: 'title', placeholder: 'e.g. Java Developer', span: 2 },
                                        { label: 'Location', key: 'location', placeholder: 'e.g. New York, NY' },
                                        { label: 'Rate', key: 'rate', placeholder: 'e.g. $60/hr' },
                                        { label: 'Exp Required', key: 'exp', placeholder: 'e.g. 3+ Years' },
                                    ].map(({ label, key, placeholder, span }) => (
                                        <div key={key} style={{ gridColumn: span === 2 ? '1 / -1' : undefined }}>
                                            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>{label}</label>
                                            <input value={formData[key]}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    setFormData(p => ({ ...p, [key]: val }));
                                                    if (key === 'title') handleFetchMatches({ ...formData, title: val });
                                                }}
                                                placeholder={placeholder}
                                                style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#0f172a', background: isExtracting ? '#f1f5f9' : 'white' }} />
                                            {key === 'title' && formData.altTitles && formData.altTitles.length > 0 && (
                                                <div style={{ marginTop: '6px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>AI Alt Roles:</span>
                                                    {formData.altTitles.map((alt, i) => (
                                                        <span key={i} style={{ background: '#f1f5f9', color: '#64748b', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '600' }}>{alt}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Job Type</label>
                                        <select value={formData.type} onChange={e => setFormData(p => ({ ...p, type: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#0f172a', background: 'white' }}>
                                            {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Work Mode</label>
                                        <select value={formData.workMode} onChange={e => setFormData(p => ({ ...p, workMode: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#0f172a', background: 'white' }}>
                                            {WORK_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Job Status</label>
                                        <select value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))} style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#0f172a', background: 'white' }}>
                                            <option value="Open">Open</option>
                                            <option value="Closed">Closed</option>
                                        </select>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '20px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Must Have Skills / Key Highlights (Comma separated)</label>
                                    <input
                                        value={formData.mustHave}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setFormData(p => ({ ...p, mustHave: val }));
                                            handleFetchMatches({ ...formData, mustHave: val });
                                        }}
                                        placeholder="e.g. React, Node.js, 5+ yrs exp"
                                        style={{ width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#0f172a' }}
                                    />
                                </div>

                                <div style={{ marginBottom: '24px' }}>
                                    <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#475569', marginBottom: '6px' }}>Full Description *</label>
                                    <div className="rte-toolbar" style={{ display: 'flex', gap: '4px', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderBottom: 'none', borderRadius: '8px 8px 0 0' }}>
                                        {['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'].map(cmd => (
                                            <button key={cmd} onMouseDown={e => { e.preventDefault(); document.execCommand(cmd, false, null); }}
                                                style={{ border: 'none', padding: '4px 8px', borderRadius: '4px', background: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '700', color: '#475569', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                                                {cmd === 'insertUnorderedList' ? '• List' : cmd === 'insertOrderedList' ? '1. List' : cmd[0].toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                    <div ref={descRef} contentEditable suppressContentEditableWarning
                                        style={{ minHeight: '180px', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '0 0 8px 8px', fontSize: '13px', color: '#0f172a', lineHeight: 1.6, overflowY: 'auto' }} />
                                </div>

                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                                    <button onClick={() => setShowForm(false)} style={{ background: 'white', border: '1px solid #e2e8f0', color: '#475569', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>Cancel</button>
                                    <button onClick={handleSave} disabled={saving} style={{ background: 'linear-gradient(135deg,#1e293b,#0f172a)', color: 'white', border: 'none', padding: '10px 30px', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '700', boxShadow: '0 4px 12px rgba(15,23,42,0.2)' }}>
                                        {saving ? 'Saving…' : (editingJob ? 'Save Changes' : 'Publish Job')}
                                    </button>
                                </div>
                            </div>

                            {/* Right: Live Matching Sidebar */}
                            {showMatches && (
                                <div style={{ width: '450px', borderLeft: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.3s ease-out' }}>
                                    <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                🎯 Instant Talent Match
                                                {matches.length > 0 && <span style={{ background: '#6366f1', color: 'white', fontSize: '10px', padding: '2px 6px', borderRadius: '10px' }}>{matches.length}</span>}
                                            </h3>
                                            <button onClick={() => handleFetchMatches({ ...formData })} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>Refresh 🔄</button>
                                        </div>
                                        <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#64748b' }}>Strict AI skill-analysis from Master DB & Sync</p>
                                    </div>

                                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                                        {matchingLoading ? (
                                            <div style={{ textAlign: 'center', padding: '40px' }}>
                                                <div style={{ width: '30px', height: '30px', border: '3px solid #e2e8f0', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                                                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600' }}>Calculating Strict Math Scores...</span>
                                            </div>
                                        ) : matches.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '40px', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📡</div>
                                                <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>No instant matches found yet.</span>
                                                <p style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '4px' }}>Try adjusting Job Title or Skills</p>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {matches.map((m, idx) => (
                                                    <div key={idx} style={{ background: 'white', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', transition: 'transform 0.2s', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
                                                        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                                                        onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                            <div>
                                                                <div style={{ fontWeight: '800', fontSize: '13px', color: '#0f172a' }}>{m.name}</div>
                                                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{m.role} • {m.exp}</div>
                                                            </div>
                                                            <div style={{ background: m.matchPercentage >= 80 ? '#ecfdf5' : m.matchPercentage >= 50 ? '#fefce8' : '#fef2f2', color: m.matchPercentage >= 80 ? '#059669' : m.matchPercentage >= 50 ? '#ca8a04' : '#dc2626', padding: '4px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: '800' }}>
                                                                {m.matchPercentage}%
                                                            </div>
                                                        </div>

                                                        <div style={{ fontSize: '11px', color: '#475569', background: '#f8fafc', padding: '6px 8px', borderRadius: '6px', fontStyle: 'italic', border: '1px solid #f1f5f9', marginBottom: '10px' }}>
                                                            {m.reason}
                                                        </div>

                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                                                            {m.foundSkills && m.foundSkills.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                                                    <span style={{ fontSize: '10px', color: '#059669', fontWeight: '800', width: '45px' }}>✓ Has:</span>
                                                                    {m.foundSkills.map((s, idx) => (
                                                                        <span key={idx} style={{ background: '#ecfdf5', color: '#059669', padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: '700', border: '1px solid #10b981' }}>{s}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {m.missingSkills && m.missingSkills.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                                                                    <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: '800', width: '45px' }}>✗ Missing:</span>
                                                                    {m.missingSkills.map((s, idx) => (
                                                                        <span key={idx} style={{ background: '#fef2f2', color: '#dc2626', padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: '700', border: '1px solid #f87171' }}>{s}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                                                            <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: '800', textTransform: 'uppercase' }}>{m.source}</span>
                                                            <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '800' }}>{m.visa}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <style>{`
                                        @keyframes fadeIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
                                        @keyframes spin { to { transform: rotate(360deg); } }
                                    `}</style>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
