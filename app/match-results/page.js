
"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import LiveProgressTracker from '@/components/LiveProgressTracker';
import dynamic from 'next/dynamic';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

const BODY_MODULES = {
    toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
        ['link'],
        ['clean']
    ]
};

const SIGNATURE_MODULES = {
    toolbar: [
        ['bold', 'italic', 'underline', 'link'],
        [{ 'color': [] }]
    ]
};

export default function MatchResultsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === 'unauthenticated') {
            signIn('google'); // Auto-redirect to login if not signed in
        }
    }, [status]);

    const userEmail = session?.user?.email || 'Unknown User';
    const [candidates, setCandidates] = useState([]);
    const [jobDescription, setJobDescription] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [abortController, setAbortController] = useState(null);
    const [results, setResults] = useState(null);
    const [analysisLogs, setAnalysisLogs] = useState([]);
    const [processedCount, setProcessedCount] = useState(0);
    const [expanded, setExpanded] = useState(true);
    const [isExtracting, setIsExtracting] = useState(false);
    const [showJobDetails, setShowJobDetails] = useState(false);

    // Email Template State
    const [jobTitle, setJobTitle] = useState('');
    const [fullEmailJD, setFullEmailJD] = useState('');
    const [requiredDetails, setRequiredDetails] = useState('');
    const [location, setLocation] = useState('');
    const [rate, setRate] = useState('');
    const [expRange, setExpRange] = useState('');
    const [client, setClient] = useState('');
    const [workMode, setWorkMode] = useState('');
    const [employmentType, setEmploymentType] = useState('');
    const [visa, setVisa] = useState('');
    const [jdLink, setJdLink] = useState('');
    const careersLink = 'https://careers.innovcentric.com/jobs';
    const [sendingEmails, setSendingEmails] = useState({}); // Track row-level sending state
    const [isBulkSending, setIsBulkSending] = useState(false);
    const [selectedIndices, setSelectedIndices] = useState(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
    const [showAdvancedSelect, setShowAdvancedSelect] = useState(false);
    const [matchThreshold, setMatchThreshold] = useState(0);
    const [gapThreshold, setGapThreshold] = useState(100);
    const [showRecipientManager, setShowRecipientManager] = useState(false);

    // Email Preview Modal State
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewData, setPreviewData] = useState({
        to: '',
        cc: '',
        subject: '',
        body: '',
        signature: '\n\nBest regards,\nRecruiting Team\nInnovcentric LLC',
        candidate: null,
        jobInfo: null,
    });
    const [currentBulkIndex, setCurrentBulkIndex] = useState(0);
    const [bulkSendList, setBulkSendList] = useState([]);

    useEffect(() => {
        const storedCandidates = sessionStorage.getItem('selectedCandidatesForMatch');
        if (storedCandidates) setCandidates(JSON.parse(storedCandidates));

        const storedJD = sessionStorage.getItem('matchJobDescription');
        if (storedJD) {
            setJobDescription(storedJD);
            setFullEmailJD(storedJD);
        }

        const storedResults = sessionStorage.getItem('matchResults');
        if (storedResults) setResults(JSON.parse(storedResults));
    }, []);

    // [NEW] Auto-extract Role from JD if not set
    useEffect(() => {
        if (!jobDescription || jobTitle) return;

        // Simple regex to find "Title: ..." or "Role: ..."
        const titleMatch = jobDescription.match(/(?:Title|Role|Position|Job Title):\s*(.+)/i);
        if (titleMatch && titleMatch[1]) {
            setJobTitle(titleMatch[1].trim());
        }
    }, [jobDescription, jobTitle]);

    // [NEW] AI Field Extraction
    const handleExtractFields = async () => {
        if (!jobDescription.trim()) {
            alert("Please paste a Job Description first.");
            return;
        }

        setIsExtracting(true);
        try {
            const response = await fetch('/api/extract-fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobDescription })
            });

            const { data, error } = await response.json();
            if (error) throw new Error(error);

            if (data) {
                if (data.jobTitle) setJobTitle(data.jobTitle);
                if (data.location) setLocation(data.location);
                if (data.rate) setRate(data.rate);
                if (data.expRange) setExpRange(data.expRange);
                if (data.client) setClient(data.client);
                if (data.workMode) setWorkMode(data.workMode);
                if (data.visa) setVisa(data.visa);
            }
        } catch (error) {
            console.error("Extraction Error:", error);
            const msg = error.message.includes("timeout")
                ? "The request timed out. The JD might be too complex or the service is busy. Please try again."
                : error.message;
            alert("Failed to auto-fill fields: " + msg);
        } finally {
            setIsExtracting(false);
        }
    };

    const handleAnalyze = async () => {
        if (!jobDescription.trim()) {
            alert("Please enter a Job Description");
            return;
        }

        if (candidates.length === 0) {
            alert("No candidates found to analyze.");
            return;
        }

        const controller = new AbortController();
        setAbortController(controller);
        setIsAnalyzing(true);
        setResults([]); // Clear previous results to show live "dripping"
        setProcessedCount(0);
        setAnalysisLogs([
            { time: new Date().toLocaleTimeString(), type: 'success', message: '🚀 Match Engine Initializing...' },
            { time: new Date().toLocaleTimeString(), type: 'success', message: '🔍 Strategy: Inch-to-Inch Deep Reasoning' }
        ]);

        try {
            const chunkSize = 10;
            const finalResults = [];

            for (let i = 0; i < candidates.length; i += chunkSize) {
                if (controller.signal.aborted) break;

                const chunk = candidates.slice(i, i + chunkSize);
                const chunkNames = chunk.map(c => c.Name).join(', ');

                setAnalysisLogs(prev => [...prev, {
                    time: new Date().toLocaleTimeString(),
                    type: 'success',
                    message: `⚡ Analyzing Batch: ${chunkNames}`
                }]);

                const response = await fetch('/api/match', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        jobDescription,
                        candidates: chunk,
                        processedBy: session?.user?.email || 'N/A'
                    })
                });

                const data = await response.json();
                if (data.results) {
                    finalResults.push(...data.results);
                    setResults(prev => [...(prev || []), ...data.results]);
                    setProcessedCount(prev => prev + chunk.length);

                    // PUSH HIGH-FIDELITY REPORTS TO TERMINAL
                    data.results.forEach(res => {
                        if (res.gapAnalysis) {
                            setAnalysisLogs(prev => [...prev, {
                                time: new Date().toLocaleTimeString(),
                                type: 'report',
                                message: res.gapAnalysis
                            }]);
                        }
                    });

                    setAnalysisLogs(prev => [...prev, {
                        time: new Date().toLocaleTimeString(),
                        type: 'success',
                        message: `✅ Batch Complete: ${data.results.length} processed.`
                    }]);
                } else {
                    throw new Error(data.error || "Batch analysis failed");
                }
            }

            setAnalysisLogs(prev => [...prev, {
                time: new Date().toLocaleTimeString(),
                type: 'success',
                message: '🏁 Analysis Complete! Finalizing report...'
            }]);

        } catch (error) {
            if (error.name === 'AbortError') {
                setAnalysisLogs(prev => [...prev, {
                    time: new Date().toLocaleTimeString(),
                    type: 'error',
                    message: '🛑 Analysis Stopped by User.'
                }]);
                console.log("Analysis aborted by user.");
            } else {
                console.error("Analysis Error:", error);
                setAnalysisLogs(prev => [...prev, {
                    time: new Date().toLocaleTimeString(),
                    type: 'error',
                    message: `❌ Error: ${error.message}`
                }]);
                alert("Analysis encountered an error.");
            }
        } finally {
            setIsAnalyzing(false);
            setAbortController(null);
        }
    };

    const handleStopAnalysis = () => {
        if (abortController) {
            abortController.abort();
            setIsAnalyzing(false);
            setAbortController(null);
        }
    };

    const getMatchColor = (percentage) => {
        if (percentage >= 80) return '#198754'; // Success Green
        if (percentage >= 50) return '#fd7e14'; // Orange
        return '#dc3545'; // Red
    };

    const toggleSelectAll = () => {
        if (!results) return;
        if (selectedIndices.size === results.length) {
            setSelectedIndices(new Set());
        } else {
            setSelectedIndices(new Set(results.map((_, i) => i)));
        }
    };

    const applyGapFilter = () => {
        if (!results) return;
        const newSelected = new Set(selectedIndices);
        let addedCount = 0;

        results.forEach((c, i) => {
            const matchP = c.matchPercentage || 0;
            const missingP = 100 - matchP;
            if (missingP <= gapThreshold) {
                if (!newSelected.has(i)) {
                    newSelected.add(i);
                    addedCount++;
                }
            }
        });

        setSelectedIndices(newSelected);
        if (addedCount > 0) {
            console.log(`Auto-selected ${addedCount} candidates based on M% ≤ ${gapThreshold}%`);
        }
    };

    const toggleSelectCandidate = (e, index) => {
        e.stopPropagation();
        const isShiftKey = e.nativeEvent.shiftKey;
        const newSelected = new Set(selectedIndices);

        if (isShiftKey && lastSelectedIndex !== null) {
            // Range selection logic
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const isRemoving = !newSelected.has(index); // Based on the current target's desired state

            for (let i = start; i <= end; i++) {
                if (newSelected.has(index)) {
                    newSelected.delete(i);
                } else {
                    newSelected.add(i);
                }
            }
        } else {
            // Toggling single item
            if (newSelected.has(index)) {
                newSelected.delete(index);
            } else {
                newSelected.add(index);
            }
        }

        setSelectedIndices(newSelected);
        setLastSelectedIndex(index);
    };

    const applyFilterSelect = () => {
        if (!results) return;
        const newSelected = new Set(selectedIndices);
        let addedCount = 0;
        results.forEach((c, i) => {
            const matchP = c.matchPercentage || 0;
            const missingP = c.missingPercentage || 0;
            if (matchP >= matchThreshold && missingP <= gapThreshold) {
                if (!newSelected.has(i)) addedCount++;
                newSelected.add(i);
            }
        });
        setSelectedIndices(newSelected);
        if (addedCount > 0) {
            // Optional: You could add a toast here, but simple alert is safer for now
            console.log(`Auto-selected ${addedCount} more candidates.`);
        }
    };
    // Helper: Consolidate Sender + Candidate emails & return structured list
    // Helper: Consolidate Sender + Candidate emails & return structured list
    const getRecipientList = (candidate) => {
        const rawEmails = [];
        if (candidate.Sender) rawEmails.push({ raw: candidate.Sender, type: 'Sender' });
        if (candidate.Email) rawEmails.push({ raw: candidate.Email, type: 'Candidate' });

        const seen = new Set();
        const result = [];

        rawEmails.forEach(item => {
            const raw = item.raw.trim();
            if (!raw || raw.toLowerCase().includes("@innovcentric.com")) return;

            // Extract core email: "Name <email@domain.com>" -> "email@domain.com"
            let email = raw;
            const match = raw.match(/<(.+?)>/);
            if (match && match[1]) {
                email = match[1].trim();
            }

            // FILTER: Skip "Not found", "N/A", or empty
            const lowerRaw = raw.toLowerCase();
            if (lowerRaw.includes("not found") || lowerRaw.includes("n/a") || !email) return;

            const lowerEmail = email.toLowerCase();

            if (!seen.has(lowerEmail)) {
                seen.add(lowerEmail);
                result.push({
                    email: email,      // Core email for sending
                    display: raw,      // Full string for UI
                    type: item.type,
                    active: true
                });
            }
        });

        return result;
    };


    const getValidEmails = (candidate) => {
        return getRecipientList(candidate)
            .map(r => r.email)
            .join(", ");
    };

    const handleBulkEmail = async () => {
        if (selectedIndices.size === 0) {
            alert("Please select at least one candidate to send bulk emails.");
            return;
        }

        const selectedCandidatesList = results.filter((_, i) => selectedIndices.has(i));
        const bulkList = selectedCandidatesList.map(cand => {
            const recipient = getRecipientInfo(cand.Name, cand.Sender || cand.Email);
            const gaps = [];
            cand.partialMatchSkills?.forEach(s => {
                const hasExp = s.candidateHas || s.has || '';
                const hasZeroExp = hasExp.includes('0 years') || hasExp.includes('0 months') || hasExp === '0';
                if (hasZeroExp) {
                    gaps.push({ skill: s.skill, req: s.jdRequirement || s.req, has: 'Not Found', status: 'Missing' });
                } else {
                    gaps.push({ skill: s.skill, req: s.jdRequirement || s.req, has: hasExp, status: 'Partial Match' });
                }
            });
            cand.missingSkills?.forEach(s => gaps.push({ skill: typeof s === 'string' ? s : s.skill, req: typeof s === 'object' ? (s.jdRequirement || s.req || 'Required') : 'Required', has: 'Not Found', status: 'Missing' }));
            cand.missingCertifications?.forEach(cert => gaps.push({ skill: typeof cert === 'object' ? (cert.name || cert.skill || 'Certification') : cert, req: 'Must Have', has: 'Not Found', status: 'Missing' }));

            const recipients = getRecipientList(cand);
            return {
                to: recipients, // Store structured list now
                candidate: { 
                    displayName: recipient.name, 
                    gaps: gaps, 
                    name: cand.Name,
                    missingSkills: cand.missingSkills || [],
                    missingCertifications: cand.missingCertifications || [],
                    partialMatchSkills: cand.partialMatchSkills || [],
                    matchPercentage: cand.matchPercentage || 0
                },
                body: `Hello ${recipient.name},<br/><br/>Thank you for sharing your resume.<br/><br/>Please provide your <strong>updated resume</strong> along with the <strong>required details and documents</strong> for further processing. Kindly review the <strong>job description</strong> for complete role details <a href="${jdLink || '#'}" style="color: #dc2626; font-weight: bold; text-decoration: none;">[Click for JD]</a>.<br/><br/>If you have relevant experience in the <strong>skills identified in the gap analysis</strong> that are not currently reflected in your resume, please update it to <strong>accurately represent your experience</strong>.`,
                matchedSkills: cand.matchedSkills || [],
                partialMatchSkills: cand.partialMatchSkills || [],
                missingSkills: cand.missingSkills || []
            };
        });

        // FILTER out candidates with no valid emails for bulk send
        const filteredBulkList = bulkList.filter(item => item.to !== "");

        if (filteredBulkList.length === 0) {
            alert("None of the selected candidates have a valid external email address.");
            return;
        }

        setBulkSendList(filteredBulkList);
        setCurrentBulkIndex(0);

        const firstBulkItem = filteredBulkList[0];
        if (!firstBulkItem || !firstBulkItem.candidate) {
            alert("No valid candidate data found.");
            return;
        }

        const activeEmails = firstBulkItem.to.filter(r => r.active).map(r => r.email).join(', ');

        setPreviewData({
            to: activeEmails,
            cc: '',
            subject: `${firstBulkItem.candidate.name}: ${jobTitle || 'New Opening'} - Match Report`,
            body: firstBulkItem.body,
            signature: '\n\nBest regards,\nRecruiting Team\nInnovcentric LLC',
            candidate: { ...firstBulkItem.candidate, requiredDetails: requiredDetails },
            jobInfo: { title: jobTitle, location: location, rate: rate, exp: expRange, client: client, mode: workMode, visa: visa, jdLink: jdLink },
            index: -1 // Indicates bulk send
        });
        setIsPreviewOpen(true);
    };

    const handleBulkNav = (direction) => {
        const nextIndex = currentBulkIndex + direction;
        if (nextIndex < 0 || nextIndex >= bulkSendList.length) return;

        // SAVE current edits to the list before flipping
        const updatedList = [...bulkSendList];
        updatedList[currentBulkIndex] = {
            ...updatedList[currentBulkIndex],
            body: previewData.body
        };
        setBulkSendList(updatedList);

        const nextItem = updatedList[nextIndex];
        setCurrentBulkIndex(nextIndex);

        const activeEmails = nextItem.to.filter(r => r.active).map(r => r.email).join(', ');

        // Update preview content for the next candidate
        setPreviewData(prev => ({
            ...prev,
            to: activeEmails,
            subject: `${nextItem.candidate.name}: ${jobTitle || 'New Opening'} - Match Report`,
            body: nextItem.body, // Use the stored (potentially edited) body
            candidate: { ...nextItem.candidate, requiredDetails: requiredDetails }
        }));
    };

    const handleApplyAll = () => {
        if (!bulkSendList || bulkSendList.length <= 1) return;
        
        // 1. Identify the 'template' from the current previewData.body
        const currentBody = previewData.body;
        
        // Try to find the first closing paragraph tag (ReactQuill uses <p> for lines)
        const pCloseIdx = currentBody.indexOf('</p>');
        let templatePart = "";
        if (pCloseIdx !== -1) {
            templatePart = currentBody.substring(pCloseIdx + 4);
        } else {
            // Fallback for non-HTML/simple text
            const firstNewline = currentBody.indexOf('\n');
            if (firstNewline !== -1) {
                templatePart = currentBody.substring(firstNewline);
            } else {
                templatePart = currentBody; 
            }
        }

        // 2. Apply this template to all items in the list
        const updatedList = bulkSendList.map((item, idx) => {
            // Preservation logic: Keep the greeting of the target candidate
            const targetGreeting = item.body.indexOf('</p>') !== -1 
                ? item.body.substring(0, item.body.indexOf('</p>') + 4)
                : (item.body.split('\n')[0] || "");
            
            return {
                ...item,
                body: targetGreeting + templatePart
            };
        });

        setBulkSendList(updatedList);
        
        // Update current preview too to reflect the change immediately
        setPreviewData(prev => ({
            ...prev,
            body: updatedList[currentBulkIndex].body
        }));

        alert(`✅ Template applied to all ${updatedList.length} candidates! Headers (Greetings) were preserved.`);
    };

    // Helper: Detect Recipient Type
    const getRecipientInfo = (name, email) => {
        if (!email) return { type: 'Candidate', name: name || 'Candidate' };

        const isCandidate = /@(gmail|yahoo|outlook|hotmail|icloud|me|live)\./i.test(email);
        const type = isCandidate ? 'Candidate' : 'Sender';

        let displayName = name || '';
        if (!displayName && email) {
            displayName = email.split('@')[0];
            // Capitalize first letter
            displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
        }

        return { type, name: displayName || type };
    };

    const handleSendRichEmail = (candidate, index) => {
        const toEmail = getValidEmails(candidate);
        if (!toEmail) {
            alert("No email address found for this candidate.");
            return;
        }

        const recipient = getRecipientInfo(candidate.Name, toEmail.split(',')[0]); // Use first primary email for greeting
        const ccEmail = ''; // Consolidating all in TO field

        // Prepare initial content with defensive categorization
        const gaps = [];
        candidate.partialMatchSkills?.forEach(s => {
            const hasExp = s.candidateHas || s.has || '';
            const hasZeroExp = hasExp.includes('0 years') || hasExp.includes('0 months') || hasExp === '0';
            if (hasZeroExp) {
                gaps.push({ skill: s.skill, req: s.jdRequirement || s.req, has: 'Not Found', status: 'Missing' });
            } else {
                gaps.push({ skill: s.skill, req: s.jdRequirement || s.req, has: hasExp, status: 'Partial Match' });
            }
        });
        candidate.missingSkills?.forEach(s => gaps.push({ skill: typeof s === 'string' ? s : s.skill, req: typeof s === 'object' ? (s.jdRequirement || s.req || 'Required') : 'Required', has: 'Not Found', status: 'Missing' }));
        candidate.missingCertifications?.forEach(cert => gaps.push({ skill: typeof cert === 'object' ? (cert.name || cert.skill || 'Certification') : cert, req: 'Must Have', has: 'Not Found', status: 'Missing' }));

        setPreviewData({
            to: toEmail,
            cc: ccEmail,
            subject: `${candidate.Name}: ${jobTitle || 'New Opening'} - Match Report`,
            body: `Hello ${recipient.name},<br/><br/>Thank you for sharing your resume.<br/><br/>Please provide your <strong>updated resume</strong> along with the <strong>required details and documents</strong> for further processing. Kindly review the <strong>job description</strong> for complete role details <a href="${jdLink || '#'}" style="color: #dc2626; font-weight: bold; text-decoration: none;">[Click for JD]</a>.<br/><br/>If you have relevant experience in the <strong>skills identified in the gap analysis</strong> that are not currently reflected in your resume, please update it to <strong>accurately represent your experience</strong>.`,
            signature: '\n\nBest regards,\nRecruiting Team\nInnovcentric LLC',
            candidate: { 
                displayName: recipient.name, 
                gaps: gaps, 
                requiredDetails: requiredDetails,
                missingSkills: candidate.missingSkills || [],
                missingCertifications: candidate.missingCertifications || [],
                partialMatchSkills: candidate.partialMatchSkills || [],
                matchPercentage: candidate.matchPercentage || 0,
                name: candidate.Name
            },
            jobInfo: { title: jobTitle, location: location, rate: rate, exp: expRange, client: client, mode: workMode, visa: visa, jdLink: jdLink },
            index: index
        });
        setIsPreviewOpen(true);
    };

    const confirmSendEmail = async () => {
        const { index, to, cc, subject, body, signature, candidate, jobInfo } = previewData;

        if (index === -1) {
            // BULK SEND MODE
            // Save current edits from modal to the list one last time before sending
            const finalBulkList = [...bulkSendList];
            finalBulkList[currentBulkIndex] = {
                ...finalBulkList[currentBulkIndex],
                body: previewData.body
            };

            setIsBulkSending(true);
            setIsPreviewOpen(false);

            let successCount = 0;
            for (let i = 0; i < finalBulkList.length; i++) {
                const item = finalBulkList[i];
                const activeTo = item.to.filter(r => r.active).map(r => r.email).join(', ');
                
                if (!activeTo) continue; // Skip if no emails active for this candidate

                // Find matching original index in results for status tracking
                const candResultIndex = results.findIndex(r => r.Name === item.candidate.name && (item.to.some(rt => rt.email === r.Sender || rt.email === r.Email)));

                if (candResultIndex !== -1) {
                    setSendingEmails(prev => ({ ...prev, [candResultIndex]: 'sending' }));
                }

                try {
                    const response = await fetch('/api/send-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            to: activeTo,
                            cc: cc,
                            subject: `Match Report: ${jobTitle || 'New Opening'} - ${item.candidate.name}`,
                            customIntro: item.body, // Using the personalized (and potentially edited) body
                            signature: signature,
                            candidate: { ...item.candidate, requiredDetails: requiredDetails },
                            jobInfo: jobInfo,
                            careersLink: careersLink
                        })
                    });

                    const data = await response.json();
                    if (data.success) {
                        successCount++;
                        if (candResultIndex !== -1) {
                            setSendingEmails(prev => ({ ...prev, [candResultIndex]: 'sent' }));
                        }
                    } else {
                        if (candResultIndex !== -1) {
                            setSendingEmails(prev => ({ ...prev, [candResultIndex]: null }));
                        }
                    }
                } catch (err) {
                    console.error("Bulk Send Individual Error:", err);
                    if (candResultIndex !== -1) {
                        setSendingEmails(prev => ({ ...prev, [candResultIndex]: null }));
                    }
                }
                // Small stagger
                await new Promise(r => setTimeout(r, 400));
            }

            setIsBulkSending(false);
            setSelectedIndices(new Set()); // Clear selection after bulk send
            alert(`Bulk mission complete! Successfully delivered ${successCount} individual reports.`);

            setTimeout(() => {
                setSendingEmails({});
            }, 5000);

            return;
        }

        // SINGLE SEND MODE
        setSendingEmails(prev => ({ ...prev, [index]: 'sending' }));
        setIsPreviewOpen(false);

        try {
            const response = await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: to,
                    cc: cc,
                    subject: subject,
                    customIntro: body,
                    signature: signature,
                    candidate: candidate,
                    jobInfo: jobInfo,
                    careersLink: careersLink
                })
            });

            const data = await response.json();
            if (data.success) {
                setSendingEmails(prev => ({ ...prev, [index]: 'sent' }));
                setTimeout(() => {
                    setSendingEmails(prev => ({ ...prev, [index]: null }));
                }, 3000);
            } else {
                throw new Error(data.error || 'Failed to send');
            }
        } catch (err) {
            console.error("Email Error:", err);
            alert("Failed to send email: " + err.message);
            setSendingEmails(prev => ({ ...prev, [index]: null }));
        }
    };
    const formatEmailBody = (candidate) => {
        const recipient = getRecipientInfo(candidate.Name, candidate.Email || candidate.Sender);

        const jobTable = `
--------------------------------------------------
| JOB DETAILS PANEL
--------------------------------------------------
| Click for Full JD : ${jdLink || '[Link]'}
| Role              : ${jobTitle || '[Role]'}
| Locations         : ${location || '[Location]'}
| Rate              : ${rate || '[Rate]'}
| Exp               : ${expRange || '[Exp Range]'}
| Client/Work Mode  : ${client || '[Client]'} (${workMode || '[Mode]'})
--------------------------------------------------
`;

        // Missing Skills Table
        let skillsTable = `
--------------------------------------------------------------------------------
| MISSING SKILLS ANALYSIS PANEL
--------------------------------------------------------------------------------
| Skill                | JD Req    | Resume    | Status
--------------------------------------------------------------------------------
`;

        const missing = candidate.missingSkills || [];
        const partial = candidate.partialMatchSkills || [];
        const certifications = candidate.missingCertifications || [];

        partial.forEach(s => {
            const skillName = (s.skill || '').padEnd(20).substring(0, 20);
            const req = (s.jdRequirement || s.req || '').padEnd(10).substring(0, 10);
            const has = (s.candidateHas || s.has || '').padEnd(10).substring(0, 10);
            skillsTable += `| ${skillName} | ${req} | ${has} | Partial Match\n`;
        });

        certifications.forEach(c => {
            const certName = (typeof c === 'string' ? c : (c.name || c.skill || '')).padEnd(20).substring(0, 20);
            skillsTable += `| ${certName} | Required  | Missing   | Missing Cert\n`;
        });

        missing.forEach(s => {
            const skillName = (typeof s === 'string' ? s : (s.skill || '')).padEnd(20).substring(0, 20);
            skillsTable += `| ${skillName} | Required  | Missing   | Missing\n`;
        });

        if (missing.length === 0 && partial.length === 0 && !candidate.gapAnalysis) {
            skillsTable += `| No major gaps identified! Matches JD requirements well. |\n`;
        }

        skillsTable += `--------------------------------------------------------------------------------`;

        const reqDetailsBlock = requiredDetails ? `\n\n📝 REQUIRED DETAILS:\n${requiredDetails}` : '';

        return `Hello ${recipient.name} (${recipient.type}),

I hope you're doing well. We have an opening for ${jobTitle || 'Full Stack Developer'} that matches this profile.

${jobTable}

${skillsTable}

${reqDetailsBlock}

For more positions from Innovcentric LLC, please visit our Careers Page: ${careersLink}

Best regards,
Recruiting Team
Innovcentric LLC`;
    };


    // [NEW] Portal Tooltip State
    const [tooltipData, setTooltipData] = useState({ visible: false, content: null, x: 0, y: 0, showAbove: false });

    const handleMouseEnter = (e, content) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const showAbove = rect.bottom > window.innerHeight - 200;
        setTooltipData({
            visible: true,
            content,
            x: rect.left + rect.width / 2,
            y: showAbove ? rect.top - 10 : rect.bottom + 10,
            showAbove
        });
    };

    const handleMouseLeave = () => {
        setTooltipData({ ...tooltipData, visible: false });
    };

    const [expandedRows, setExpandedRows] = useState({});

    const toggleRow = (index) => {
        setExpandedRows(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    return (
        <div style={{
            height: '100vh',
            width: '100vw',
            background: 'white',
            fontFamily: "'Inter', sans-serif",
            color: '#1e293b',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        }}>
            <style jsx global>{`
                body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
                /* Clean Corporate Animations */
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes glowPulse {
                    0% { box-shadow: 0 0 5px rgba(220, 38, 38, 0.4); transform: scale(1); }
                    50% { box-shadow: 0 0 20px rgba(220, 38, 38, 0.7); transform: scale(1.05); }
                    100% { box-shadow: 0 0 5px rgba(220, 38, 38, 0.4); transform: scale(1); }
                }
                .animate-fade { animation: fadeInUp 0.4s ease-out forwards; }

                /* Corporate Inputs */
                .corp-input {
                    transition: all 0.2s ease;
                    border: 1px solid #e2e8f0;
                    background: #fff;
                    font-size: 13px;
                    color: #0f172a;
                    border-radius: 12px;
                }
                .corp-input:focus {
                    border-color: #6366f1;
                    outline: 0;
                    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
                    background: #fff;
                }
                .corp-input::placeholder {
                    color: #94a3b8;
                    font-size: 12px;
                }

                /* Corporate Buttons */
                .corp-button {
                    background-color: #0d6efd;
                    color: white;
                    border: none;
                    transition: all 0.2s;
                    font-weight: 600;
                    cursor: pointer;
                }
                .corp-button:hover { background-color: #0b5ed7; }
                .corp-button:disabled { background-color: #6c757d; cursor: not-allowed; opacity: 0.65; }

                /* Corporate Card */
                .corp-card {
                    background: #fff;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
                }

                /* Corporate Table */
                .corp-table tr { border-bottom: 1px solid #dee2e6; cursor: pointer; }
                .corp-table tr:hover { background-color: #e9ecef !important; }
                .corp-table th {
                    background-color: #f8f9fa;
                    border-bottom: 2px solid #dee2e6;
                    font-weight: 700;
                    color: #495057;
                    text-transform: uppercase;
                    font-size: 11px;
                    letter-spacing: 0.5px;
                }
                .corp-table td { vertical-align: middle; }

                /* Global Scrollbar Refinement */
                *::-webkit-scrollbar { width: 6px; height: 6px; }
                *::-webkit-scrollbar-track { background: transparent; }
                *::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
                *::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
                
                /* Textarea specific */
                textarea { resize: none; }
            `}</style>

            {/* Premium Header Transformation */}
            <div className="animate-fade" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 10px',
                background: 'rgba(255, 255, 255, 0.4)',
                backdropFilter: 'blur(10px)',
                borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
                flexShrink: 0,
                width: '100%'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', width: '36px', height: '36px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(99,102,241,0.2)' }}>
                        <span style={{ fontSize: '20px' }}>🚀</span>
                    </div>
                    <div>
                        <h1 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.5px' }}>
                            AI Candidate Matcher
                        </h1>
                        <p style={{ margin: 0, fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Deep analysis & candidate matching engine</p>
                    </div>
                </div>
                <button
                    onClick={() => router.back()}
                    style={{
                        padding: '8px 24px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: '800',
                        background: 'white',
                        border: '1.5px solid #e2e8f0',
                        cursor: 'pointer',
                        color: '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.3px'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; e.currentTarget.style.transform = 'translateX(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'translateX(0)'; }}
                >
                    <span style={{ fontSize: '16px' }}>←</span> Back to Dashboard
                </button>
            </div>

            {/* Main Content Grid */}
            <div style={{
                flex: 1,
                display: 'grid',
                gridTemplateColumns: '280px 1fr',
                gap: '0px',
                padding: '0',
                overflow: 'hidden',
                alignItems: 'stretch'
            }}>

                {/* LEFT PANEL: Inputs (PREMIUM REFINEMENT) */}
                <div className="animate-fade" style={{
                    padding: '16px',
                    background: 'white',
                    borderRadius: '0',
                    borderRight: '1.5px solid rgba(226, 232, 240, 0.8)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    animationDelay: '0.1s',
                    height: '100%',
                    overflow: 'hidden'
                }}>
                    <h2 style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1.5px solid #f1f5f9', paddingBottom: '8px', margin: '0 0 2px 0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '14px' }}>⚙️</span> Setup Analysis
                    </h2>

                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>

                        {/* Section 1: AI JD Analysis (PRIMARY) */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '9px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1.2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ height: '1px', flex: 1, background: '#f1f5f9' }}></div>
                                Context & Analysis
                                <div style={{ height: '1px', flex: 1, background: '#f1f5f9' }}></div>
                            </div>
                            <div style={{ flexShrink: 0 }}>
                                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span>🧠</span> AI JD Analysis</span>
                                    <button
                                        onClick={handleExtractFields}
                                        disabled={isExtracting || !jobDescription.trim()}
                                        style={{
                                            padding: '2px 8px',
                                            borderRadius: '6px',
                                            fontSize: '8px',
                                            fontWeight: '800',
                                            background: isExtracting ? '#f1f5f9' : '#6366f1',
                                            color: isExtracting ? '#94a3b8' : 'white',
                                            border: 'none',
                                            cursor: isExtracting || !jobDescription.trim() ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.5px'
                                        }}
                                    >
                                        {isExtracting ? '✨ Extracting...' : '✨ Auto-Fill Fields'}
                                    </button>
                                </label>
                                <textarea
                                    value={jobDescription}
                                    onChange={(e) => setJobDescription(e.target.value)}
                                    placeholder="Paste JD for AI matching..."
                                    className="corp-input"
                                    style={{
                                        width: '100%',
                                        height: '140px',
                                        padding: '6px 10px',
                                        border: '1px solid #e2e8f0',
                                        lineHeight: '1.4',
                                        fontSize: '11px'
                                    }}
                                />
                            </div>

                            <div style={{ flexShrink: 0 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                    <span>🔗</span> JD Link
                                </label>
                                <input
                                    type="text"
                                    value={jdLink}
                                    onChange={(e) => setJdLink(e.target.value)}
                                    placeholder="Paste req link here..."
                                    className="corp-input"
                                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                />
                            </div>

                            <button
                                onClick={() => setShowJobDetails(!showJobDetails)}
                                style={{
                                    alignSelf: 'flex-start',
                                    background: 'none',
                                    border: 'none',
                                    color: '#6366f1',
                                    fontSize: '10px',
                                    fontWeight: '700',
                                    cursor: 'pointer',
                                    padding: '4px 0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}
                            >
                                {showJobDetails ? '🔽 Hide Details' : '⚙️ Edit Job Details'}
                            </button>
                        </div>

                        {/* Collapsible Section for Manual Details */}
                        {showJobDetails && (
                            <div className="animate-fade" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* Section 2: Essentials */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #f1f5f9', paddingBottom: '2px' }}>Job Essentials</div>

                                    <div style={{ flexShrink: 0 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                            <span>📝</span> Job Title
                                        </label>
                                        <input
                                            type="text"
                                            value={jobTitle}
                                            onChange={(e) => setJobTitle(e.target.value)}
                                            placeholder="e.g. Full Stack Developer"
                                            className="corp-input"
                                            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                        />
                                    </div>

                                    <div style={{ flexShrink: 0 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                            <span>📍</span> Locations
                                        </label>
                                        <input
                                            type="text"
                                            value={location}
                                            onChange={(e) => setLocation(e.target.value)}
                                            placeholder="e.g. New York, NY"
                                            className="corp-input"
                                            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                                <span>💰</span> Rate
                                            </label>
                                            <input
                                                type="text"
                                                value={rate}
                                                onChange={(e) => setRate(e.target.value)}
                                                placeholder="$60/hr"
                                                className="corp-input"
                                                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                                <span>⏳</span> Exp
                                            </label>
                                            <input
                                                type="text"
                                                value={expRange}
                                                onChange={(e) => setExpRange(e.target.value)}
                                                placeholder="3-8 Yrs"
                                                className="corp-input"
                                                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 3: Logistics */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ fontSize: '9px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #f1f5f9', paddingBottom: '2px' }}>Logistics & Links</div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                                <span>🔷</span> Client
                                            </label>
                                            <input
                                                type="text"
                                                value={client}
                                                onChange={(e) => setClient(e.target.value)}
                                                placeholder="e.g. TCS"
                                                className="corp-input"
                                                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                                <span>🏠</span> Mode
                                            </label>
                                            <input
                                                type="text"
                                                value={workMode}
                                                onChange={(e) => setWorkMode(e.target.value)}
                                                placeholder="Onsite"
                                                className="corp-input"
                                                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ flexShrink: 0 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                            <span>🛂</span> Visa
                                        </label>
                                        <input
                                            type="text"
                                            value={visa}
                                            onChange={(e) => setVisa(e.target.value)}
                                            placeholder="H1B/GC/USC"
                                            className="corp-input"
                                            style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Section 4: Required Details (Always Visible) */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ flexShrink: 0 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', marginBottom: '2px', fontSize: '9px', color: '#64748b', textTransform: 'uppercase' }}>
                                    <span>📌</span> Req. Details
                                </label>
                                <textarea
                                    value={requiredDetails}
                                    onChange={(e) => setRequiredDetails(e.target.value)}
                                    placeholder="e.g. Visa Copy, Resume..."
                                    className="corp-input"
                                    style={{ width: '100%', height: '80px', padding: '6px 10px', border: '1px solid #e2e8f0', lineHeight: '1.4', fontSize: '11px' }}
                                />
                            </div>
                        </div>

                    </div>

                    <button
                        onClick={isAnalyzing ? handleStopAnalysis : handleAnalyze}
                        disabled={!isAnalyzing && candidates.length === 0}
                        style={{
                            marginTop: 'auto',
                            width: '100%',
                            padding: '12px',
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: '800',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            flexShrink: 0,
                            background: isAnalyzing ? '#ef4444' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                            color: 'white',
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: isAnalyzing ? '0 4px 14px 0 rgba(239, 68, 68, 0.39)' : '0 4px 14px 0 rgba(99, 102, 241, 0.39)',
                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            letterSpacing: '0.3px',
                            textTransform: 'uppercase'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = isAnalyzing ? '0 6px 20px rgba(239, 68, 68, 0.45)' : '0 6px 20px rgba(99, 102, 241, 0.45)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = isAnalyzing ? '0 4px 14px 0 rgba(239, 68, 68, 0.39)' : '0 4px 14px 0 rgba(99, 102, 241, 0.39)'; }}
                    >
                        {isAnalyzing ? (
                            <><span>🛑</span> STOP</>
                        ) : (
                            <><span>🚀</span> Start Analysis</>
                        )}
                    </button>
                </div>

                {/* RIGHT PANEL: Results */}
                <div className="animate-fade" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    animationDelay: '0.2s',
                    height: '100%',
                    overflow: 'hidden'
                }}>

                    {isAnalyzing ? (
                        /* TERMINAL ONLY MODE DURING ANALYSIS */
                        <LiveProgressTracker
                            totalCandidates={candidates.length}
                            processedCount={processedCount}
                            currentStatus={analysisLogs[analysisLogs.length - 1]?.message}
                            details={analysisLogs}
                        />
                    ) : (
                        results && results.length > 0 ? (
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                                background: 'white'
                            }}>
                                {/* Summary Header (PREMIUM REDESIGN) */}
                                <div
                                    style={{
                                        padding: '8px 20px',
                                        background: 'rgba(255,255,255,0.7)',
                                        borderBottom: '1px solid #e2e8f0',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        transition: 'all 0.2s',
                                        flexShrink: 0,
                                        boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.02)',
                                        zIndex: 10
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                        {/* Date Badge */}
                                        <div style={{ background: 'white', padding: '4px 12px', borderRadius: '20px', border: '1.5px solid #f1f5f9', display: 'flex', flexDirection: 'column', minWidth: '90px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                            <span style={{ color: '#94a3b8', fontSize: '8px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date Generated</span>
                                            <span style={{ fontWeight: '800', fontSize: '11px', color: '#334155' }}>23/02/2026</span>
                                        </div>

                                        {/* Role Badge (Large) */}
                                        <div style={{ background: 'white', padding: '4px 15px', borderRadius: '20px', border: '1.5px solid #f1f5f9', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                            <span style={{ color: '#94a3b8', fontSize: '8px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Analysis Profile</span>
                                            <span style={{ fontWeight: '800', fontSize: '11px', color: '#334155', maxWidth: '350px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {jobTitle || 'HBITS-07-14613 - Medicaid Business Analyst'}
                                            </span>
                                        </div>

                                        {/* Count Badge */}
                                        <div style={{ background: 'white', padding: '4px 15px', borderRadius: '20px', border: '1.5px solid #f1f5f9', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                                            <span style={{ color: '#94a3b8', fontSize: '8px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Results Base</span>
                                            <span style={{ fontWeight: '800', fontSize: '11px', color: '#334155' }}>3 Candidates</span>
                                        </div>

                                        {/* SELECTION CRITERIA FILTERS (NEW LOCATION) */}
                                        {(() => {
                                            const totalCount = results.length;
                                            const filteredCount = results.filter(c => {
                                                const matchP = c.matchPercentage || 0;
                                                const missingP = 100 - matchP;
                                                const meetR = matchP >= (parseInt(matchThreshold) || 0);
                                                const meetM = missingP <= (parseInt(gapThreshold) || 100);
                                                return meetR && meetM;
                                            }).length;
                                            const isFiltered = filteredCount < totalCount;

                                            return (
                                                <div style={{ background: isFiltered ? '#fff1f2' : '#fff7ed', padding: '4px 12px', borderRadius: '20px', border: `1px solid ${isFiltered ? '#fecaca' : '#ffedd5'}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontSize: '8px', fontWeight: '900', color: isFiltered ? '#e11d48' : '#ea580c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            {isFiltered ? `Showing ${filteredCount} of ${totalCount}` : 'Selection Criteria'}
                                                        </span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <span style={{ fontSize: '9px', fontWeight: '800', color: '#6366f1' }}>R≥</span>
                                                                <input
                                                                    type="number"
                                                                    value={matchThreshold}
                                                                    onChange={(e) => setMatchThreshold(e.target.value)}
                                                                    style={{ width: '48px', border: '1.5px solid #e0e7ff', background: 'white', fontSize: '12px', fontWeight: '800', textAlign: 'center', borderRadius: '6px', outline: 'none', color: '#4338ca', padding: '2px 0' }}
                                                                />
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                <span style={{ fontSize: '9px', fontWeight: '800', color: '#ef4444' }}>M≤</span>
                                                                <input
                                                                    type="number"
                                                                    value={gapThreshold}
                                                                    onChange={(e) => setGapThreshold(e.target.value)}
                                                                    style={{ width: '48px', border: '1.5px solid #fee2e2', background: 'white', fontSize: '12px', fontWeight: '800', textAlign: 'center', borderRadius: '6px', outline: 'none', color: '#b91c1c', padding: '2px 0' }}
                                                                />
                                                            </div>
                                                            {isFiltered && (
                                                                <button
                                                                    onClick={() => { setMatchThreshold(0); setGapThreshold(100); }}
                                                                    style={{ padding: '0 6px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', fontSize: '8px', fontWeight: '800', cursor: 'pointer' }}
                                                                >
                                                                    RESET
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleBulkEmail(); }}
                                            disabled={isBulkSending || selectedIndices.size === 0}
                                            style={{
                                                padding: '10px 24px',
                                                borderRadius: '30px',
                                                fontSize: '12px',
                                                fontWeight: '800',
                                                background: (isBulkSending || selectedIndices.size === 0) 
                                                    ? '#f1f5f9' 
                                                    : 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                                                color: (isBulkSending || selectedIndices.size === 0) ? '#94a3b8' : 'white',
                                                border: 'none',
                                                cursor: (isBulkSending || selectedIndices.size === 0) ? 'not-allowed' : 'pointer',
                                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '1px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                boxShadow: (isBulkSending || selectedIndices.size === 0) 
                                                    ? 'none' 
                                                    : '0 4px 14px rgba(79, 70, 229, 0.3)',
                                                transform: 'translateZ(0)'
                                            }}
                                            onMouseEnter={e => { 
                                                if (!isBulkSending && selectedIndices.size > 0) { 
                                                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)'; 
                                                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(79, 70, 229, 0.4)';
                                                } 
                                            }}
                                            onMouseLeave={e => { 
                                                if (!isBulkSending && selectedIndices.size > 0) { 
                                                    e.currentTarget.style.transform = 'translateY(0) scale(1)'; 
                                                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(79, 70, 229, 0.3)';
                                                } 
                                            }}
                                        >
                                            {isBulkSending ? (
                                                <><span>⌛</span> SENDING...</>
                                            ) : (
                                                <><span>🚀</span> SEND TO {selectedIndices.size} SELECTED</>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Detailed Table (PREMIUM REFINEMENT) */}
                                <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 6px 12px' }}>
                                    <table className="corp-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 2px', fontSize: '11px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '4%', background: '#f8fafc', borderRadius: '8px 0 0 8px' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={results && selectedIndices.size === results.length}
                                                        onChange={toggleSelectAll}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                </th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '16%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>Candidate</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '18%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>Contact</th>
                                                <th style={{ padding: '6px 4px', textAlign: 'center', width: '6%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>Exp</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '34%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>Detailed Analysis</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '12%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px' }}>Match Result</th>
                                                <th style={{ padding: '6px 12px', textAlign: 'center', width: '10%', background: '#f8fafc', color: '#64748b', fontWeight: '800', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '0.5px', borderRadius: '0 8px 8px 0' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {results
                                                .filter(c => {
                                                    const matchP = c.matchPercentage || 0;
                                                    const missingP = 100 - matchP;
                                                    const meetR = matchP >= (parseInt(matchThreshold) || 0);
                                                    const meetM = missingP <= (parseInt(gapThreshold) || 100);
                                                    return meetR && meetM;
                                                })
                                                .map((c, i) => {
                                                    const matchP = c.matchPercentage || 0;
                                                    const missingP = 100 - matchP;
                                                    const matchColor = getMatchColor(matchP);
                                                    const isOpen = expandedRows[i];

                                                    // Prepare Tooltip Contents
                                                    const rTooltipContent = (
                                                        <div>
                                                            <div style={{ fontWeight: '700', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '4px' }}>Matched Skills ({c.matchedSkills?.length || 0})</div>
                                                            {c.matchedSkills && c.matchedSkills.length > 0 ? (
                                                                <ul style={{ paddingLeft: '14px', margin: 0 }}>
                                                                    {c.matchedSkills.map((s, idx) => <li key={idx}>{typeof s === 'object' ? s.skill : s}</li>)}
                                                                </ul>
                                                            ) : <span>No specific skills matched.</span>}
                                                        </div>
                                                    );

                                                    const mTooltipContent = (
                                                        <div>
                                                            {c.partialMatchSkills && c.partialMatchSkills.length > 0 && (
                                                                <div style={{ marginBottom: '8px' }}>
                                                                    <div style={{ fontWeight: '700', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '4px', color: '#ffc107' }}>
                                                                        ⚠️ Partial Match ({c.partialMatchSkills.length})
                                                                    </div>
                                                                    <ul style={{ paddingLeft: '8px', margin: 0, listStyle: 'none' }}>
                                                                        {c.partialMatchSkills.map((p, idx) => (
                                                                            <li key={idx} style={{ marginBottom: '2px' }}>
                                                                                <span style={{ color: '#fff' }}>{p.skill}</span> <span style={{ fontSize: '10px', color: '#aaa' }}>(Has {p.candidateHas || p.has || '-'} / Req {p.jdRequirement || p.req || '-'})</span>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                            <div style={{ fontWeight: '700', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '4px', color: '#ff6b6b' }}>
                                                                ❌ Missing ({c.missingSkills?.length || 0})
                                                            </div>
                                                            {c.missingSkills && c.missingSkills.length > 0 ? (
                                                                <ul style={{ paddingLeft: '14px', margin: 0 }}>
                                                                    {c.missingSkills.map((s, idx) => <li key={idx}>{typeof s === 'object' ? s.skill : s}</li>)}
                                                                </ul>
                                                            ) : <span style={{ color: '#aaa', fontStyle: 'italic' }}>No missing skills found.</span>}
                                                            {c.missingCertifications && c.missingCertifications.length > 0 && (
                                                                <div style={{ marginTop: '8px' }}>
                                                                    <div style={{ fontWeight: '700', borderBottom: '1px solid #555', paddingBottom: '4px', marginBottom: '4px', color: '#ff6b6b' }}>
                                                                        📜 Certifications ({c.missingCertifications.length})
                                                                    </div>
                                                                    <ul style={{ paddingLeft: '14px', margin: 0 }}>
                                                                        {c.missingCertifications.map((cert, idx) => <li key={idx}>{typeof cert === 'object' ? (cert.name || cert.skill || JSON.stringify(cert)) : cert}</li>)}
                                                                    </ul>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );

                                                    return (
                                                        <tr key={i} onClick={() => toggleRow(i)} style={{
                                                            background: 'white',
                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                                                            transition: 'all 0.1s',
                                                        }} className="corp-table-row">
                                                            <td style={{ padding: '6px 12px', textAlign: 'center', borderRadius: '8px 0 0 8px' }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedIndices.has(i)}
                                                                        onChange={(e) => toggleSelectCandidate(e, i)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        style={{ cursor: 'pointer' }}
                                                                    />
                                                                    {(() => {
                                                                        const info = getRecipientInfo(c.Name, c.Sender || c.Email);
                                                                        return (
                                                                            <span style={{
                                                                                fontSize: '7px',
                                                                                fontWeight: '900',
                                                                                textTransform: 'uppercase',
                                                                                color: info.type === 'Candidate' ? '#6366f1' : '#f59e0b',
                                                                                background: info.type === 'Candidate' ? '#f5f3ff' : '#fffbeb',
                                                                                padding: '1px 3px',
                                                                                borderRadius: '2px',
                                                                                border: `1px solid ${info.type === 'Candidate' ? '#e0e7ff' : '#fef3c7'}`
                                                                            }}>
                                                                                {info.type}
                                                                            </span>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </td>
                                                            <td title={c.Name} style={{ padding: '6px 12px', fontWeight: '800', color: '#0f172a', textAlign: 'center', fontSize: '11px' }}>{c.Name}</td>
                                                            <td title={c.Email} style={{ padding: '6px 12px', color: '#64748b', textAlign: 'center', fontSize: '10px', fontWeight: '500' }}>{c.Email}</td>
                                                            <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                                                <span style={{ fontWeight: '800', fontSize: '11px', color: '#334155', background: '#f8fafc', padding: '2px 8px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>{c['Years of Experience']}</span>
                                                            </td>
                                                            <td style={{ padding: '6px 12px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#f97316', fontWeight: '700', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                                                    <span style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', display: 'inline-block', fontSize: '9px' }}>▶</span>
                                                                    <span>AI Insights</span>
                                                                    <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: 500 }}>({c.missingSkills?.length || 0} Gaps)</span>
                                                                </div>

                                                                {isOpen && (
                                                                    <div
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="animate-fade"
                                                                        style={{
                                                                            marginTop: '4px',
                                                                            fontSize: '10px',
                                                                            color: '#334155',
                                                                            padding: '6px 10px',
                                                                            background: 'transparent',
                                                                            borderLeft: '3px solid #f59e0b',
                                                                            whiteSpace: 'pre-wrap',
                                                                            lineHeight: '1.4',
                                                                            borderRadius: '0 8px 8px 0',
                                                                            cursor: 'text'
                                                                        }}
                                                                    >
                                                                        {/* MATCH DESIRED OUTPUT FORMAT */}
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                                            {/* Missing Skills Table */}
                                                                            {c.missingSkills && c.missingSkills.length > 0 && (
                                                                                <div>
                                                                                    <div style={{ fontWeight: '800', color: '#e11d48', marginBottom: '6px', fontSize: '11px' }}>Missing Skills:</div>
                                                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                                        <thead>
                                                                                            <tr style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                                                <th style={{ textAlign: 'left', padding: '4px', color: '#94a3b8', whiteWhiteSpace: 'nowrap' }}>Missing Skills</th>
                                                                                                <th style={{ textAlign: 'center', padding: '4px', color: '#94a3b8', whiteWhiteSpace: 'nowrap' }}>JD Req</th>
                                                                                                <th style={{ textAlign: 'center', padding: '4px', color: '#94a3b8' }}>Has</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {(c.missingSkills || []).map((ms, idx) => (
                                                                                                <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                                    <td style={{ padding: '4px', fontWeight: '700' }}>• {typeof ms === 'object' ? ms.skill : ms}</td>
                                                                                                    <td style={{ padding: '4px', textAlign: 'center' }}>{typeof ms === 'object' ? (ms.jdRequirement || ms.req || '-') : '-'}</td>
                                                                                                    <td style={{ padding: '4px', textAlign: 'center' }}>{typeof ms === 'object' ? (ms.has || '0m') : '0m'}</td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                    </table>
                                                                                </div>
                                                                            )}

                                                                            {/* Missing Certifications Table */}
                                                                            {c.missingCertifications && c.missingCertifications.length > 0 && (
                                                                                <div style={{ marginTop: '12px' }}>
                                                                                    <div style={{ fontWeight: '800', color: '#dc2626', marginBottom: '6px', fontSize: '11px' }}>Missing Certifications:</div>
                                                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                                        <thead>
                                                                                            <tr style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                                                <th style={{ textAlign: 'left', padding: '4px', color: '#94a3b8' }}>Missing Certifications</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody>
                                                                                            {c.missingCertifications.map((cert, idx) => (
                                                                                                <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                                    <td style={{ padding: '4px', fontWeight: '700' }}>• {typeof cert === 'object' ? (cert.name || cert.skill || JSON.stringify(cert)) : cert}</td>
                                                                                                </tr>
                                                                                            ))}
                                                                                        </tbody>
                                                                                    </table>
                                                                                </div>
                                                                            )}
                                                                            {/* Partial Match Skills Table */}
                                                                            {c.partialMatchSkills && c.partialMatchSkills.filter(ps => {
                                                                                const hasVal = String(ps.candidateHas || ps.has || '').toLowerCase().trim();
                                                                                return hasVal !== '' && !hasVal.startsWith('0');
                                                                            }).length > 0 && (
                                                                                    <div>
                                                                                        <div style={{ fontWeight: '800', color: '#ea580c', marginBottom: '6px', fontSize: '11px' }}>Partial Match Skills:</div>
                                                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                                                            <thead>
                                                                                                <tr style={{ borderBottom: '1px solid #ffedd5' }}>
                                                                                                    <th style={{ textAlign: 'left', padding: '4px', color: '#94a3b8', whiteWhiteSpace: 'nowrap' }}>PARTIAL</th>
                                                                                                    <th style={{ textAlign: 'center', padding: '4px', color: '#94a3b8', whiteWhiteSpace: 'nowrap' }}>JD REQ</th>
                                                                                                    <th style={{ textAlign: 'center', padding: '4px', color: '#94a3b8' }}>HAS</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody>
                                                                                                {c.partialMatchSkills.filter(ps => {
                                                                                                    const hasVal = String(ps.candidateHas || ps.has || '').toLowerCase().trim();
                                                                                                    return hasVal !== '' && !hasVal.startsWith('0');
                                                                                                }).map((ps, idx) => (
                                                                                                    <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                                                                                                        <td style={{ padding: '4px', fontWeight: '700' }}>• {ps.skill}</td>
                                                                                                        <td style={{ padding: '4px', textAlign: 'center' }}>{ps.jdRequirement || ps.req || '-'}</td>
                                                                                                        <td style={{ padding: '4px', textAlign: 'center' }}>{ps.candidateHas || ps.has || '-'}</td>
                                                                                                    </tr>
                                                                                                ))}
                                                                                            </tbody>
                                                                                        </table>
                                                                                    </div>
                                                                                )}

                                                                            {/* Percentage Summary */}
                                                                            <div style={{ marginTop: '4px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                                                                                <div style={{ fontWeight: '800', color: '#0f172a', marginBottom: '2px', fontSize: '11px' }}>Resume Percentage to JD:</div>
                                                                                <div style={{ color: '#6366f1', fontWeight: '700' }}>(match skills +Partial skills) {c.matchPercentage}%</div>
                                                                                <div style={{ color: '#e11d48', fontWeight: '700' }}>Missing skills {c.missingPercentage || (100 - c.matchPercentage)}%</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>

                                                                    {/* R (Match) Circle - COMPACT */}
                                                                    <div
                                                                        onMouseEnter={(e) => handleMouseEnter(e, rTooltipContent)}
                                                                        onMouseLeave={handleMouseLeave}
                                                                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'help' }}
                                                                    >
                                                                        <div style={{
                                                                            width: '28px', height: '28px', borderRadius: '50%',
                                                                            border: '1.5px solid #10b981', background: '#ecfdf5', color: '#047857',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            fontWeight: '900', fontSize: '9px'
                                                                        }}>
                                                                            {matchP}%
                                                                        </div>
                                                                        <span style={{ fontSize: '8px', fontWeight: '800', color: '#059669', marginTop: '2px', textTransform: 'uppercase' }}>Match</span>
                                                                    </div>

                                                                    {/* M (Missing) Circle - COMPACT */}
                                                                    <div
                                                                        onMouseEnter={(e) => handleMouseEnter(e, mTooltipContent)}
                                                                        onMouseLeave={handleMouseLeave}
                                                                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'help' }}
                                                                    >
                                                                        <div style={{
                                                                            width: '28px', height: '28px', borderRadius: '50%',
                                                                            border: '1.5px solid #ef4444', background: '#fef2f2', color: '#b91c1c',
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            fontWeight: '900', fontSize: '9px'
                                                                        }}>
                                                                            {missingP}%
                                                                        </div>
                                                                        <span style={{ fontSize: '8px', fontWeight: '800', color: '#dc2626', marginTop: '2px', textTransform: 'uppercase' }}>Gap</span>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td style={{ padding: '6px 12px', textAlign: 'center', borderRadius: '0 8px 8px 0' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                                    {(() => {
                                                                        const validEmails = getValidEmails(c);
                                                                        if (sendingEmails[i] === 'sent') {
                                                                            return (
                                                                                <div style={{
                                                                                    padding: '4px 14px',
                                                                                    background: '#ecfdf5',
                                                                                    color: '#059669',
                                                                                    borderRadius: '20px',
                                                                                    fontSize: '9px',
                                                                                    fontWeight: '900',
                                                                                    border: '1px solid #10b981',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '4px',
                                                                                    letterSpacing: '0.5px'
                                                                                }}>
                                                                                    <span>✅</span> SENT
                                                                                </div>
                                                                            );
                                                                        }
                                                                        if (!validEmails) {
                                                                            return (
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); handleSendRichEmail(c, i); }}
                                                                                    style={{
                                                                                        padding: '4px 14px',
                                                                                        background: '#fff1f2',
                                                                                        color: '#e11d48',
                                                                                        borderRadius: '20px',
                                                                                        fontSize: '9px',
                                                                                        fontWeight: '900',
                                                                                        border: '1px solid #fda4af',
                                                                                        cursor: 'pointer',
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '4px',
                                                                                        letterSpacing: '0.5px'
                                                                                    }}
                                                                                >
                                                                                    <span>🚫</span> NO EMAIL
                                                                                </button>
                                                                            );
                                                                        }
                                                                        return (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleSendRichEmail(c, i); }}
                                                                                disabled={sendingEmails[i] === 'sending'}
                                                                                style={{
                                                                                    padding: '6px 16px',
                                                                                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                                                                                    color: 'white',
                                                                                    borderRadius: '20px',
                                                                                    fontSize: '10px',
                                                                                    fontWeight: '800',
                                                                                    border: 'none',
                                                                                    cursor: sendingEmails[i] === 'sending' ? 'not-allowed' : 'pointer',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '6px',
                                                                                    boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
                                                                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                                    textTransform: 'uppercase',
                                                                                    letterSpacing: '0.5px'
                                                                                }}
                                                                                onMouseEnter={e => {
                                                                                    if (sendingEmails[i] !== 'sending') {
                                                                                        e.currentTarget.style.transform = 'scale(1.05) translateY(-1px)';
                                                                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.3)';
                                                                                    }
                                                                                }}
                                                                                onMouseLeave={e => {
                                                                                    if (sendingEmails[i] !== 'sending') {
                                                                                        e.currentTarget.style.transform = 'scale(1) translateY(0)';
                                                                                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(79, 70, 229, 0.2)';
                                                                                    }
                                                                                }}
                                                                            >
                                                                                {sendingEmails[i] === 'sending' ? (
                                                                                    <><span>⌛</span> SENDING...</>
                                                                                ) : (
                                                                                    <><span>📧</span> SEND</>
                                                                                )}
                                                                            </button>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                        </tbody>
                                    </table>

                                    {/* EMPTY STATE FOR FILTERS */}
                                    {results.filter(c => {
                                        const matchP = c.matchPercentage || 0;
                                        const missingP = 100 - matchP;
                                        const meetR = matchP >= (parseInt(matchThreshold) || 0);
                                        const meetM = missingP <= (parseInt(gapThreshold) || 100);
                                        return meetR && meetM;
                                    }).length === 0 && (
                                            <div style={{ padding: '60px 20px', textAlign: 'center', background: '#fff', borderRadius: '12px', border: '1px dashed #e2e8f0', margin: '20px' }}>
                                                <div style={{ fontSize: '32px', marginBottom: '16px' }}>🔍</div>
                                                <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>No candidates match your current filters</h3>
                                                <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '20px' }}>Try adjusting your <b>Match (R%)</b> or <b>Gap (M%)</b> thresholds to see more results.</p>
                                                <button
                                                    onClick={() => { setMatchThreshold(0); setGapThreshold(100); }}
                                                    style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', transition: 'all 0.2s' }}
                                                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                                                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                                                >
                                                    🔄 Reset All Filters
                                                </button>
                                            </div>
                                        )}
                                </div>
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', opacity: 0.5 }}>
                                <div style={{ fontSize: '64px', marginBottom: '20px' }}>🕵️‍♂️</div>
                                <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#1e293b', margin: '0 0 10px 0' }}>Ready for Analysis</h3>
                                <p style={{ fontSize: '14px', color: '#64748b', textAlign: 'center', maxWidth: '400px', lineHeight: '1.6' }}>
                                    Paste a Job Description and click <b>Start Analysis</b> to unlock deep forensic insights for your {candidates.length} selected candidates.
                                </p>
                            </div>
                        ))}
                </div>
            </div >
            {/* End Main Grid */}

            {/* GLOBAL FIXED TOOLTIP */}
            {
                tooltipData.visible && (
                    <div style={{
                        position: 'fixed',
                        top: tooltipData.showAbove ? 'auto' : tooltipData.y,
                        bottom: tooltipData.showAbove ? (window.innerHeight - tooltipData.y) : 'auto',
                        left: tooltipData.x,
                        transform: 'translate(-50%, 0)', // Center horizontally
                        zIndex: 9999,
                        background: '#333',
                        color: '#fff',
                        padding: '10px 14px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 400,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        maxWidth: '300px',
                        width: 'max-content',
                        pointerEvents: 'none'
                    }}>
                        <div style={{
                            position: 'absolute',
                            ...(tooltipData.showAbove ? {
                                top: '100%',
                            } : {
                                bottom: '100%',
                            }),
                            left: '50%',
                            marginLeft: '-5px',
                            borderWidth: '5px',
                            borderStyle: 'solid',
                            borderColor: tooltipData.showAbove ? '#333 transparent transparent transparent' : 'transparent transparent #333 transparent'
                        }}></div>
                        {tooltipData.content}
                    </div>
                )
            }

            {/* Removed Manual Login Modal */}

            {/* EMAIL PREVIEW MODAL */}
            {
                isPreviewOpen && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                        backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(12px)',
                        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
                    }}>
                        <div style={{
                            backgroundColor: '#fff', width: '100%', maxWidth: '1200px', height: '92vh',
                            borderRadius: '24px', boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.25)',
                            display: 'grid', gridTemplateColumns: '330px 1fr', position: 'relative', overflow: 'hidden',
                            animation: 'fadeInUp 0.3s ease-out', border: '1px solid rgba(255,255,255,0.2)'
                        }}>
                            {/* Close button */}
                            <button
                                onClick={() => setIsPreviewOpen(false)}
                                style={{
                                    position: 'absolute', top: '15px', right: '15px', border: 'none',
                                    background: '#f1f5f9', color: '#64748b', width: '28px', height: '28px',
                                    borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', fontSize: '14px', zIndex: 10, transition: 'all 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                                onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                            >
                                &times;
                            </button>

                            {/* LEFT COLUMN: Premium Editor Refactored to 3-Layer Grid */}
                            <div style={{ 
                                borderRight: '1px solid #f1f5f9', 
                                display: 'grid', 
                                gridTemplateRows: 'auto 1fr auto', 
                                height: '100%', 
                                background: '#ffffff', 
                                position: 'relative', 
                                zIndex: 10 
                            }}>
                                {/* 1. HEADER (Overflow Visible for Dropdown) */}
                                <div style={{ padding: '12px 20px', background: '#ffffff', borderBottom: '1px solid #f1f5f9', zIndex: 20 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <h2 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ color: '#6366f1', fontSize: '14px' }}>⚡</span> 
                                            Bulk Send
                                        </h2>
                                    </div>

                                    {/* COMPACT TOOLBAR */}
                                    {previewData.index === -1 && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', position: 'relative' }}>
                                            {/* LEFT: Navigation Pill */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', padding: '3px 8px', borderRadius: '10px', border: '1px solid #f1f5f9' }}>
                                                <button
                                                    onClick={() => handleBulkNav(-1)}
                                                    disabled={currentBulkIndex === 0}
                                                    style={{ border: 'none', background: 'none', cursor: currentBulkIndex === 0 ? 'not-allowed' : 'pointer', color: currentBulkIndex === 0 ? '#cbd5e1' : '#6366f1', fontSize: '10px', padding: '0 2px', fontWeight: '800' }}
                                                >
                                                    ◂
                                                </button>
                                                <span style={{ fontSize: '10px', fontWeight: '800', color: '#475569', minWidth: '30px', textAlign: 'center' }}>
                                                    {currentBulkIndex + 1} / {bulkSendList.length}
                                                </span>
                                                <button
                                                    onClick={() => handleBulkNav(1)}
                                                    disabled={currentBulkIndex === bulkSendList.length - 1}
                                                    style={{ border: 'none', background: 'none', cursor: currentBulkIndex === bulkSendList.length - 1 ? 'not-allowed' : 'pointer', color: currentBulkIndex === bulkSendList.length - 1 ? '#cbd5e1' : '#6366f1', fontSize: '10px', padding: '0 2px', fontWeight: '800' }}
                                                >
                                                    ▸
                                                </button>
                                            </div>

                                            {/* APPLY ALL BUTTON */}
                                            <button
                                                onClick={handleApplyAll}
                                                style={{
                                                    padding: '4px 10px',
                                                    borderRadius: '8px',
                                                    background: '#6366f1',
                                                    color: 'white',
                                                    border: 'none',
                                                    fontSize: '9px',
                                                    fontWeight: '800',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    transition: 'all 0.2s'
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                            >
                                                <span>✨</span> Apply All
                                            </button>

                                            {/* EMAILS DROPDOWN */}
                                            <div style={{ position: 'relative' }}>
                                                <button
                                                    onClick={() => setShowRecipientManager(!showRecipientManager)}
                                                    style={{
                                                        padding: '4px 10px', borderRadius: '8px', background: '#fff', border: '1px solid #e2e8f0',
                                                        fontSize: '9px', fontWeight: '800', color: '#475569', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = '#6366f1'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                                                >
                                                    <span>📬</span> Emails {showRecipientManager ? '▲' : '▼'}
                                                </button>
                                                
                                                {showRecipientManager && (
                                                    <div style={{
                                                        position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                                                        width: '280px', maxHeight: '400px', background: '#ffffff', 
                                                        borderRadius: '16px', boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
                                                        border: '1px solid #e2e8f0', zIndex: 9999, overflow: 'hidden',
                                                        display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.2s ease-out'
                                                    }}>
                                                        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span style={{ fontSize: '11px', fontWeight: '800', color: '#0f172a', letterSpacing: '0.3px' }}>Emails Manager</span>
                                                            <button style={{ color: '#6366f1', fontSize: '10px', fontWeight: '700', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: '4px' }} onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'} onMouseLeave={e => e.currentTarget.style.background = 'none'} onClick={() => {
                                                                const newList = bulkSendList.map(item => ({
                                                                    ...item,
                                                                    to: item.to.map(r => ({ ...r, active: true }))
                                                                }));
                                                                setBulkSendList(newList);
                                                                setPreviewData(prev => ({ ...prev, to: newList[currentBulkIndex].to.filter(r => r.active).map(rt => rt.email).join(', ') }));
                                                            }}>Reset All</button>
                                                        </div>
                                                        <div style={{ overflowY: 'auto', padding: '4px 0' }}>
                                                            {bulkSendList.map((item, candIdx) => (
                                                                <div key={candIdx} style={{ padding: '6px 0', borderBottom: candIdx === bulkSendList.length - 1 ? 'none' : '1px solid #f8fafc' }}>
                                                                    <div style={{ padding: '4px 16px', fontSize: '10px', fontWeight: '800', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                                        <span style={{ color: candIdx === currentBulkIndex ? '#6366f1' : '#cbd5e1', fontSize: '9px' }}>{String(candIdx + 1).padStart(2, '0')}</span> 
                                                                        <span style={{ color: '#334155' }}>{item.candidate.name}</span>
                                                                    </div>
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        {item.to.map((rec, recIdx) => (
                                                                            <label key={recIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', padding: '8px 16px', transition: 'all 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: '2px' }}>
                                                                                    <input 
                                                                                        type="checkbox" 
                                                                                        checked={rec.active}
                                                                                        onChange={() => {
                                                                                            const newList = [...bulkSendList];
                                                                                            newList[candIdx].to[recIdx].active = !newList[candIdx].to[recIdx].active;
                                                                                            setBulkSendList(newList);
                                                                                            if (candIdx === currentBulkIndex) {
                                                                                                const activeTo = newList[candIdx].to.filter(r => r.active).map(rt => rt.email).join(', ');
                                                                                                setPreviewData(prev => ({ ...prev, to: activeTo }));
                                                                                            }
                                                                                        }}
                                                                                        style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#6366f1' }}
                                                                                    />
                                                                                </div>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                                                                    <span style={{ fontSize: '11px', color: rec.active ? '#1e293b' : '#94a3b8', fontWeight: '600', textDecoration: rec.active ? 'none' : 'line-through', wordBreak: 'break-all', lineHeight: '1.4' }}>{rec.display}</span>
                                                                                    <div style={{ display: 'flex', marginTop: '4px' }}>
                                                                                        <span style={{ 
                                                                                            fontSize: '7px', 
                                                                                            fontWeight: '900', 
                                                                                            color: rec.type === 'Sender' ? '#4f46e5' : '#ea580c', 
                                                                                            textTransform: 'uppercase', 
                                                                                            background: rec.type === 'Sender' ? '#f5f3ff' : '#fff7ed',
                                                                                            padding: '2px 6px',
                                                                                            borderRadius: '4px',
                                                                                            border: `1px solid ${rec.type === 'Sender' ? '#e0e7ff' : '#ffedd5'}`,
                                                                                            letterSpacing: '0.5px'
                                                                                        }}>
                                                                                            {rec.type}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            </label>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 2. CONTENT (Scrollable Compact View) */}
                                <div style={{ padding: '12px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                                            <label style={{ width: '50px', fontSize: '9px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>To</label>
                                            <div style={{ flex: 1, fontSize: '11px', color: '#0f172a', fontWeight: '700' }}>
                                                {previewData.index === -1 ? (
                                                    <span style={{ color: '#6366f1', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ fontSize: '12px' }}>📬</span> {previewData.to.split('<')[0].trim()}
                                                    </span>
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={previewData.to}
                                                        onChange={(e) => setPreviewData({ ...previewData, to: e.target.value })}
                                                        style={{ border: 'none', outline: 'none', width: '100%', background: 'transparent', fontWeight: '700' }}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                                            <label style={{ width: '50px', fontSize: '9px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>CC</label>
                                            <input
                                                type="text"
                                                value={previewData.cc}
                                                onChange={(e) => setPreviewData({ ...previewData, cc: e.target.value })}
                                                placeholder="Add CC email..."
                                                style={{ border: 'none', outline: 'none', fontSize: '11px', color: '#1e293b', flex: 1, background: 'transparent' }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                                            <label style={{ width: '50px', fontSize: '9px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Sub</label>
                                            <input
                                                type="text"
                                                value={previewData.subject}
                                                onChange={(e) => setPreviewData({ ...previewData, subject: e.target.value })}
                                                style={{ border: 'none', outline: 'none', fontSize: '11px', color: '#0f172a', fontWeight: '700', flex: 1, background: 'transparent' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div>
                                            <label style={{ fontSize: '9px', fontWeight: '900', color: '#6366f1', textTransform: 'uppercase', marginBottom: '6px', display: 'block', letterSpacing: '0.5px' }}>Personalized Message</label>
                                            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                                <ReactQuill
                                                    theme="snow"
                                                    value={previewData.body}
                                                    onChange={(content, delta, source) => { if (source === 'user') setPreviewData({ ...previewData, body: content }) }}
                                                    style={{ height: '150px', marginBottom: '34px' }}
                                                    modules={BODY_MODULES}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label style={{ fontSize: '9px', fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', display: 'block', letterSpacing: '0.5px' }}>Signature</label>
                                            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                                <ReactQuill
                                                    theme="snow"
                                                    value={previewData.signature}
                                                    onChange={(content, delta, source) => { if (source === 'user') setPreviewData({ ...previewData, signature: content }) }}
                                                    style={{ height: '55px', marginBottom: '34px' }}
                                                    modules={SIGNATURE_MODULES}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 3. FOOTER (Fixed Bottom Compact) */}
                                <div style={{ padding: '12px 18px', borderTop: '1px solid #f1f5f9', background: '#ffffff', display: 'flex', gap: '10px', zIndex: 10 }}>
                                    <button
                                        onClick={() => setIsPreviewOpen(false)}
                                        style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: '700', cursor: 'pointer', fontSize: '11px' }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmSendEmail}
                                        style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '11px', boxShadow: '0 4px 10px rgba(99,102,241,0.2)' }}
                                    >
                                        🚀 {previewData.index === -1 ? `Send (${selectedIndices.size})` : 'Send Analysis'}
                                    </button>
                                </div>
                            </div>



                            {/* RIGHT COLUMN: Live Layout Preview */}
                            <div style={{ background: '#ffffff', padding: '0', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                                {/* The Pseudo-Email Window - Now just a clean container */}
                                <div style={{ background: '#ffffff', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    {/* Fake Email Header - Clean white */}
                                    <div style={{ padding: '15px 35px 10px 35px', background: '#ffffff', flexShrink: 0 }}>
                                        <div style={{ fontSize: '10px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>Email Preview</div>
                                        <div style={{ fontSize: '16px', fontWeight: '800', color: '#1e293b', lineHeight: '1.2' }}>{previewData.subject}</div>
                                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', fontWeight: '500' }}>
                                            From: <span style={{ color: '#1e293b', fontWeight: '700' }}>{session?.user?.name || 'Careers Team'}</span> • Innovcentric LLC
                                        </div>
                                        <div style={{ height: '1px', background: '#f1f5f9', marginTop: '15px', marginBottom: '15px' }}></div>

                                        {/* Title Bar Banner */}
                                        <div style={{ padding: '0 10px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px', marginBottom: '12px' }}>
                                                <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', lineHeight: '1.2' }}>
                                                    {previewData.jobInfo?.title || 'Not specified'}
                                                </div>
                                                <span style={{ fontSize: '9px', fontWeight: '900', color: '#fff', background: '#dc2626', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', boxShadow: '0 0 15px rgba(220, 38, 38, 0.5)', animation: 'glowPulse 2s infinite ease-in-out', border: '1px solid rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px', transition: 'all 0.2s' }} onClick={() => window.open(previewData.jobInfo?.jdLink || '#', '_blank')} onMouseEnter={e => e.currentTarget.style.filter = 'brightness(1.2)'} onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}>Click for JD</span>
                                            </div>
                                            
                                            <div style={{ fontSize: '11px', color: '#475569', fontWeight: '700', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>LOCATION:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.location || '---'}</span> <span style={{ color: '#cbd5e1' }}>|</span>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>RATE:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.rate || '---'}</span> <span style={{ color: '#cbd5e1' }}>|</span>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>VISA:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.visa || '---'}</span> <span style={{ color: '#cbd5e1' }}>|</span>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>CLIENT:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.client || '---'}</span> <span style={{ color: '#cbd5e1' }}>|</span>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>MODE:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.mode || '---'}</span> <span style={{ color: '#cbd5e1' }}>|</span>
                                                <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '9px' }}>EXP:</span> <span style={{ color: '#1e293b' }}>{previewData.jobInfo?.exp || '---'}</span>
                                            </div>
                                        </div>
                                        <div style={{ height: '1px', background: '#f1f5f9', marginTop: '15px' }}></div>
                                    </div>

                                    {/* Fake Email Content - Rigid Grid 70/30 Refactor */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '70% 30%', flex: 1, padding: '0', background: '#ffffff', overflowY: 'auto', minWidth: 0 }}>
                                        {/* 70% Body Column (Rigid Grid Child) */}
                                        <div style={{ 
                                            padding: '15px 25px', 
                                            borderRight: '1px solid #f1f5f9', 
                                            boxSizing: 'border-box', 
                                            minWidth: 0,
                                            overflow: 'hidden' // Strictly contain all text
                                        }}>
                                            {/* Preview Renderer: High-Density & Matched Typography */}
                                            <div 
                                                className="preview-content"
                                                style={{ 
                                                    fontSize: '12px', 
                                                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                                                    color: '#334155', 
                                                    lineHeight: '1.6', 
                                                    textAlign: 'left',
                                                    marginBottom: '20px',
                                                    overflowWrap: 'break-word', // natural wrapping
                                                    wordBreak: 'normal',
                                                    whiteSpace: 'normal' // Rely on HTML tags for newlines
                                                }} 
                                                dangerouslySetInnerHTML={{ __html: previewData.body }} 
                                            />

                                            {/* Injected style to match Quill paragraphs exactly (Zero margin) */}
                                            <style>
                                                {`
                                                    .preview-content p { margin: 0; padding: 0; min-height: 1em; }
                                                    .preview-content ul, .preview-content ol { padding-left: 20px; margin: 0 0 10px 0; }
                                                    .preview-content li { margin-bottom: 4px; }
                                                `}
                                            </style>

                                            <div style={{ fontSize: '10px', fontWeight: '800', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>Gap Analysis</div>

                                            {/* CATEGORIZED GAP ANALYSIS (PREMIUM REDESIGN) */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
                                                
                                                {/* 1. MISSING SKILLS */}
                                                {(previewData.candidate?.missingSkills?.length > 0) && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: '800', color: '#e11d48', marginBottom: '6px' }}>Missing Skills:</div>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                            <thead>
                                                                <tr style={{ textAlign: 'left', background: '#f8fafc', borderBottom: '1.5px solid #fee2e2' }}>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px' }}>Missing Skills</th>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px', textAlign: 'center' }}>JD Req</th>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px', textAlign: 'center' }}>Has</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {previewData.candidate.missingSkills.map((s, si) => (
                                                                    <tr key={si} style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                        <td style={{ padding: '6px 8px', color: '#1e293b', fontWeight: '800' }}>• {typeof s === 'string' ? s : s.skill}</td>
                                                                        <td style={{ padding: '6px 8px', color: '#64748b', textAlign: 'center', fontWeight: '700' }}>Must Have</td>
                                                                        <td style={{ padding: '6px 8px', color: '#ef4444', textAlign: 'center', fontWeight: '900' }}>0m</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* 2. MISSING CERTIFICATIONS */}
                                                {(previewData.candidate?.missingCertifications?.length > 0) && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: '800', color: '#e11d48', marginBottom: '6px' }}>Missing Certifications:</div>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                            <thead>
                                                                <tr style={{ textAlign: 'left', background: '#f8fafc', borderBottom: '1.5px solid #fee2e2' }}>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px' }}>Missing Certifications</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {previewData.candidate.missingCertifications.map((c, ci) => (
                                                                    <tr key={ci} style={{ borderBottom: '1px solid #fee2e2' }}>
                                                                        <td style={{ padding: '6px 8px', color: '#1e293b', fontWeight: '800' }}>• {typeof c === 'string' ? c : (c.name || c.skill)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* 3. PARTIAL MATCH SKILLS */}
                                                {(previewData.candidate?.partialMatchSkills?.length > 0) && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: '800', color: '#f59e0b', marginBottom: '6px' }}>Partial Match Skills:</div>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                                                            <thead>
                                                                <tr style={{ textAlign: 'left', background: '#f8fafc', borderBottom: '1.5px solid #fef3c7' }}>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px' }}>Partial</th>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px', textAlign: 'center' }}>JD Req</th>
                                                                    <th style={{ padding: '6px 8px', color: '#94a3b8', textTransform: 'uppercase', fontSize: '9px', textAlign: 'center' }}>Has</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {previewData.candidate.partialMatchSkills.map((p, pi) => (
                                                                    <tr key={pi} style={{ borderBottom: '1px solid #fef3c7' }}>
                                                                        <td style={{ padding: '6px 8px', color: '#1e293b', fontWeight: '800' }}>• {p.skill}</td>
                                                                        <td style={{ padding: '6px 8px', color: '#475569', textAlign: 'center', fontWeight: '700' }}>{p.jdRequirement || p.req || '-'}</td>
                                                                        <td style={{ padding: '6px 8px', color: '#f59e0b', textAlign: 'center', fontWeight: '900' }}>{p.candidateHas || p.has || '-'}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}

                                                {/* SUMMARY PERCENTAGES */}
                                                <div style={{ marginTop: '5px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                    <div style={{ fontSize: '11px', fontWeight: '900', color: '#0f172a', marginBottom: '4px' }}>Resume Percentage to JD:</div>
                                                    <div style={{ fontSize: '10px', color: '#6366f1', fontWeight: '700' }}>(match skills + Partial skills) {previewData.candidate?.matchPercentage}%</div>
                                                    <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: '700' }}>Missing skills {100 - (previewData.candidate?.matchPercentage || 0)}%</div>
                                                </div>
                                            </div>

                                            <div style={{ display: 'inline-block', padding: '8px 18px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: '#fff', borderRadius: '10px', fontSize: '12px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)', transition: 'all 0.3s' }} onClick={() => window.open(careersLink, '_blank')} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(99, 102, 241, 0.4)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.3)'; }}>View More Jobs</div>

                                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '25px', borderTop: '1px solid #f1f5f9', paddingTop: '15px', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: previewData.signature }} />
                                        </div>

                                        <div style={{ flex: '1', padding: '25px 20px', background: '#ffffff' }}>

                                            {previewData.candidate?.requiredDetails && (
                                                <div style={{ marginTop: '25px' }}>
                                                    <div style={{ fontSize: '10px', fontWeight: '900', color: '#6366f1', textTransform: 'uppercase', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px', marginBottom: '10px' }}>Required Details</div>
                                                    <div style={{ fontSize: '11px', color: '#1e293b', lineHeight: '1.5', whiteSpace: 'pre-wrap', fontWeight: '700' }}>
                                                        {previewData.candidate.requiredDetails}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <p style={{ textAlign: 'center', fontSize: '10px', color: '#94a3b8', marginTop: '20px', fontWeight: '500' }}>
                                    This is a direct representation of the final HTML email delivered to the candidate.
                                </p>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Removed High-Friction Advanced Select Modal */}
        </div >
    );
}
