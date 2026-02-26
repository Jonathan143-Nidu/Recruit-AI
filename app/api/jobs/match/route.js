
import { sheets, SHEET_ID, GMAIL_SYNC_SHEET_ID } from '@/lib/google';
import { getAICompletion } from '@/lib/ai';
import { NextResponse } from 'next/server';
import { getToken } from "next-auth/jwt";

export async function POST(req) {
    try {
        const body = await req.json();
        const { jobTitle, mustHave, exp, location, workMode, visa } = body;

        const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
        const userEmail = token?.email || 'anonymous';

        console.log(`[AI Matcher] Finding candidates for: ${jobTitle} | ${mustHave}`);

        // 1. Fetch data from BOTH sheets
        const [masterRes, syncRes] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: 'Sheet1!A:Z',
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId: GMAIL_SYNC_SHEET_ID,
                range: 'Sheet1!A:Z',
            })
        ]);

        const masterRows = masterRes.data.values || [];
        const syncRows = syncRes.data.values || [];

        // 2. Normalize and Combine
        const formatCandidates = (rows, source) => {
            if (rows.length < 2) return [];
            const headers = rows[0];
            const data = rows.slice(1);

            const idx = (name) => {
                const ln = name.toLowerCase();
                return headers.findIndex(h => h.toLowerCase().includes(ln));
            };

            const nameIdx = idx("Name");
            const roleIdx = idx("Role");
            const expIdx = idx("Exp");
            const visaIdx = idx("Visa");
            const locIdx = idx("Location");
            const skillsIdx = idx("Skills");
            const resumeSaysIdx = idx("Resume Says");

            return data.map((row, i) => ({
                id: `${source}-${i}`,
                name: row[nameIdx] || 'Unknown',
                role: row[roleIdx] || 'N/A',
                exp: row[expIdx] || 'N/A',
                visa: row[visaIdx] || 'N/A',
                location: row[locIdx] || 'N/A',
                skills: row[skillsIdx] || '',
                resumeSays: row[resumeSaysIdx] || '',
                source: source === 'master' ? 'Master DB' : 'Sync Results'
            }));
        };

        const allCandidates = [
            ...formatCandidates(masterRows, 'master'),
            ...formatCandidates(syncRows, 'sync')
        ];

        if (allCandidates.length === 0) {
            return NextResponse.json({ matches: [] });
        }

        // 3. Fast Semantic Ranking using AI
        // Pre-filter: Boost scores for candidates matching the Job Title or Alt Titles
        const altTitlesArr = body.altTitles || [];
        const searchTerms = [jobTitle, ...altTitlesArr, ...mustHave.split(',').map(s => s.trim())].filter(Boolean);

        const preFiltered = allCandidates.map(c => {
            let score = 0;
            const cRole = c.role.toLowerCase();
            const cSkills = (c.skills || '').toLowerCase();
            const cResume = c.resumeSays.toLowerCase();
            const combinedText = cSkills + " " + cResume;

            // Major boost if current role matches Job Title or Alt Titles exactly/closely
            if (cRole.includes(jobTitle.toLowerCase())) score += 50;
            altTitlesArr.forEach(alt => {
                if (cRole.includes(alt.toLowerCase())) score += 40;
            });

            const terms = mustHave.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            terms.forEach(term => {
                if (combinedText.includes(term)) score += 5;
            });

            return { ...c, preScore: score };
        }).sort((a, b) => b.preScore - a.preScore).slice(0, 40);

        const prompt = `
        Role: Expert Technical Source & Calculator.
        Task: Perform a STRICT MATHEMATICAL skill check on the candidates against the Job Requirement.
        
        JOB REQUIREMENT:
        - Target Role: ${jobTitle}
        - Acceptable Alt Roles: ${altTitlesArr.join(', ')}
        - MANDATORY SKILLS (Target Maximum 10): ${mustHave}
        - Experience: ${exp}
        
        CANDIDATES TO RANK:
        ${preFiltered.map((c, i) => `${i + 1}. [${c.id}] Name: ${c.name}, Role: ${c.role}, Exp: ${c.exp}, Visa: ${c.visa}, Skills: ${c.skills}, Resume Summary: ${c.resumeSays.substring(0, 1000)}`).join('\n')}

        INSTRUCTIONS:
        1. Select the Top 10-15 best matching candidates.
        2. Identify EXACTLY WHICH mandatory skills they have from the JD's 'MUST HAVE' list.
        3. Identify EXACTLY WHICH mandatory skills they are MISSING.
        4. Calculate matchPercentage STRICTLY as: (Number of Skills Found / Total Mandatory Skills) * 100.
           - Example: If JD asks for 10 skills, and they have 8 -> matchPercentage is 80.
           - (Bonus: You may add +10 points if their Role exactly matches the Target/Alt Roles, capped at 100).
        5. Provide a 1-line reason summarizing the match.

        OUTPUT FORMAT: JSON ONLY
        {
          "matches": [
            { 
              "id": "...", 
              "matchPercentage": 80, 
              "reason": "Strong Match, but missing Docker.", 
              "foundSkills": ["Python", "React", "AWS", "SQL", "Git", "REST", "Linux", "CI/CD"],
              "missingSkills": ["Docker", "Kubernetes"],
              "name": "..." 
            }
          ]
        }
        `;

        const completion = await getAICompletion({
            messages: [{ role: "system", content: prompt }],
            model: "gpt-4o-mini",
            temperature: 0.0,
            response_format: { type: "json_object" },
            userEmail: userEmail
        });

        const aiResult = JSON.parse(completion.choices[0].message.content);

        // Attach full candidate data back to the AI results
        const finalMatches = aiResult.matches.map(m => {
            const fullData = preFiltered.find(c => c.id === m.id);
            return { ...fullData, ...m };
        }).sort((a, b) => b.matchPercentage - a.matchPercentage);

        return NextResponse.json({ matches: finalMatches });

    } catch (error) {
        console.error("Match Discovery API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
