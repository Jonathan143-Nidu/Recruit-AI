const OpenAI = require('openai');
// Manually set key for diagnostic test from what I saw in .env.local
const apiKey = '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';

async function test() {
    console.log("Starting OpenAI Connectivity Test...");
    const openai = new OpenAI({ apiKey: apiKey });

    try {
        console.time("Test-AI-Call");
        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: "Say hi" }],
            model: "gpt-4o-mini"
        }, { timeout: 10000 });
        console.timeEnd("Test-AI-Call");
        console.log("Response:", completion.choices[0].message.content);
        console.log("SUCCESS: Connectivity and API Key are working.");
    } catch (e) {
        console.error("FAILURE: AI Call failed:", e.message);
    }
}

test();
