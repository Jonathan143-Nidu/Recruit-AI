
import { drive, sheets, SHEET_ID } from '@/lib/google';
import { getAICompletion } from '@/lib/ai';
import { NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt";

// [FIX] Polyfill DOMMatrix & ImageData for pdf-parse/pdfjs-dist in Node environment
// We FORCE override these because some Node environments have partial/broken Class-only versions 
// that cause "Class constructor cannot be invoked without 'new'" errors.
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

export async function POST(req) {
    try {
        const body = await req.json();
        const { jobDescription, candidates } = body;

        // [NEW] Extract verified user from session
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        const userEmail = token?.email || body.processedBy || 'Unknown User';

        console.log(`Analyzing ${candidates.length} candidates against JD... ProcessedBy: ${userEmail}`);

        const results = [];
        const errors = [];

        // Helper to chunk the candidates array
        const chunkArray = (arr, size) => {
            const chunks = [];
            for (let i = 0; i < arr.length; i += size) {
                chunks.push(arr.slice(i, i + size));
            }
            return chunks;
        };

        // [UPGRADE] Process in parallel batches of 7 (Optimized for 5 employees)
        const candidateChunks = chunkArray(candidates, 7);

        for (const chunk of candidateChunks) {
            console.log(`[Batch Analysis] Processing chunk of ${chunk.length} candidates...`);

            const batchPromises = chunk.map(async (candidate) => {
                try {
                    const fileId = extractFileId(candidate.Resume);
                    if (!fileId) throw new Error("No valid Resume link found");

                    const fileContent = await downloadFileContent(fileId);
                    const analysis = await analyzeCandidate(candidate.Name, fileContent, jobDescription, userEmail);

                    return {
                        ...candidate,
                        ...analysis,
                        success: true
                    };
                } catch (err) {
                    console.error(`Failed to analyze ${candidate.Name}:`, err);
                    return {
                        ...candidate,
                        matchPercentage: 0,
                        missingSkills: ["Error: " + err.message],
                        matchStatus: "Error",
                        error: err.message,
                        success: false
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);

            // Separate results and errors
            batchResults.forEach(res => {
                if (!res.success) {
                    errors.push({ name: res.Name, error: res.error });
                }
                const { success, error, ...cleanResult } = res;
                results.push(cleanResult);
            });
        }

        // 4. Save to History (Fire and Forget)
        saveAnalysisHistory(jobDescription, results, userEmail).catch(err => console.error("Failed to save history:", err));

        return NextResponse.json({ results, errors });

    } catch (error) {
        console.error("Match API Error:", error);
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
            range: 'Analysis_History!A:D',
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
                        requests: [{
                            addSheet: {
                                properties: { title: "Analysis_History" }
                            }
                        }]
                    }
                });
                // Retry saving
                await saveAnalysisHistory(jd, results, processedBy);
            } catch (createErr) {
                console.error("Failed to create Analysis_History sheet:", createErr);
            }
        }
    }
}

// --- Helpers ---

function extractFileId(resumeLink) {
    if (!resumeLink) return null;

    console.log("Extracting File ID from:", resumeLink); // DEBUG LOG

    // 1. Try simple URL match first
    const urlMatch = resumeLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];

    // 2. Try extracting from HYPERLINK formula with various quote styles
    // Matches: =HYPERLINK("url", "text") OR =HYPERLINK('url', 'text')
    const formulaMatch = resumeLink.match(/HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (formulaMatch) {
        // Now extract ID from that inner URL
        const innerUrl = formulaMatch[1];
        const innerMatch = innerUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (innerMatch) return innerMatch[1];
    }

    return null;
}

async function downloadFileContent(fileId) {
    try {
        // 1. Get file metadata to check mime type
        const meta = await drive.files.get({
            fileId,
            fields: 'name, mimeType',
            supportsAllDrives: true
        });
        const mimeType = meta.data.mimeType;
        console.log("File Metadata:", meta.data);

        // 2. Download file as stream/buffer
        const response = await drive.files.get({
            fileId,
            alt: 'media',
            supportsAllDrives: true
        }, { responseType: 'arraybuffer' });

        const buffer = Buffer.from(response.data);

        // 3. Parse Text based on MimeType
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);

        if (mimeType === 'application/pdf') {
            const pdfParse = require('pdf-parse');
            let data;
            try {
                // Try calling as a standard function first
                data = await pdfParse(buffer);
            } catch (e) {
                // If it fails because it's actually an ES6 class in this environment
                if (e.message.includes("Class constructor")) {
                    console.log("DEBUG: pdfParse is a class. Retrying with 'new'...");
                    data = await new pdfParse(buffer);
                } else {
                    throw e;
                }
            }
            return data.text;
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') { // docx
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: buffer });
            return result.value;
        } else if (mimeType === 'text/plain') {
            return buffer.toString('utf-8');
        } else {
            return "Unsupported file format for AI analysis.";
        }
    } catch (e) {
        console.error("Drive Download Error for ID:", fileId, e);
        // Throw the ACTUAL error message so user sees "404 Not Found" or "Permission Denied"
        throw new Error(`Drive Error: ${e.message}`);
    }
}

