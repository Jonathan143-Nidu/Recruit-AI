// background.js - API Proxy and Config
// Configuration
const WEB_APP_URL = "http://https://recruit.innovcentric.com/";
const ACCESS_CODE = "secret123";

// --- 1. UTILS ---
async function fetchWithRetry(url, options = {}, retries = 3, backoff = 1000) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        if (retries > 0 && (error.message.includes('NetworkError') || error.message.includes('Fetch'))) {
            console.warn(`Retrying fetch: ${url}. Retries left: ${retries}`);
            await new Promise(r => setTimeout(r, backoff));
            return fetchWithRetry(url, options, retries - 1, backoff * 2);
        }
        throw error;
    }
}

// --- 2. MESSAGE HANDLER ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchFolders") {
        handleFetchFolders(sendResponse);
        return true;
    }
    if (request.action === "processEmail") {
        handleProcessEmail(request.payload, sender, sendResponse);
        return true;
    }
    if (request.action === "downloadAttachment") {
        handleDownloadAttachment(request.url, sendResponse);
        return true;
    }
});

async function handleDownloadAttachment(url, sendResponse) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Could not download file from Gmail");
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            sendResponse({ success: true, base64 });
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        console.error("Download Attachment Failed:", error);
        sendResponse({ success: false, error: error.message });
    }
}

