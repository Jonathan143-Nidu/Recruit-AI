import { getAICompletion } from './ai.js';

/**
 * High-Precision AI Matching Engine
 * Uses "Step-by-Step" Reasoning and "Inch-by-Inch" analysis to compare a resume against a JD.
 */
export async function analyzeCandidate(name, resumeText, jd, userEmail, keyOffset = 0) {
    const prompt = `
You are an Expert Technical Recruiter evaluating a candidate's resume against a Job Description (JD). 
You must output STRICT JSON ONLY. Do not return markdown blocks outside the JSON.

### Rule Set for Analyzing Job Description and Resume Match
1. Deep Reasoning Mode: Thoroughly analyze both documents. Break down each requirement and qualification.
2. Inch-by-Inch Analysis: Scrutinize every line of the JD and resume. Do not skip soft skills, tools, or technologies.
3. Experience Check: You MUST explicitly locate 'Total Experience' or 'Years of Experience' required in the JD (even if just in the top header) and strictly evaluate it.
4. Strict Factuality: Base all conclusions solely on explicit statements.
5. [CRITICAL] Granular Extraction: Identify each technical requirement, tool, or certification as a unique, non-grouped entity. For example, 'Java', 'Javascript', and 'Typescript' must be treated as three unique checks, even if they are mentioned in the same single sentence in the JD. DO NOT consolidate technologies.
6. Total Experience Separation: Strictly separate 'Total Years of Experience' from technical skills. Do not include 'Total Experience' as a skill in the matched/partial/missing arrays. Instead, ensure the root-level 'Years of Experience' field is populated accurately based on the candidate's total tenure.
7. Categorization:
   - Full Match: Candidate has >= the required months of experience, or binary skill is present.
   - Partial Match: Candidate has > 0 months, but less than the JD explicitly requires.
   - Missing: Candidate has literally 0 months of experience or skill is entirely absent.
8. [NEW] Deterministic Scoring: Ensure that the 'partialMatchSkills' and 'missingSkills' arrays are comprehensive and include every gap identified between the JD and the Resume. No summarizing—every gap must be its own line item.

### Step-by-Step Process:
- Step 1: Extract all mandatory qualifications from JD (skills, exp years, certs).
- Step 2: Extract all candidate info from resume (skills, exp durations).
- Step 3: Compare each JD requirement with resume.
- Step 4: Strict 0 Month Categorization: Any skill with 0 months is MISSING, not partial.
- Step 5: Final Count Analysis. Sum of Full + Partial + Missing must equal total extracted JD requirements.

---

REAL JOB DESCRIPTION:
${jd.substring(0, 5000)}

---

REAL CANDIDATE RESUME:
${resumeText.substring(0, 30000)}

---

### Output JSON Format:
{
    "internalReasoning": "Brief summary of your step-by-step reasoning",
    "Years of Experience": "number of years (e.g. '5 Years')",
    "matchStatus": "High Match" | "Partial Match" | "Low Match",
    "matchPercentage": 0-100,
    "missingPercentage": 0-100,
    "matchedSkills": ["Skill Name (Evidence from Resume)"],
    "partialMatchSkills": [
        { "skill": "Skill Name", "jdRequirement": "STRICT SHORT DURATION (e.g. '10+ years')", "candidateHas": "STRICT SHORT DURATION (e.g. '9 years')" }
    ],
    "missingSkills": [
        { "skill": "Skill Name", "jdRequirement": "STRICT SHORT DURATION (e.g. '10+ years')" }
    ],
    "missingCertifications": ["Certification Name"]
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
