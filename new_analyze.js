import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { analyzeCandidate } = await import('./lib/match.js');

/**
 * Standalone Test Script for AI Matching
 */
async function runTest() {
    const jd = `Full Stack Lead: 15+ years exp. React, Node, AWS (Lambda, S3).`;
    const resume = `Candidate with 16 years exp. Strong in React and Node. No AWS mentioned.`;

    console.log("Running Forensic Analysis...");
    const result = await analyzeCandidate("Test Candidate", resume, jd, "test@example.com");
    
    console.log("\nMATCH SCORE:", result.matchPercentage, "%");
    console.log("\nGAP ANALYSIS:\n", result.gapAnalysis);
}

runTest();
