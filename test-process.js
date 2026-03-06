const fetch = require('node-fetch');
const fs = require('fs');

async function run() {
    const payload = {
        accessCode: "secret123",
        subject: "AWS Data Engineer (Python & Power BI)",
        senderEmail: "aneel@flyhigh-staffing.com",
        threadLink: "https://mail.google.com/mail/u/0/#inbox/123",
        emailBody: "Test body",
        attachments: [
            {
                name: "test.pdf",
                mimeType: "application/pdf",
                contentBase64: Buffer.from("test").toString('base64'),
                error: null
            }
        ],
        manualFolderName: "Data Engineer TEST FOLDER",
        processedBy: "tester@innovcentric.com"
    };

    console.log("Sending payload...");
    const res = await fetch("https://recruit.innovcentric.com/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
}

run();
