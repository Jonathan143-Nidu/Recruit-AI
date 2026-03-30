document.addEventListener('DOMContentLoaded', () => {
    const serverUrlInput = document.getElementById('serverUrl');
    const accessCodeInput = document.getElementById('accessCode');
    const processBtn = document.getElementById('processBtn');
    const statusDiv = document.getElementById('status');
    const folderSelect = document.getElementById('folderSelect');
    const newFolderDiv = document.getElementById('newFolderDiv');
    const newFolderInput = document.getElementById('newFolderInput');
    const attachmentsList = document.getElementById('attachmentsList');

    let currentAttachments = []; // Store fetched attachments

    // Load saved settings
    chrome.storage.local.get(['serverUrl', 'accessCode'], (result) => {
        if (result.serverUrl) {
            serverUrlInput.value = result.serverUrl;
            loadFolders(result.serverUrl);
        }
        if (result.accessCode) accessCodeInput.value = result.accessCode;
    });

    // Auto-Fetch Attachments on Open
    fetchAttachments();

    // Handle Folder Selection Change
    folderSelect.addEventListener('change', () => {
        if (folderSelect.value === 'new') {
            newFolderDiv.style.display = 'block';
        } else {
            newFolderDiv.style.display = 'none';
            newFolderInput.value = '';
        }
    });

    serverUrlInput.addEventListener('blur', () => {
        loadFolders(serverUrlInput.value);
    });

    async function loadFolders(baseUrl) {
        if (!baseUrl) return;
        baseUrl = baseUrl.replace(/\/$/, '');
        try {
            folderSelect.innerHTML = '<option value="">Loading...</option>';
            const res = await fetch(`${baseUrl}/api/folders`);
            const data = await res.json();

            let options = '<option value="">Auto-Detect (AI)</option>';
            options += '<option value="new">+ Create New Folder</option>';

            if (data.folders) {
                data.folders.forEach(f => {
                    options += `<option value="${f.name}">${f.name}</option>`;
                });
            }
            folderSelect.innerHTML = options;
        } catch (e) {
            console.error("Failed to load folders", e);
            folderSelect.innerHTML = '<option value="">Error Loading Folders</option><option value="new">+ Create New Folder</option>';
        }
    }

    async function fetchAttachments() {
        try {
            attachmentsList.innerHTML = '<div style="color: #666; font-style: italic;">Scanning for attachments...</div>';

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url.includes('mail.google.com')) {
                attachmentsList.innerHTML = '<div style="color: red;">Please open a Gmail email.</div>';
                return;
            }

            // Send message to content script
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });

            if (response && response.attachments && response.attachments.length > 0) {
                currentAttachments = response.attachments;
                renderAttachments(currentAttachments);
            } else {
                currentAttachments = [];
                attachmentsList.innerHTML = '<div style="color: #666;">No attachments found.</div>';
            }
        } catch (error) {
            console.error(error);
            attachmentsList.innerHTML = '<div style="color: red;">Error scanning attachments. Refresh page.</div>';
        }
    }

    function renderAttachments(attachments) {
        attachmentsList.innerHTML = '';
        attachments.forEach((att, index) => {
            const div = document.createElement('div');
            div.style.marginBottom = '5px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `att-${index}`;
            checkbox.checked = true; // Default to checked
            checkbox.value = index;

            const label = document.createElement('label');
            label.htmlFor = `att-${index}`;
            label.textContent = att.name;
            label.style.marginLeft = '5px';
            label.style.cursor = 'pointer';

            div.appendChild(checkbox);
            div.appendChild(label);
            attachmentsList.appendChild(div);
        });
    }

    processBtn.addEventListener('click', async () => {
        const serverUrl = serverUrlInput.value.replace(/\/$/, '');
        const accessCode = accessCodeInput.value;

        if (!serverUrl || !accessCode) {
            showStatus('Please enter Server URL and Access Code.', 'error');
            return;
        }

        // Get Selected Attachments
        const selectedIndices = Array.from(document.querySelectorAll('#attachmentsList input[type="checkbox"]:checked'))
            .map(cb => parseInt(cb.value));

        const attachmentsToSend = currentAttachments.filter((_, index) => selectedIndices.includes(index));

        if (attachmentsToSend.length === 0) {
            if (!confirm("No attachments selected. Process email body only?")) return;
        }

        // Determine Manual Folder Name
        let manualFolderName = '';
        const selectedFolder = folderSelect.value;
        if (selectedFolder === 'new') {
            manualFolderName = newFolderInput.value.trim();
            if (!manualFolderName) {
                showStatus('Please enter a name for the New Folder.', 'error');
                return;
            }
        } else if (selectedFolder !== '') {
            manualFolderName = selectedFolder;
        }

        chrome.storage.local.set({ serverUrl, accessCode });

        showStatus('Processing...', '');
        processBtn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // We re-use the extraction data we already fetched? 
            // Better to re-fetch subject/body just in case, or store it.
            // For simplicity, let's just trigger extractData again OR allow it to be passed.
            // Actually, we already have currentAttachments. We just need subject/body again.
            // Let's re-run extraction quickly to get text, but we override attachments with our selection.
            const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractData' });

            showStatus('Sending to backend...', '');

            const apiResponse = await fetch(`${serverUrl}/api/process`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessCode,
                    subject: response.subject,
                    emailBody: response.body,
                    attachments: attachmentsToSend, // User selected only
                    manualFolderName: manualFolderName
                })
            });

            const result = await apiResponse.json();

            if (!apiResponse.ok) {
                throw new Error(result.error || 'Server error');
            }

            showStatus(`Success! Saved to ${result.folder}`, 'success');

            if (result.folder) {
                setTimeout(() => window.open(result.folder, '_blank'), 1500);
            }

        } catch (error) {
            console.error(error);
            showStatus(error.message, 'error');
        } finally {
            processBtn.disabled = false;
        }
    });

    function showStatus(text, type) {
        statusDiv.textContent = text;
        statusDiv.className = `status ${type}`;
        statusDiv.style.display = 'block';
    }
});
