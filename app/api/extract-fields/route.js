import { getAICompletion } from '@/lib/ai';
import { NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt";

export async function POST(req) {
    const startTime = Date.now();
    try {
        const body = await req.json();
        const { jobDescription } = body;

        // Extract verified user from session
        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        const userEmail = token?.email || body.processedBy || 'anonymous';

        if (!jobDescription) {
            return NextResponse.json({ error: "Job description is required" }, { status: 400 });
        }

        console.log(`[Field Extraction] Starting extraction for JD (${jobDescription.length} chars)`);

        const prompt = `
        Role: Expert Technical Recruiting Coordinator.
        Task: Extract specific structured data from the provided Job Description (JD).

        Job Description:
        ${jobDescription.substring(0, 5000)}

        EXTRACT THE FOLLOWING FIELDS:
        1. jobTitle: The official title of the position.
        2. altTitles: An array of 3 alternative, highly-searchable job titles for this role (e.g. ["Python Developer", "Backend Engineer", "Django Dev"]).
        3. location: City and State (e.g., Austin, TX). If multiple, list them.
        4. rate: Pay rate or salary range (e.g., $60/hr, $120k/yr). If not specified, return "---".
        5. expRange: Required years of experience (e.g., 5-8 years).
        6. client: The end client company name (e.g., Google, TCS). If not specified, return "---".
        7. workMode: Onsite, Remote, or Hybrid.
        8. visa: Required work authorization (e.g., H1B, GC, USC, Any).
        9. skills: An array of the top 5 to 10 mandatory technical skills, tools, or certifications required for this role.

        OUTPUT FORMAT: JSON ONLY.
        {
          "jobTitle": "...",
          "altTitles": ["...", "...", "..."],
          "location": "...",
          "rate": "...",
          "expRange": "...",
          "client": "...",
          "workMode": "...",
          "visa": "...",
          "skills": ["...", "...", "..."]
        }

        STRICT: Return ONLY the JSON object. No other text or explanation.
        `;

        console.time("Field-Extraction-AI-Call");
        const completion = await getAICompletion({
            messages: [{ role: "system", content: prompt }],
            model: "deepseek-chat",
            provider: "deepseek",
            temperature: 0.0,
            response_format: { type: "json_object" },
            timeout: 60000,
            userEmail: userEmail
        });
        console.timeEnd("Field-Extraction-AI-Call");

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[Field Extraction] Completed in ${duration}s`);

        const rawContent = completion.choices[0].message.content;
        console.log(`\n--- RAW AI EXTRACTED FIELDS ---\n`, rawContent, "\n-------------------\n");

        const extractedData = JSON.parse(rawContent);
        return NextResponse.json({ data: extractedData });

    } catch (error) {
        console.error("Extraction API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
