import { google } from 'googleapis';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { sheets, GMAIL_SYNC_SHEET_ID } from "@/lib/google";
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.accessToken) {
            console.error("DEBUG: No session or accessToken found!");
            return NextResponse.json({ error: 'Unauthorized: Re-login required for Gmail access' }, { status: 401 });
        }

        console.log("DEBUG: Session found. AccessToken starts with:", session.accessToken?.substring(0, 10));

        const { startDate, endDate, subject } = await req.json();

        // 1. Initialize Gmail API with User Token
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const gmail = google.gmail({ version: 'v1', auth });

        // 2. Fetch Existing "Fingerprints" (Thread IDs) from Google Sheet
        let existingIds = new Set();
        try {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: GMAIL_SYNC_SHEET_ID,
                range: 'Sheet1!P:P', // Column P is the Fingerprint/Thread ID
            });
            if (res.data.values) {
                // Flatten the 2D array and exclude the header if present
                existingIds = new Set(res.data.values.flat().filter(id => id !== 'Fingerprint' && id !== 'N/A'));
            }
        } catch (sheetError) {
            console.warn("Could not fetch existing IDs from sheet (might be empty):", sheetError.message);
        }

        // 3. Build Gmail Search Query (STRICT ATTACHMENTS + DYNAMIC SUBJECT)
        let query = `has:attachment`;
        if (subject) query += ` subject:"${subject}"`;
        if (startDate) query += ` after:${startDate.replace(/-/g, '/')}`;
        if (endDate) query += ` before:${endDate.replace(/-/g, '/')}`;

        console.log("Gmail Query:", query);

        // 4. List ALL Messages matching query (Recursive Pagination)
        const allMessages = [];
        let nextPageToken = null;

        do {
            const msgRes = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                pageToken: nextPageToken,
                maxResults: 100 // Fetch in chunks of 100
            });

            if (msgRes.data.messages) {
                allMessages.push(...msgRes.data.messages);
            }
            nextPageToken = msgRes.data.nextPageToken;
        } while (nextPageToken);

        if (allMessages.length === 0) {
            return NextResponse.json({ success: true, count: 0, candidates: [] });
        }

        // 5. Filter for candidates NOT in our "Already Processed" set
        const unfilteredMessages = [];
        const seenInThisBatch = new Set();

        for (const msg of allMessages) {
            if (!existingIds.has(msg.threadId) && !seenInThisBatch.has(msg.threadId)) {
                seenInThisBatch.add(msg.threadId);
                unfilteredMessages.push(msg);
            }
        }

        if (unfilteredMessages.length === 0) {
            return NextResponse.json({ success: true, count: 0, candidates: [] });
        }

        // 6. Turbo Scan Batching: Fetch Details in Parallel Groups
        const candidates = [];
        const batchSize = 20;

        for (let i = 0; i < unfilteredMessages.length; i += batchSize) {
            const batch = unfilteredMessages.slice(i, i + batchSize);
            const batchPromises = batch.map(async (msg) => {
                try {
                    const detail = await gmail.users.messages.get({
                        userId: 'me',
                        id: msg.id,
                        format: 'metadata',
                        metadataHeaders: ['Subject', 'From', 'Date']
                    });

                    const headers = detail.data.payload.headers;
                    const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
                    const from = headers.find(h => h.name === 'From')?.value || 'Unknown';
                    const date = headers.find(h => h.name === 'Date')?.value || '';

                    return {
                        id: msg.id,
                        threadId: msg.threadId,
                        subject,
                        from,
                        date,
                        snippet: detail.data.snippet
                    };
                } catch (err) {
                    console.error(`Error fetching detail for message ${msg.id}:`, err);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            candidates.push(...batchResults.filter(c => c !== null));
        }

        return NextResponse.json({
            success: true,
            totalFound: allMessages.length,
            uniqueCount: candidates.length,
            candidates
        });

    } catch (error) {
        console.error('Batch Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
