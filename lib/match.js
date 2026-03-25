import { getAICompletion } from './ai.js';

/**
 * High-Precision AI Matching Engine
 * Uses "Step-by-Step" Reasoning and "Inch-by-Inch" analysis to compare a resume against a JD.
 */
export async function analyzeCandidate(name, resumeText, jd, userEmail, keyOffset = 0) {
    const prompt = `
JD AND RESUME MATCH

Consider given JD: ${jd.substring(0, 5000)}
and given resume.
${resumeText.substring(0, 30000)}

Rule Set for Analyzing Job Description and Resume Match:
1. Deep Reasoning: Analyze both documents thoroughly. Break down every requirement.
2. Inch by Inch: Scrutinize every JD & resume line. Do not skip details (soft skills, tools, tech, certifications, years).
3. Strict Factuality: Base conclusions solely on explicit document text. Do not infer.
4. Step by Step Process:
   - Step 1: Extract all mandatory qualifications from JD (skills, exp years, certs).
   - Step 2: Extract all candidate info from resume (skills, exp durations).
   - Step 3: Compare each JD requirement with resume.
   - Step 4: Apply Categorization:
     * Full: Experience >= required; OR binary skill present.
     * Partial: Skill present but experience < required (and > 0).
     * Missing: No mention/equivalent, OR experience = 0.
   - Step 5: Strict 0 Month Categorization: Any skill with 0 months is MISSING, not partial.
   - Step 6: Count and Categorize uniquely. Sum of Full + Partial + Missing must equal total JD requirements.

OUTPUT FORMAT: JSON ONLY
{
    "internalReasoning": "Your step-by-step reasoning summary",
    "matchStatus": "High Match" | "Partial Match" | "Low Match",
    "matchPercentage": 0-100,
    "missingPercentage": 0-100,
    "gapAnalysis": "(A markdown-formatted string with Missing Skills table, Partial Match table, and Percentages summary, exactly as expected by the UI)",
    "missingSkills": [
        { "skill": "Name", "req": "JD requirement context", "has": "0m" }
    ],
    "partialMatchSkills": [
        { "skill": "Name", "req": "Required months/years", "has": "Candidate months/years" }
    ],
    "matchedSkills": ["List of fully matched skill names as strings"],
    "missingCertifications": ["List of missing certification names"]
}
`;

    try {
        const completion = await getAICompletion({
            messages: [
                { role: "system", content: "You are an Expert Technical Recruiter. Output STRICT JSON ONLY." },
                { role: "user", content: prompt }
            ],
            model: "deepseek-chat",
            provider: "deepseek",
            temperature: 0.0,
            response_format: { type: "json_object" },
            userEmail: userEmail,
            keyOffset: keyOffset
        });

        const rawContent = completion.choices[0].message.content;
        const result = JSON.parse(rawContent);

        // Normalize Scores for maximum consistency (Full = 1.0, Partial = 0.5)
        const fullCount = (result.matchedSkills || []).length;
        const partialCount = (result.partialMatchSkills || []).length;
        const missingCount = (result.missingSkills || []).length;
        const total = fullCount + partialCount + missingCount;

        if (total > 0) {
            const earned = fullCount + (partialCount * 0.5);
            result.matchPercentage = Math.round((earned / total) * 100);
            result.missingPercentage = 100 - result.matchPercentage;
        } else {
            result.matchPercentage = 0;
            result.missingPercentage = 0;
        }

        // Programmatically Construct gapAnalysis for UI Consistency
        let gapStr = "Missing Skills:\n| Missing Skills | JD Req | Has |\n| :--- | :--- | :--- |\n";
        (result.missingSkills || []).forEach(s => {
            gapStr += `| • ${s.skill} | ${s.req || s.jdRequirement || 'Required'} | 0m |\n`;
        });
        
        if (result.partialMatchSkills && result.partialMatchSkills.length > 0) {
            gapStr += "\nPartial Match Skills:\n| Partial Match Skills | JD Req | Has |\n| :--- | :--- | :--- |\n";
            result.partialMatchSkills.forEach(s => {
                gapStr += `| • ${s.skill} | ${s.req || s.jdRequirement || 'Required'} | ${s.has || s.candidateHas || 'Partial'} |\n`;
            });
        }
        
        gapStr += `\nResume Percentage to JD:\n${result.matchPercentage}%\nMissing skills = ${result.missingPercentage}%`;
        result.gapAnalysis = gapStr;

        return result;

    } catch (e) {
        console.error(`AI Analysis Error for ${name}:`, e);
        return {
            matchPercentage: 0,
            missingPercentage: 100,
            missingSkills: [{ skill: "AI Error", req: "Analysis failed", has: "Error" }],
            matchStatus: "Error",
            gapAnalysis: "Failed to analyze candidate due to AI service error."
        };
    }
}
