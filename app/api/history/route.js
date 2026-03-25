
import { sheets, SHEET_ID } from '@/lib/google';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Analysis_History!A:E',
        });

        const rows = response.data.values || [];
        
        // Skip header if present
        const dataRows = rows.length > 0 && rows[0][0] === 'Timestamp' ? rows.slice(1) : rows;

        // Format: [Timestamp, JD, Count, ResultsJSON, ProcessedBy]
        const history = dataRows.map((row, index) => {
            try {
                return {
                    id: index, // Simple index as ID
                    timestamp: row[0],
                    jd: row[1],
                    count: row[2],
                    results: JSON.parse(row[3] || '[]'),
                    processedBy: row[4] || 'N/A'
                };
            } catch (e) {
                console.warn("Failed to parse history row:", index, e);
                return null;
            }
        }).filter(item => item !== null).reverse(); // Show newest first

        return NextResponse.json({ history });
    } catch (error) {
        console.error("History API Error:", error);
        if (error.message.includes("Unable to parse range")) {
            return NextResponse.json({ history: [] });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { jd, count, results, processedBy } = body;
        const timestamp = new Date().toISOString();

        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Analysis_History!A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[timestamp, jd, count, JSON.stringify(results || []), processedBy || 'N/A']]
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("History Save Error:", error);
        // [AUTO-CREATION] If sheet missing, create it
        if (error.message.includes("Unable to parse range")) {
            try {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [{ addSheet: { properties: { title: "Analysis_History" } } }]
                    }
                });
                // Recursive retry (one time)
                return await POST(req);
            } catch (createErr) {
                return NextResponse.json({ error: "Failed to create history sheet" }, { status: 500 });
            }
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
