
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
    Confirmed Rule Set for JD and Resume match:
    API Key Usage: I will operate under the assumption that API access is available and configured as needed for specific tasks (like web search).
    Deep Think (Reasoning): For any complex reasoning, analysis, problem-solving, or multi-step planning, I will explicitly engage my internal reasoning process (the "deep think" step) before providing a final answer. I will structure this thought process clearly in my response.
    Web Search: When a query requires current, real-time, or highly specific factual information not contained in my training data, I will automatically invoke the web search function to gather the necessary data. I will then synthesize this information to provide an accurate, up-to-date answer.

    Example of How I Will Proceed:
    My process would be:
    1.	Acknowledge & Plan: I will first acknowledge the user's request to compare a JD and a Resume. I will recognize that this is a complex analysis task requiring detailed comparison, critical reasoning, and structured output. I will note that it likely does not require a web search, as the primary data (the text of both documents) will be provided by the user. My plan is to ingest both documents, break them down into their core components, and then perform a systematic comparison.
    2.	Execute Analysis (Internal Data Processing):
    o	Parse the Job Description: I will extract key elements from the JD, creating a structured profile. This includes:
        Must-Have Requirements: Hard skills, specific years of experience, mandatory certifications, educational qualifications.
        Nice-to-Have Requirements: Preferred skills, additional experience, soft skills, desired personality traits.
        Core Responsibilities: The main day-to-day tasks and long-term goals of the role.
        Company/Team Context: Any information about the company culture, team size, or project methodologies.
    o	Parse the Resume/CV: I will extract key elements from the resume, creating a candidate profile. This includes:
        Work Experience: Previous job titles, companies, durations, and key achievements.
        Skills: Both technical and soft skills explicitly listed or demonstrably used.
        Education: Degrees, institutions, and graduation years.
        Projects & Certifications: Any additional relevant qualifications.
    3.	Deep Think (Reasoning & Comparison): This is the core reasoning step. I will not just list items from both documents. Instead, I will engage in a detailed analysis:
    o	Direct Match Analysis: I will compare the "Must-Have Requirements" from the JD against the "Skills" and "Work Experience" from the resume. I will explicitly note which requirements are met and which are not.
    o	Semantic & Contextual Matching: I will look beyond keywords. For example, if the JD asks for "leading cross-functional teams," I will search the resume for evidence of leadership, project management, and collaboration across different departments.
    o	Gap Identification: I will clearly identify any critical gaps, such as missing mandatory skills or insufficient years of experience in a key area.
    o	Strength Identification: I will pinpoint the candidate's strongest assets that align with the JD's "Nice-to-Have" requirements or core responsibilities.
    o	Overall Fit Assessment: Based on the analysis, I will form an initial conclusion about the candidate's overall suitability (e.g., "Excellent Match," "Good Match," "Potential Match with Gaps," "Poor Match").
    4.	Deliver Final Answer: I will structure the response to be clear, actionable, and easy to follow. The final output will include:
    o	Executive Summary: A brief statement of the overall match result.
    o	Detailed Match Breakdown: A table or structured list comparing JD requirements to Resume qualifications, categorized by areas like Technical Skills, Experience, Education, and Soft Skills. I will highlight matches and gaps.
    o	Strengths: A summary of the candidate's key assets for this specific role.
    o	Areas for Improvement / Red Flags: A clear list of any missing requirements or potential concerns.
    o	Suggested Talking Points: (If appropriate) Questions a hiring manager might ask to probe the identified gaps or strengths further.

    STRICT STEP-BY-STEP CHECKLIST RULES:
    1. First, EXTRACT a rigid list of every single mandatory skill required by the JD.
    2. Second, SEARCH the resume text strictly for those exact skills (or direct industry synonyms).
    3. Do NOT guess or invent skills. If it is not explicitly written in the resume text, it does not exist.
    4. Do NOT include skills in your final output that were not explicitly asked for in the JD.
    5. CONSISTENCY CHECK: Before finalizing your output, verify that every single "Missing" skill was actually asked for in the JD.

    STRICT PARTIAL MATCH LIMITS:
    A skill is ONLY a "Partial Match" if the candidate has MORE than 0 months of experience BUT LESS than the JD requires.
    If a candidate has EQUAL TO or MORE YEARS than the JD explicitly requires, it is a FULL MATCH. Do NOT place it in the Partial Match list.

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

    Partial Match:
     Partial Match Skills | JD Req | Has |
     • Software Engineering Experience (15+ years) | 180m | 117m |
     • Leadership Experience (6+ years) | 72m | 68m |
    • PySpark | 60m | 55m

    Rule Set for Analyzing Skills and Certifications in Job Description (JD) and Resume
    ________________________________________
    Objective
    To systematically compare the skills and certifications listed in a job description (JD) with those in a candidate's resume, categorizing them as Match, Partial, or Missing, and presenting the results in a consistent format.
    ________________________________________
    General Guidelines
    •	Deep Reasoning Mode: Before responding, thoroughly analyze both documents. Break down each requirement and qualification. If needed, use web search to clarify ambiguous terms or verify industry standards.
    •	Inch-by-Inch Analysis: Scrutinize every line of the JD and resume. Do not skip any detail, including soft skills, tools, technologies, certifications, or years of experience.
    •	Consistency: Ensure the output format is always identical, regardless of the content. The example format must be strictly followed.
    ________________________________________
    Step-by-Step Process
    Step 1: Extract Skills and Certifications from the JD
    •	Read the job description carefully.
    •	Identify all explicitly mentioned skills, competencies, and certifications. Include:
    o	Technical skills (e.g., programming languages, software, tools)
    o	Soft skills (e.g., communication, leadership)
    o	Required certifications (e.g., PMP, AWS Certified)
    o	Educational requirements (if specified as a must)
    o	Years of experience in specific areas
    •	Create a numbered list of these items. Example:
    1.	Python programming
    2.	Project management (PMP preferred)
    3.	Data analysis with SQL
    4.	AWS Certified Solutions Architect
    5.	Team leadership
    etc.
    Step 2: Extract Skills and Certifications from the Resume
    •	Read the resume thoroughly.
    •	List all skills, experiences, and certifications mentioned. Look for:
    o	Skills sections
    o	Work experience bullet points (implicit skills)
    o	Education and certifications
    o	Projects and achievements
    •	Create a list of these items, noting any synonyms or related terms.
    Step 3: Compare Each JD Requirement with the Resume
    •	For every item in the JD list, determine if it is present in the resume.
    •	Match: The skill/certification is explicitly stated or clearly demonstrated with equivalent terminology. (e.g., JD says "Python", resume says "Python" or "Python programming").
    •	Partial: The skill is mentioned but not at the required level, or only partially covered. Examples:
    o	JD requires "5 years of Python", resume shows "2 years of Python".
    o	JD requires "AWS Certified Solutions Architect", resume shows "AWS Certified Cloud Practitioner" (lower level).
    o	JD requires "Data analysis with SQL", resume mentions "basic SQL queries" but not advanced.
    o	Soft skills: JD asks for "team leadership", resume mentions "led a small team" but not extensively.
    •	Missing: The skill/certification is not found in the resume at all, or no equivalent is present.
    Step 4: Count and Categorize
    •	Tally the number of items in each category:
    o	Total skills in JD: Total number of items from Step 1.
    o	Match skills: Number of items that are a full match.
    o	Partial skills: Number of items that are partial matches.
    o	Missing skills: Number of items not found.
    •	Ensure that the sum of Match + Partial + Missing equals Total.
    Step 5: Output in Desired Format
    •	Present the results exactly as shown below:
    Total skills in JD : [number]
    Match skills: [number]
    Partial Skills: [number]
    Missing Skills: [number]
    •	Optionally, you may include a brief explanation or a list of the items in each category for clarity, but the core format must be preserved.
    ________________________________________
    Additional Rules for Accuracy
    •	Synonyms and Variations: Recognize common synonyms or industry jargon. For example, "JavaScript" may be written as "JS", "Excel" as "Microsoft Excel", etc. Use reasoning to match.
    •	Certifications: Verify if the certification is the exact one or a related one. If the JD requires "CISSP" and the resume has "Security+", it's partial or missing depending on context.
    •	Experience Levels: If the JD specifies years of experience, compare with the resume's timeline. If not mentioned, assume it's a match if the skill is present.
    •	Soft Skills: These can be harder to match. Look for behavioral indicators or explicit mentions. If the JD asks for "strong communication" and the resume lists "presented at conferences", that's a match. If it's not mentioned, it's missing.
    •	Education: If the JD requires a specific degree, check the resume's education section. If the degree is not listed but the candidate has equivalent experience, consider it partial or missing based on strictness.
    •	Web Search: When in doubt about a term or certification, perform a quick web search to understand its meaning or level. This ensures accurate categorization.
    ________________________________________
    Example Application
    Given a JD with 10 skills and a resume, after analysis:
    •	Total skills in JD: 10
    •	Match skills: 4
    •	Partial Skills: 4
    •	Missing Skills: 2
    Output:
    Total skills in JD: 10
    Match skills: 4
    Partial Skills: 4
    Missing Skills: 2
    ________________________________________
    Important Notes
    •	Always double-check your counts.
    •	If the JD lists a skill multiple times, count it only once.
    •	If the resume mentions a skill that is not in the JD, ignore it (focus only on JD requirements).
    •	Maintain a neutral and objective tone; do not infer beyond what is written.
    then give the match, missing and partial skills and certifications in desired output format; and make sure the desired output  is always the same if we trigger this prompt.

    JD: 
    ${jd.substring(0, 5000)}

    Resume Text:
    ${resumeText.substring(0, 50000)}

    Consider years or months of any skill, only if mentioned in JD and give the result as partial match. If years or months of any skill is not mentioned in JD, give only missing skills result and avoid partial match skills result in desired output.

    Take output of match, Partial Match, Missing skills and certifications; keep in your memory.

    Strict 0-Month Categorization
    •	Any skill for which the candidate has 0 months of experience must be placed in the Missing Skills category.
    •	This overrides any job description requirement (e.g., requested duration is ignored for 0 month cases).
    •	No 0 month skill shall appear under “Partial Match” or any other category.

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

    if no Partial Match skills ignore Partial Match in output.
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
