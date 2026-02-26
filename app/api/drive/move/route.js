import { google } from 'googleapis';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from 'next/server';
import { GMAIL_SYNC_DRIVE_FOLDER_ID } from '@/lib/google';

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.accessToken) {
            return NextResponse.json({ error: 'Unauthorized: Re-login required' }, { status: 401 });
        }

        const { folderLink, targetFolderName } = await req.json();

        // Extract folder ID from link safely (handles query params and different URL formats)
        let fileId = null;
        const match = folderLink.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (match) {
            fileId = match[1];
        } else {
            // Fallback for direct IDs or unique links
            fileId = folderLink.split('/').pop().split('?')[0];
        }

        if (!fileId) throw new Error("Invalid folder link provided.");

        // Use the Shared Service Account drive client for consistent permissions
        const { drive } = require('@/lib/google');

        // 1. Get the current parents
        const file = await drive.files.get({
            fileId: fileId,
            fields: 'parents',
            supportsAllDrives: true
        });
        const previousParents = file.data.parents?.join(',') || '';

        // 2. Find or Create the Target Role Folder
        // We'll search in the main Gmail Sync Data folder
        const parentId = GMAIL_SYNC_DRIVE_FOLDER_ID;

        const folderList = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${targetFolderName}' and '${parentId}' in parents and trashed=false`,
            fields: 'files(id, name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });

        let targetFolderId;
        if (folderList.data.files.length > 0) {
            targetFolderId = folderList.data.files[0].id;
        } else {
            // Create new folder
            const newFolder = await drive.files.create({
                requestBody: {
                    name: targetFolderName,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentId],
                },
                fields: 'id',
                supportsAllDrives: true,
            });
            targetFolderId = newFolder.data.id;
        }

        // 3. Move the folder to the new parent
        await drive.files.update({
            fileId: fileId,
            addParents: targetFolderId,
            removeParents: previousParents,
            fields: 'id, parents',
            supportsAllDrives: true,
        });

        return NextResponse.json({ success: true, message: `Moved to ${targetFolderName}` });

    } catch (error) {
        console.error('Drive Move Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
