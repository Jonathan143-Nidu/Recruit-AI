import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

export default async function middleware(req) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const { pathname } = req.nextUrl;

    console.log("Middleware check:", { pathname, hasToken: !!token });

    // Allow auth-related requests and public assets
    if (
        pathname.includes("/api/auth") ||
        pathname === "/login" ||
        pathname.startsWith("/jobs") ||       // public careers page
        pathname.startsWith("/api/jobs") ||   // public jobs API
        pathname.startsWith("/api/process") || // [FIX] Allow internal sync calls (backed by accessCode)
        pathname.startsWith("/api/folders") || // [FIX] Allow extension to fetch folders
        pathname.startsWith("/api/drive") ||   // [FIX] Allow extension to fetch drive tokens
        pathname.startsWith("/_next") ||
        pathname.includes(".") // static files
    ) {
        return NextResponse.next();
    }

    // Redirect to login if no token
    if (!token) {
        console.log("Redirecting to /login");
        return NextResponse.redirect(new URL("/login", req.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!api/auth|api/process|api/folders|api/drive|_next/static|_next/image|favicon.ico).*)"],
};
