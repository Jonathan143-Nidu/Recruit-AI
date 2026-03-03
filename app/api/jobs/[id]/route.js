import { NextResponse } from 'next/server';
import { readJobs, writeJobs, isAdmin } from '@/lib/jobsDb';

// PUT — edit a job
export async function PUT(req, context) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;   // ← await params (Next.js 15)
    const body = await req.json();
    const jobs = await readJobs(); // Changed to await
    const idx = jobs.findIndex(j => j.id === id);

    if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    jobs[idx] = { ...jobs[idx], ...body };
    await writeJobs(jobs); // Changed to await

    return NextResponse.json(jobs[idx]);
}

// DELETE — delete a job
export async function DELETE(req, context) {
    if (!(await isAdmin())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;   // ← await params (Next.js 15)
    const jobs = await readJobs(); // Changed to await
    const filtered = jobs.filter(j => j.id !== id);

    if (filtered.length === jobs.length) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await writeJobs(filtered); // Changed to await
    return NextResponse.json({ success: true });
}