async function handleFetchFolders(sendResponse) {
    try {
        const data = await fetchWithRetry(`${WEB_APP_URL}/api/folders`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        sendResponse({ success: true, folders: data.folders || [] });
    } catch (error) {
        console.error("Fetch Folders Failed:", error);
        sendResponse({ success: false, error: "Backend Connection Error: " + error.message });
    }
}

async function handleProcessEmail(payload, sender, sendResponse) {
    const sendProgress = (msg) => {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, { action: "updateProgress", msg });
        }
    };

    try {
        console.log("[UPLOAD] Starting Direct Drive Upload process for", payload.attachments.length, "files");
        sendProgress(`🚀 Starting upload process for ${payload.attachments.length} files...`);

        // 1. Get Temporary Drive Token
        sendProgress(`🔑 Authenticating with Drive...`);
        const tokenData = await fetchWithRetry(`${WEB_APP_URL}/api/drive/token?accessCode=${ACCESS_CODE}`);
        if (!tokenData.success || !tokenData.token) throw new Error("Failed to get Drive token.");
        const driveToken = tokenData.token;
        const parentFolderId = tokenData.parentFolderId;
        sendProgress(`✅ Auth Success.`);

        // 2. Upload Each Attachment Directly to Drive
        const uploadedFiles = [];
        const attachmentsToProcess = [...payload.attachments];

        for (let i = 0; i < attachmentsToProcess.length; i++) {
            const att = attachmentsToProcess[i];
            if (!att.url || att.error) continue;

            sendProgress(`[FETCH] Starting download of ${att.name}...`);

            try {
                let bytes;
                let downloadSuccess = false;
                let lastError = "";

                // Attempt Background Fetch
                try {
                    const response = await fetch(att.url, { credentials: 'include' });
                    if (response.ok) {
                        const arrayBuffer = await response.arrayBuffer();
                        bytes = new Uint8Array(arrayBuffer);
                        downloadSuccess = true;
                        sendProgress(`[SUCCESS] Downloaded ${att.name} via Service Worker.`);
                    } else {
                        lastError = `HTTP ${response.status}`;
                        sendProgress(`[RETRY] SW Fetch failed (${lastError}) for ${att.name}. Trying fallback...`);
                    }
                } catch (fetchErr) {
                    lastError = fetchErr.message;
                    sendProgress(`[RETRY] SW Fetch error for ${att.name}. Trying fallback...`);
                }

                // Fallback to Content Script
                if (!downloadSuccess) {
                    const dlRes = await new Promise(resolve => {
                        chrome.tabs.sendMessage(sender.tab.id, { action: "downloadAttachment", url: att.url }, (res) => {
                            resolve(res);
                        });
                    });

                    if (dlRes && dlRes.success) {
                        const binary = atob(dlRes.base64);
                        bytes = new Uint8Array(binary.length);
                        for (let b = 0; b < binary.length; b++) bytes[b] = binary.charCodeAt(b);
                        downloadSuccess = true;
                        sendProgress(`[SUCCESS] Downloaded ${att.name} via Content Script.`);
                    } else {
                        throw new Error(`Download failed: ${dlRes?.error || 'Unknown error'}`);
                    }
                }

                // Upload to Drive
                sendProgress(`[UPLOAD] Sending ${att.name} to Google Drive...`);
                const driveId = await uploadToDriveDirect(bytes, att.name, att.mimeType, driveToken, parentFolderId, (msg) => {
                    sendProgress(`[DRIVE] ${msg} (${att.name})...`);
                });

                const fileLink = `https://drive.google.com/file/d/${driveId}/view`;
                uploadedFiles.push({ name: att.name, id: driveId });
                sendProgress(`[SUCCESS] ${att.name} saved to Drive.`);

            } catch (err) {
                console.error(`[UPLOAD ERROR] ${att.name}:`, err);
                sendProgress(`[FAILED] Could not process ${att.name}: ${err.message}`);
                // Don't throw, try next file
            }
        }

        // 3. Finalize with Next.js Backend
        sendProgress(`[AI] Analyzing content and logging to Google Sheet...`);
        const finalPayload = {
            subject: payload.subject,
            senderEmail: payload.senderEmail,
            threadLink: payload.threadLink,
            emailBody: payload.emailBody,
            attachments: payload.attachments.map(a => ({
                name: a.name,
                mimeType: a.mimeType,
                error: a.error
            })),
            manualFolderName: payload.manualFolderName,
            processedBy: payload.processedBy,
            accessCode: ACCESS_CODE,
            uploadedFiles: uploadedFiles
        };

        const data = await fetchWithRetry(`${WEB_APP_URL}/api/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });

        // 4. Handle Results
        if (data.skipped) {
            sendProgress(`[SAVED] Duplicate Candidate found: ${data.reason}`);
            chrome.notifications.create({
                type: 'basic',
                iconUrl: chrome.runtime.getURL('icon128.png'),
                title: 'Duplicate Candidate',
                message: data.reason || 'Candidate already exists in Sheets.',
                priority: 2
            });
            sendResponse({ success: true, skipped: true, reason: data.reason });
            return;
        }

        sendProgress(`[SAVED] Candidate ${data.candidate?.Name || 'Success'} added to Sheets.`);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon128.png'),
            title: 'Candidate Saved!',
            message: `Successfully saved ${data.candidate?.Name || 'Candidate'} to ${payload.manualFolderName || 'Drive'}.`,
            priority: 2
        });

        sendResponse({
            success: true,
            candidate: data.candidate,
            folder: data.folder,
            moveErrors: data.moveErrors
        });

    } catch (error) {
        console.error("Process Email Failed:", error);
        sendProgress(`[CRITICAL ERROR] ${error.message}`);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon128.png'),
            title: 'Save Failed',
            message: `Error: ${error.message}. Please try again.`,
            priority: 2
        });
        sendResponse({ success: false, error: error.message });
    }
}

async function uploadToDriveDirect(bytes, fileName, mimeType, token, parentId, progressCallback) {
    mimeType = mimeType || 'application/pdf';
    if (progressCallback) progressCallback("🐚 Creating file placeholder");

    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: fileName,
            parents: [parentId],
            mimeType: mimeType
        })
    });

    if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(`Metadata creation failed: ${err.error?.message || createRes.statusText}`);
    }

    const fileData = await createRes.json();
    const fileId = fileData.id;

    if (progressCallback) progressCallback("📤 Uploading binary data");

    const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
        method: "PATCH",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": mimeType
        },
        body: bytes
    });

    if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(`Media upload failed: ${err.error?.message || uploadRes.statusText}`);
    }

    return fileId;
}