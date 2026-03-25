import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { analyzeCandidate } = await import('./lib/match.js');

async function testMatch() {
    console.log("-----------------------------------------");
    console.log("TESTING UNIFIED MATCHING ENGINE (SHARED)");
    console.log("-----------------------------------------");

    const jd = `We are seeking a Full Stack Development Lead to drive cloud-native investment technology platforms. 
    Must-Have Skills: 15+ years in software engineering, 6+ years in a lead role.
    Full Stack: React/Angular, Node.js/Java/.NET/Python, SQL.
    AWS: Glue, Lambda, API Gateway, IAM, S3, CloudWatch.
    Testing: Jest, Cypress, Selenium.`;

    const resumeText = `HARI CHANDRA PRASAD RAO POLSANI
    SUMMARY: 16+ years of IT experience in designing and developing web applications using Java/J2EE. 
    AWS Cloud Certified. Experience in Spring Boot, REST APIs, Microservices, React JS, Oracle, PL/SQL. 
    CI/CD pipelines with Jenkins. Experience driving agile teams.`;

    try {
        const result = await analyzeCandidate("Hari", resumeText, { substring: (s) => jd }, "test@example.com");
        
        console.log("\n--- ANALYSIS RESULT ---");
        console.log("Match Status:", result.matchStatus);
        console.log("Match Percentage:", result.matchPercentage, "%");
        console.log("Missing Percentage:", result.missingPercentage, "%");
        
        console.log("\n--- GAPS IDENTIFIED ---");
        console.log(result.gapAnalysis);
        
        console.log("\n--- FULL JSON ---");
        console.log(JSON.stringify(result, null, 2));

    } catch (e) {
        console.error("Test Failed:", e);
    }
}

testMatch();
