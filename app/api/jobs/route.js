import { NextResponse } from 'next/server';
import { decode } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
const ADMIN_EMAIL = 'careers@innovcentric.com';
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev_mode_only';

async function isAdmin() {
    const cookieStore = await cookies();
    const sessionToken =
        cookieStore.get('next-auth.session-token')?.value ||
        cookieStore.get('__Secure-next-auth.session-token')?.value;
    if (!sessionToken) return false;
    const token = await decode({ token: sessionToken, secret: SECRET });
    return token?.email === ADMIN_EMAIL;
}

function readJobs() {
    try {
        const data = fs.readFileSync(JOBS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

function writeJobs(jobs) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
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
    const jobs = readJobs();

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

    const jobs = readJobs();
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
    writeJobs(jobs);

    return NextResponse.json(newJob, { status: 201 });
}
