import { NextResponse } from 'next/server';
import { readJobs, writeJobs, getDbFileId, isAdmin } from '@/lib/jobsDb';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req) {
    try {
        const fileId = await getDbFileId();
        const jobs = await readJobs();
        const admin = await isAdmin();

        // Attempt a write to see if it throws
        let writeStatus = 'Not Attempted';
        let writeError = null;
        if (req.url.includes('testwrite=true')) {
            try {
                const updated = await writeJobs(jobs);
                writeStatus = updated ? 'Success' : 'Failed returning false';
            } catch (e) {
                writeStatus = 'Exception Throw';
                writeError = e.message;
            }
        }

        return NextResponse.json({
            ok: true,
            fileId,
            jobsCount: jobs.length,
            jobsPreview: jobs.slice(0, 2),
            admin,
            env: {
                hasEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                hasKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
                parentId: process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
            },
            writeStatus,
            writeError
        });
    } catch (error) {
        return NextResponse.json({ ok: false, error: String(error), stack: error.stack }, { status: 500 });
    }
}
