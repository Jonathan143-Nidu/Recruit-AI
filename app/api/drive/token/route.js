import { google } from 'googleapis';
import { NextResponse } from 'next/server';

// Reuse the existing auth initialization logic from lib/google.js
export async function GET(request) {
    try {
        // 1. Validate Access Code
        const { searchParams } = new URL(request.url);
        const accessCode = searchParams.get('accessCode');

        if (accessCode !== process.env.APP_ACCESS_CODE) {
            return NextResponse.json({ error: 'Unauthorized: Invalid access code' }, { status: 401 });
        }

        // 2. Initialize Service Account Auth
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

        // 3. Request a temporary OAuth Access Token for the service account
        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();

        // 4. Return the secure short-lived token to the Chrome Extension
        return NextResponse.json({
            success: true,
            token: tokenResponse.token,
            // The extension needs the Parent Folder ID to know where to create role folders
            parentFolderId: process.env.GMAIL_SYNC_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
        });

    } catch (error) {
        console.error("Token Generation Error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Failed to generate Drive token" },
            { status: 500 }
        );
    }
}
