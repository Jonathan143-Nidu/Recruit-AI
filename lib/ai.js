import OpenAI from 'openai';

/**
 * Expert Technical Recruiter - AI KEY ROTATOR
 * Handles automatic switching between multiple API keys if one fails due to rate limits or quota.
 */

// Load all OpenAI Keys (Up to 19)
const OPENAI_KEYS = [];
for (let i = 1; i <= 19; i++) {
    const key = process.env[`OPENAI_API_KEY_${i}`] || (i === 1 ? process.env.OPENAI_API_KEY : null);
    if (key) OPENAI_KEYS.push(key);
}

// Load all DeepSeek Keys (Up to 20)
const DEEPSEEK_KEYS = [];
for (let i = 1; i <= 20; i++) {
    const key = process.env[`DEEPSEEK_API_KEY_${i}`] || (i === 1 ? process.env.DEEPSEEK_API_KEY : null);
    if (key) DEEPSEEK_KEYS.push(key);
}

/**
 * Execute a completion with automatic key rotation
 * [UPGRADE] Now supports 'Dedicated Key Lanes' for 20 employees.
 */
export async function getAICompletion({ messages, model, temperature = 0, response_format = null, provider = 'openai', timeout = 60000, userEmail = 'anonymous', keyOffset = 0 }) {
    const keys = provider === 'openai' ? OPENAI_KEYS : DEEPSEEK_KEYS;
    const baseUrl = provider === 'openai' ? undefined : 'https://api.deepseek.com';

    // Simple hash function to turn an email into a consistent starting number
    const getHash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash);
    };

    // Pick a starting index based on the user's email + parallel offset
    // This allows parallel requests from the same user to "fan out" across different keys
    const startIndex = (getHash(userEmail) + keyOffset) % keys.length;

    // Reorder keys so the user's assigned key is first
    const userLanes = [
        ...keys.slice(startIndex),
        ...keys.slice(0, startIndex)
    ];

    let lastError = null;

    for (const key of userLanes) {
        try {
            const openai = new OpenAI({
                apiKey: key,
                baseURL: baseUrl
            });

            const options = {
                messages,
                model,
                temperature,
            };

            if (response_format) {
                options.response_format = response_format;
            }

            const completion = await openai.chat.completions.create(options, { timeout });

            // If we're here, it worked!
            return completion;

        } catch (error) {
            lastError = error;
            console.error(`[AI Rotation] Key failed (${provider}):`, error.message);

            // Only rotate on rate limit (429) or quota errors (403/401 sometimes) or server errors (500/503)
            const isRetryable = error.status === 429 || error.status === 401 || error.status === 403 || error.status >= 500;

            if (!isRetryable) {
                // If it's a BAD REQUEST (400) or something else, don't bother rotating, it's a code issue
                throw error;
            }

            console.log(`[AI Rotation] Switching to next key...`);
            continue;
        }
    }

    throw new Error(`All ${provider} API keys failed. Last error: ${lastError?.message}`);
}
