import { drive, GMAIL_SYNC_DRIVE_FOLDER_ID } from '@/lib/google';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { folderName, parentId } = await req.json();
        const targetParentId = parentId || GMAIL_SYNC_DRIVE_FOLDER_ID;

        // 1. Try to find the folder
        const listRes = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${targetParentId}' in parents and trashed=false`,
            fields: 'files(id, name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        if (listRes.data.files && listRes.data.files.length > 0) {
            console.log(`[Folder Scout] Found existing folder: ${folderName} (${listRes.data.files[0].id})`);
            return NextResponse.json({ success: true, folderId: listRes.data.files[0].id });
        }

        // 2. Not found? Create it!
        console.log(`[Folder Scout] Creating new folder: ${folderName}`);
        const createRes = await drive.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [targetParentId],
            },
            fields: 'id',
            supportsAllDrives: true,
        });

        return NextResponse.json({ success: true, folderId: createRes.data.id });

    } catch (error) {
        console.error('Folder Scout Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
