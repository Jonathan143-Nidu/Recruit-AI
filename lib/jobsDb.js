import { decode } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import { drive } from '@/lib/google';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

const ADMIN_EMAIL = 'careers@innovcentric.com';
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev_mode_only';
const DB_FILENAME = 'innovcentric-jobs-db.json';

export async function isAdmin() {
    const cookieStore = await cookies();
    const sessionToken =
        cookieStore.get('next-auth.session-token')?.value ||
        cookieStore.get('__Secure-next-auth.session-token')?.value;

    if (!sessionToken) return false;

    const token = await decode({ token: sessionToken, secret: SECRET });
    return token?.email === ADMIN_EMAIL;
}

export async function getDbFileId() {
    const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    if (!parentId) return null;

    try {
        const res = await drive.files.list({
            q: `name='${DB_FILENAME}' and '${parentId}' in parents and trashed=false`,
            fields: 'files(id)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        });
        return res.data.files && res.data.files.length > 0 ? res.data.files[0].id : null;
    } catch (e) {
        console.error("Drive API error (list):", e.message);
        return null;
    }
}

export async function readJobs() {
    try {
        const fileId = await getDbFileId();
        if (!fileId) {
            const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
            let initialJobs = [];
            try {
                if (fs.existsSync(JOBS_FILE)) {
                    initialJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
                }
            } catch (fsErr) {
                console.warn("Could not read local fallback:", fsErr);
            }
            if (initialJobs.length > 0) {
                await writeJobs(initialJobs);
            }
            return initialJobs;
        }

        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });

        let data = res.data;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                console.error("Failed to parse drive data:", e.message);
                return [];
            }
        }

        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Error reading jobs:", e.message);
        return [];
    }
}

export async function writeJobs(jobs) {
    try {
        const fileId = await getDbFileId();
        const jsonStr = JSON.stringify(jobs, null, 2);

        const media = {
            mimeType: 'application/json',
            body: jsonStr,
        };

        if (fileId) {
            await drive.files.update({
                fileId: fileId,
                media: media,
                supportsAllDrives: true,
            });
        } else {
            const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
            if (parentId) {
                await drive.files.create({
                    requestBody: {
                        name: DB_FILENAME,
                        parents: [parentId]
                    },
                    media: media,
                    supportsAllDrives: true,
                });
            } else {
                console.warn("No parent folder id for drive!");
            }
        }
        return true;
    } catch (e) {
        console.error("Error writing jobs:", e.message);
        return false;
    }
}
