import { drive } from '@/lib/google';
import { NextResponse } from 'next/server';

const PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const res = await drive.files.list({
            q: `'${PARENT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        return NextResponse.json({ folders: res.data.files });
    } catch (error) {
        console.error('Error listing folders:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
