import { NextResponse } from 'next/server';
import { decode } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import fs from 'fs';
import path from 'path';

const JOBS_FILE = path.join(process.cwd(), 'data', 'jobs.json');
const ADMIN_EMAIL = 'careers@innovcentric.com';
const SECRET = process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev_mode_only';

function readJobs() {
    try {
        return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

function writeJobs(jobs) {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

async function isAdmin() {
    const cookieStore = await cookies();
    const sessionToken =
        cookieStore.get('next-auth.session-token')?.value ||
        cookieStore.get('__Secure-next-auth.session-token')?.value;

    if (!sessionToken) return false;

    const token = await decode({ token: sessionToken, secret: SECRET });
    return token?.email === ADMIN_EMAIL;
}

// PUT — edit a job
export async function PUT(req, context) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;   // ← await params (Next.js 15)
    const body = await req.json();
    const jobs = readJobs();
    const idx = jobs.findIndex(j => j.id === id);

    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    jobs[idx] = { ...jobs[idx], ...body };
    writeJobs(jobs);

    return NextResponse.json(jobs[idx]);
}

// DELETE — delete a job
export async function DELETE(req, context) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;   // ← await params (Next.js 15)
    const jobs = readJobs();
    const filtered = jobs.filter(j => j.id !== id);

    if (filtered.length === jobs.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    writeJobs(filtered);
    return NextResponse.json({ success: true });
}
