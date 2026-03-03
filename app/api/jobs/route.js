import { NextResponse } from 'next/server';
import { decode } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import { drive } from '@/lib/google'; // Added for Google Drive
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';

const ADMIN_EMAIL = 'careers@innovcentric.com';
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev_mode_only';
const DB_FILENAME = 'innovcentric-jobs-db.json';

async function isAdmin() {
    const cookieStore = await cookies();
    const sessionToken =
        cookieStore.get('next-auth.session-token')?.value ||
        cookieStore.get('__Secure-next-auth.session-token')?.value;
    if (!sessionToken) return false;
    const token = await decode({ token: sessionToken, secret: SECRET });
    return token?.email === ADMIN_EMAIL;
}

async function getDbFileId() {
    const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
    const res = await drive.files.list({
        q: `name='${DB_FILENAME}' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });
    return res.data.files && res.data.files.length > 0 ? res.data.files[0].id : null;
}

export async function readJobs() {
    try {
        const fileId = await getDbFileId();
        if (!fileId) {
            // [MIGRATION] If Drive DB doesn't exist yet, read the local jobs.json and upload it
            const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
            let initialJobs = [];
            try {
                if (fs.existsSync(JOBS_FILE)) {
                    initialJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
                }
            } catch (fsErr) {
                console.warn("Could not read local jobs.json fallback:", fsErr);
            }

            // Auto-seed Google Drive with the local data
            if (initialJobs.length > 0) {
                await writeJobs(initialJobs);
            }
            return initialJobs;
        }

        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
        // Depending on googleapis version, it might automatically parse JSON or return as string
        const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error("Error reading jobs from Drive:", e.message);
        return [];
    }
}

export async function writeJobs(jobs) {
    const fileId = await getDbFileId();
    const jsonStr = JSON.stringify(jobs, null, 2);

    // Convert string to a readable stream for upload
    const stream = new Readable();
    stream.push(Buffer.from(jsonStr, 'utf-8'));
    stream.push(null);

    const media = {
        mimeType: 'application/json',
        body: stream,
    };

    if (fileId) {
        await drive.files.update({
            fileId: fileId,
            media: media,
            supportsAllDrives: true,
        });
    } else {
        await drive.files.create({
            requestBody: {
                name: DB_FILENAME,
                parents: [process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID]
            },
            media: media,
            supportsAllDrives: true,
        });
    }
}

function generateJobId(jobs) {
    let max = 0;
    for (const job of jobs) {
        const match = job.jobId && job.jobId.match(/^Inno-(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > max) max = num;
        }
    }
    const nextNum = String(max + 1).padStart(3, '0');
    return `Inno-${nextNum}`;
}

// GET — public: active jobs only. Admin: all jobs when ?all=true
export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const fetchAll = searchParams.get('all') === 'true';
    const jobs = await readJobs(); // Changed to await

    if (fetchAll) {
        if (await isAdmin()) {
            return NextResponse.json(jobs);
        }
    }

    return NextResponse.json(jobs.filter(j => j.active));
}

// POST — admin only: create a new job
export async function POST(req) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { title, location, type, description, exp, rate, workMode } = body;

    if (!title || !description) {
        return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
    }

    const jobs = await readJobs(); // Changed to await
    const newJob = {
        id: Date.now().toString(),
        jobId: generateJobId(jobs),
        title,
        location: location || 'Remote',
        type: type || 'Full-time',
        workMode: workMode || 'Remote',
        exp: exp || '',
        rate: rate || '',
        description,
        posted: new Date().toISOString(),
        active: true,
        status: body.status || 'Open',
        mustHave: body.mustHave || ''
    };

    jobs.push(newJob);
    await writeJobs(jobs); // Changed to await

    return NextResponse.json(newJob, { status: 201 });
}
