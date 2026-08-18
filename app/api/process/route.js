import { drive, sheets, SHEET_ID, GMAIL_SYNC_SHEET_ID, GMAIL_SYNC_DRIVE_FOLDER_ID } from '@/lib/google';
import { google } from 'googleapis';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from 'next/server';
import { getAICompletion } from '@/lib/ai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const maxDuration = 300; // Allow 5 minute execution for large AI tasks

// [FIX] Polyfill DOMMatrix & ImageData for pdf-parse/pdfjs-dist in Node environment
// We FORCE override these because some Node environments have partial/broken Class-only versions 
// that cause "Class constructor cannot be invoked without 'new'" errors.
const polyfill = () => {
    function mock() {
        this.m11 = 1; this.m12 = 0; this.m21 = 0; this.m22 = 1;
        this.m31 = 0; this.m32 = 0; this.m41 = 0; this.m42 = 0;
        this.width = 1; this.height = 1; this.data = new Uint8ClampedArray(4);
    }

    const targets = ['DOMMatrix', 'ImageData', 'Path2D'];
    [global, globalThis].forEach(g => {
        if (!g) return;
        targets.forEach(t => {
            // Force override to ensure it's a callable function
            try {
                Object.defineProperty(g, t, {
                    value: mock,
                    configurable: true,
                    writable: true
                });
            } catch (e) {
                g[t] = mock;
            }
        });
    });
};
polyfill();

// [GLOBAL CACHE] To store folder IDs and prevent duplicates due to Drive's eventual consistency
const folderIdCache = new Map(); // name -> { id, timestamp }
const creationLocks = new Map(); // name -> Promise

