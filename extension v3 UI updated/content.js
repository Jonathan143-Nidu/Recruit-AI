// content.js - In-Page UI & Extraction Logic

// --- 1. UTILS ---
function safeWait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitCondition(conditionFn, timeout = 10000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const result = conditionFn();
        if (result) return result;
        await safeWait(interval);
    }
    return null;
}

// --- 2. DOMAIN CHECK ---
function checkDomain() {
    const title = document.title;
    console.log("Checking domain for title:", title);
    return true; // Bypass for debugging
}

// --- 3. UI INJECTION ---
let observer = null;
let lastUrl = location.href;

function init() {
    console.log("Gmail Saver: Content Script Loaded");
    if (!checkDomain()) return;

    // Detect URL changes (Gmail is a SPA)
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            triggerCheck();
        }
    }, 1000);

    // Initial check and observer
    observer = new MutationObserver(() => triggerCheck());
    observer.observe(document.body, { childList: true, subtree: true });
    
    triggerCheck();
}

function triggerCheck() {
    const selectors = ['.gD', '.qu', 'span[email]', 'h3 span', '.gE'];
    let senderElement = null;

    for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
            if (el.innerText.length > 0 && el.offsetParent !== null) {
                senderElement = el;
                const isThread = document.querySelector('h2.hP');
                if (isThread && !el.querySelector('.gmail-saver-btn') && !el.parentElement.querySelector('.gmail-saver-btn')) {
                    injectButton(el);
                }
            }
        }
    }
}

function injectButton(senderElement) {
    if (senderElement.dataset.saverInjected === 'true') return;
    senderElement.dataset.saverInjected = 'true';

    const btn = document.createElement('button');
    btn.className = 'gmail-saver-btn';
    btn.innerHTML = '💾 Save';
    btn.style.cssText = `
        background-color: #0b57d0;
        color: white;
        border: none;
        border-radius: 18px;
        padding: 4px 12px;
        margin-left: 8px;
        font-weight: 500;
        cursor: pointer;
        font-family: 'Google Sans',Roboto,RobotoDraft,Helvetica,Arial,sans-serif;
        font-size: 12px;
        vertical-align: middle;
        z-index: 900;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
        display: inline-block;
        transition: background-color 0.2s;
    `;

    btn.onmouseover = () => btn.style.backgroundColor = '#0842a0';
    btn.onmouseout = () => btn.style.backgroundColor = '#0b57d0';

    if (senderElement.parentElement) {
        senderElement.parentElement.appendChild(btn);
    } else {
        senderElement.parentNode.insertBefore(btn, senderElement.nextSibling);
    }

    btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Scanning...';
        btn.disabled = true;

        try {
            await showModal(senderElement);
        } catch (err) {
            console.error(err);
            btn.innerHTML = '⚠️ Error';
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }, 3000);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };
}

// --- 3. MODAL UI ---
async function showModal(senderElement) {
    if (document.getElementById('gmail-saver-modal')) return;

    let senderEmail = 'Unknown';
    if (senderElement) {
        senderEmail = senderElement.getAttribute('email') || senderElement.title || senderElement.innerText;
        const match = senderEmail.match(/<([^>]+)>/);
        if (match) senderEmail = match[1];
    }
    const threadLink = window.location.href;

    const backdrop = document.createElement('div');
    backdrop.id = 'gmail-saver-modal';
    backdrop.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 10000;
        display: flex;
        justify-content: center;
        align-items: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white;
        padding: 24px;
        border-radius: 8px;
        width: 480px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        font-family: Roboto, sans-serif;
    `;

    modal.innerHTML = `
        <div style="text-align:center; padding: 20px;">
            <div style="margin-bottom:10px;">⏳ Scanning email thread...</div>
            <div style="font-size:12px; color:#666;">Expanding replies and finding attachments</div>
        </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    try {
        await expandAllThreads();
        const emailData = await extractEmailData();
        emailData.senderEmail = senderEmail;
        emailData.threadLink = threadLink;

        chrome.runtime.sendMessage({ action: "fetchFolders" }, (response) => {
            if (!response || !response.success) {
                renderError(modal, response ? response.error : "Failed to fetch folders.");
            } else {
                renderForm(modal, emailData, response.folders);
            }
        });
    } catch (err) {
        renderError(modal, "Extraction Failed: " + err.message);
    }
}

