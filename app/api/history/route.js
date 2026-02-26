
import { sheets, SHEET_ID } from '@/lib/google';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: 'Analysis_History!A:E',
        });

        const rows = response.data.values || [];
        // Format: [Timestamp, JD, Count, ResultsJSON]
        const history = rows.map((row, index) => {
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
        // If sheet doesn't exist, return empty list instead of error
        if (error.message.includes("Unable to parse range")) {
            return NextResponse.json({ history: [] });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