async function analyzeCandidate(name, resumeText, jd, userEmail) {
    const prompt = `
    Role: Expert Technical Recruiter & Forensic Resume Analyst.
    Task: Execute a "Deep Reasoning" comparison of the Candidate Resume against the Job Description (JD).

    Candidate Name: ${name}

    Analyze all skills and certifications in JD and resume
    try deep reasoning mode. 
    analyze the resume and JD inch to inch then give the match, missing and partial skills and certifications.

    Job Description:
    ${jd.substring(0, 5000)}

    Resume Text:
    ${resumeText.substring(0, 50000)}

    Consider years or months of any skill only if mentioned in JD.

    STRICT CATEGORIZATION RULES:
    1. If the candidate has 0 months (0m) of a required skill, it MUST be listed in "Missing Skills".
    2. A skill is a "Partial Match" ONLY if the candidate has MORE than 0m experience, but less than the JD requirement.
    3. If there are NO Partial Match skills with >0m experience, do NOT include a Partial Match section in the reasoning or output.
    4. STRICT CERTIFICATION CLASSIFICATION:
        - Any item that is a certification (contains keywords: "Certification", "Certified", "Professional", "Expert", "Associate", "CDMP", "TOGAF", "DAMA", "SnowPro") MUST be listed in "Missing Certifications" and NEVER in "Missing Skills".
        - "Missing Skills" is strictly for technical skills, tools, and languages (e.g., Python, SQL, Snowflake, Databricks).

    STRICT OUTPUT RULES:
    - Every skill entry must be EXACTLY ONE LINE.
    - Do NOT add any notes, justifications, or descriptive text below the skill line.
    - The "Has" column MUST ONLY contain a numerical value (e.g., "12m", "5y", "0m").

    After processing all above scenarios give me desired output as below in the "gapAnalysis" field of the JSON.

    Output Format: JSON string ONLY.
    {
        "internalReasoning": "Brief summary of reasoning",
        "matchPercentage": Number,
        "missingPercentage": Number,
        "matchStatus": "High Match" | "Partial Match" | "Low Match",
        "matchedSkills": ["Skill Name (Evidence)"],
        "partialMatchSkills": [
            { "skill": "Skill Name", "req": "X months", "has": "Y months", "evidence": "Context" }
        ],
        "missingSkills": [
            { "skill": "Skill Name", "req": "X months", "has": "0m" }
        ],
        "missingCertifications": ["Certification Name"],
        "gapAnalysis": "DESIRED OUTPUT:\n\nMissing Skills:\n| Missing Skills | JD Req | Has |\n| :--- | :--- | :--- |\n• [Skill Name] | [Req] | 0m\n...\n\nMissing Certifications:\n| Missing Certifications |\n| :--- |\n• [Certification Name]\n...\n\nPartial Match Skills:\n| Partial Match Skills | JD Req | Has |\n| :--- | :--- | :--- |\n• [Skill Name] | [Req] | [Has]\n...\n\nResume Percentage to JD:\n(match skills +Partial skills) % \nMissing skills %"
    }

    STRICT: Return ONLY valid JSON. No other text.
    `;

    try {
        const completion = await getAICompletion({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4-turbo",
            temperature: 0.0,
            response_format: { type: "json_object" },
            userEmail: userEmail
        });

        const rawContent = completion.choices[0].message.content;
        console.log(`\n--- RAW AI RESPONSE FOR ${name} ---\n`, rawContent, "\n-------------------\n");

        return JSON.parse(rawContent);
    } catch (e) {
        console.error("AI Analysis Error:", e);
        const errorMsg = e.error?.message || e.message || "Unknown AI Error";
        return {
            matchPercentage: 0,
            missingSkills: [`AI Error: ${errorMsg} `],
            matchStatus: "Error",
            gapAnalysis: "Failed to analyze candidate due to AI service error."
        };
    }
}
