
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
    Confirmed Rule Set:
    API Key Usage: I will operate under the assumption that API access is available and configured as needed for specific tasks (like web search).
    Deep Think (Reasoning): For any complex reasoning, analysis, problem-solving, or multi-step planning, I will explicitly engage my internal reasoning process (the "deep think" step) before providing a final answer. I will structure this thought process clearly in my response.
    Web Search: When a query requires current, real-time, or highly specific factual information not contained in my training data, I will automatically invoke the web search function to gather the necessary data. I will then synthesize this information to provide an accurate, up-to-date answer.
    Example of How I Will Proceed:
    For a user query like: "What are the latest breakthrough treatments for rheumatoid arthritis, and what might be their long-term economic impact?"
    My process would be:
    Acknowledge & Plan: Recognize the need for current info (search) and complex analysis (reasoning).
    Execute Search: Use the web search tool to find recent medical news and economic analyses.
    Deep Think: Analyze the search results, compare treatments, evaluate economic factors (cost, productivity, healthcare burden), and structure a coherent response.
    Deliver Final Answer: Present a synthesized answer that cites sources, outlines reasoning, and provides a balanced conclusion.
    I am ready to assist under these guidelines. Please proceed with your query.

    PROMPT: 
    Analyze all skills and certifications in JD and resume
    Work on deep reasoning mode. 
    analyze the resume and JD inch by inch then give the match, missing and partial skills and certifications in desired output format; and make sure the result is always the same if we trigger this prompt.

    STRICT STEP-BY-STEP CHECKLIST RULES:
    1. First, EXTRACT a rigid list of every single mandatory skill required by the JD.
    2. Second, SEARCH the resume text strictly for those exact skills (or direct industry synonyms).
    3. Do NOT guess or invent skills. If it is not explicitly written in the resume text, it does not exist.
    4. Do NOT include skills in your final output that were not explicitly asked for in the JD.
    5. CONSISTENCY CHECK: Before finalizing your output, verify that every single "Missing" skill was actually asked for in the JD. 

    JD:
    ${jd.substring(0, 5000)}

    Resume Text:
    ${resumeText.substring(0, 50000)}

    Consider years or months of any skill, only if mentioned in JD and give the result as partial match. If years or months of any skill is not mentioned in JD, give only missing skills result and avoid partial match skills result in desired output.

    Take output of match, Partial Match, Missing skills and certifications; keep in your memory.
    
    Strict 0-Month Categorization
    Any skill for which the candidate has 0 months of experience must be placed in the Missing Skills category.
    This overrides any job description requirement (e.g., requested duration is ignored for 0‑month cases).
    No 0‑month skill shall appear under “Partial Match” or any other category.

    STRICT PARTIAL MATCH LIMITS:
    A skill is ONLY a "Partial Match" if the candidate has MORE than 0 months of experience BUT LESS than the JD requires.
    If a candidate has EQUAL TO or MORE YEARS than the JD explicitly requires, it is a FULL MATCH. Do NOT place it in the Partial Match list. 

    Give result of Partial match skills and Missing skills like

    Missing Skills:
    | Missing Skills | JD Req | Has |
    • .NET | (language listed in JD) | 0m
    • AWS S3 | (service listed in JD) | 0m
    • Jenkins | (CI/CD tool listed in JD) | 0m
    • Terraform / CloudFormation | (IaC listed in JD) | 0m
    • Jest | (testing listed in JD) | 0m
    • Snowflake | (desired data platform) | 0m
    • Asset Management / Investment Banking / Wealth Management domain knowledge (OMS/PMS, fund lifecycle, ETF platforms, risk engines) | (desired domain experience) | 0m
    • ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m
    • Proven leadership in matrix environments (explicit) | (leadership style listed in JD) | 0m
    • Professional certifications (AWS, Snowflake, finance/industry-related certs) | (not listed on resume) | Missing

    Partial Match:
     Partial Match Skills | JD Req | Has |
     • Software Engineering Experience (15+ years) | 180m | 117m |
     • Leadership Experience (6+ years) | 72m | 68m |
    • PySpark | 60m | 55m

    Give result of match percentage of resume to JD as
    (match skills +Partial skills) %
    Missing skills %
    so that (match skills +Partial skills %) + (Missing skills %) from resume is 100% to JD.

    After processing all above scenarios give me desired output as below under the "gapAnalysis" field in the JSON response.

    OUTPUT FORMAT: JSON ONLY

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
        "gapAnalysis": "DESIRED OUTPUT:\n\nMissing Skills:\n| Missing Skills | JD Req | Has |\n| :--- | :--- | :--- |\n• [Skill Name] | [Req] | 0m\n...\n\nPartial Match Skills:\n| Partial Match Skills | JD Req | Has |\n| :--- | :--- | :--- |\n• [Skill Name] | [Req] | [Has]\n...\n\nResume Percentage to JD:\n(match skills +Partial skills) %\nMissing skills %"
    }

    if no Partial Match skills ignore Partial Match  in output.
    DESIRED OUTPUT:
    Missing Skills:
    | Missing Skills | JD Req | Has |
    • .NET | (language listed in JD) | 0m
    • AWS S3 | (service listed in JD) | 0m
    • Jenkins | (CI/CD tool listed in JD) | 0m
    • Terraform / CloudFormation | (IaC listed in JD) | 0m
    • Jest | (testing listed in JD) | 0m
    • Snowflake | (desired data platform) | 0m
    • Asset Management / Investment Banking / Wealth Management domain knowledge (OMS/PMS, fund lifecycle, ETF platforms, risk engines) | (desired domain experience) | 0m
    • ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m
    • Proven leadership in matrix environments (explicit) | (leadership style listed in JD) | 0m
    • Professional certifications (AWS, Snowflake, finance/industry-related certs) | (not listed on resume) | Missing

    Resume Percentage to JD: 
    (match skills +Partial skills) %
    Missing skills %
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