async function getSynchronizedFolder(name, parentId) {
    const lockKey = `${parentId}_${name}`;

    // 1. Check local cache first (Instant)
    const cached = folderIdCache.get(lockKey);
    if (cached && (Date.now() - cached.timestamp < 300000)) { // 5 minute cache
        return cached.id;
    }

    // 2. If there's an ongoing creation for this folder, wait for it
    if (creationLocks.has(lockKey)) {
        await creationLocks.get(lockKey);
        // After waiting, recrystallize from cache
        const retryCached = folderIdCache.get(lockKey);
        if (retryCached) return retryCached.id;
        // Fallback to searching if cache expired during wait
        return await findFolder(name, parentId);
    }

    // 3. Try to find it on Drive (Standard Check)
    const existingId = await findFolder(name, parentId);
    if (existingId) {
        folderIdCache.set(lockKey, { id: existingId, timestamp: Date.now() });
        return existingId;
    }

    // 4. RESERVATION (Synchronous) - We are the first ones here!
    let resolveLock;
    const lockPromise = new Promise(resolve => { resolveLock = resolve; });
    creationLocks.set(lockKey, lockPromise);

    try {
        // Double check Drive one last time inside the lock
        // (Just in case it became findable in the last 100ms)
        const lastMinuteCheck = await findFolder(name, parentId);
        if (lastMinuteCheck) {
            folderIdCache.set(lockKey, { id: lastMinuteCheck, timestamp: Date.now() });
            return lastMinuteCheck;
        }

        const newId = await createFolder(name, parentId);
        // SAVE TO CACHE IMMEDIATELY
        folderIdCache.set(lockKey, { id: newId, timestamp: Date.now() });
        return newId;
    } finally {
        resolveLock();
        creationLocks.delete(lockKey);
    }
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { accessCode, subject, emailBody, attachments, manualFolderName, manualFolderId, senderEmail, threadLink, threadId, messageId, processedBy, emailDate, keyOffset = 0 } = body;

        // Determine destination based on context (Batch Sync should use the new IDs)
        // If threadId is provided, we assume it's coming from Gmail Sync
        const targetSheetId = threadId ? GMAIL_SYNC_SHEET_ID : SHEET_ID;
        const targetDriveParentId = threadId ? GMAIL_SYNC_DRIVE_FOLDER_ID : process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;

        const ACCESS_CODE = process.env.APP_ACCESS_CODE;

        // 1. Validate Access Code
        if (accessCode !== ACCESS_CODE) {
            console.warn(`[AUTH] Access Code Mismatch. Received: ${accessCode}`);
            return NextResponse.json({ error: 'Invalid Access Code' }, { status: 401 });
        }

        console.log(`[PROCESS] Starting extraction for: ${subject}`);

        // 2. Parse Text content from ALL attachments (Resume, Visa Docs, etc.)
        let resumeText = '';
        let primaryResumeFilename = ''; // Anchor: Keep track of which file actually gave us the text
        const requestUploadedFiles = body.uploadedFiles || []; // [NEW] Pre-uploaded directly from Chrome Extension

        if (attachments && attachments.length > 0) {
            for (const att of attachments) {
                const lowerName = (att.name || "").toLowerCase();
                // Skip tracking pixels and common generic logo names to keep Drive clean
                const isGarbage = !att.name || lowerName.includes('image00') || lowerName.includes('pixel') || lowerName.includes('logo');

                if (isGarbage) continue;

                if (lowerName.endsWith('.pdf') ||
                    lowerName.endsWith('.docx') ||
                    lowerName.endsWith('.doc') ||
                    lowerName.endsWith('.txt')) {

                    try {
                        let text = '';
                        if (att.contentBase64) {
                            text = await parseAttachmentText(att);
                        } else {
                            // [DRIVE BYPASS] The extension uploaded this directly and stripped the Base64 to save bandwidth.
                            // We need to fetch the file from Drive to parse its text content for the AI.
                            const matchedUpload = requestUploadedFiles.find(u => u.name === att.name);
                            if (matchedUpload && matchedUpload.id) {
                                console.log(`[DRIVE BYPASS] Fetching ${att.name} from Drive for text extraction...`);
                                const driveFileRes = await drive.files.get({ fileId: matchedUpload.id, alt: 'media' }, { responseType: 'stream' });

                                const chunks = [];
                                for await (const chunk of driveFileRes.data) {
                                    chunks.push(chunk);
                                }
                                const buffer = Buffer.concat(chunks);
                                const tempAtt = { name: att.name, contentBase64: buffer.toString('base64') };
                                text = await parseAttachmentText(tempAtt);
                            }
                        }

                        if (text) {
                            resumeText += `\n\n--- Document: ${att.name} ---\n${text}`;
                            if (!primaryResumeFilename) primaryResumeFilename = att.name;
                        }
                    } catch (e) {
                        console.error("Failed to parse text from:", att.name, e);
                    }
                }
            }
        }

        // 3. [PRE-FLIGHT DEDUPLICATION CHECK]
        // To save AI and Drive quota, check if this thread or sender already exists in the destination sheet.
        let existingRows = [];
        let emailIdx = -1;

        try {
            // [FIX] Use the pre-initialized 'sheets' instance from lib/google instead of parsing env variables
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: targetSheetId,
                range: 'Sheet1!A:Z'
            });

            existingRows = response.data.values || [];
            if (existingRows.length > 1) {
                const headers = existingRows[0];
                const fingerprintIdx = headers.findIndex(h => h.toLowerCase() === 'fingerprint');
                emailIdx = headers.findIndex(h => h.toLowerCase() === 'email');

                // Check rows for exact duplicates
                for (let i = 1; i < existingRows.length; i++) {
                    const row = existingRows[i];
                    const existingFingerprint = fingerprintIdx !== -1 ? row[fingerprintIdx] : null;

                    if (
                        (messageId && existingFingerprint === messageId) ||
                        (threadId && existingFingerprint === threadId)
                    ) {
                        console.log(`[DEDUPLICATION] Fingerprint Match Found: ${messageId || threadId}`);
                        return NextResponse.json({
                            success: true,
                            skipped: true,
                            reason: "Thread already processed.",
                            details: "Matched on Fingerprint."
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("[DEDUPLICATION ERROR] Could not verify uniqueness:", e.message);
        }

        // 4. Extract Candidate Data using OpenAI or DeepSeek
        let candidateData;
        try {
            const isSyncData = !!threadId;
            candidateData = await extractCandidateData(subject, emailBody, resumeText, attachments, processedBy, keyOffset, isSyncData);

            // [NORMALIZE] Map 'Gold Standard' keys back to internal expectations so filing/logging works
            if (candidateData.Resume_Name && !candidateData.Name) candidateData.Name = candidateData.Resume_Name;
            if (candidateData.Role_Name_Suggest && !candidateData.Role) candidateData.Role = candidateData.Role_Name_Suggest;
            if (candidateData.Resume_Email && !candidateData.Email) candidateData.Email = candidateData.Resume_Email;
            if (candidateData.Resume_Phone && !candidateData.Phone) candidateData.Phone = candidateData.Resume_Phone;
            if (candidateData.Years_You_Calculate && !candidateData["Years of Experience"]) {
                candidateData["Years of Experience"] = candidateData.Years_You_Calculate;
            }
            if (candidateData.LinkedIn_URL) candidateData.LinkedIn = candidateData.LinkedIn_URL;

            // [FIX] EXTRA FOUL-PLAY CHECK: If email/phone is missing, use Regex search on resume text
            const textToScan = (resumeText || "") + " " + (emailBody || "");
            const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6})/g;
            const phoneRegex = /(\+?\d{1,3}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}/g;

            if (!candidateData.Email || candidateData.Email.toLowerCase().includes('not provide') || candidateData.Email === 'N/A') {
                const foundEmails = textToScan.match(emailRegex);
                if (foundEmails && foundEmails.length > 0) {
                    const candidateEmail = foundEmails.find(e => !e.includes('innov') && !e.includes('hr@') && !e.includes('careers@')) || foundEmails[0];
                    candidateData.Email = candidateEmail;
                }
            }

            if (!candidateData.Phone || candidateData.Phone.toLowerCase().includes('not provide') || candidateData.Phone === 'N/A') {
                const foundPhones = textToScan.match(phoneRegex);
                if (foundPhones && foundPhones.length > 0) {
                    candidateData.Phone = foundPhones[0].trim();
                }
            }
        } catch (aiError) {
            console.error("AI Extraction Failed, using Rescue Candidate:", aiError);
            // [RESCUE] Create a placeholder so the user doesn't lose the candidate
            candidateData = {
                Name: `RESCUE: ${subject.substring(0, 30)}...`,
                Role: "MANUAL REVIEW REQUIRED",
                "Years of Experience": "0.0",
                "Resume Says": "AI FAILED TO EXTRACT",
                Email: senderEmail || "Check Thread",
                Phone: "Check Thread",
                Notes: "The AI failed to process this resume automatically. Please check the Drive folder manually."
            };
        }

        // 4.5 [DEEP DEDUPLICATION] Check if the extracted Candidate Email already exists (Handles Multi-Vendor scenario)
        if (candidateData.Email && candidateData.Email.toLowerCase() !== 'n/a' && !candidateData.Email.toLowerCase().includes('not provide') && !candidateData.Email.toLowerCase().includes('check thread')) {
            const cleanCandidateEmail = candidateData.Email.trim().toLowerCase();
            if (emailIdx !== -1 && existingRows.length > 1) {
                for (let i = 1; i < existingRows.length; i++) {
                    const rowEmail = existingRows[i][emailIdx];
                    if (rowEmail) {
                        const cleanRowEmail = rowEmail.trim().toLowerCase();
                        if (cleanRowEmail === cleanCandidateEmail) {
                            console.log(`[DEEP DEDUPLICATION] Candidate ${cleanCandidateEmail} found in row ${i + 1}`);
                            return NextResponse.json({
                                success: true,
                                skipped: true,
                                reason: `Candidate already exists (${cleanCandidateEmail}).`,
                                details: `Matched row ${i + 1} email.`
                            });
                        }
                    }
                }
            }
        }

        // 5. Determine or Create the Target Role Folder
        const roleFolderName = manualFolderName || candidateData.Role || 'General';
        console.log(`[DRIVE] Preparing folder for role: ${roleFolderName}`);
        let roleFolderId = manualFolderId;

        if (!roleFolderId) {
            roleFolderId = await getSynchronizedFolder(roleFolderName, targetDriveParentId);
        }

        // Create Candidate Folder
        const candidateFolderName = `${candidateData.Name} - ${candidateData.Email || 'No Email'}`;
        console.log(`[DRIVE] Creating candidate folder: ${candidateFolderName}`);
        let candidateFolderId = await getSynchronizedFolder(candidateFolderName, roleFolderId);

        // 6. Save Attachments (with Matchmaker 2.1 Filter)
        const uploadedFiles = [];
        const moveErrors = [];

        // PATH A: Files were already uploaded directly to Google Drive by the Extension
        if (requestUploadedFiles && requestUploadedFiles.length > 0) {
            console.log(`[DRIVE BYPASS] Processing ${requestUploadedFiles.length} pre-uploaded files...`);
            for (const uploadedFile of requestUploadedFiles) {
                if (!uploadedFile.id) continue;

                // Move the file from the Root (where the Extension uploaded it) into the specific Candidate Folder
                try {
                    const fileObj = await drive.files.get({
                        fileId: uploadedFile.id,
                        fields: 'parents',
                        supportsAllDrives: true  // [FIX] Required for shared/team drives
                    });

                    // Only remove if there are parents
                    const previousParents = (fileObj.data.parents || []).join(',');

                    await drive.files.update({
                        fileId: uploadedFile.id,
                        addParents: candidateFolderId,
                        removeParents: previousParents || undefined,
                        fields: 'id, parents',
                        supportsAllDrives: true  // [FIX] Required for shared/team drives
                    });

                    const fileLink = `https://drive.google.com/file/d/${uploadedFile.id}/view`;
                    uploadedFiles.push({ name: uploadedFile.name, link: fileLink });
                    console.log(`[DRIVE BYPASS] Successfully moved ${uploadedFile.name} into Candidate Folder`);
                } catch (moveErr) {
                    console.error(`[DRIVE BYPASS ERROR] Failed to move file ${uploadedFile.id}:`, moveErr.message);
                    moveErrors.push({ name: uploadedFile.name, error: moveErr.message });
                }
            }
        }
        // PATH B: Legacy Base64 Upload (for backwards compatibility with old extensions or small payloads)
        else if (attachments && attachments.length > 0) {
            const matchedFiles = (candidateData.Belongs_To_Me_Files || []).map(f => f.toLowerCase());

            for (const att of attachments) {
                const fileName = att.name || "attachment_" + Math.random().toString(36).substring(7);
                const lowName = fileName.toLowerCase();

                // [GARBAGE FILTER] Skip tiny files/logos that often result in "undefined" or junk in Drive
                const isGarbage = !att.name || lowName.includes('image00') || lowName.includes('pixel') || lowName.includes('logo');

                // [ANCHOR] Always save the file we actually read as a resume, if AI matched it, or if it's an ID Document
                const isImportantID = /dl|license|passport|visa|h1b|i-94|i94|ead|id[_\s-]?copy|copy/i.test(lowName);
                const isMatched = matchedFiles.some(f => lowName.includes(f) || f.includes(lowName)) ||
                    fileName === primaryResumeFilename ||
                    attachments.indexOf(att) === 0 ||
                    isImportantID;

                if (att.contentBase64 && isMatched && !isGarbage) {
                    const fileId = await uploadFile(fileName, att.mimeType, att.contentBase64, candidateFolderId);
                    const fileLink = `https://drive.google.com/file/d/${fileId}/view`;
                    uploadedFiles.push({ name: fileName, link: fileLink });
                } else if (!isMatched || isGarbage) {
                    console.log(`[MATCHMAKER] Skipping ${fileName} for ${candidateData.Name} (Matched: ${isMatched}, Garbage: ${isGarbage})`);
                }
            }
        }

        // 7. Log to Google Sheet
        const driveFolderLink = `https://drive.google.com/drive/folders/${candidateFolderId}`;
        const aiIdentifiedResume = (candidateData.Identified_Resume_Filename || "").toLowerCase();

        // [SMART-LINK] Find the actual resume from uploadedFiles using Name-Based Matching
        let resumeLink = '';
        if (uploadedFiles.length > 0) {
            // Priority 1: AI Identified Filename
            let bestResumeAtt = attachments.find(att => {
                const low = att.name.toLowerCase();
                return aiIdentifiedResume && (low.includes(aiIdentifiedResume) || aiIdentifiedResume.includes(low));
            });

            // Priority 2: Filename containing "resume" or "cv"
            if (!bestResumeAtt) {
                bestResumeAtt = attachments.find(att => {
                    const low = att.name.toLowerCase();
                    return low.includes('resume') || low.includes('cv') || low.includes('curriculum');
                });
            }

            // Priority 3: Fallback - any document that IS NOT an ID/Visa
            if (!bestResumeAtt) {
                bestResumeAtt = attachments.find(att => {
                    const low = att.name.toLowerCase();
                    const isDoc = low.endsWith('.pdf') || low.endsWith('.docx') || low.endsWith('.doc');
                    // [AGGRESSIVE TRASH FILTER] Strictly exclude IDs, Visa Docs, I-797s, DLs, etc.
                    const isID = /dl|license|passport|visa|h1b|i797|i-797|i94|i-94|id|state|card|ssn|utility|bill|notice|receipt|form|copy/.test(low);
                    return isDoc && !isID;
                });
            }

            if (bestResumeAtt) {
                const matchedFile = uploadedFiles.find(f => f.name === bestResumeAtt.name);
                resumeLink = matchedFile ? matchedFile.link : (uploadedFiles[0]?.link || '');
            } else {
                // Last ditch fallback
                resumeLink = uploadedFiles[0]?.link || '';
            }
        }

        // SMART SYNC: Fetch headers first to map columns correctly
        let headers = [];
        try {
            const headerRes = await sheets.spreadsheets.values.get({
                spreadsheetId: targetSheetId,
                range: 'Sheet1!1:1',
            });
            headers = headerRes.data.values ? headerRes.data.values[0] : [];
        } catch (e) {
            console.error("Failed to fetch headers, falling back to default set.");
        }

        // If sheet is empty or legacy, we use a standard set of headers
        if (headers.length === 0) {
            headers = [
                "Name", "Date", "Subject", "Role", "Exp", "Skills", "Resume Says", "Email", "Phone", "LinkedIn", "Drive Folder", "Resume", "Sender", "Thread", "Processed By", "Fingerprint"
            ];
            await sheets.spreadsheets.values.update({
                spreadsheetId: targetSheetId,
                range: 'Sheet1!1:1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [headers] }
            });
        }

        const findIdx = (name) => {
            const lowName = name.toLowerCase();
            // First look for exact match
            let found = headers.findIndex(h => h.toLowerCase() === lowName);
            if (found !== -1) return found;
            // Fallback to includes
            const i = headers.findIndex(h => h.toLowerCase().includes(lowName));
            return i === -1 ? null : i;
        };

        // Construct the row intelligently based on sheet headers
        const rowData = new Array(headers.length).fill('');

        const mapData = (colName, value) => {
            const idx = findIdx(colName);
            if (idx !== null) rowData[idx] = value;
        };

        const formatDateString = (rawDate) => {
            if (!rawDate || rawDate === 'N/A') {
                const today = new Date();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                const yyyy = today.getFullYear();
                return `${mm}/${dd}/${yyyy}`;
            }
            const d = new Date(rawDate);
            if (isNaN(d.getTime())) return rawDate;
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${mm}/${dd}/${yyyy}`;
        };

        mapData("Name", candidateData.Resume_Name || candidateData.Name || 'N/A');
        mapData("Date", formatDateString(emailDate));
        mapData("Subject", subject || 'N/A');
        mapData("Role", candidateData.Role_Name_Suggest || candidateData.Role || 'N/A');
        mapData("Exp", candidateData.Years_You_Calculate || candidateData['Years of Experience'] || 'N/A');

        // Extract skills to the new column
        mapData("Skills", candidateData.Top_Skills || 'N/A');

        // Construct "Resume Says" by combining the stated role and years, and summary for context
        const resumeSaysText = `${candidateData.Role_Name_Resume_Says || candidateData.Role || ''} (${candidateData.Years_Resume_Says || candidateData['Resume Says'] || ''}). Summary: ${candidateData.Summary || ''}`.trim();
        mapData("Resume Says", resumeSaysText || 'N/A');

        mapData("Email", candidateData.Resume_Email || candidateData.Email || 'N/A');
        mapData("Phone", (candidateData.Resume_Phone || candidateData.Phone) ? `'${candidateData.Resume_Phone || candidateData.Phone}` : 'N/A');

        const linkedIn = candidateData.LinkedIn_URL || candidateData.LinkedIn;
        mapData("LinkedIn", (linkedIn && linkedIn !== 'N/A' && !linkedIn.toLowerCase().includes('not found'))
            ? `=HYPERLINK("${linkedIn.startsWith('http') ? linkedIn : 'https://' + linkedIn}", "LinkedIn")`
            : '--');

        mapData("Drive Folder", `=HYPERLINK("${driveFolderLink}", "Drive Folder")`);
        mapData("Drive", `=HYPERLINK("${driveFolderLink}", "Drive")`);
        mapData("Resume", resumeLink ? `=HYPERLINK("${resumeLink}", "Resume")` : 'N/A');
        mapData("Sender", senderEmail || 'N/A');
        mapData("Thread", threadLink ? `=HYPERLINK("${threadLink}", "Thread")` : 'N/A');
        mapData("Processed By", processedBy || 'N/A');
        mapData("Fingerprint", messageId || threadId || 'N/A');

        mapData("Visa", candidateData.Visa || 'N/A');
        mapData("Location", candidateData.Location || 'N/A');
        mapData("DOB", candidateData.DOB || 'N/A');
        mapData("PPN", candidateData.PPN || 'N/A');

        await appendToSheet(rowData, targetSheetId);

        return NextResponse.json({ 
            success: true, 
            candidate: candidateData, 
            folder: driveFolderLink,
            moveErrors: moveErrors.length > 0 ? moveErrors : null
        });

    } catch (error) {
        console.error('Error processing request:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Helper: Extract Data with Fallback
async function extractCandidateData(subject, body, resumeText, attachments, processedBy, keyOffset = 0, isSyncData = false) {
    const prompt = `
    Extract ONLY these specific fields from the resume provided below.
    Ignore education, personal hobbies, and any other content not specifically requested.

    ### CRITICAL FIELDS TO EXTRACT:
    1. Summary section (copy exactly as written or provide a 2-3 sentence technical summary of their experience).
    2. Client/company names.
    3. Job titles/roles.
    4. Start dates and end dates for every project/job.
    5. Name.
    6. Email, Phone, LinkedIn URL (if present), and Location/City.
    7. Visa/Work Authorization status (if mentioned in resume OR attachments OR AND ESPECIALLY the email body).
    8. Date of Birth (DOB) (if mentioned).
    9. Passport Number (PPN) (if mentioned in the email body OR resume. DO NOT skip if it's clearly stated in the Email Body).
    10. Top_Skills: Extract a comma-separated list of the top 15 to 20 technical skills, programming languages, and frameworks found in the resume.

    ### SOURCE PRIORITY FOR PPN/VISA/DOB:
    - If you find a Passport Number or Visa status in the **Email Body**, USE IT even if it's missing from the Resume text. People often include newer info in their emails.
    - If the email body says "Passport number M1234567", you MUST extract "M1234567" into the PPN field.
    
    ### DATE SYNONYMS (TREAT AS FEB 24, 2026):
    Whenever you see these words, treat them as TODAY (February 24, 2026):
    - "Present", "Till Date", "To Date", "Currently", "Today", "Up to date", "Still Working".

    ### CALCULATIONS:
    - Total years of experience: Calculate from the EARLIEST start date found in the resume up to TODAY (February 24, 2026).
    - Compare this calculated value with what the resume states in its summary.

    ### ROLE SUGGESTION:
    - Suggest a Role Name based on the total experience and seniority found (e.g. Senior Lead Python Architect, Full Stack Java/AWS Lead).
    - Extract the Role Name as stated in the resume.

    ### MATCHMAKER RULE:
    - Look at all attachments provided.
    - Identify EXACTLY which files belong to THIS candidate (e.g., their specific resume, their H1B, their ID).
    - Return these as a list of filenames in the 'Belongs_To_Me_Files' field.
    
    ### OUTPUT FORMAT (JSON ONLY):
    Return exactly this structure:
    {
      "Summary": "Exact summary text from resume",
      "Top_Skills": "Python, React.js, AWS, Docker, NumPy, Pandas, Scikit-learn, etc.",
      "Role_Name_Suggest": "Your professional suggestion based on experience level",
      "Role_Name_Resume_Says": "Role name as stated in resume",
      "Years_You_Calculate": "X.X (Total years from earliest start date to Feb 2026)",
      "Years_Resume_Says": "Years stated in resume summary",
      "Resume_Name": "Full candidate name",
      "Resume_Email": "Email address",
      "Resume_Phone": "Phone number",
      "LinkedIn_URL": "URL or 'Not found'",
      "Location": "City, State or 'N/A'",
      "Visa": "Visa status or 'N/A'",
      "DOB": "Date of birth or 'N/A'",
      "PPN": "Passport number or 'N/A'",
      "Documents_Found": "Resume, H1B, Passport, etc.",
      "Identified_Resume_Filename": "filename.pdf (PICK THE ACTUAL RESUME. IGNORE IDs, PASS-PORTS, VISAS, OR I-797 FORMS)",
      "Belongs_To_Me_Files": ["file1.pdf", "image2.jpg"]
    }

    Resume content and Image Documents are MOST important.
    Return ONLY a valid JSON object.`;

    // [COST OPTIMIZATION] Truncate resume text to 30k characters (approx 10 pages)
    const safeResumeText = resumeText ? resumeText.substring(0, 30000) : "No Resume Text Found";

    // [VISIBILITY] List all potential filenames so the AI can surgically match them
    const fileList = (attachments || []).map(a => a.name).filter(Boolean).join(', ');

    const textContent = `
### AVAILABLE FILES (MATCH THESE FILENAMES):
${fileList}

### PRIMARY SOURCE: RESUME CONTENT
${safeResumeText}

### SECONDARY SOURCE: EMAIL METADATA
Subject: ${subject}
Email Body: ${body}`;

    // Construct Message Payload
    let userMessageContent = [{ type: "text", text: textContent }];

    // Check for Images
    const imageFiles = attachments.filter(a =>
        ['.jpg', '.jpeg', '.png'].some(ext => a.name.toLowerCase().endsWith(ext)) && a.contentBase64
    );

    if (imageFiles.length > 0) {
        console.log(`Attaching ${imageFiles.length} images for Vision analysis...`);
        imageFiles.slice(0, 3).forEach(img => { // Limit to 3 images to avoid payload limits
            userMessageContent.push({
                type: "image_url",
                image_url: {
                    url: `data:${img.mimeType || 'image/jpeg'};base64,${img.contentBase64}`
                }
            });
        });
    }

    // If it's Sync Data, we use DeepSeek CHAT as the PRIMARY engine (10x cheaper than Reasoner).
    const primaryProvider = isSyncData ? "deepseek" : "openai";
    const secondaryProvider = isSyncData ? "openai" : "deepseek";

    const getCompletion = async (p) => {
        const isVision = p === 'openai';
        // [COST OPTIMIZATION] Switched back to deepseek-chat from reasoner
        const model = p === 'openai' ? "gpt-4o" : "deepseek-chat";

        return await getAICompletion({
            messages: [{ role: "system", content: prompt }, { role: "user", content: isVision ? userMessageContent : textContent }],
            model,
            provider: p,
            // Native JSON mode is supported by deepseek-chat
            response_format: { type: "json_object" },
            userEmail: processedBy || "anonymous",
            keyOffset: keyOffset
        });
    };

    try {
        console.log(`Attempting High-Precision [Cost Optimized] extraction with ${primaryProvider.toUpperCase()}...`);
        const response = await getCompletion(primaryProvider);
        let responseContent = response.choices[0].message.content;

        // Clean JSON formatting
        responseContent = responseContent.replace(/```json|```/g, '').trim();

        if (!responseContent || responseContent === "null") throw new Error("AI returned empty content");
        return JSON.parse(responseContent);
    } catch (error) {
        console.warn(`${primaryProvider.toUpperCase()} failed, attempting ${secondaryProvider.toUpperCase()} fallback...`, error.message);
        try {
            const response = await getCompletion(secondaryProvider);
            let responseContent = response.choices[0].message.content;
            responseContent = responseContent.replace(/```json|```/g, '').trim();
            if (!responseContent || responseContent === "null") throw new Error("Fallback failed");
            return JSON.parse(responseContent);
        } catch (fallbackError) {
            console.error("Secondary AI also failed:", fallbackError.message);
            throw fallbackError;
        }
    }
}

// Helper: Parse Attachment Text
async function parseAttachmentText(file) {
    if (!file.contentBase64) return "";
    const buffer = Buffer.from(file.contentBase64, 'base64');

    try {
        const lowName = file.name.toLowerCase();

        // 1. PDF Handling
        if (lowName.endsWith('.pdf')) {
            const pdf = require('pdf-parse');
            let pdfParse = (typeof pdf === 'function') ? pdf : (pdf.default || pdf.pdf || pdf.PDFParse);

            if (!pdfParse) return `[PDF PARSER MISSING]`;

            try {
                // [FIX] Passing custom options prevents pdf-parse from trying to load its own test PDFs (ENOENT error)
                const options = { pagerender: (pageData) => pageData.getTextContent().then(c => c.items.map(i => i.str).join(' ')) };
                const data = await pdfParse(buffer, options);
                return data.text || "";
            } catch (pErr) {
                // Fallback for different pdf-parse exports or constructor issues
                try {
                    const data = await pdfParse(buffer);
                    return data.text || "";
                } catch (e2) {
                    console.error("[PDF ERROR] Final fallback failed:", e2.message);
                    return "";
                }
            }
        }

        // 2. Modern Word (.docx)
        if (lowName.endsWith('.docx')) {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            return result.value || "";
        }

        // 3. Legacy Word (.doc) - Rescue Text
        if (lowName.endsWith('.doc')) {
            // [RESCUE] Legacy .doc is binary, but we can extract readable strings to find names/emails
            const raw = buffer.toString('latin1');
            const rescuedText = raw.replace(/[^\x20-\x7E\t\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
            return `[LEGACY .DOC RESCUE TEXT]: ${rescuedText.substring(0, 5000)}`;
        }

        // 4. Plain Text
        if (lowName.endsWith('.txt')) {
            return buffer.toString('utf-8');
        }

        return "";
    } catch (error) {
        console.error(`Error parsing ${file.name}:`, error.message);
        return `[ERROR READING ${file.name}: ${error.message}]`;
    }
}

// Helper: Find Folder
async function findFolder(name, parentId) {
    const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });
    if (res.data.files.length > 0) return res.data.files[0].id;
    return null;
}

// Helper: Create Folder
async function createFolder(name, parentId) {
    const res = await drive.files.create({
        requestBody: {
            name: name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id',
        supportsAllDrives: true,
    });
    return res.data.id;
}

// Helper: Upload File
async function uploadFile(name, mimeType, base64Content, parentId) {
    const buffer = Buffer.from(base64Content, 'base64');
    const { Readable } = require('stream');

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Create fresh stream for each attempt
            const stream = new Readable();
            stream.push(buffer);
            stream.push(null);

            const res = await drive.files.create({
                requestBody: {
                    name: name,
                    parents: [parentId], // CRITICAL: This places it in the User's folder (User's Quota)
                },
                media: {
                    mimeType: mimeType,
                    body: stream,
                },
                fields: 'id, webViewLink',
                supportsAllDrives: true,
            });
            return res.data.id;
        } catch (error) {
            console.warn(`Upload attempt ${attempt} failed for ${name}:`, error.message);
            if (attempt === MAX_RETRIES) {
                console.error("All upload attempts failed.");
                throw new Error(`Failed to upload ${name} after ${MAX_RETRIES} attempts: ${error.message}`);
            }
            // Wait before retry (1s, 2s, etc.)
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }
}

// Helper: Append to Sheet
async function appendToSheet(values, customSheetId) {
    const spreadsheetId = customSheetId || SHEET_ID;
    // Check if headers exist
    try {
        const headerCheck = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Sheet1!A1',
        });

        if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
            console.log("Sheet is empty. Adding headers...");
            const headers = [
                "Name", "Date", "Subject", "Role", "Exp", "Resume Says", "Email", "Phone", "LinkedIn", "Drive Folder", "Resume", "Sender", "Thread", "Processed By", "Fingerprint"
            ];
            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: 'Sheet1!A1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [headers] },
            });
        }
    } catch (e) {
        console.warn("Header check failed, proceeding to append data:", e.message);
    }

    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Sheet1!A1', // Appends to the end of Sheet1
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [values],
        },
    });
}