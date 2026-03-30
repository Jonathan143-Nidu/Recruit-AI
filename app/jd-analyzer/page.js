'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function JDAnalyzerPage() {
    const router = useRouter();

    const [jdText, setJdText] = useState('');
    const [resumeInputType, setResumeInputType] = useState('upload'); // 'upload' or 'paste'
    const [resumeText, setResumeText] = useState('');
    const [resumeFiles, setResumeFiles] = useState([]); // Array for batch uploads

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [results, setResults] = useState([]); // Array for batch results
    const [expandedRow, setExpandedRow] = useState(null); // Track which row is open

    // Job Sync States
    const [jobs, setJobs] = useState([]);
    const [selectedJob, setSelectedJob] = useState('');

    useEffect(() => {
        async function loadJobs() {
            try {
                const res = await fetch('/api/jobs');
                const data = await res.json();
                if (Array.isArray(data)) {
                    // Load all active/open jobs
                    setJobs(data.filter(j => j.status === 'Open' || !j.status));
                }
            } catch (e) { console.error("Could not fetch jobs list:", e); }
        }
        loadJobs();
    }, []);

    const handleJobSelect = (e) => {
        const jobId = e.target.value;
        setSelectedJob(jobId);
        if (!jobId) {
            setJdText('');
            return;
        }
        const job = jobs.find(j => j.jobId === jobId || j.id === jobId);
        if (job) {
            // Very simple HTML stripper to clean the rich text description
            const cleanDesc = job.description 
                ? job.description.replace(/<br\s*\/?>/gi, '\\n').replace(/<[^>]+>/g, '') 
                : '';
            
            const formatJD = `Role: ${job.title || 'N/A'}\nLocation: ${job.location || 'N/A'}\nType: ${job.type || 'N/A'}\nWork Mode: ${job.workMode || 'N/A'}\nExperience: ${job.exp || 'N/A'}\n\nDescription:\n${cleanDesc}`;
            setJdText(formatJD.trim());
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
            setResumeFiles(Array.from(e.target.files));
        }
    };
    
    const removeFile = (idxToRemove) => {
        setResumeFiles(prev => prev.filter((_, idx) => idx !== idxToRemove));
    };

    const handleAnalyze = async () => {
        if (!jdText.trim()) {
            alert("Please paste a Job Description or select one from the list.");
            return;
        }

        if (resumeInputType === 'paste' && !resumeText.trim()) {
            alert("Please paste the Resume text.");
            return;
        }

        if (resumeInputType === 'upload' && resumeFiles.length === 0) {
            alert("Please upload at least one Resume file (PDF, DOCX, TXT).");
            return;
        }

        setIsAnalyzing(true);
        setResults([]);
        setExpandedRow(null);

        try {
            const formData = new FormData();
            formData.append('jd', jdText);
            
            if (resumeInputType === 'upload') {
                resumeFiles.forEach(file => {
                    formData.append('resumeFile', file);
                });
            } else {
                formData.append('resumeText', resumeText);
            }

            const response = await fetch('/api/jd-analyzer', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            if (data.results && data.results.length > 0) {
                setResults(data.results);
            } else {
                throw new Error("No results returned.");
            }

        } catch (error) {
            console.error("Analyzer Error:", error);
            alert("Analysis failed: " + error.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    // UI Helper
    const getMatchColor = (percentage) => {
        if (percentage >= 80) return '#198754';
        if (percentage >= 50) return '#fd7e14';
        return '#dc3545';
    };

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '"Inter", system-ui, sans-serif' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
                * { box-sizing: border-box; margin: 0; padding: 0; }
                .back-btn:hover { background: #f1f5f9 !important; }
                .tab-btn { padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
                .tab-active { background: #4f46e5; color: white; border: 1px solid #4f46e5; }
                .tab-inactive { background: white; color: #64748b; border: 1px solid #e2e8f0; }
            `}</style>

            {/* Header */}
            <div style={{ background: '#ffffff', padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button className="back-btn" onClick={() => router.push('/')} style={{ background: 'white', border: '1px solid #e2e8f0', color: '#1e293b', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                        ← Back
                    </button>
                    <div>
                        <h1 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>Manual JD & Resume Analyzer</h1>
                        <p style={{ color: '#64748b', fontSize: '12px', fontWeight: '500' }}>Deep AI mapping for single candidate files.</p>
                    </div>
                </div>
            </div>

            <div style={{ width: '100%', padding: '24px 32px', display: 'grid', gridTemplateColumns: 'minmax(340px, 400px) 1fr', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* LEFT PANEL: Form Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    
                    {/* Candidate Resume Block */}
                    <div style={{ background: 'white', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h2 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                📄 Candidate Resume
                            </h2>
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button className={'tab-btn ' + (resumeInputType === 'upload' ? 'tab-active' : 'tab-inactive')} onClick={() => setResumeInputType('upload')} style={{ padding: '4px 10px', fontSize: '11px' }}>Upload</button>
                                <button className={'tab-btn ' + (resumeInputType === 'paste' ? 'tab-active' : 'tab-inactive')} onClick={() => setResumeInputType('paste')} style={{ padding: '4px 10px', fontSize: '11px' }}>Paste</button>
                            </div>
                        </div>

                        {resumeInputType === 'paste' ? (
                            <textarea 
                                value={resumeText}
                                onChange={(e) => setResumeText(e.target.value)}
                                placeholder="Paste the Candidate's Resume text here..."
                                style={{ width: '100%', minHeight: '80px', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', background: '#f8fafc' }}
                            />
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', border: '2px dashed #cbd5e1', background: '#f8fafc', transition: 'all 0.2s', cursor: 'pointer' }} onClick={() => document.getElementById('resume-file-input').click()}>
                                <div style={{ fontSize: '20px' }}>📂</div>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontSize: '12px', color: '#334155', fontWeight: '600', margin: 0 }}>Click to Browse Files (Batch Upload)</p>
                                    <p style={{ fontSize: '10px', color: '#94a3b8', margin: 0 }}>PDF, DOCX, DOC, TXT supported</p>
                                </div>
                                <input 
                                    id="resume-file-input"
                                    type="file" 
                                    accept=".pdf,.docx,.doc,.txt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    multiple
                                    onChange={handleFileChange}
                                    style={{ display: 'none' }}
                                />
                            </div>
                        )}
                        {/* File Chips */}
                        {resumeInputType === 'upload' && resumeFiles && resumeFiles.length > 0 && (
                            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
                                {resumeFiles.map((file, idx) => (
                                    <div key={idx} style={{ background: '#e0e7ff', color: '#4338ca', padding: '6px 12px', border: '1px solid #c7d2fe', borderRadius: '6px', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span>✓</span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                                        </div>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                                            style={{ background: 'transparent', border: 'none', color: '#4338ca', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Job Description Block */}
                    <div style={{ background: 'white', borderRadius: '12px', padding: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                        <div style={{ marginBottom: '8px' }}>
                            <h2 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                📝 Job Description
                            </h2>
                            
                            {/* JOBS SYNC DROPDOWN */}
                            <div style={{ marginBottom: '10px' }}>
                                <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>Sync with Jobs List:</label>
                                <select 
                                    value={selectedJob} 
                                    onChange={handleJobSelect}
                                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: '500', color: '#1e293b', background: '#f8fafc', outline: 'none' }}
                                >
                                    <option value="">-- Manual Paste JD --</option>
                                    {jobs.map(job => (
                                        <option key={job.jobId || job.id} value={job.jobId || job.id}>
                                            {job.title} {job.location ? `(${job.location})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <textarea 
                                value={jdText}
                                onChange={(e) => {
                                    setJdText(e.target.value);
                                    if (selectedJob) setSelectedJob(''); // Unsync if user manually edits extensively
                                }}
                                placeholder="Paste the Job Description text here..."
                                style={{ width: '100%', minHeight: '200px', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '12px', resize: 'vertical', fontFamily: 'inherit', background: '#f8fafc' }}
                            />
                        </div>
                    </div>

                    {/* Action Button */}
                    <button 
                        onClick={handleAnalyze} 
                        disabled={isAnalyzing}
                        style={{ 
                            background: isAnalyzing ? '#94a3b8' : '#4f46e5', 
                            color: 'white', 
                            border: 'none', 
                            padding: '14px 20px', 
                            borderRadius: '12px', 
                            fontSize: '15px', 
                            fontWeight: '800', 
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                            boxShadow: isAnalyzing ? 'none' : '0 4px 15px rgba(79, 70, 229, 0.3)',
                            transition: 'all 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px'
                        }}
                    >
                        {isAnalyzing ? (
                            <>
                                <svg style={{ animation: 'spin 1s linear infinite', width: '20px', height: '20px', color: 'white' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeOpacity="0.2"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                Analyzing Document...
                            </>
                        ) : 'Run AI Match Score'}
                    </button>
                    <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>

                </div>


                {/* RIGHT PANEL: Results Display */}
                <div style={{ position: 'relative' }}>
                    
                    {results.length === 0 && !isAnalyzing && (
                        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', height: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.02)' }}>
                            <div style={{ background: '#f1f5f9', width: '80px', height: '80px', borderRadius: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            </div>
                            <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>Waiting for Target</h3>
                            <p style={{ fontSize: '14px', color: '#64748b', maxWidth: '300px', lineHeight: 1.6 }}>Upload candidate resume(s) on the left, load your Job Requirements, and hit Analyze to see the batch scorecard here.</p>
                        </div>
                    )}

                    {isAnalyzing && (
                        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', height: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontSize: '48px', marginBottom: '24px', animation: 'bounce 1s infinite' }}>🧠</div>
                            <style>{`@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-15px); } }`}</style>
                            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#4f46e5', marginBottom: '12px' }}>Reading Inch-by-Inch Requirements</h3>
                            <div style={{ width: '200px', height: '4px', background: '#e2e8f0', borderRadius: '2px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', background: '#4f46e5', width: '50%', animation: 'slideRight 1s infinite linear', borderRadius: '2px' }} />
                            </div>
                            <style>{`@keyframes slideRight { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }`}</style>
                            <p style={{ marginTop: '16px', fontSize: '13px', color: '#64748b', fontWeight: '500' }}>Deep extracting qualifications vs. past experience.</p>
                        </div>
                    )}

                    {results.length > 0 && !isAnalyzing && (
                        <div style={{ animation: 'fadeIn 0.5s ease', background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}>
                            <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'white' }}>
                                <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                    <tr>
                                        <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', borderRight: '1px solid #f1f5f9' }}>CANDIDATE</th>
                                        <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>INSIGHTS</th>
                                        <th style={{ padding: '12px 16px', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center' }}>MATCH / GAP</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((reqResult, idx) => {
                                        const isOpen = expandedRow === idx;
                                        const matchP = reqResult.matchPercentage || 0;
                                        const missingP = reqResult.missingPercentage || (100 - matchP);

                                        return (
                                            <tr key={idx} onClick={() => setExpandedRow(isOpen ? null : idx)} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: isOpen ? '#f8fafc' : 'white', transition: 'background 0.2s', display: 'table-row' }}>
                                                <td style={{ padding: '16px', verticalAlign: 'top', borderRight: '1px solid #f1f5f9', width: '25%' }}>
                                                    <div style={{ fontWeight: '800', color: '#0f172a', fontSize: '13px', wordBreak: 'break-word' }}>{reqResult.Name || 'Unknown Candidate'}</div>
                                                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
                                                        <span style={{ fontWeight: '700', color: '#334155', background: '#e2e8f0', padding: '3px 8px', borderRadius: '6px' }}>{reqResult['Years of Experience'] || 'Exp Not Extracted'}</span>
                                                    </div>
                                                </td>
                                                
                                                <td style={{ padding: '16px', textAlign: 'center', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>
                                                    {/* AI Insights Button that expands */}
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#f97316', fontWeight: '800', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.3px', padding: '6px 12px', borderRadius: '6px', background: isOpen ? '#fffbeb' : 'transparent', transition: 'all 0.2s', border: isOpen ? '1px solid #fef08a' : '1px solid transparent' }}>
                                                        <span style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block', fontSize: '10px' }}>▶</span>
                                                        <span>AI Insights</span>
                                                        <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>({(reqResult.missingSkills || []).length} Gaps)</span>
                                                    </div>

                                                    {isOpen && (
                                                        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '16px', padding: '16px 20px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', borderLeft: '3px solid #f59e0b', textAlign: 'left', cursor: 'text', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
                                                            
                                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                                {/* Missing Skills Table */}
                                                                {reqResult.missingSkills && reqResult.missingSkills.length > 0 && (
                                                                    <div>
                                                                        <div style={{ fontWeight: '800', color: '#e11d48', marginBottom: '8px', fontSize: '12px' }}>Missing Skills:</div>
                                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                            <thead>
                                                                                <tr style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                                    <th style={{ textAlign: 'left', padding: '6px 4px', color: '#94a3b8', whiteSpace: 'nowrap' }}>MISSING SKILLS</th>
                                                                                    <th style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8', whiteSpace: 'nowrap' }}>JD REQ</th>
                                                                                    <th style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8' }}>HAS</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {reqResult.missingSkills.map((ms, idxi) => (
                                                                                    <tr key={idxi} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                        <td style={{ padding: '6px 4px', fontWeight: '700' }}>• {typeof ms === 'object' ? ms.skill : ms}</td>
                                                                                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>{typeof ms === 'object' ? (ms.jdRequirement || ms.req || '-') : '-'}</td>
                                                                                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>{typeof ms === 'object' ? (ms.has || '0m') : '0m'}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}

                                                                {/* Missing Certifications Table */}
                                                                {reqResult.missingCertifications && reqResult.missingCertifications.length > 0 && (
                                                                    <div style={{ marginTop: '12px' }}>
                                                                        <div style={{ fontWeight: '800', color: '#dc2626', marginBottom: '8px', fontSize: '12px' }}>Missing Certifications:</div>
                                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                            <thead>
                                                                                <tr style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                                    <th style={{ textAlign: 'left', padding: '6px 4px', color: '#94a3b8' }}>Missing Certifications</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {reqResult.missingCertifications.map((cert, idxi) => (
                                                                                    <tr key={idxi} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                        <td style={{ padding: '6px 4px', fontWeight: '700' }}>• {typeof cert === 'object' ? (cert.name || cert.skill || JSON.stringify(cert)) : cert}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}

                                                                {/* Partial Match Skills Table */}
                                                                {reqResult.partialMatchSkills && reqResult.partialMatchSkills.filter(ps => {
                                                                    const hasVal = String(ps.candidateHas || ps.has || '').toLowerCase().trim();
                                                                    return hasVal !== '' && !hasVal.startsWith('0');
                                                                }).length > 0 && (
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <div style={{ fontWeight: '800', color: '#ea580c', marginBottom: '8px', fontSize: '12px' }}>Partial Match Skills:</div>
                                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                                <thead>
                                                                                    <tr style={{ borderBottom: '1px solid #ffedd5' }}>
                                                                                        <th style={{ textAlign: 'left', padding: '6px 4px', color: '#94a3b8', whiteSpace: 'nowrap' }}>PARTIAL</th>
                                                                                        <th style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8', whiteSpace: 'nowrap' }}>JD REQ</th>
                                                                                        <th style={{ textAlign: 'center', padding: '6px 4px', color: '#94a3b8' }}>HAS</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {reqResult.partialMatchSkills.filter(ps => {
                                                                                        const hasVal = String(ps.candidateHas || ps.has || '').toLowerCase().trim();
                                                                                        return hasVal !== '' && !hasVal.startsWith('0');
                                                                                    }).map((ps, idxi) => (
                                                                                        <tr key={idxi} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                            <td style={{ padding: '6px 4px', fontWeight: '700' }}>• {ps.skill}</td>
                                                                                            <td style={{ padding: '6px 4px', textAlign: 'center' }}>{ps.jdRequirement || ps.req || '-'}</td>
                                                                                            <td style={{ padding: '6px 4px', textAlign: 'center' }}>{ps.candidateHas || ps.has || '-'}</td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}

                                                                {/* Percentage Summary */}
                                                                <div style={{ marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                                                                    <div style={{ fontWeight: '800', color: '#0f172a', marginBottom: '4px', fontSize: '11px' }}>Resume Percentage to JD:</div>
                                                                    <div style={{ color: '#6366f1', fontWeight: '700', fontSize: '11px' }}>(match skills +Partial skills) {matchP}%</div>
                                                                    <div style={{ color: '#e11d48', fontWeight: '700', fontSize: '11px' }}>Missing skills {missingP}%</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </td>
                                                
                                                <td style={{ padding: '16px', verticalAlign: 'top', width: '20%' }}>
                                                    {/* MATCH & GAP BADGES */}
                                                    <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                                                        {/* Match Circle */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                            <div style={{
                                                                width: '36px', height: '36px', borderRadius: '50%',
                                                                border: '1.5px solid #10b981', background: '#ecfdf5', color: '#047857',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontWeight: '900', fontSize: '11px'
                                                            }}>
                                                                {matchP}%
                                                            </div>
                                                            <span style={{ fontSize: '9px', fontWeight: '800', color: '#059669', marginTop: '4px', textTransform: 'uppercase' }}>Match</span>
                                                        </div>

                                                        {/* Gap Circle */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                            <div style={{
                                                                width: '36px', height: '36px', borderRadius: '50%',
                                                                border: '1.5px solid #ef4444', background: '#fef2f2', color: '#b91c1c',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                fontWeight: '900', fontSize: '11px'
                                                            }}>
                                                                {missingP}%
                                                            </div>
                                                            <span style={{ fontSize: '9px', fontWeight: '800', color: '#dc2626', marginTop: '4px', textTransform: 'uppercase' }}>Gap</span>
                                                        </div>
                                                    </div>
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
        </div>
    );
}
