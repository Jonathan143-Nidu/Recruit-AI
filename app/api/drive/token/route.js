import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const accessCode = searchParams.get('accessCode');

        if (accessCode !== process.env.APP_ACCESS_CODE) {
            return NextResponse.json({ error: 'Unauthorized: Invalid access code' }, { status: 401 });
        }

        if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            throw new Error('Missing Google Service Account credentials');
        }

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
            },
            scopes: ['https://www.googleapis.com/auth/drive'],
        });

        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();

        // [FIX] parentFolderId must point to the SAME drive that /api/process uses for extension
        // submissions (no threadId) → GOOGLE_DRIVE_PARENT_FOLDER_ID = Hiring drive.
        // Old code used GMAIL_SYNC_DRIVE_FOLDER_ID which pointed to "Gmail Sync Data" — wrong drive.
        return NextResponse.json({
            success: true,
            token: tokenResponse.token,
            parentFolderId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
        }, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }
        });

    } catch (error) {
        console.error("Token Generation Error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Failed to generate Drive token" },
            { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
    }
}

export async function OPTIONS() {
    return new Response(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
    });
}