function renderForm(modal, emailData, folders) {
    let attachmentHtml = '';
    emailData.attachments.forEach((att, idx) => {
        attachmentHtml += `
            <div style="display:flex; align-items:center; margin-bottom:4px;">
                <input type="checkbox" id="att-${idx}" checked style="margin-right:8px;">
                <label for="att-${idx}" style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:320px;" title="${att.name}">
                    ${att.name}
                </label>
            </div>
        `;
    });

    const folderOptions = folders.map(f => `<option value="${f.name}">${f.name}</option>`).join('');

    modal.innerHTML = `
        <div style="margin-bottom:16px;">
            <label style="display:block; font-size:11px; margin-bottom:4px; color:#5f6368; text-transform:uppercase;">Sender Email</label>
            <input type="text" value="${emailData.senderEmail}" disabled style="width:100%; padding:8px; background:#f1f3f4; border:none; border-radius:4px; color:#666;">
        </div>

        <div style="margin-bottom:16px;">
            <label style="display:block; font-size:11px; margin-bottom:4px; color:#5f6368; text-transform:uppercase;">Candidate Name (Subject)</label>
            <input type="text" value="${emailData.subject}" disabled style="width:100%; padding:8px; background:#f1f3f4; border:none; border-radius:4px;">
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom:16px;">
            <div>
                <label style="display:block; font-size:11px; margin-bottom:4px; color:#5f6368; text-transform:uppercase;">Role Folder</label>
                <select id="folder-select" style="width:100%; padding:8px; border:1px solid #dadce0; border-radius:4px;">
                    <option value="">-- Select --</option>
                    ${folderOptions}
                </select>
            </div>
            <div>
                <label style="display:block; font-size:11px; margin-bottom:4px; color:#5f6368; text-transform:uppercase;">New Folder</label>
                <input type="text" id="new-folder" placeholder="e.g. Java Dev" style="width:100%; padding:8px; border:1px solid #dadce0; border-radius:4px;">
            </div>
        </div>

        <div style="margin-bottom:20px; max-height:100px; overflow-y:auto; border:1px solid #eee; padding:8px; background:#fafafa; border-radius:4px;">
            <label style="display:block; font-size:11px; margin-bottom:6px; font-weight:bold; color:#5f6368; text-transform:uppercase;">Attachments</label>
            ${attachmentHtml || '<p style="font-size:11px; color:#999;">No documents found.</p>'}
        </div>

        <div style="margin-bottom:16px;">
            <label style="display:block; font-size:11px; margin-bottom:6px; font-weight:bold; color:#5f6368; text-transform:uppercase;">Activity Log</label>
            <div id="activity-log" style="
                height: 120px; 
                background: #1e1e1e; 
                color: #d4d4d4; 
                padding: 10px; 
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace; 
                font-size: 11px; 
                line-height: 1.4; 
                overflow-y: auto; 
                border-radius: 4px;
                box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
            ">
                <div style="color: #6a9955;">// Ready to process candidate...</div>
            </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button id="cancel-btn" style="padding:8px 16px; border:none; background:none; cursor:pointer; color:#5f6368; font-weight:500;">Cancel</button>
            <button id="process-btn" style="padding:8px 24px; border:none; background:#0b57d0; color:white; border-radius:18px; cursor:pointer; font-weight:500;">Extract & Save</button>
        </div>
        <div id="status-msg" style="margin-top:10px; font-size:13px; font-weight: 500;"></div>
    `;

    document.getElementById('cancel-btn').onclick = () => document.getElementById('gmail-saver-modal').remove();

    document.getElementById('process-btn').onclick = async () => {
        const btn = document.getElementById('process-btn');
        const status = document.getElementById('status-msg');
        btn.disabled = true;
        btn.innerText = 'Processing...';

        const folderSelect = document.getElementById('folder-select');
        const manualInput = document.getElementById('new-folder');
        const finalFolder = manualInput.value.trim() || folderSelect.value;

        const selectedAttachments = [];
        emailData.attachments.forEach((att, idx) => {
            const cb = document.getElementById(`att-${idx}`);
            if (cb && cb.checked) selectedAttachments.push(att);
        });

        const payload = {
            subject: emailData.subject,
            senderEmail: emailData.senderEmail,
            threadLink: emailData.threadLink,
            emailBody: emailData.body,
            attachments: selectedAttachments,
            manualFolderName: finalFolder,
            processedBy: extractLoggedInUser()
        };

        chrome.runtime.sendMessage({ action: "processEmail", payload }, (response) => {
            if (response && response.success) {
                if (response.skipped) {
                    status.style.color = '#e67e22';
                    status.innerHTML = `⚠️ Already exists. Check Sheet.`;
                } else {
                    status.style.color = 'green';
                    status.innerHTML = `✅ Saved Successfully!`;
                    setTimeout(() => document.getElementById('gmail-saver-modal').remove(), 3000);
                }
            } else {
                status.style.color = 'red';
                status.innerText = '❌ Error occurred.';
                btn.disabled = false;
                btn.innerText = 'Extract & Save';
            }
        });
    };
}

