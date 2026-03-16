
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
    Consider given JD: 
    ${jd.substring(0, 5000)}
    and resume.
    ${resumeText.substring(0, 50000)}

 This is the perfect analyze and output, consider this when you compare JD and resume
 {
 Given JD: [ We are seeking a Full Stack Development Lead to drive cloud-native investment technology platforms. You will lead a team in designing scalable solutions, managing AWS infrastructure, and delivering high-impact features in a fast-paced financial environment. Must-Have Skills: 15+ years in software engineering, 6+ years in a lead role Full Stack: React/Angular, Node.js/Java/.NET/Python, SQL AWS: Glue, Lambda, API Gateway, IAM, S3, CloudWatch CI/CD: Jenkins, GitHub Actions, Terraform/CloudFormation Strong API development & integration Testing: Jest, Cypress, Selenium Proven leadership in matrix environments Desired Skills: Asset Management, Investment Banking, or Wealth Management experience Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle Snowflake, Python, event-driven architecture ESG data, performance attribution, or regulatory reporting exposure Key Responsibilities: Lead full-stack development across hybrid/cloud-native architectures Build scalable APIs and rich UI components (React/Angular) Manage AWS infrastructure & CI/CD pipelines Oversee production environments and approve deployment changes Partner with business teams to translate needs into technical solutions Interface with vendors (e.g., BlackRock Aladdin, Snowflake) Drive automation and team efficiency Typical Day: Leading development on investment platforms Designing cloud architecture for portfolio/trading systems Developing front-end and back-end services Managing AWS pipelines and supporting production Collaborating with stakeholders across investment tech, product, and operations]

 Given Resume: [                                                                                                                                             	                                                                                                  Anusha Potla
📧 Email: anushapotla27@gmail.com
 📱 Mobile: +1 224-446-5150
 🔗 LinkedIn: Anusha_Potla                                                                                                                
                                                                                                                                                                                                                                                                                                                                                        
SUMMARY
·       9+ years of experience building backend-heavy enterprise platforms and internal services.
·       Strong in Java and Python, developing scalable APIs and automation workflows.
·       Skilled in microservices, Docker/Kubernetes deployments, CI/CD, and asynchronous processing.
·       Experienced in integrating enterprise systems and implementing security fundamentals (OAuth2, JWT, LDAP/SAML).
·       Adept at automating operational tasks, collaborating with DevOps/Platform teams, and supporting services end-to-end.
  	
CORE COMPETENCIES/SKILLS
 
Category
Technologies
Programming skills
Java, Spring Boot, Hibernate, JPA, Spring Data, Postman, Node.js, Express.js, NestJS, RESTful APIs, Python, Shell Scripting
UI-Technologies
HTML5, CSS3, JavaScript, jQuery, Angular, ReactJS
Database
MongoDB, Postgres, Redis
Cloud Platforms
AWS
DevOps & CI/CD
Docker, Kubernetes, Git, GitHub Actions
 
Bug/Issue-Tracking System
Jira
Security & Authentication
 
SSL/TLS, JWT, and OAuth 2.0

 
PROFESSIONAL EXPERIENCE
                                	                                                   
Project: Austin Energy – User Resource System
Employer: S & V TEKsystems LLC   	                                            	                    	   Oct 2024 to Present
 Role: Senior Full Stack Java Developer
Description:
Built a backend IAM platform using Java Spring Boot to automate identity provisioning and access control, deployed as containerized microservices on Kubernetes with CI/CD.
Responsibilities:
·       Built backend microservices in Java & Spring Boot for enterprise Identity Provisioning and Access Governance.
·       Developed REST APIs to integrate with internal systems for user, role, and entitlement management.
·       Implemented authentication and authorization using Spring Security and JWT.
·       Automated user onboarding, access updates, and de-provisioning workflows, reducing manual operational effort.
·       Deployed containerized services using Docker and Kubernetes with CI/CD pipelines.
·       Stored identity data and audit logs using PostgreSQL and MongoDB.
·       Wrote unit and integration tests (JUnit) and supported production issues.
Project:  COX
Employer: TRC Companies                                                             	        	           	Oct 2020 to Sep 2024
 Role: Full Stack Java Developer
Description:
 Developed an end-to-end device activation system for modems, routers, and set-top boxes, automating inventory checks, plan compatibility, and provisioning through external APIs, ensuring seamless customer onboarding.
Responsibilities:
·       Developed a device provisioning and activation system for routers, modems, and set-top boxes using Spring Boot.
·       CSR enters MAC address and serial number to initiate device activation. System checks device inventory, whether the device is already assigned, and plan compatibility.
·       Used Java Lambdas and Streams for efficient data processing and filtering of devices.
·       Calls external provisioning APIs to activate the device for the customer.
·       Updates activation status in PostgreSQL and caches device info in Redis.
·       Built a frontend with Angular/React to display device status, activation history, and inventory.
·       Implemented logging, error handling, and monitoring to track activations and failures.
·       Wrote unit and integration tests to ensure reliable end-to-end functionality.
·       Containerized services using Docker and deployed on Kubernetes clusters in AWS for scalable, cloud-native deployment.
 
Client: TPCL – Web Development & Support
Employer: MagikMinds (a TRC Company Sep 2022)                       	                    	June 2016 to Sep 2020
 Role: Senior Full Stack Developer
Description:
Tata Power has a customer base of 6.0 lakh customers in Mumbai and on an average about 6,500 million units (MU) are sold in a year. Tata Power has taken number of initiatives to improve the quality and reliability of its power supply and enhance customer service.
Responsibilities:
·       Developed Node.js backend APIs using Express.js for different modules.
·       Managed MongoDB and Postgres for storing application data.
·       Implemented a Python scripts to migrate data from PostgreSQL to MongoDB for data consolidation and processing.
·       Added real-time features like live updates and notifications.
·       Integrated WhatsApp and SMS messaging for sending alerts.
·       Worked on building web applications using AngularJS
·       Configured Apache as a reverse proxy to manage incoming requests and route them to backend Node.js applications.
·       Implemented authentication, authorization, and encryption for secure access.
·       Set up cron jobs for system monitoring and automated tasks.
·       Deployed applications on Windows servers and handled configuration.
·       Guided junior team members on coding standards and best practices.
 
EDUCATION DETAILS:
Bachelors in Computer Science – VVIT University, INDIA, 2012-2016
                                                        	
 ]
We need to analyze the given job description (JD) and resume. The JD is for a Full Stack Development Lead with specific must-have and desired skills. The resume is for Anusha Potla, with 9+ years experience, Java, etc.
We need to extract all requirements from JD, then compare with resume, following the strict rules. Let's list all JD requirements step by step.
First, read JD carefully:
"Must-Have Skills:
 15+ years in software engineering, 6+ years in a lead role
 Full Stack: React/Angular, Node.js/Java/.NET/Python, SQL
 AWS: Glue, Lambda, API Gateway, IAM, S3, CloudWatch
 CI/CD: Jenkins, GitHub Actions, Terraform/CloudFormation
 Strong API development & integration
 Testing: Jest, Cypress, Selenium
 Proven leadership in matrix environments
Desired Skills:
 Asset Management, Investment Banking, or Wealth Management experience
 Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle
 Snowflake, Python, event-driven architecture
 ESG data, performance attribution, or regulatory reporting exposure
Key Responsibilities:
 Lead full-stack development across hybrid/cloud-native architectures
 Build scalable APIs and rich UI components (React/Angular)
 Manage AWS infrastructure & CI/CD pipelines
 Oversee production environments and approve deployment changes
 Partner with business teams to translate needs into technical solutions
 Interface with vendors (e.g., BlackRock Aladdin, Snowflake)
 Drive automation and team efficiency"
Also note typical day: similar.
We need to list all unique skills/requirements. Some are explicit, some are domain knowledge. Also years of experience: 15+ years software engineering, 6+ years lead role. Others may not have duration specified, so presence is enough.
Let's enumerate:
Must-have:
1. 	Software engineering experience: 15+ years (180 months)
2. 	Lead role experience: 6+ years (72 months)
3. 	Full Stack: React or Angular (frontend) - need either? The JD says "React/Angular" meaning one or both? Usually they want experience with one of them. So we need to check if candidate has React or Angular.
4. 	Full Stack: Node.js/Java/.NET/Python - backend languages; they list multiple, candidate should have at least one? But JD says "Node.js/Java/.NET/Python" meaning they want experience with one or more. So we need to check if candidate has any of these. Candidate has Java, Python, Node.js (from resume: Java, Python, Node.js, Express.js, NestJS). So that's a match.
5. 	SQL - database? They list SQL under full stack. Candidate has PostgreSQL, which is SQL, so yes.
6. 	AWS: Glue, Lambda, API Gateway, IAM, S3, CloudWatch. These are specific AWS services. Candidate's resume mentions AWS in skills section, but no specific services listed? Under Cloud Platforms: AWS. In experience: "Containerized services using Docker and deployed on Kubernetes clusters in AWS" - so they used AWS for deployment, but no explicit mention of Glue, Lambda, etc. We need to check each service. Since no specific services listed, we have to assume missing unless implied. Possibly they used some, but not stated. Strictly, we cannot assume. So each AWS service is a separate requirement? The JD lists them as part of must-have, so we need to check each. Candidate has AWS general, but not specific services. So we'll mark each as missing unless we can infer from experience. For example, they mention "deployed on Kubernetes in AWS" which might involve EC2 or EKS, but not the listed ones. No mention of Lambda, API Gateway, etc. So missing.
7. 	CI/CD: Jenkins, GitHub Actions, Terraform/CloudFormation. Candidate's resume: under DevOps & CI/CD: Docker, Kubernetes, Git, GitHub Actions. So they have GitHub Actions. But Jenkins? No. Terraform/CloudFormation? No. So we have partial? Actually GitHub Actions is a match for that part. But we need to list each as separate? The JD lists them as a group but we should treat each as a skill. So:
o   Jenkins: missing
o   GitHub Actions: present (from skills)
o   Terraform/CloudFormation: missing
8. 	Strong API development & integration: Candidate has extensive API development (REST APIs, Spring Boot, etc.) so that's a match.
9. 	Testing: Jest, Cypress, Selenium. Candidate mentions "unit and integration tests (JUnit)" and "wrote unit and integration tests" but no specific mention of Jest, Cypress, Selenium. So these are missing? JUnit is Java testing, but not the listed ones. So we mark each as missing.
10.   Proven leadership in matrix environments: This is a soft skill. Resume mentions "Guided junior team members" and "Senior Full Stack Java Developer" roles, but does it explicitly say "leadership in matrix environments"? Not explicitly. Possibly partial? But we need to see if they have leadership experience. They have 9+ years, and in roles they might have led, but no explicit mention of leading a team or matrix environment. The JD requires 6+ years in a lead role, which we'll treat as a separate experience requirement. But here "proven leadership in matrix environments" is a separate quality. We'll check if resume shows any leadership. They have "Guided junior team members" which is some leadership, but not necessarily matrix. Also they have "Senior" roles. But we need to be strict: if not explicitly stated, it's missing. However, we might consider it as partial if there is some evidence. But the rule says: "Soft skills: look for behavioral indicators or explicit mentions. For example, 'led a team of 5' can match 'leadership'. If not mentioned, it is missing." Here they mention "Guided junior team members" which is a form of leadership. But "matrix environments" is specific. I think we can consider it as partial? But we need to decide. Let's see if there is any mention of leading projects or teams. In the COX project, they didn't mention leading. In TPCL, they mention "Guided junior team members". That's a leadership indicator. So we might say partial match for leadership, but the JD requires "proven leadership in matrix environments" which is a bit more. However, we have a separate requirement for "6+ years in a lead role" which we'll treat as experience. So this one might be a separate soft skill. I think it's better to treat it as missing because it's not explicitly proven in matrix environment. But we can also consider that the candidate has 9+ years and has guided juniors, so maybe partial. However, the rule says: if not mentioned, it's missing. Since "matrix environments" is not mentioned, it's missing. But let's see if any of the job descriptions mention working with multiple teams? Not really. So I'll mark it as missing.
Now Desired Skills:
 11. Asset Management, Investment Banking, or Wealth Management experience: Candidate's experience is in Austin Energy (utility), COX (telecom?), TPCL (Tata Power - utility). No finance. So missing.
 12. Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle: missing.
 13. Snowflake: missing (not in resume)
 14. Python: candidate has Python (from skills and experience: "Python scripts" for data migration). So Python is present, but it's desired, not must-have. But we still count it as a skill in JD. So we have Python as a match.
 15. event-driven architecture: candidate has experience? They mention "asynchronous processing" in summary, and "real-time features" but not explicitly event-driven architecture. Could be partial? But we need to see if they have used message queues or events? Not mentioned. So missing.
 16. ESG data, performance attribution, or regulatory reporting exposure: missing.
Also from Key Responsibilities, we might extract additional skills? But they are mostly covered by must-have. However, we need to ensure we capture all technical requirements. For example, "Manage AWS infrastructure & CI/CD pipelines" is already covered by AWS and CI/CD. "Build scalable APIs" is covered. "Rich UI components (React/Angular)" is covered by frontend. "Interface with vendors (e.g., BlackRock Aladdin, Snowflake)" implies knowledge of those, but they are desired.
Also we have "Full Stack" which includes frontend and backend. We already have backend languages. For frontend, candidate has Angular and React? In skills: UI-Technologies: HTML5, CSS3, JavaScript, jQuery, Angular, ReactJS. So they have both Angular and React. So that's a full match for frontend.
Now we need to compute years of experience. The candidate's total experience: From resume, they started in June 2016 to present (Oct 2024? Actually current project is Oct 2024 to Present, so as of now (assuming current date is 2026? But we need to calculate months. The resume says "Oct 2024 to Present" and we are in March 2026? Actually the current date is not given, but we need to compute total months up to now. Typically we use current date as the date of analysis. Let's assume today is March 2026. Then from June 2016 to March 2026 is about 9 years and 9 months? Let's calculate precisely: June 2016 to June 2026 would be 10 years, but we are at March 2026, so it's 9 years and 9 months? Actually from June 2016 to March 2026 is 9 years and 9 months? Let's do: June 2016 to June 2025 is 9 years, then to March 2026 is 9 months, so total 9 years 9 months = 117 months. That matches the example in the output: they had 117m for software engineering. So they used 117 months. So candidate has 117 months of software engineering experience. JD requires 180 months (15 years). So that's a partial match (117 < 180).
Lead role experience: They have been in senior roles? The resume lists "Senior Full Stack Java Developer" from Oct 2020 to Sep 2024 (4 years) and then "Senior Full Stack Java Developer" from Oct 2024 to present (1.5 years) and earlier "Senior Full Stack Developer" from June 2016 to Sep 2020? Actually the third role is "Senior Full Stack Developer" from June 2016 to Sep 2020? Wait, the dates: For TPCL, it says "June 2016 to Sep 2020" and role is "Senior Full Stack Developer". So they have been in senior roles since 2016? That would be about 9+ years of senior? But "senior" doesn't necessarily mean lead role. The JD requires "6+ years in a lead role" meaning leading teams. The resume mentions "Guided junior team members" but not explicitly leading a team. We need to estimate lead experience. Possibly they have some lead responsibilities but not explicitly stated. The example in the output gave 68 months for leadership experience, which is less than 72. So they considered that candidate had some leadership but not enough. In our case, we need to decide if the candidate has any lead experience. The resume says "Guided junior team members" which indicates some mentoring, but not necessarily leading a team. Also they have "Senior" titles, but that's not a lead role. In many companies, senior is individual contributor. So we might say they have 0 months of explicit lead role? But the example considered partial match for leadership with 68 months. So they must have inferred from some bullet points. In our resume, we have "Guided junior team members" which could be considered leadership, but we need to quantify. The candidate has been in senior roles since 2016, so maybe they have been leading or mentoring for some time. But we don't know how many months of actual lead responsibility. Since it's not quantified, we have to be careful. The rule says: if a duration is required and not specified, we cannot assume. So we might treat it as missing? But the example had a partial match for leadership with a specific number. So they must have inferred from the resume that the candidate had some leadership experience. In our resume, we have "Guided junior team members" in one role. That role lasted from June 2016 to Sep 2020 (about 4 years 3 months). So possibly they had mentoring during that time. But is that equivalent to "lead role"? Probably not full-time leading. However, we need to follow the example: they gave 68 months for leadership, which is about 5.7 years, less than 6. So they considered that the candidate had some leadership experience. In our case, we might estimate that the candidate has been in a lead role for maybe a portion? But we don't have explicit statements like "Led a team of X". The only mention is "Guided junior team members". That could be considered a form of leadership, but not necessarily a lead role. To be safe, we might put 0 months for lead role because it's not explicitly stated that they were a team lead. However, the example output had "Leadership Experience (6+ years)" as a partial match with 68m. So they interpreted that the candidate had some leadership. Let's look at the resume in the example? Actually the example is just a template. In our actual resume, we need to decide.
Let's re-read the resume: In the TPCL role, they say "Guided junior team members on coding standards and best practices." That is a leadership activity. In the COX role, no mention of leading. In the current role, no mention. So total duration of that role is from June 2016 to Sep 2020, which is about 4 years 3 months (51 months). So if we count that as leadership experience, then they have 51 months. But the JD requires 72 months. So partial match with 51m. However, is that "lead role"? The JD says "6+ years in a lead role" which implies a formal leadership position. Guiding juniors is often part of a senior role, not necessarily a lead role. But we'll go with the example's approach: they considered leadership experience as a separate skill. So we'll list it as partial with 51 months? But we need to be consistent: we also have the "proven leadership in matrix environments" as a separate missing skill. Actually the JD has two leadership-related requirements: one is "6+ years in a lead role" (experience) and another is "Proven leadership in matrix environments" (soft skill). So we need to treat them separately. For the experience requirement, we need to see if the candidate has 6+ years of lead role. They have 51 months from guiding, but that might not be enough. So we'll put partial with 51m. But let's verify if there is any other leadership indicator. In the summary, they say "9+ years of experience building backend-heavy enterprise platforms" but no mention of leading. So 51 months is the best we have.
Now we need to list all JD requirements. Let's make a comprehensive list:
Must-have:
1. 	Software Engineering Experience (15+ years) - 180m
2. 	Lead Role Experience (6+ years) - 72m
3. 	React or Angular (frontend) - we have both, so match
4. 	Node.js/Java/.NET/Python (backend) - we have Java, Python, Node.js, so match
5. 	SQL - we have PostgreSQL, so match
6. 	AWS Glue - missing
7. 	AWS Lambda - missing
8. 	AWS API Gateway - missing
9. 	AWS IAM - missing
10.   AWS S3 - missing
11.   AWS CloudWatch - missing
12.   Jenkins - missing
13.   GitHub Actions - present (from skills)
14.   Terraform/CloudFormation - missing
15.   Strong API development & integration - present (extensive)
16.   Jest - missing
17.   Cypress - missing
18.   Selenium - missing
19.   Proven leadership in matrix environments - missing (no explicit mention of matrix)
Desired:
 20. Asset Management/Investment Banking/Wealth Management experience - missing
 21. Knowledge of OMS/PMS, risk engines, ETF platforms, fund lifecycle - missing
 22. Snowflake - missing
 23. Python - present (desired, but we have it)
 24. event-driven architecture - missing? Not explicitly mentioned, but they have "asynchronous processing" in summary. That could be related. However, event-driven architecture is a specific pattern. They might have used it? Not stated. So missing.
 25. ESG data/performance attribution/regulatory reporting exposure - missing
Also from key responsibilities, we might have "Manage AWS infrastructure" which is covered by AWS services. "Build scalable APIs" already. "Rich UI components" covered by frontend. "Interface with vendors" like BlackRock Aladdin, Snowflake - that's domain knowledge, already missing.
Now we need to count total skills. Let's list them uniquely. I'll number them:
1. 	Software Engineering Experience (15+ years) - 180m
2. 	Lead Role Experience (6+ years) - 72m
3. 	React/Angular (frontend) - binary
4. 	Node.js/Java/.NET/Python (backend) - binary (we have multiple)
5. 	SQL - binary
6. 	AWS Glue
7. 	AWS Lambda
8. 	AWS API Gateway
9. 	AWS IAM
10.   AWS S3
11.   AWS CloudWatch
12.   Jenkins
13.   GitHub Actions
14.   Terraform/CloudFormation
15.   Strong API development & integration
16.   Jest
17.   Cypress
18.   Selenium
19.   Proven leadership in matrix environments
20.   Asset Management/Investment Banking/Wealth Management experience
21.   OMS/PMS, risk engines, ETF platforms, fund lifecycle knowledge
22.   Snowflake
23.   Python
24.   event-driven architecture
25.   ESG data/performance attribution/regulatory reporting exposure
That's 25 items. But note that some are binary (presence) and some have duration. For binary, if present, it's full match. For duration, we compare months.
Now let's evaluate each from resume:
1. 	Software Engineering: 117 months (from June 2016 to March 2026) - partial (since 117 < 180)
2. 	Lead Role: We have 51 months from guiding juniors? But is that considered lead role? Possibly. Let's see if any other role indicates lead. In the current role (Oct 2024 to present) they are "Senior Full Stack Java Developer" - no mention of leading. So total lead experience might be 51 months. But we need to be consistent with the example: they gave 68m for leadership. So we'll use 51m. However, we need to check if the candidate has any other leadership like in COX? No. So partial.
3. 	React/Angular: Both present, full match.
4. 	Backend languages: Java, Python, Node.js present, full match.
5. 	SQL: PostgreSQL, full match.
6. 	AWS Glue: missing (0m)
7. 	AWS Lambda: missing
8. 	AWS API Gateway: missing
9. 	AWS IAM: missing
10.   AWS S3: missing
11.   AWS CloudWatch: missing
12.   Jenkins: missing
13.   GitHub Actions: present (from skills), full match
14.   Terraform/CloudFormation: missing
15.   Strong API development: present, full match
16.   Jest: missing
17.   Cypress: missing
18.   Selenium: missing
19.   Proven leadership in matrix environments: missing (no mention)
20.   Asset Management etc: missing
21.   OMS/PMS etc: missing
22.   Snowflake: missing
23.   Python: present (already counted in backend? But it's a separate desired skill. We need to include it as a separate requirement. So yes, Python is present, full match.
24.   event-driven architecture: missing? Not explicitly, so 0m
25.   ESG etc: missing
Now we have full matches for: 3,4,5,13,15,23. That's 6 full matches. Also we have partial for 1 and 2. So total skills = 25.
Now we need to list missing skills. That includes all that are not full or partial. For partial, we list them separately. So missing are: 6,7,8,9,10,11,12,14,16,17,18,19,20,21,22,24,25. Let's count: from 6 to 11 is 6 items, 12 is one, 14 one, 16-18 three, 19 one, 20 one, 21 one, 22 one, 24 one, 25 one. That's 6+1+1+3+1+1+1+1+1+1 = 17? Let's list: 6,7,8,9,10,11 (6), 12 (7), 14 (8), 16 (9), 17 (10), 18 (11), 19 (12), 20 (13), 21 (14), 22 (15), 24 (16), 25 (17). Yes 17 missing.
Plus 2 partials, plus 6 full = 25.
Now we need to output in the desired format. The example had a table for missing skills with bullet points. They also had a table for partial match skills. And then percentages.
But note: The example included "Professional certifications (AWS, Snowflake, finance/industry-related certs)" as a missing item. In our JD, is there a requirement for certifications? The JD does not explicitly list certifications as a must-have or desired. It says "Professional certifications" in the example output, but that might be from a different JD. In our JD, there is no mention of certifications. So we should not include that. The only certifications might be implied? No. So we omit that.
Also the example had "PySpark" as a partial, but we don't have that. So our partial list will only have the two experience items.
Now we need to compute the percentages. Total skills = 25. Full match = 6, partial = 2, so match+partial = 8. Percentage = (8/25)*100 = 32%. Missing = 17/25 = 68%. But we need to verify if any of the full matches are actually partial because of duration? No, they are binary.
But wait: For "Python", it's a desired skill, and we have it, so full. For "GitHub Actions", we have it. For "API development", we have. So that's fine.
Now we need to output in the exact format. The example had a table for missing skills with columns: Missing Skills, JD Req, Has. And they used bullet points with •. They also had a table for partial match with columns: Partial Match Skills, JD Req, Has. And then percentages.
We need to list each missing skill with a brief description of JD Req. For example, for AWS Glue: "(service listed in JD)". For Jenkins: "(CI/CD tool listed in JD)". For Jest: "(testing tool listed in JD)". For domain knowledge: "(desired domain experience)" etc.
Also for the partial skills, we need to specify the required months and has months.
Let's write them.
First, missing skills:
·       AWS Glue | (service listed in JD) | 0m
·       AWS Lambda | (service listed in JD) | 0m
·       AWS API Gateway | (service listed in JD) | 0m
·       AWS IAM | (service listed in JD) | 0m
·       AWS S3 | (service listed in JD) | 0m
·       AWS CloudWatch | (service listed in JD) | 0m
·       Jenkins | (CI/CD tool listed in JD) | 0m
·       Terraform/CloudFormation | (IaC listed in JD) | 0m
·       Jest | (testing tool listed in JD) | 0m
·       Cypress | (testing tool listed in JD) | 0m
·       Selenium | (testing tool listed in JD) | 0m
·       Proven leadership in matrix environments | (leadership style listed in JD) | 0m
·       Asset Management / Investment Banking / Wealth Management domain knowledge | (desired domain experience) | 0m
·       Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle | (desired domain knowledge) | 0m
·       Snowflake | (desired data platform) | 0m
·       Event-driven architecture | (desired architectural pattern) | 0m
·       ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m
That's 17 items. Note we didn't include .NET because it's not a separate requirement; we have backend languages as a group, but we already counted Java/Python/Node as full. So .NET is not a separate skill; the JD asked for Node.js/Java/.NET/Python, meaning any of those. Since we have Java and Python, that requirement is satisfied. So we don't list .NET as missing.
Similarly, we didn't list PySpark because it's not in JD.
Now partial match skills:
·       Software Engineering Experience (15+ years) | 180m | 117m
·       Lead Role Experience (6+ years) | 72m | 51m
But we need to be consistent with the example: they had "Leadership Experience (6+ years)" and "Software Engineering Experience (15+ years)". So we'll use similar wording.
Now we need to compute percentages: (full+partial)/total = (6+2)/25 = 8/25 = 32%. Missing = 17/25 = 68%.
But wait, we have 6 full matches? Let's list full matches explicitly:
·       React/Angular
·       Node.js/Java/.NET/Python (backend) - we have Java, Python, Node.js
·       SQL
·       GitHub Actions
·       Strong API development & integration
·       Python (desired)
That's 6. Yes.
Now we need to output.
But note: The example also had a line for "Professional certifications" which we don't have. So we omit.
Also ensure that we follow the format exactly: The missing skills table should have bullet points with • and then the skill name, then | and JD Req, then | and Has. The example used a markdown table with columns separated by | but they didn't use table headers? Actually they wrote:
Missing Skills:
 | Missing Skills | JD Req | Has |
 • .NET | (language listed in JD) | 0m
 ...
That is a bit inconsistent. Probably they intended a table with rows. Let's replicate the exact format from the DESIRED OUTPUT section:
DESIRED OUTPUT:
Missing Skills:
 | Missing Skills | JD Req | Has |
 • .NET | (language listed in JD) | 0m
 • AWS S3 | (service listed in JD) | 0m
 ...
So it's a list with bullet points, but with a header line. We'll do the same.
Similarly for partial match:
Partial Match Skills:
 | Partial Match Skills | JD Req | Has |
 • Software Engineering Experience (15+ years) | 180m | 117m |
 • Leadership Experience (6+ years) | 72m | 68m |
 • PySpark | 60m | 55m
But we don't have PySpark, so only two.
Then:
Resume Percentage to JD:
 (match skills +Partial skills) %
 Missing skills %
So we need to put the numbers.
Let's write.
But before finalizing, we need to double-check if any other skills might be considered present. For example, "event-driven architecture" - the resume mentions "asynchronous processing" in summary. That might be a hint, but not explicit. Also they have "real-time features" in TPCL. But we should be strict. So missing.
Also "AWS" general might imply some knowledge of IAM etc, but not specific. So missing.
Now, we need to ensure that we haven't missed any requirement. The JD also says "Full Stack: React/Angular, Node.js/Java/.NET/Python, SQL" - we covered. "AWS: Glue, Lambda, API Gateway, IAM, S3, CloudWatch" - we listed each. "CI/CD: Jenkins, GitHub Actions, Terraform/CloudFormation" - we listed each. "Testing: Jest, Cypress, Selenium" - each. "Strong API development & integration" - we have. "Proven leadership in matrix environments" - we have. Desired skills we listed.
Also note: The JD requires "15+ years in software engineering" and "6+ years in a lead role". These are separate. So we have partial for both.
Now, one more thing: The candidate's total experience is 117 months, which is 9.75 years. That's less than 15. So partial.
For lead role, we estimated 51 months from guiding juniors. But is that accurate? The guiding might have been only part of that role. However, we don't have a better estimate. So we'll use 51.
But we need to be careful: The example had 68 months for leadership, which is close to 72. In our case, 51 is quite less. That's fine.
Now, let's produce the output.
I'll format as per the desired output.
Missing Skills:
 | Missing Skills | JD Req | Has |
 • AWS Glue | (service listed in JD) | 0m
 • AWS Lambda | (service listed in JD) | 0m
 • AWS API Gateway | (service listed in JD) | 0m
 • AWS IAM | (service listed in JD) | 0m
 • AWS S3 | (service listed in JD) | 0m
 • AWS CloudWatch | (service listed in JD) | 0m
 • Jenkins | (CI/CD tool listed in JD) | 0m
 • Terraform/CloudFormation | (IaC listed in JD) | 0m
 • Jest | (testing tool listed in JD) | 0m
 • Cypress | (testing tool listed in JD) | 0m
 • Selenium | (testing tool listed in JD) | 0m
 • Proven leadership in matrix environments | (leadership style listed in JD) | 0m
 • Asset Management / Investment Banking / Wealth Management domain knowledge | (desired domain experience) | 0m
 • Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle | (desired domain knowledge) | 0m
 • Snowflake | (desired data platform) | 0m
 • Event-driven architecture | (desired architectural pattern) | 0m
 • ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m
Partial Match Skills:
 | Partial Match Skills | JD Req | Has |
 • Software Engineering Experience (15+ years) | 180m | 117m |
 • Lead Role Experience (6+ years) | 72m | 51m |
Resume Percentage to JD:
 (6 + 2) / 25 = 32%
 Missing skills = 68%
But we need to write it as "32%" and "68%". Also note that the example had "(match skills +Partial skills) %" so we just put the number.
So final answer.
Missing Skills:
 | Missing Skills | JD Req | Has |
 • AWS Glue | (service listed in JD) | 0m
 • AWS Lambda | (service listed in JD) | 0m
 • AWS API Gateway | (service listed in JD) | 0m
 • AWS IAM | (service listed in JD) | 0m
 • AWS S3 | (service listed in JD) | 0m
 • AWS CloudWatch | (service listed in JD) | 0m
 • Jenkins | (CI/CD tool listed in JD) | 0m
 • Terraform/CloudFormation | (IaC listed in JD) | 0m
 • Jest | (testing tool listed in JD) | 0m
 • Cypress | (testing tool listed in JD) | 0m
 • Selenium | (testing tool listed in JD) | 0m
 • Proven leadership in matrix environments | (leadership style listed in JD) | 0m
 • Asset Management / Investment Banking / Wealth Management domain knowledge | (desired domain experience) | 0m
 • Knowledge of OMS/PMS, risk engines, ETF platforms, or fund lifecycle | (desired domain knowledge) | 0m
 • Snowflake | (desired data platform) | 0m
 • Event-driven architecture | (desired architectural pattern) | 0m
 • ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m
Partial Match Skills:
 | Partial Match Skills | JD Req | Has |
 • Software Engineering Experience (15+ years) | 180m | 117m |
 • Lead Role Experience (6+ years) | 72m | 51m |
Resume Percentage to JD:
 32%
 Missing skills = 68%
}
 
Rule Set for Analyzing Job Description and Resume Match
Objective
To systematically compare a Job Description (JD) against a candidate's resume, identifying matched, partially matched, and missing skills and certifications, and presenting the results in a consistent, actionable format.

General Guidelines
·       Deep Reasoning Mode: Before responding, thoroughly analyze both documents. Break down each requirement and qualification. If a term is ambiguous or requires industry context, use web search to verify.
·       Inch‑by‑Inch Analysis: Scrutinize every line of the JD and resume. Do not skip any detail, including soft skills, tools, technologies, certifications, and years of experience.
·       Strict Factuality: Base all conclusions solely on what is explicitly stated in the documents. Do not infer or invent skills. If a skill is not written in the resume, it does not exist.
·       Consistency: The output format must be identical every time, following the examples provided.

Step‑by‑Step Process
Step 1: Extract Requirements from the Job Description
·       Read the JD carefully.
·       Create a rigid list of every mandatory skill, certification, experience requirement, and any other explicit qualification. Include:
o   Technical skills (programming languages, frameworks, tools, platforms)
o   Soft skills (e.g., leadership, communication, teamwork)
o   Required certifications (e.g., PMP, AWS Certified, CFA)
o   Educational requirements (if specified as a must)
o   Years of experience in specific areas (e.g., “5+ years in Python”)
o   Domain knowledge (e.g., asset management, healthcare, etc.)
·       For each requirement, note if a duration (months/years) is specified. If not, treat it as a binary requirement (present/absent).
Step 2: Extract Information from the Resume
·       Read the resume thoroughly.
·       List all skills, experiences, certifications, and achievements mentioned. Look in:
o   Skills sections
o   Summary section
o   Technical Skills Section
o   Work experience bullet points (implicit skills)
o   Education and certifications
o   Projects and volunteer work
·       For each skill, estimate the months of experience if possible (based on job durations or explicit statements). If not possible, note it as “present” without duration.
Step 3: Compare Each JD Requirement with the Resume
For every item in the JD list, determine its status:
·       Full Match:
o   The skill/certification is explicitly stated or clearly demonstrated with equivalent terminology (e.g., “Python” = “Python programming”).
o   If a duration is specified in the JD, the candidate’s experience must be equal to or greater than the required months.
o   If no duration is specified, presence alone counts as a full match.
·       Partial Match:
o   The skill is mentioned in the resume, but the candidate’s experience is less than the JD’s required duration.
o   The skill is present but at a lower level (e.g., JD requires “AWS Certified Solutions Architect”, resume shows “AWS Certified Cloud Practitioner”).
o   Soft skills: the resume shows some evidence but not the level described in the JD.
o   Strict condition: A skill is only a partial match if the candidate has more than 0 months of experience and that amount is less than the JD requirement. If the candidate meets or exceeds the requirement, it is a full match.
·       Missing:
o   The skill/certification is not found in the resume at all, or no equivalent is present.
o   The candidate has 0 months of experience in that skill, regardless of what the JD requires. (See Strict 0‑Month Categorization below.)
Step 4: Apply Strict Categorization Rules
Strict 0‑Month Categorization
·       Any skill for which the candidate has 0 months of experience must be placed in the Missing Skills category. This overrides any JD requirement—even if the JD asks for 0 years, if the candidate has 0 months, it is still missing (the skill is absent).
Strict Partial Match Limits
·       A skill is only a “Partial Match” if:
1.     The candidate has > 0 months of experience, and
2.     That experience is less than the months explicitly required by the JD.
·       If the candidate has equal to or more months than the JD requires, it is a Full Match. Do not place it in Partial Match.
Consistency Check
·       Before finalizing, verify that every skill listed as “Missing” was actually asked for in the JD.
·       Ensure that no skill with 0 months appears in Partial Match.
Step 5: Count and Categorize
·       Total skills in JD = total number of unique requirements from Step 1.
·       Count of Full Match skills.
·       Count of Partial Match skills.
·       Count of Missing skills.
·       Verify: Full + Partial + Missing = Total.
Step 6: Calculate Percentages
·       Resume Match Percentage = (Full Match count + Partial Match count) / Total skills × 100%
·       Missing Skills Percentage = Missing count / Total skills × 100%
·       The two percentages sum to 100%.

Output Format
The final response must be structured exactly as shown below. Use markdown tables for clarity.
1. Missing Skills
List every missing skill in a bulleted table. For each skill:
·       Provide the skill name as it appears in the JD (include any clarifying context in parentheses if needed).
·       In the “JD Req” column, describe what the JD asked for (e.g., “language listed in JD”, “service listed in JD”, “desired domain experience”).
·       In the “Has” column, put 0m (zero months) or “Missing” for certifications.
Example:
text
Missing Skills:
| Missing Skills | JD Req | Has |
| --- | --- | --- |
| • .NET | (language listed in JD) | 0m |
| • AWS S3 | (service listed in JD) | 0m |
| • Jenkins | (CI/CD tool listed in JD) | 0m |
| • Terraform / CloudFormation | (IaC listed in JD) | 0m |
| • Jest | (testing listed in JD) | 0m |
| • Snowflake | (desired data platform) | 0m |
| • Asset Management / Investment Banking / Wealth Management domain knowledge (OMS/PMS, fund lifecycle, ETF platforms, risk engines) | (desired domain experience) | 0m |
| • ESG data / performance attribution / regulatory reporting exposure | (desired domain exposure) | 0m |
| • Proven leadership in matrix environments (explicit) | (leadership style listed in JD) | 0m |
| • Professional certifications (AWS, Snowflake, finance/industry-related certs) | (not listed on resume) | Missing |
2. Partial Match Skills (if any)
If there are partial matches, list them in a similar table. For each:
·       Skill name (with context if needed).
·       JD Req: the required duration in months (e.g., “180m” for 15 years).
·       Has: the candidate’s experience in months.
Example:
text
Partial Match Skills:
| Partial Match Skills | JD Req | Has |
| --- | --- | --- |
| • Software Engineering Experience (15+ years) | 180m | 117m |
| • Leadership Experience (6+ years) | 72m | 68m |
| • PySpark | 60m | 55m |
If there are no partial matches, omit this section entirely.
3. Resume Percentage to JD
Provide the two percentages:
text
Resume Percentage to JD:
(match skills + Partial skills) = XX%
Missing skills = YY%
Where XX + YY = 100%.

Additional Rules for Accuracy
·       Synonyms and Variations: Recognize common synonyms and industry jargon (e.g., “JS” for JavaScript, “Excel” for Microsoft Excel). Use reasoning to match, but do not stretch beyond reasonable equivalence.
·       Certifications: Verify if the certification is the exact one or a related one. If the JD requires “CISSP” and the resume has “Security+”, it is a partial match (if considered related) or missing (if strict). Use judgment based on context.
·       Experience Levels: When a JD specifies years, convert to months for comparison. If the resume does not provide explicit duration for a skill, infer from job tenure if the skill was used in that role. If impossible to determine, treat as “present” without duration (so it becomes a full match if no duration required, or partial if a duration is required but unknown—but be cautious).
·       Soft Skills: Look for behavioral indicators or explicit mentions. For example, “led a team of 5” can match “leadership”. If not mentioned, it is missing.
·       Education: If the JD requires a specific degree, check the resume’s education section. If the degree is not listed but the candidate has equivalent experience, consider it missing (unless the JD allows substitution, then partial may be appropriate).
·       Web Search: Use web search to clarify ambiguous terms, verify certification levels, or understand industry standards. This ensures accurate categorization.

Important Notes
·       Count each JD requirement only once, even if it appears multiple times in the JD.
·       Ignore skills in the resume that are not asked for in the JD. Focus solely on what the JD requires.
·       Maintain a neutral, objective tone. Do not infer beyond what is written.
·       Always double-check counts and percentages before finalizing.
 
 
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
 
After processing all above scenarios give me desired output as below.

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
    "gapAnalysis": "DESIRED OUTPUT:\\n\\nMissing Skills:\\n| Missing Skills | JD Req | Has |\\n| :--- | :--- | :--- |\\n• [Skill Name] | [Req] | 0m\\n...\\n\\nPartial Match Skills:\\n| Partial Match Skills | JD Req | Has |\\n| :--- | :--- | :--- |\\n• [Skill Name] | [Req] | [Has]\\n...\\n\\nResume Percentage to JD:\\n(match skills +Partial skills) = XX%\\nMissing skills = YY%"
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
