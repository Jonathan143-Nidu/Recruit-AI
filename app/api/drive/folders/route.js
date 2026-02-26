import { drive, GMAIL_SYNC_DRIVE_FOLDER_ID } from "@/lib/google";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // We target the new Shared Drive folder specifically for Gmail Sync
        const parentId = GMAIL_SYNC_DRIVE_FOLDER_ID;

        const res = await drive.files.list({
            q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            orderBy: 'name',
        });

        return NextResponse.json({ success: true, folders: res.data.files });
    } catch (error) {
        console.error("Failed to list Drive folders:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
