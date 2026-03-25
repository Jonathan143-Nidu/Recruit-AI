import GoogleProvider from "next-auth/providers/google";

/**
 * Takes a token, and returns a new token with updated
 * `accessToken` and `accessTokenExpires`. If an error occurs,
 * returns the old token and an error property.
 */
async function refreshAccessToken(token) {
    try {
        console.log("DEBUG: Refreshing token for user:", token.user?.email || "unknown");

        const url =
            "https://oauth2.googleapis.com/token?" +
            new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                grant_type: "refresh_token",
                refresh_token: token.refreshToken,
            });

        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method: "POST",
        });

        const refreshedTokens = await response.json();

        if (!response.ok) {
            console.error("DEBUG: Google Token Refresh Failed:", refreshedTokens);
            throw refreshedTokens;
        }

        console.log("DEBUG: Token refreshed successfully.");
        return {
            ...token,
            accessToken: refreshedTokens.access_token,
            accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
            refreshToken: refreshedTokens.refresh_token ?? token.refreshToken, // Fall back to old refresh token
        };
    } catch (error) {
        console.error("RefreshAccessTokenError Details:", JSON.stringify(error));

        return {
            ...token,
            error: "RefreshAccessTokenError",
        };
    }
}

export const authOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
                params: {
                    scope: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets",
                    access_type: "offline",
                    prompt: "consent",
                },
            },
        }),
    ],
    secret: process.env.NEXTAUTH_SECRET || "fallback_secret_for_dev_mode_only",
    debug: true,
    pages: {
        signIn: '/login',
    },
    callbacks: {
        async jwt({ token, account, user }) {
            // Initial sign in
            if (account && user) {
                console.log("DEBUG: Initial Sign In - Saving Refresh Token:", !!account.refresh_token);
                return {
                    accessToken: account.access_token,
                    // account.expires_at is already an absolute timestamp in seconds
                    accessTokenExpires: account.expires_at * 1000,
                    refreshToken: account.refresh_token,
                    user,
                };
            }

            // Return previous token if the access token has not expired yet
            // Add a 30s buffer to prevent edge-case 401s
            if (Date.now() < (token.accessTokenExpires - 30000)) {
                return token;
            }

            // Access token has expired (or is about to), try to update it
            if (!token.refreshToken) {
                console.warn("DEBUG: Access token expired but NO Refresh Token found. User must re-login.");
                return { ...token, error: "MissingRefreshToken" };
            }

            console.log("DEBUG: Access token expired. Attempting refresh...");
            return refreshAccessToken(token);
        },
        async session({ session, token }) {
            session.user = token.user;
            session.accessToken = token.accessToken;
            session.error = token.error; // Pass error (e.g., 'RefreshAccessTokenError' or 'MissingRefreshToken') to UI
            return session;
        },
    },
};
