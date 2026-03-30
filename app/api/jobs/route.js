import { NextResponse } from 'next/server';
import { readJobs, writeJobs, isAdmin } from '@/lib/jobsDb';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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
    const { title, location, type, description, exp, rate, workMode, priority } = body;

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
        priority: priority || false,
        status: body.status || 'Open',
        mustHave: body.mustHave || ''
    };

    jobs.push(newJob);
    await writeJobs(jobs); // Changed to await

    return NextResponse.json(newJob, { status: 201 });
}
