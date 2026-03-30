import { getAICompletion } from '@/lib/ai';
import { analyzeCandidate } from '@/lib/match';
import { sheets, SHEET_ID } from '@/lib/google';
import { NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt";

// [FIX] Polyfill DOMMatrix & ImageData for pdf-parse/pdfjs-dist in Node environment
const polyfill = () => {
    function mock() {
        this.m11 = 1; this.m12 = 0; this.m21 = 0; this.m22 = 1;
        this.m31 = 0; this.m32 = 0; this.m41 = 0; this.m42 = 0;
        this.width = 1; this.height = 1; this.data = new Uint8ClampedArray(4);
    }

    const targets = ['DOMMatrix', 'ImageData', 'Path2D'];
    const globals = [global, globalThis];
    globals.forEach(g => {
        if (!g) return;
        targets.forEach(t => {
            try {
                Object.defineProperty(g, t, {
                    value: mock,
                    configurable: true,
                    writable: true
                });
            } catch (e) {
                g[t] = mock;
            }
        });
    });
};
polyfill();

export const maxDuration = 300; // Allow 5 mins for large files and AI
export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const formData = await req.formData();
        const jd = formData.get('jd');
        const resumeFiles = formData.getAll('resumeFile'); // MULTIPLE FILES SUPPORT
        const resumeTextPaste = formData.get('resumeText');
        
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        const userEmail = token?.email || 'Manual Analyzer';

        if (!jd) {
            return NextResponse.json({ error: "Job Description is required." }, { status: 400 });
        }

        const parseFile = async (file) => {
            const buffer = Buffer.from(await file.arrayBuffer());
            const mimeType = file.type || '';
            const fileName = (file.name || '').toLowerCase();
            
            const { createRequire } = await import('module');
            const require = createRequire(import.meta.url);

            if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
                const rawPdfParse = require('pdf-parse/lib/pdf-parse.js');
                const pdfParse = rawPdfParse.default || rawPdfParse;
                try {
                    const data = await pdfParse(buffer);
                    return data.text;
                } catch (e) {
                    if (e.message.includes("Class constructor")) {
                        const data = await new pdfParse(buffer);
                        return data.text;
                    } else throw e;
                }
            } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc') || mimeType.includes('word')) { 
                const mammoth = require('mammoth');
                try {
                    const result = await mammoth.extractRawText({ buffer: buffer });
                    return result.value;
                } catch (e) {
                    console.error("Mammoth DOC/DOCX parsing error:", e);
                    return buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ''); 
                }
            } else if (mimeType.includes('text') || fileName.endsWith('.txt')) {
                return buffer.toString('utf-8');
            } else {
                throw new Error(`Unsupported file format: ${file.name}. Please use PDF, DOCX, DOC, or TXT.`);
            }
        };

        if (resumeFiles && resumeFiles.length > 0) {
            // Process all uploaded files in parallel
            const analysisResults = await Promise.all(resumeFiles.map(async (file) => {
                const resumeContent = await parseFile(file);
                const name = file.name || "Unknown Candidate";
                const analysis = await analyzeCandidate(name, resumeContent, jd, userEmail);
                return { Name: name, ...analysis };
            }));

            const roleSummary = jd.split('\n')[0] || "Custom Upload";
            saveAnalysisHistory(`MANUAL BATCH: ${roleSummary}`, analysisResults, userEmail).catch(err => console.error(err));

            return NextResponse.json({
                success: true,
                results: analysisResults
            });

        } else if (resumeTextPaste && resumeTextPaste.trim().length > 0) {
            // Single manual paste
            const analysis = await analyzeCandidate("Manual Paste", resumeTextPaste, jd, userEmail);
            const analysisResults = [{ Name: "Manual Paste", ...analysis }];
            
            const roleSummary = jd.split('\n')[0] || "Pasted Text";
            saveAnalysisHistory(`MANUAL PASTE: ${roleSummary}`, analysisResults, userEmail).catch(err => console.error(err));

            return NextResponse.json({
                success: true,
                results: analysisResults
            });
        } else {
            return NextResponse.json({ error: "Please provide either Resume File(s) or pasted Resume Text." }, { status: 400 });
        }

    } catch (error) {
        console.error("Manual JD Analyzer Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function saveAnalysisHistory(jd, results, processedBy) {
    try {
        const timestamp = new Date().toISOString();
        const candidateCount = results.length;
        const resultsJson = JSON.stringify(results);

        // Append to 'Analysis_History' sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Analysis_History!A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [
                    [timestamp, jd, candidateCount, resultsJson, processedBy || 'N/A']
                ]
            }
        });
    } catch (e) {
        console.error("Error saving history row:", e);
        // If sheet doesn't exist, try creating it
        if (e.message && e.message.includes("Unable to parse range")) {
            try {
                console.log("Creating Analysis_History sheet...");
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SHEET_ID,
                    requestBody: {
                        requests: [{ addSheet: { properties: { title: "Analysis_History" } } }]
                    }
                });
                // Once created, retry append
                await saveAnalysisHistory(jd, results, processedBy);
            } catch (createErr) {
                console.error("Could not create Analysis_History sheet:", createErr);
            }
        }
    }
}