function renderError(modal, msg) {
    modal.innerHTML = `
        <h3 style="color:red">Error</h3>
        <p>${msg}</p>
        <button onclick="document.getElementById('gmail-saver-modal').remove()">Close</button>
    `;
}

async function expandAllThreads() {
    try {
        const expandBtn = document.querySelector('[aria-label="Expand all"], img[alt="Expand all"], div[data-tooltip="Expand all"]');
        if (expandBtn) {
            expandBtn.click();
            await waitCondition(() => {
                const bodies = document.querySelectorAll('.a3s.aiL');
                return bodies.length > 1;
            }, 3000);
        }
    } catch (e) { }
}

async function extractEmailData() {
    const subjectElement = document.querySelector('h2.hP');
    const subject = subjectElement ? subjectElement.textContent : 'No Subject';
    const messageBodies = document.querySelectorAll('.a3s.aiL');
    let fullBody = '';
    messageBodies.forEach(el => fullBody += el.innerText + '\n---\n');

    const rawAttachments = [];
    const seenUrls = new Set();
    const allLinks = Array.from(document.querySelectorAll('a'));
    
    for (const link of allLinks) {
        const url = link.href;
        if (url && (url.includes('view=att') || url.includes('disp=safe') || url.includes('disp=attd'))) {
            await processAttachment(url, link, rawAttachments, seenUrls);
        }
    }

    const uniqueAttachments = [];
    const seenNames = new Set();
    const allowedExts = ['.pdf', '.docx', '.doc', '.txt', '.jpg', '.jpeg', '.png'];
    const ignoredNames = ['signature', 'image00', 'logo'];

    for (const att of rawAttachments) {
        const lowerName = att.name.toLowerCase();
        if (allowedExts.some(ext => lowerName.endsWith(ext)) && !ignoredNames.some(ign => lowerName.includes(ign))) {
            if (!seenNames.has(lowerName)) {
                seenNames.add(lowerName);
                uniqueAttachments.push(att);
            }
        }
    }

    return { subject, body: fullBody, attachments: uniqueAttachments };
}

async function processAttachment(url, element, attachments, seenUrls) {
    if (url.startsWith('/')) url = window.location.origin + url;
    if (url.includes('view=att')) {
        url = url.replace('disp=safe', 'disp=attd').replace('disp=inline', 'disp=attd');
        if (!url.includes('disp=')) url += '&disp=attd';
    }
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    let filename = element.getAttribute('download') || element.getAttribute('aria-label') || element.innerText || 'Attachment';
    filename = filename.replace(/download/gi, '').trim();

    const mimeMap = { 'pdf': 'application/pdf', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const ext = filename.split('.').pop().toLowerCase();
    
    attachments.push({ name: filename, url: url, mimeType: mimeMap[ext] || 'application/octet-stream' });
}

function extractLoggedInUser() {
    const title = document.title;
    const match = title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1] : "Unknown User";
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const addLog = (msg, color = '#d4d4d4') => {
        const log = document.getElementById('activity-log');
        if (log) {
            const line = document.createElement('div');
            const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            line.innerHTML = `<span style="color: #569cd6;">[${time}]</span> <span style="color: ${color};">${msg}</span>`;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }
    };

    if (request.action === "downloadAttachment") {
        addLog(`[FETCH] Starting content-script download...`, '#ce9178');
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', request.url, true);
            xhr.responseType = 'blob';
            xhr.withCredentials = true;
            xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const reader = new FileReader();
                    reader.onloadend = () => sendResponse({ success: true, base64: reader.result.split(',')[1] });
                    reader.readAsDataURL(xhr.response);
                } else {
                    addLog(`[ERROR] Fetch failed: ${xhr.status}`, '#f44747');
                    sendResponse({ success: false, error: `HTTP ${xhr.status}` });
                }
            };
            xhr.onerror = () => {
                addLog(`[ERROR] Network error`, '#f44747');
                sendResponse({ success: false, error: "Network error" });
            };
            xhr.send();
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        return true;
    }

    if (request.action === "updateProgress") {
        const modal = document.getElementById('gmail-saver-modal');
        if (modal) {
            const status = modal.querySelector('#status-msg');
            if (status) {
                status.style.color = '#0b57d0';
                status.innerText = '⏳ ' + request.msg;
            }
            let color = '#d4d4d4';
            if (request.msg.includes('SUCCESS')) color = '#b5cea8';
            if (request.msg.includes('ERROR') || request.msg.includes('FAILED')) color = '#f44747';
            if (request.msg.includes('UPLOAD')) color = '#ce9178';
            if (request.msg.includes('SAVED')) color = '#4fc1ff';
            addLog(request.msg, color);
        }
    }
});

init();