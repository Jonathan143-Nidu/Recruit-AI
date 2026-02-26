import { google } from 'googleapis';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.accessToken) {
            return NextResponse.json({ error: 'Unauthorized: Re-login required' }, { status: 401 });
        }

        let bodyData;
        try {
            bodyData = await req.json();
        } catch (e) {
            console.error("DEBUG: Empty or invalid JSON body in process-single:", e.message);
            return NextResponse.json({ error: 'Malformed request: Missing body.' }, { status: 400 });
        }

        const { messageId, emailDate, targetFolderName, targetFolderId, keyOffset = 0 } = bodyData;

        // 1. Initialize Gmail API
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const gmail = google.gmail({ version: 'v1', auth });

        // 2. Fetch the message to get the Thread ID
        const msg = await gmail.users.messages.get({
            userId: 'me',
            id: messageId
        });

        // 3. Fetch Full Thread to scan all replies for documents
        const thread = await gmail.users.threads.get({
            userId: 'me',
            id: msg.data.threadId
        });

        const attachments = [];
        let body = "";
        let subject = "";
        let from = "";

        // 3. Loop through EVERY message in the thread
        for (const message of thread.data.messages) {
            const mHeaders = message.payload.headers;
            if (!subject) subject = mHeaders.find(h => h.name === 'Subject')?.value || 'No Subject';
            if (!from) from = mHeaders.find(h => h.name === 'From')?.value || 'Unknown';

            // Extract Body (Handle Multipart)
            function findBody(part) {
                if (part.mimeType === 'text/plain' && part.body.data) {
                    body += Buffer.from(part.body.data, 'base64').toString('utf-8') + "\n";
                } else if (part.parts) {
                    part.parts.forEach(findBody);
                }
            }
            if (message.payload.parts) {
                message.payload.parts.forEach(findBody);
            } else if (message.payload.body.data) {
                body += Buffer.from(message.payload.body.data, 'base64').toString('utf-8') + "\n";
            }

            // Extract Attachments
            async function fetchParts(part) {
                if (part.filename && part.body && part.body.attachmentId) {
                    try {
                        const att = await gmail.users.messages.attachments.get({
                            userId: 'me',
                            messageId: message.id,
                            id: part.body.attachmentId
                        });
                        attachments.push({
                            name: part.filename,
                            mimeType: part.mimeType,
                            contentBase64: att.data.data
                                .replace(/-/g, '+')
                                .replace(/_/g, '/')
                        });
                    } catch (e) {
                        console.error(`Failed to fetch attachment ${part.filename}:`, e);
                    }
                } else if (part.parts) {
                    for (const p of part.parts) {
                        await fetchParts(p);
                    }
                }
            }

            if (message.payload.parts) {
                for (const p of message.payload.parts) {
                    await fetchParts(p);
                }
            }
        }

        // 5. Identify EXACT Candidate Documents (Negative Filtering for IDs)
        const candidateFiles = attachments.filter(att => {
            const lowerName = att.name.toLowerCase();
            const isDoc = lowerName.endsWith('.pdf') || lowerName.endsWith('.docx') || lowerName.endsWith('.doc');

            // Forensic Exclusion: Don't treat these as primary resumes
            const isID = /dl|license|passport|visa|h1b|i-94|i94|id_copy|identification/.test(lowerName);

            return isDoc && !isID;
        });

        // [GHOST FILTER] Skip processing if no real resumes are found (only logos/junk)
        if (candidateFiles.length === 0) {
            console.log(`[GHOST FILTER] No real resumes found in thread ${msg.data.threadId}. Skipping... 🛡️🧹`);
            return NextResponse.json({
                success: true,
                processedCount: 0,
                skipped: true,
                reason: "No valid resume (PDF/DOC/DOCX) found in thread attachments.",
                details: []
            });
        }

        // Supporting docs are things like images (EAD, Passport) or text files
        const supportingFiles = attachments.filter(att => !candidateFiles.includes(att));

        const results = [];
        const origin = req.headers.get('origin') || `http://${req.headers.get('host')}`;

        // 6. Process each Candidate File separately (Turbo Parallel Mode)
        if (candidateFiles.length > 1) {
            console.log(`[TURBO] Detected ${candidateFiles.length} separate resumes. Processing in parallel...`);

            const processPromises = candidateFiles.map(async (resume, index) => {
                try {
                    const processResponse = await fetch(`${origin}/api/process`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            accessCode: process.env.APP_ACCESS_CODE,
                            subject,
                            emailBody: body,
                            attachments: [resume, ...supportingFiles],
                            manualFolderName: targetFolderName,
                            manualFolderId: targetFolderId,
                            senderEmail: from,
                            threadLink: `https://mail.google.com/mail/u/0/#inbox/${thread.data.id}`,
                            threadId: thread.data.id,
                            emailDate: emailDate, // Pass through
                            processedBy: session.user.email,
                            keyOffset: keyOffset + index
                        })
                    });
                    return await processResponse.json();
                } catch (e) {
                    console.error(`[TURBO ERROR] Failed to process resume ${resume.name}:`, e.message);
                    return { success: false, error: e.message, filename: resume.name };
                }
            });

            const batchResults = await Promise.all(processPromises);
            results.push(...batchResults);
        } else {
            // Standard behavior: 1 resume (or none) with attachments
            const processResponse = await fetch(`${origin}/api/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessCode: process.env.APP_ACCESS_CODE,
                    subject,
                    emailBody: body,
                    attachments: attachments,
                    manualFolderName: targetFolderName,
                    manualFolderId: targetFolderId,
                    senderEmail: from,
                    threadLink: `https://mail.google.com/mail/u/0/#inbox/${thread.data.id}`,
                    threadId: thread.data.id,
                    emailDate: emailDate, // Pass through
                    processedBy: session.user.email
                })
            });
            const resJson = await processResponse.json();
            results.push(resJson);
        }

        return NextResponse.json({ success: true, processedCount: results.length, details: results });

    } catch (error) {
        console.error('Single Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
