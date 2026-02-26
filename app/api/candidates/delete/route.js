import { sheets, SHEET_ID, GMAIL_SYNC_SHEET_ID } from '@/lib/google';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { rowIndices, dbType } = await req.json();

        if (!rowIndices || !Array.isArray(rowIndices) || rowIndices.length === 0) {
            return NextResponse.json({ error: 'No rows provided for deletion.' }, { status: 400 });
        }

        const targetSheetId = dbType === 'sync' ? GMAIL_SYNC_SHEET_ID : SHEET_ID;

        // Note: Google Sheets API batchUpdate requires sheetId (which is usually 0 for the first sheet)
        // We need to fetch the sheetId first based on the targetSheetId (Spreadsheet ID)
        const sheetMeta = await sheets.spreadsheets.get({
            spreadsheetId: targetSheetId
        });

        // Assuming data is in the first sheet ("Sheet1")
        const sheetId = sheetMeta.data.sheets[0].properties.sheetId;

        // Sort indices descending to avoid shifting the rows as we delete them
        const sortedIndices = [...rowIndices].sort((a, b) => b - a);

        const requests = sortedIndices.map(index => ({
            deleteDimension: {
                range: {
                    sheetId: sheetId,
                    dimension: "ROWS",
                    startIndex: index - 1,   // startIndex is inclusive, 0-indexed
                    endIndex: index          // endIndex is exclusive
                }
            }
        }));

        const response = await sheets.spreadsheets.batchUpdate({
            spreadsheetId: targetSheetId,
            requestBody: {
                requests
            }
        });

        return NextResponse.json({ success: true, count: sortedIndices.length });
    } catch (error) {
        console.error('Delete Candidates Error:', error);
        return NextResponse.json({ error: error.message || 'Failed to delete candidates' }, { status: 500 });
    }
}
