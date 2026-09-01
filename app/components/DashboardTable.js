'use client';

import React, { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';

export default function DashboardTable({ data, headers, session }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const dbType = searchParams.get('db') || 'master';

    const [itemsPerPage] = useState(100);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedRows, setSelectedRows] = useState(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState(null);

    // Search & Filter State
    const [globalSearch, setGlobalSearch] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [filters, setFilters] = useState({
        name: '',
        role: '',
        exp: '',
        visa: '',
        email: '',
        subject: '',
        resumeSays: '',
        startDate: '',
        endDate: ''
    });

    // Handle clicks outside the user menu to close it
    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (showUserMenu && !event.target.closest('.user-menu-container')) {
                setShowUserMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUserMenu]);

    // Filter Data Logic
    const filteredData = useMemo(() => {
        // Find indices dynamically for search
        const idx = (name) => {
            const lowName = name.toLowerCase();
            // First look for exact match
            let found = headers.findIndex(h => h.toLowerCase() === lowName);
            if (found !== -1) return found;
            // Fallback to includes
            return headers.findIndex(h => h.toLowerCase().includes(lowName));
        };
        const nameIdx = idx("Name");
        const roleIdx = idx("Role");
        const expIdx = idx("Exp");
        const visaIdx = idx("Visa");
        const locIdx = idx("Location");
        const emailIdx = idx("Email");
        const subjectIdx = idx("Subject");
        const dateIdx = idx("Date"); // New: Smart Timeline Column
        const resumeSaysIdx = idx("Resume Says"); // New: Tab-specific index

        // Attach original index to keep track of the row position in the Google Sheet 
        // before sorting and filtering scrambles the array order.
        const dataWithIndices = data.map((row, index) => {
            // We append the original index as a hidden property on the array object itself
            row.originalIndex = index;
            return row;
        });

        const filtered = dataWithIndices.filter(row => {
            const name = nameIdx !== -1 ? row[nameIdx]?.toString().toLowerCase() || '' : '';
            const role = roleIdx !== -1 ? row[roleIdx]?.toString().toLowerCase() || '' : '';
            const exp = expIdx !== -1 ? row[expIdx]?.toString().toLowerCase() || '' : '';
            const visa = visaIdx !== -1 ? row[visaIdx]?.toString().toLowerCase() || '' : '';
            const location = locIdx !== -1 ? row[locIdx]?.toString().toLowerCase() || '' : '';
            const email = emailIdx !== -1 ? row[emailIdx]?.toString().toLowerCase() || '' : '';
            const subjectCol = subjectIdx !== -1 ? row[subjectIdx]?.toString().toLowerCase() || '' : '';
            const resumeSays = resumeSaysIdx !== -1 ? row[resumeSaysIdx]?.toString().toLowerCase() || '' : '';

            // Global Search
            if (globalSearch) {
                const searchLower = globalSearch.toLowerCase();
                const matchGlobal =
                    name.includes(searchLower) ||
                    role.includes(searchLower) ||
                    exp.includes(searchLower) ||
                    visa.includes(searchLower) ||
                    location.includes(searchLower) ||
                    email.includes(searchLower) ||
                    subjectCol.includes(searchLower);

                if (!matchGlobal) return false;
            }

            // Specific Filters
            return (
                name.includes(filters.name.toLowerCase()) &&
                role.includes(filters.role.toLowerCase()) &&
                exp.includes(filters.exp?.toLowerCase() || '') &&
                visa.includes(filters.visa.toLowerCase()) &&
                email.includes(filters.email.toLowerCase()) &&
                subjectCol.includes(filters.subject.toLowerCase()) &&
                (dbType === 'sync' ? resumeSays.includes(filters.resumeSays.toLowerCase()) : true) &&
                (() => {
                    if (!filters.startDate && !filters.endDate) return true;
                    if (dateIdx === -1 || !row[dateIdx] || row[dateIdx] === 'N/A') return false;
                    const rowDate = new Date(row[dateIdx]);
                    if (isNaN(rowDate.getTime())) return false;

                    if (filters.startDate) {
                        const start = new Date(filters.startDate);
                        start.setHours(0, 0, 0, 0);
                        if (rowDate < start) return false;
                    }
                    if (filters.endDate) {
                        const end = new Date(filters.endDate);
                        end.setHours(23, 59, 59, 999);
                        if (rowDate > end) return false;
                    }
                    return true;
                })()
            );
        });

        // [SMART SORT] Interleave candidates by Date (Newest First), then fallback to Newest Google Sheet Row First
        filtered.sort((a, b) => {
            const parseDate = (val) => {
                if (!val || val === 'N/A') return null;
                const d = new Date(val);
                return isNaN(d.getTime()) ? null : d;
            };
            const dateA = dateIdx !== -1 ? parseDate(a[dateIdx]) : null;
            const dateB = dateIdx !== -1 ? parseDate(b[dateIdx]) : null;

            if (dateA && dateB) {
                if (dateB.getTime() !== dateA.getTime()) {
                    return dateB.getTime() - dateA.getTime();
                }
            }
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;

            // When dates are equal or missing, newest row in Google Sheet (highest index) comes first!
            return (b.originalIndex ?? 0) - (a.originalIndex ?? 0);
        });

        return filtered;
    }, [data, headers, globalSearch, filters, dbType]);

    // Logic for Pagination
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredData.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
    };

    // Logic for Selection
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const currentIndices = new Set(currentItems.map(item => item.originalIndex));
            setSelectedRows(new Set([...selectedRows, ...currentIndices]));
        } else {
            const newSelected = new Set(selectedRows);
            currentItems.forEach(item => newSelected.delete(item.originalIndex));
            setSelectedRows(newSelected);
        }
    };

    const handleSelectRow = (e, globalIndex) => {
        const newSelected = new Set(selectedRows);
        const originalIndex = filteredData[globalIndex].originalIndex;

        if (e.nativeEvent.shiftKey && lastSelectedIndex !== null) {
            const start = Math.min(lastSelectedIndex, globalIndex);
            const end = Math.max(lastSelectedIndex, globalIndex);

            // Should we add or remove in the range? 
            // Usually, if the first click was selecting, shift range will select.
            const isSelecting = !selectedRows.has(originalIndex);

            for (let i = start; i <= end; i++) {
                const rowOriginalIndex = filteredData[i].originalIndex;
                if (isSelecting) newSelected.add(rowOriginalIndex);
                else newSelected.delete(rowOriginalIndex);
            }
        } else {
            if (newSelected.has(originalIndex)) {
                newSelected.delete(originalIndex);
            } else {
                newSelected.add(originalIndex);
            }
        }

        setSelectedRows(newSelected);
        setLastSelectedIndex(globalIndex);
    };

    const isAllSelected = currentItems.length > 0 && currentItems.every(item => selectedRows.has(item.originalIndex));



    // Action: AI Analyze
    const handleAnalyze = () => {
        // Find indices dynamically - be precise with "Resume" vs "Resume Says"
        const idx = (name) => {
            const lowName = name.toLowerCase();
            // First look for exact match
            let found = headers.findIndex(h => h.toLowerCase() === lowName);
            if (found !== -1) return found;
            // Fallback to includes
            return headers.findIndex(h => h.toLowerCase().includes(lowName));
        };
        const nameIdx = idx("Name");
        const roleIdx = idx("Role");
        const expIdx = idx("Exp");
        const visaIdx = idx("Visa");
        const locIdx = idx("Location");
        const emailIdx = idx("Email");
        const phoneIdx = idx("Phone");
        // For Resume, we MUST be exact or specifically skip "Resume Says"
        const resumeIdx = headers.findIndex(h => h.toLowerCase() === "resume");
        const linkedInIdx = idx("LinkedIn");
        const senderIdx = idx("Sender");
        const subjectIdx = idx("Subject");

        const selectedData = Array.from(selectedRows).map(originalIdx => {
            const row = data[originalIdx];
            if (!row) return null;
            return {
                Name: nameIdx !== -1 ? row[nameIdx] : "N/A",
                Role: roleIdx !== -1 ? row[roleIdx] : "N/A",
                "Years of Experience": expIdx !== -1 ? row[expIdx] : "0.0",
                Visa: visaIdx !== -1 ? row[visaIdx] : "N/A",
                Location: locIdx !== -1 ? row[locIdx] : "N/A",
                Email: emailIdx !== -1 ? row[emailIdx] : "N/A",
                Phone: phoneIdx !== -1 ? row[phoneIdx] : "N/A",
                Resume: resumeIdx !== -1 ? row[resumeIdx] : "N/A",
                LinkedIn: linkedInIdx !== -1 ? row[linkedInIdx] : "N/A",
                Sender: senderIdx !== -1 ? row[senderIdx] : "N/A",
                Subject: subjectIdx !== -1 ? row[subjectIdx] : "N/A"
            };
        }).filter(Boolean);

        if (selectedData.length === 0) return;

        sessionStorage.setItem('selectedCandidatesForMatch', JSON.stringify(selectedData));
        // Clear previous results to start fresh
        sessionStorage.removeItem('matchResults');
        sessionStorage.removeItem('matchJobDescription');
        router.push('/match-results');
    };

    // Action: Delete Selected candidates from DB
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to completely delete ${selectedRows.size} candidate(s) from the Database?\n\nThis action cannot be undone.`)) {
            return;
        }

        setIsDeleting(true);

        const selectedIndices = Array.from(selectedRows).map(originalIdx => {
            // Find the original global row index taking filtering/sorting into account
            // +2 to account for 0-indexing and the Header row in Google Sheets
            return originalIdx + 2;
        });

        try {
            const currentDb = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('db') || 'master' : 'master';
            const res = await fetch('/api/candidates/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rowIndices: selectedIndices, dbType: currentDb })
            });

            const data = await res.json();
            if (data.success) {
                alert(`Successfully deleted ${selectedRows.size} candidate(s).`);
                window.location.reload(); // Refresh immediately to show the updated table
            } else {
                alert(`Failed to delete: ${data.error}`);
            }
        } catch (error) {
            console.error('Delete error:', error);
            alert('An error occurred while deleting.');
        } finally {
            setIsDeleting(false);
        }
    };

    // Filter Input Handler
    const handleFilterChange = (field, value) => {
        setFilters(prev => ({ ...prev, [field]: value }));
        setCurrentPage(1);
    };

    // Helper to safely extract URL
    const extractUrl = (cell) => {
        if (!cell || cell === 'N/A' || cell === '--') return null;
        const text = cell.toString();

        // 1. Check for standard http/https links
        if (text.includes('http')) {
            const start = text.indexOf('http');
            let end = text.length;
            const terminators = ['"', "'", ",", ")", " ", "\n"];
            terminators.forEach(t => {
                const pos = text.indexOf(t, start);
                if (pos !== -1) end = Math.min(end, pos);
            });
            const extracted = text.substring(start, end);
            return extracted.length > 10 ? extracted : null;
        }

        // 2. LinkedIn Specific Recovery: Recover from partial links like "www.linkedin.com/in/..."
        if (text.toLowerCase().includes('linkedin.com')) {
            const start = text.toLowerCase().indexOf('linkedin.com');
            let end = text.length;
            const terminators = ['"', "'", ",", ")", " ", "\n"];
            terminators.forEach(t => {
                const pos = text.indexOf(t, start);
                if (pos !== -1) end = Math.min(end, pos);
            });
            const extracted = text.substring(start, end);
            return `https://${extracted}`;
        }

        return null;
    };

    // Helper to format cell values (e.g. handle Google Sheets date serials)
    const formatCellValue = (header, cell) => {
        if (!cell || cell === 'N/A' || cell === 'Not available' || cell === 'Unknown') return '';
        const text = cell.toString();

        // 1. Clean up raw Google Formulas for the UI
        if (text.startsWith('=HYPERLINK')) {
            const match = text.match(/",\s*"([^"]+)"\)/);
            if (match) return match[1]; // Return "LinkedIn" or "Resume" instead of the whole formula
            return "Link";
        }

        const h = header.toLowerCase();
        // Handle Google Sheets date serial numbers for DOB column (usually 5 digits)
        if (h.includes('dob') && !isNaN(cell) && cell.toString().trim().length === 5) {
            const dateNum = parseFloat(cell);
            const date = new Date((dateNum - 25569) * 86400 * 1000);
            return date.toLocaleDateString('en-US');
        }

        if (h.includes('phone') && typeof cell === 'number') {
            return cell.toString();
        }

        return cell;
    };

    // Helper to determine link label
    const getLinkLabel = (header, cell) => {
        const h = header.toLowerCase();
        if (h.includes('drive')) return 'Drive';
        if (h.includes('resume')) return 'Resume';
        if (h.includes('thread')) return 'Thread';
        if (h.includes('linkedin')) return 'LinkedIn';
        return 'Link';
    };
    const effectiveHeaders = dbType === 'master' ? [
        "Name", "Date", "Subject", "Role", "EXP", "Visa", "Location", "Skills", "Resume Says", "Email", "Phone", "DOB", "PPN", "LinkedIn", "Drive Folder", "Resume", "Sender", "Thread", "Processed By", "Fingerprint"
    ] : headers;

    // Helper to check if a string looks like a Visa status (Strict Word Boundaries to avoid 'Lead' matching 'ead')
    const isVisaValue = (val) => {
        if (!val) return false;
        const v = val.toString().toLowerCase().trim();
        if (v.includes('lead') || v.includes('report') || v.includes('manager') || v.includes('developer') || v.includes('architect') || v.includes('engineer')) return false;
        const clean = v.replace(/[^a-z0-9]/g, '');
        return clean === 'h1' || clean === 'h1b' || clean.includes('h1b') || clean === 'gc' || clean.includes('greencard') || clean.includes('h4') || clean.includes('usc') || clean.includes('opt') || clean.includes('cpt') || clean.includes('citizen') || clean === 'ead' || clean === 'h4ead';
    };

    // Smart dynamic cell resolver ONLY for Master DB tab matching attributes across all row formats
    const getMasterDbCell = (row, h, j) => {
        if (!row || !Array.isArray(row)) return '';
        const hl = h ? h.toLowerCase() : '';
        const strVal = (val) => (val !== null && val !== undefined) ? val.toString() : '';

        // Find attribute indices dynamically within row
        const emailIndex = row.findIndex(cell => cell && typeof cell === 'string' && cell.includes('@') && !cell.startsWith('http'));
        const phoneIndex = row.findIndex((cell, idx) => idx !== emailIndex && cell && typeof cell === 'string' && (cell.includes('+1') || /^\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/.test(cell.trim())));
        const dobIndex = row.findIndex((cell, idx) => idx >= 7 && cell && typeof cell === 'string' && (/\b(19\d{2}|20\d{2})\b/.test(cell) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(cell)) && !cell.includes('@') && !cell.startsWith('http'));
        const visaIndex = row.findIndex(cell => isVisaValue(cell));
        const expValue = row.find(c => c && /^\d{1,2}(\.\d)?$/.test(c.toString().trim()));

        // Rows 1-225 layout vs Rows 226+ layout
        const isStandardLayout = row.length >= 13 && (isVisaValue(row[5]) || isVisaValue(row[4]));

        if (isStandardLayout) {
            const hasVisaAt5 = isVisaValue(row[5]);
            if (hasVisaAt5) {
                if (hl === 'name') return strVal(row[0]);
                if (hl === 'date') return strVal(row[1]);
                if (hl === 'subject') return strVal(row[2]);
                if (hl === 'role') return strVal(row[3]);
                if (hl.includes('exp')) return strVal(row[4]);
                if (hl === 'visa') return strVal(row[5]);
                if (hl === 'location') return strVal(row[6]);
                if (hl === 'skills') return strVal(row[7]);
                if (hl.includes('resume says')) return strVal(row[8]);
                if (hl === 'email') return strVal(row[9]);
                if (hl === 'phone') return strVal(row[10]);
                if (hl === 'dob') return strVal(row[11]);
                if (hl === 'ppn' || hl.includes('passport') || hl === 'code') return strVal(row[12]);
                if (hl === 'linkedin') return strVal(row[13]);
                if (hl.includes('drive')) return strVal(row[14]);
                if (hl === 'resume') return strVal(row[15]);
                if (hl === 'sender') return strVal(row[16]);
                if (hl === 'thread') return strVal(row[17]);
            } else {
                if (hl === 'name') return strVal(row[0]);
                if (hl === 'date') return strVal(row[8] || row[1]);
                if (hl === 'subject') return strVal(row[1]);
                if (hl === 'role') return strVal(row[2]);
                if (hl.includes('exp')) return strVal(row[3]);
                if (hl === 'visa') return strVal(row[4]);
                if (hl === 'location') return strVal(row[5]);
                if (hl === 'skills') return '';
                if (hl.includes('resume says')) return strVal(row[6]);
                if (hl === 'email') return strVal(row[6]);
                if (hl === 'phone') return strVal(row[7]);
                if (hl === 'dob') return strVal(row[8]);
                if (hl === 'ppn' || hl.includes('passport') || hl === 'code') return strVal(row[9]);
                if (hl === 'linkedin') return strVal(row[10] || row[9]);
                if (hl.includes('drive')) return strVal(row[11] || row[10]);
                if (hl === 'resume') return strVal(row[12] || row[11]);
                if (hl === 'sender') return strVal(row[13] || row[12]);
                if (hl === 'thread') return strVal(row[14] || row[13]);
            }
        } else {
            // Rows 226+ layout smart resolver
            if (hl === 'name') {
                const col0 = strVal(row[0]);
                if (col0.includes('Match Report') || col0.includes('RTR') || col0.includes('RE:') || col0.includes('Profile')) {
                    const match = col0.match(/(?:-|–|:)\s*([A-Za-z\s]+)$/);
                    return match ? match[1].trim() : col0;
                }
                return col0;
            }
            if (hl === 'date') return strVal(row[1]); // Col B in Google Sheet!
            if (hl === 'subject') return strVal(row[0]);
            if (hl === 'role') return strVal(row[1]);
            if (hl.includes('exp')) return strVal(expValue || row[2]);
            if (hl === 'visa') return visaIndex !== -1 ? strVal(row[visaIndex]) : strVal(row[3]);
            if (hl === 'location') return strVal(row.find((c, idx) => idx >= 3 && idx <= 6 && typeof c === 'string' && (c.includes(',') || c.includes('TX') || c.includes('NC') || c.includes('CA') || c.includes('NJ') || c.includes('GA') || c.includes('FL') || c.includes('MA'))) || row[4]);
            if (hl === 'skills') return strVal(row[5] || row[3]);
            if (hl.includes('resume says')) return strVal(row[6] || row[4]);
            if (hl === 'email') return strVal(emailIndex !== -1 ? row[emailIndex] : row[7]);
            if (hl === 'phone') return strVal(phoneIndex !== -1 ? row[phoneIndex] : row[8]);
            if (hl === 'dob') return strVal(dobIndex !== -1 ? row[dobIndex] : '');
            if (hl === 'ppn' || hl.includes('passport') || hl === 'code') return strVal(row.find((c, idx) => idx >= 7 && idx <= 10 && typeof c === 'string' && /^[A-Za-z0-9]{7,10}$/.test(c.trim()) && !c.includes('@')));
            if (hl === 'linkedin') return strVal(row.find(c => c && typeof c === 'string' && c.includes('linkedin')) || row[9]);
            if (hl.includes('drive')) return strVal(row.find(c => c && typeof c === 'string' && c.includes('drive')) || row[10]);
            if (hl === 'resume') return strVal(row.find(c => c && typeof c === 'string' && c.includes('view')) || row[11]);
            if (hl === 'sender') return strVal(row.find((c, idx) => idx >= 10 && typeof c === 'string' && c.includes('@')) || row[12]);
            if (hl === 'thread') return strVal(row.find(c => c && typeof c === 'string' && c.includes('mail.google.com')) || row[13]);
        }
        return strVal(row[j]);
    };

    // Helper to determine link label

    return (
        <div style={{ background: 'white', color: '#0f172a', fontFamily: '"Inter", system-ui, sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column', fontSize: '14px' }}>

            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                * { box-sizing: border-box; }
                .dash-btn { transition: all 0.2s ease; }
                .dash-btn:hover { transform: translateY(-1px); }
                .row-hover:hover { background: #f0f7ff !important; }
                .check-custom { width: 16px; height: 16px; cursor: pointer; accent-color: #6366f1; }
                .link-pill:hover { opacity: 0.8; }
                input::placeholder { color: #94a3b8; }
                input:focus { outline: none; border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-track { background: #f1f5f9; }
                ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 99px; }
                ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
                .user-menu-item:hover { background: #f1f5f9; color: #4f46e5; }
            `}</style>

            {/* ── IMMERSIVE HERO SECTION ── */}
            <div style={{
                position: 'relative',
                height: '150px', // Increased to show more background
                background: '#0f172a',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingBottom: '0',
                zIndex: 400
            }}>
                {/* Background Wrapper (Video + Gradient Overlay) */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                    <video
                        autoPlay
                        loop
                        muted
                        playsInline
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.95 }}
                    >
                        <source src="/hero-video.mp4" type="video/mp4" />
                    </video>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(15, 23, 42, 0.6), rgba(15, 23, 42, 0.3))' }} />
                </div>

                {/* ── TOP OVERLAY CONTROLS (SINGLE LINE) ── */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: '0 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1000 }}>
                    {/* Top Left: Logo Spacer */}
                    <div style={{ width: '200px' }}></div>

                    {/* ── CENTERED SEARCH BAR (ALIGNED) ── */}
                    <div style={{ position: 'relative', width: '100%', maxWidth: '450px' }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'rgba(255, 255, 255, 0.85)',
                            backdropFilter: 'blur(20px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                            borderRadius: '10px',
                            padding: '0 6px 0 14px',
                            border: '1px solid rgba(255, 255, 255, 0.3)',
                            boxShadow: '0 8px 32px -8px rgba(0, 0, 0, 0.2)',
                            height: '34px', // Matches DB switcher height
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}>
                            <svg style={{ flexShrink: 0, color: '#4f46e5', marginRight: '10px', opacity: 0.8 }} width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Find any candidate instantly..."
                                value={globalSearch}
                                onChange={(e) => { setGlobalSearch(e.target.value); setCurrentPage(1); }}
                                style={{
                                    flex: 1,
                                    background: 'transparent',
                                    border: 'none',
                                    color: '#0f172a',
                                    fontSize: '12.5px',
                                    fontWeight: '500',
                                    padding: '0',
                                    width: '100%',
                                    outline: 'none'
                                }}
                            />

                            <div style={{ width: '1px', height: '18px', background: 'rgba(0,0,0,0.1)', margin: '0 8px' }} />
                            <button
                                onClick={() => setShowFilters(!showFilters)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: showFilters ? '#4f46e5' : 'transparent',
                                    border: showFilters ? 'none' : '1px solid rgba(0,0,0,0.1)',
                                    padding: '0 10px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    color: showFilters ? 'white' : '#64748b',
                                    fontSize: '10.5px',
                                    fontWeight: '700',
                                    transition: 'all 0.2s',
                                    height: '24px'
                                }}
                            >
                                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h18m-18 5h18m-18 5h18m-18 5h18" />
                                </svg>
                                {showFilters ? 'Hide' : 'Filters'}
                            </button>
                        </div>
                    </div>

                    {/* Top Right: Actions + User */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '200px', justifyContent: 'flex-end' }}>
                        {/* Database Switcher */}
                        <div style={{
                            display: 'flex',
                            background: 'rgba(255,255,255,0.05)',
                            padding: '3px',
                            borderRadius: '10px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            height: '34px',
                            alignItems: 'center'
                        }}>
                            <button
                                onClick={() => router.push('/')}
                                style={{
                                    padding: '5px 12px',
                                    borderRadius: '7px',
                                    fontSize: '10px',
                                    fontWeight: '800',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: dbType === 'master' ? 'white' : 'transparent',
                                    color: dbType === 'master' ? '#0f172a' : 'rgba(255,255,255,0.6)',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                MASTER DB
                            </button>
                            <button
                                onClick={() => router.push('/?db=sync')}
                                style={{
                                    padding: '5px 12px',
                                    borderRadius: '7px',
                                    fontSize: '10px',
                                    fontWeight: '800',
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: dbType === 'sync' ? 'white' : 'transparent',
                                    color: dbType === 'sync' ? '#0f172a' : 'rgba(255,255,255,0.6)',
                                    transition: 'all 0.2s',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                SYNC RESULTS
                            </button>
                        </div>

                        <div style={{ height: '20px', width: '1px', background: 'rgba(255,255,255,0.2)', margin: '0 2px' }} />

                        {/* Delete Button */}
                        {selectedRows.size > 0 && (
                            <button className="dash-btn" onClick={handleDelete} disabled={isDeleting} style={{
                                background: 'rgba(255,100,100,0.1)',
                                color: '#fca5a5',
                                border: '1px solid rgba(255,100,100,0.3)',
                                padding: '0 10px',
                                borderRadius: '10px',
                                cursor: isDeleting ? 'not-allowed' : 'pointer',
                                fontSize: '11px',
                                fontWeight: '700',
                                display: 'flex', alignItems: 'center', gap: '6px',
                                height: '34px',
                                transition: 'all 0.3s',
                                opacity: isDeleting ? 0.6 : 1
                            }}>
                                {isDeleting ? '...' : (
                                    <>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                        </svg>
                                        Delete
                                    </>
                                )}
                            </button>
                        )}

                        {/* Analyze Button */}
                        <button className="dash-btn" onClick={handleAnalyze} disabled={selectedRows.size === 0} style={{
                            background: selectedRows.size > 0
                                ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                                : 'rgba(255,255,255,0.05)',
                            color: selectedRows.size > 0 ? 'white' : 'rgba(255, 255, 255, 0.6)',
                            border: 'none',
                            padding: '0 14px',
                            borderRadius: '10px',
                            cursor: selectedRows.size > 0 ? 'pointer' : 'not-allowed',
                            fontSize: '11px',
                            fontWeight: '700',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            height: '34px',
                            boxShadow: selectedRows.size > 0 ? '0 8px 20px -8px rgba(99,102,241,0.6)' : 'none',
                            transition: 'all 0.3s'
                        }}>
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            Analyze
                        </button>

                        {/* Gmail-style User Circle */}
                        <div className="user-menu-container" style={{ position: 'relative' }}>
                            <button
                                onClick={() => setShowUserMenu(!showUserMenu)}
                                style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    color: 'white',
                                    border: '2px solid rgba(255,255,255,0.3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '12px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
                                    transition: 'transform 0.2s'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                                {session?.user?.email?.charAt(0).toUpperCase() || 'U'}
                            </button>

                            {/* Dropdown Menu */}
                            {showUserMenu && (
                                <div style={{
                                    position: 'absolute', top: '42px', right: 0, width: '220px', background: 'white',
                                    borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', zIndex: 9999,
                                    border: '1px solid #f1f5f9', padding: '6px'
                                }}>
                                    <div style={{ padding: '12px', borderBottom: '1px solid #f1f5f9', marginBottom: '6px' }}>
                                        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Signed in as</div>
                                        <div style={{ fontSize: '12px', color: '#1e293b', fontWeight: '700', wordBreak: 'break-all' }}>{session?.user?.email}</div>
                                    </div>

                                    {/* Unified Menu Items */}
                                    {[
                                        { label: 'JD Analyzer', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />, onClick: () => router.push('/jd-analyzer') },
                                        { label: 'Batch Sync', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 16c0-1.1.9-2 2-2h12a2 2 0 012 2M4 16V9a2 2 0 012-2h12a2 2 0 012 2v7" />, onClick: () => router.push('/gmail-sync') },
                                        { label: 'Jobs', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zm0 0V5a2 2 0 00-2-2H6a2 2 0 00-2 2v2" />, onClick: () => router.push('/jobs') },
                                        { label: 'History', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />, onClick: () => router.push('/history') },
                                        { label: 'Get Extension', icon: <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />, onClick: () => window.location.href = '/Recruit-AI-Extension.zip' },
                                    ].map(item => (
                                        <div key={item.label} className="user-menu-item" onClick={item.onClick} style={{ padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', fontWeight: '600', margin: '2px 0' }}>
                                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>{item.icon}</svg>
                                            {item.label}
                                        </div>
                                    ))}

                                    <div style={{ height: '1px', background: '#f1f5f9', margin: '6px 0' }} />

                                    <div className="user-menu-item" onClick={() => signOut({ callbackUrl: '/login' })} style={{ padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', fontWeight: '600', color: '#ef4444' }}>
                                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                        Sign out
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bottom smooth fade to dashboard background */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30px', background: 'linear-gradient(to bottom, transparent, #f8fafc)' }} />
            </div>

            {/* ── CONSOLIDATED COUNT & PAGINATION STRIP ── */}
            <div style={{
                padding: '8px 24px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '12px',
                color: '#64748b',
                fontWeight: '600'
            }}>
                <div style={{ opacity: 0.8 }}>
                    {filteredData.length > 0
                        ? `Showing ${indexOfFirstItem + 1}-${Math.min(indexOfLastItem, filteredData.length)} of ${filteredData.length}`
                        : 'No results'}
                </div>

                {/* --- HEADER PAGINATION (Page Flip) --- */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <button
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            style={{
                                width: '28px', height: '28px', padding: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px',
                                cursor: currentPage === 1 ? 'default' : 'pointer',
                                opacity: currentPage === 1 ? 0.3 : 1, color: '#4f46e5',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        >
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 24 24" strokeWidth="2.5"><path d="M15 19l-7-7 7-7" /></svg>
                        </button>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'white',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            padding: '2px 8px',
                            gap: '8px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                        }}>
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                                .filter(num => num === 1 || num === totalPages || (num >= currentPage - 1 && num <= currentPage + 1))
                                .map((num, i, arr) => (
                                    <React.Fragment key={num}>
                                        {i > 0 && arr[i - 1] !== num - 1 && <span style={{ color: '#cbd5e1', fontSize: '10px' }}>•</span>}
                                        <button
                                            onClick={() => handlePageChange(num)}
                                            style={{
                                                border: 'none',
                                                background: 'transparent',
                                                color: currentPage === num ? '#4f46e5' : '#94a3b8',
                                                cursor: 'pointer',
                                                fontWeight: currentPage === num ? '800' : '600',
                                                fontSize: '11px',
                                                transition: 'all 0.2s ease'
                                            }}
                                        >
                                            {num}
                                        </button>
                                    </React.Fragment>
                                ))}
                        </div>

                        <button
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages}
                            style={{
                                width: '28px', height: '28px', padding: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px',
                                cursor: currentPage === totalPages ? 'default' : 'pointer',
                                opacity: currentPage === totalPages ? 0.3 : 1, color: '#4f46e5',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                            }}
                        >
                            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 24 24" strokeWidth="2.5"><path d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                )}
            </div>

            {/* ── FILTER PANEL ── */}
            {showFilters && (
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '12px 24px',
                    background: 'linear-gradient(to bottom, #ffffff, #fdfdfd)',
                    borderBottom: '1px solid #eef2ff',
                    boxShadow: '0 4px 15px -1px rgba(0,0,0,0.03)',
                    position: 'relative',
                    zIndex: 5
                }}>
                    {[
                        ['name', 'Name'],
                        ['role', 'Role'],
                        ['exp', 'Exp'],
                        ['visa', 'Visa'],
                        ['email', 'Email'],
                        ['subject', 'Subject'],
                        ...(dbType === 'sync' ? [['resumeSays', 'Resume Says']] : [])
                    ].map(([field, label]) => (
                        <div key={field} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            minWidth: field === 'resumeSays' ? '220px' : '185px',
                            flex: '1 1 0px'
                        }}>
                            <span style={{ fontSize: '10px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.8px', whiteSpace: 'nowrap', opacity: 0.7 }}>{label}</span>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <input
                                    type="text"
                                    value={filters[field]}
                                    onChange={(e) => handleFilterChange(field, e.target.value)}
                                    placeholder={`Filter...`}
                                    style={{
                                        width: '100%',
                                        padding: '7px 12px',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '10px',
                                        background: '#f8fafc',
                                        color: '#1e293b',
                                        fontSize: '12.5px',
                                        fontWeight: '500',
                                        outline: 'none'
                                    }}
                                />
                            </div>
                        </div>
                    ))}

                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '6px 16px',
                        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        flexShrink: 0
                    }}>
                        <span style={{ fontSize: '10px', fontWeight: '900', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Timeline</span>
                        <input
                            type="date"
                            value={filters.startDate}
                            onChange={(e) => handleFilterChange('startDate', e.target.value)}
                            style={{ border: 'none', background: 'transparent', color: '#4338ca', fontSize: '11.5px', fontWeight: '700', outline: 'none' }}
                        />
                        <span style={{ color: '#94a3b8', fontWeight: '900' }}>→</span>
                        <input
                            type="date"
                            value={filters.endDate}
                            onChange={(e) => handleFilterChange('endDate', e.target.value)}
                            style={{ border: 'none', background: 'transparent', color: '#4338ca', fontSize: '11.5px', fontWeight: '700', outline: 'none' }}
                        />
                    </div>
                </div>
            )}

            {/* --- TABLE --- */}
            <div style={{ flex: 1, padding: '8px 12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: 'white' }}>
                <div style={{ overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', background: 'white' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', tableLayout: 'fixed' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={{ padding: '9px 8px', width: '32px', borderBottom: '1px solid #e2e8f0' }}>
                                    <input type="checkbox" className="check-custom" checked={isAllSelected} onChange={handleSelectAll} />
                                </th>
                                <th style={{ padding: '10px 6px', textAlign: 'center', width: '28px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.4px', borderBottom: '1px solid #e2e8f0' }}>#</th>
                                {effectiveHeaders.map((h, i) => {
                                    const hl = h.toLowerCase();
                                    if (hl === 'processed by' || hl === 'fingerprint') return null;

                                    const colWidth =
                                        hl === 'name' ? '130px'
                                            : hl === 'role' ? '120px'
                                                : hl.includes('exp') ? '55px'
                                                    : hl === 'date' ? '125px'
                                                        : hl === 'subject' ? '140px'
                                                            : hl.includes('resume says') ? '150px'
                                                                : hl === 'visa' ? '85px'
                                                                    : hl === 'location' ? '110px'
                                                                        : hl === 'email' ? '150px'
                                                                            : hl === 'phone' ? '105px'
                                                                                : hl === 'dob' ? '125px'
                                                                                    : hl === 'ppn' ? '110px'
                                                                                        : hl === 'linkedin' ? '80px'
                                                                                            : hl.includes('drive') ? '85px'
                                                                                                : hl === 'resume' ? '75px'
                                                                                                    : hl === 'sender' ? '130px'
                                                                                                        : hl === 'thread' ? '65px'
                                                                                                            : '100px';
                                    return (
                                        <th key={i} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.4px', borderBottom: '1px solid #e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: colWidth }}>
                                            {h}
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {currentItems.map((row, i) => {
                                const globalIndex = indexOfFirstItem + i;
                                const isSelected = selectedRows.has(row.originalIndex);

                                return (
                                    <tr key={row.originalIndex} className="row-hover" style={{
                                        borderBottom: '1px solid #f1f5f9',
                                        background: isSelected ? 'linear-gradient(135deg, #eef2ff, #f5f3ff)' : 'white',
                                        transition: 'background 0.15s'
                                    }}>
                                        <td style={{ padding: '11px 8px', textAlign: 'center' }}>
                                            <input type="checkbox" className="check-custom" checked={isSelected} onChange={(e) => handleSelectRow(e, globalIndex)} />
                                        </td>
                                        <td style={{ padding: '11px 6px', textAlign: 'center', color: '#94a3b8', fontSize: '12px', fontWeight: '600' }}>
                                            {globalIndex + 1}
                                        </td>
                                        {effectiveHeaders.map((h, j) => {
                                            const cell = dbType === 'master' ? getMasterDbCell(row, h, j) : row[j];
                                            const url = extractUrl(cell);
                                            const header = h.toLowerCase();

                                            if (header === 'processed by' || header === 'fingerprint') return null;

                                            // Visa badge
                                            if (header.includes('visa') && cell && cell !== 'N/A') {
                                                const visaColors = { 'h1b': ['#ede9fe', '#7c3aed'], 'gc': ['#dcfce7', '#16a34a'], 'usc': ['#dbeafe', '#2563eb'], 'opt': ['#fef3c7', '#d97706'], 'cpt': ['#fce7f3', '#db2777'] };
                                                const key = cell.toString().toLowerCase().replace(/[^a-z]/g, '');
                                                const [bg, color] = Object.entries(visaColors).find(([k]) => key.includes(k))?.[1] || ['#f1f5f9', '#64748b'];
                                                return (
                                                    <td key={j} style={{ padding: '10px 12px' }}>
                                                        <span style={{ background: bg, color, padding: '3px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700' }}>{cell}</span>
                                                    </td>
                                                );
                                            }

                                            // Date badge
                                            if (header === 'date' && cell && cell !== 'N/A') {
                                                const parseDateObj = (val) => {
                                                    if (!val) return null;
                                                    const str = val.toString().trim();
                                                    if (!isNaN(str) && Number(str) > 30000 && Number(str) < 70000) {
                                                        const dateNum = Number(str);
                                                        const d = new Date((dateNum - 25569) * 86400 * 1000);
                                                        return isNaN(d.getTime()) ? null : d;
                                                    }
                                                    const d = new Date(str);
                                                    return isNaN(d.getTime()) ? null : d;
                                                };
                                                const d = parseDateObj(cell);
                                                const formatted = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : cell.toString();
                                                return (
                                                    <td key={j} style={{ padding: '10px 12px' }}>
                                                        <span style={{
                                                            background: '#f1f5f9',
                                                            color: '#475569',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: '600',
                                                            border: '1px solid #e2e8f0',
                                                            whiteSpace: 'nowrap',
                                                            display: 'inline-flex',
                                                            alignItems: 'center'
                                                        }}>
                                                            📅 {formatted}
                                                        </span>
                                                    </td>
                                                );
                                            }

                                            // Subject badge
                                            if (header === 'subject' && cell && cell !== 'N/A') {
                                                return (
                                                    <td key={j} style={{ padding: '10px 12px' }}>
                                                        <span style={{
                                                            background: '#f5f3ff',
                                                            color: '#7c3aed',
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: '700',
                                                            border: '1px solid #ddd6fe',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            display: 'block',
                                                            maxWidth: '120px'
                                                        }} title={cell}>
                                                            {cell}
                                                        </span>
                                                    </td>
                                                );
                                            }

                                            return (
                                                <td key={j} style={{ padding: '11px 8px', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '0' }}>
                                                    {url ? (
                                                        <a href={url} target="_blank" rel="noopener noreferrer" className="link-pill" style={{
                                                            background: '#eef2ff',
                                                            color: '#4f46e5',
                                                            padding: '2px 7px',
                                                            borderRadius: '5px',
                                                            textDecoration: 'none',
                                                            fontSize: '11px',
                                                            fontWeight: '600',
                                                            display: 'inline-block',
                                                            border: '1px solid #c7d2fe',
                                                        }}>
                                                            {getLinkLabel(h, cell)}
                                                        </a>
                                                    ) : (
                                                        <span title={cell} style={{ color: '#334155' }}>{formatCellValue(h, cell)}</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                            {currentItems.length === 0 && (
                                <tr>
                                    <td colSpan={headers.length + 2} style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                                        <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔍</div>
                                        <div style={{ fontWeight: '600', fontSize: '15px', marginBottom: '4px', color: '#64748b' }}>No candidates found</div>
                                        <div style={{ fontSize: '13px' }}>Try adjusting your search or filters.</div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Combined Footer & Spacing */}
            <div style={{ height: '12px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }} />

        </div >
    );
}
