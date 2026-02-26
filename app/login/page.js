"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const { data: session } = useSession();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (session) {
            router.push("/");
        }
    }, [session, router]);

    const handleLogin = () => {
        setIsLoading(true);
        signIn('google', { callbackUrl: '/' });
    };

    return (
        <div style={{ display: 'flex', minHeight: '100vh', fontFamily: '"Geist", sans-serif', background: '#fff' }}>
            {/* Left Panel - Visual Video Background */}
            <div className="hidden-mobile" style={{
                flex: '1',
                background: '#0F172A',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexDirection: 'column',
                padding: '60px'
            }}>
                {/* Background Video - Restored to full brightness */}
                <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        zIndex: 1
                    }}
                >
                    <source src="/videos/login-bg.mp4" type="video/mp4" />
                </video>

                {/* Text Removed for Cleaner Look */}
            </div>

            {/* Right Panel - Login Form */}
            <div style={{
                flex: '0 0 500px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                background: '#ffffff',
                boxShadow: '-10px 0 24px rgba(0,0,0,0.02)'
            }}>
                <div style={{ width: '100%', maxWidth: '360px' }}>
                    <div style={{ marginBottom: '40px' }}>
                        <video
                            autoPlay
                            loop
                            muted
                            playsInline
                            style={{
                                width: '100%',
                                borderRadius: '12px',
                                marginBottom: '24px',
                                display: 'block',
                                objectFit: 'cover'
                            }}
                        >
                            <source src="/intro.mp4" type="video/mp4" />
                        </video>
                        <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>Welcome back</h2>
                        <p style={{ color: '#64748b', fontSize: '14px' }}>Please sign in to your corporate account.</p>
                    </div>

                    <button
                        onClick={handleLogin}
                        disabled={isLoading}
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            padding: '12px 16px',
                            background: '#fff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: '500',
                            color: '#1e293b',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.borderColor = '#cbd5e1';
                            e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.borderColor = '#e2e8f0';
                            e.currentTarget.style.background = '#fff';
                        }}
                    >
                        {isLoading ? (
                            <span style={{ width: '18px', height: '18px', border: '2px solid #cbd5e1', borderTopColor: '#475569', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></span>
                        ) : (
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" style={{ width: '18px', height: '18px' }} />
                        )}
                        <span>{isLoading ? 'Connecting...' : 'Sign in with Google'}</span>
                    </button>

                    <div style={{ marginTop: '32px', textAlign: 'center' }}>
                        <p style={{ fontSize: '12px', color: '#94a3b8' }}>
                            Protected by enterprise-grade security. <br />
                            By signing in, you agree to our internal data policies.
                        </p>
                    </div>
                </div>
            </div>

            <style jsx global>{`
                @media (max-width: 768px) {
                    .hidden-mobile { display: none !important; }
                    div[style*="flex: 0 0 500px"] { flex: 1 !important; }
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                body { margin: 0; }
            `}</style>
        </div>
    );
}
