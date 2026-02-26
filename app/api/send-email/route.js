import { google } from 'googleapis';
import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/authOptions";

export async function POST(req) {
    try {
        const session = await getServerSession(authOptions);

        // If no session or no access token, we cannot send as the individual
        if (!session?.accessToken) {
            console.error('No Google Access Token found in session.');
            return NextResponse.json({
                success: false,
                error: 'Authentication Required. Please sign out and sign in again to authorize email sending.'
            }, { status: 401 });
        }

        const body = await req.json();
        const { to, cc, subject, candidate, jobInfo, careersLink, customIntro, signature } = body;

        // Initialize Gmail API
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: session.accessToken });
        const gmail = google.gmail({ version: 'v1', auth });

        const senderName = session?.user?.name || "Recruiting Team";
        const senderEmail = session?.user?.email;

        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #334155; margin: 0; padding: 0; background-color: #ffffff; }
        .container { width: 100%; margin: 0; padding: 0; background-color: #ffffff; }
        
        .main-layout { display: table; width: 100%; background: #ffffff; border-collapse: collapse; }
        .content { display: table-cell; width: 70%; padding: 15px 25px 30px 0; vertical-align: top; border-right: 1px solid #f1f5f9; }
        .sidebar-essentials { display: table-cell; width: 30%; padding: 15px 20px; background-color: #ffffff; vertical-align: top; }
        
        .intro { color: #334155; margin-bottom: 25px; white-space: pre-wrap; font-size: 14px; }
        .signature { color: #64748b; margin-top: 25px; border-top: 1px solid #f1f5f9; padding-top: 15px; font-size: 13px; white-space: pre-wrap; }
        
        .section-title { font-size: 10px; font-weight: 800; color: #6366f1; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
        
        .gap-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11px; }
        .gap-table th { text-align: left; padding: 6px 10px; color: #64748b; font-weight: 700; border-bottom: 1px solid #f1f5f9; background: #f8fafc; font-size: 10px; }
        .gap-table td { padding: 4px 10px; border-bottom: 1px solid #f8fafc; line-height: 1.4; color: #475569; }
        
        .status-badge { padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
        .status-missing { background: #fee2e2; color: #ef4444; }
        .status-partial { background: #fef3c7; color: #f59e0b; }
        
        .sidebar-item { margin-bottom: 12px; }
        .sidebar-label { font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase; display: block; margin-bottom: 2px; }
        .sidebar-value { font-size: 11px; color: #1e293b; font-weight: 700; line-height: 1.3; }
        
        .button { display: inline-block; padding: 8px 16px; background-color: #6366f1; color: white !important; text-decoration: none; border-radius: 4px; margin-top: 15px; font-size: 10px; font-weight: 700; }
        
        .job-header { background: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 15px 30px; margin-bottom: 0; }
        .job-header-grid { display: table; width: 100%; border-collapse: collapse; }
        .job-header-col { display: table-cell; vertical-align: top; padding: 0 8px; }
        .job-header-label { font-size: 8px; font-weight: 800; color: #6366f1; text-transform: uppercase; display: block; margin-bottom: 2px; }
        .job-header-value { font-size: 11px; color: #1e293b; font-weight: 700; line-height: 1.2; }

        @media screen and (max-width: 650px) {
            .main-layout, .content, .sidebar-essentials { display: block; width: 100%; border-left: none; border-right: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="job-header">
            <div class="job-header-grid">
                <div class="job-header-col" style="width: 20%; padding-left: 0;">
                    <span class="job-header-label">Role</span>
                    <span class="job-header-value">${jobInfo?.title || 'Not specified'}</span>
                </div>
                <div class="job-header-col" style="width: 12%;">
                    <span class="job-header-label">Location</span>
                    <span class="job-header-value">${jobInfo?.location || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 12%;">
                    <span class="job-header-label">Rate</span>
                    <span class="job-header-value">${jobInfo?.rate || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 8%;">
                    <span class="job-header-label">Visa</span>
                    <span class="job-header-value">${jobInfo?.visa || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 15%;">
                    <span class="job-header-label">Client</span>
                    <span class="job-header-value">${jobInfo?.client || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 10%;">
                    <span class="job-header-label">Mode</span>
                    <span class="job-header-value">${jobInfo?.mode || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 8%;">
                    <span class="job-header-label">Exp</span>
                    <span class="job-header-value">${jobInfo?.exp || '---'}</span>
                </div>
                <div class="job-header-col" style="width: 15%; padding-right: 0; text-align: right; vertical-align: middle;">
                    <a href="${jobInfo?.jdLink || '#'}" style="color:#6366f1; font-size:10px; font-weight:800; text-decoration: none; white-space: nowrap;">Full JD →</a>
                </div>
            </div>
        </div>
        <div class="main-layout">
            <div class="content">
                <div class="intro" style="font-size:12px; line-height:1.5;">${customIntro || `Hello ${candidate?.displayName || 'Candidate'},<br/><br/>${senderName} here from Innovcentric. We've carefully reviewed your profile against our current opening. Based on our AI-driven "Forensic Analysis", here is your detailed match report.`}</div>
                
                <div class="section-title">Gap Analysis</div>
                <table class="gap-table">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th style="width: 35%;">Skill</th>
                            <th style="width: 25%;">Requirement</th>
                            <th style="width: 25%;">CV Status</th>
                            <th style="width: 15%;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${candidate?.gaps?.map(g => `
                            <tr>
                            <td style="border-bottom: 1px solid #f1f5f9; font-weight: 800; color: #1e293b;">${g.skill}</td>
                            <td style="border-bottom: 1px solid #f1f5f9; font-weight: 700; color: #475569;">${g.req}</td>
                            <td style="border-bottom: 1px solid #f1f5f9; color: ${g.status === 'Missing' ? '#ef4444' : '#f59e0b'}; font-weight: 900;">
                                ${g.has || (g.status === 'Missing' ? 'Not Found' : '---')}
                            </td>
                                <td style="border-bottom: 1px solid #f1f5f9;">
                                    <span class="status-badge ${g.status === 'Missing' ? 'status-missing' : 'status-partial'}">${g.status}</span>
                                </td>
                            </tr>
                        `).join('') || '<tr><td colspan="4" style="text-align:center; color:#94a3b8; font-style:italic;">Detailed match report loading...</td></tr>'}
                        ${candidate?.gaps?.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:#94a3b8; font-style:italic;">No major gaps identified! Matches JD requirements well.</td></tr>' : ''}
                    </tbody>
                </table>
                
                
                <a href="${careersLink || 'https://innovcentric.com/careers'}" class="button">View More Jobs</a>

                <div class="signature">${signature || `Best regards,<br/>${senderName}<br/>Innovcentric LLC`}</div>
            </div>
            
            <div class="sidebar-essentials">

                ${candidate?.requiredDetails ? `
                    <div style="margin-top:25px;">
                        <div class="section-title">Required Details</div>
                        <div style="font-size:12px; color:#1e293b; line-height:1.5; white-space:pre-wrap; font-weight:700;">
                            ${candidate.requiredDetails.replace(/\n/g, '<br/>')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    </div>
</body>
</html>
        `;

        // Gmail requires messages to be in base64url encoded format
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const messageParts = [
            `From: "${senderName}" <${senderEmail}>`,
            `To: ${to}`,
            cc ? `Cc: ${cc}` : null,
            `Subject: ${utf8Subject}`,
            'Content-Type: text/html; charset=utf-8',
            'MIME-Version: 1.0',
            '',
            htmlContent,
        ].filter(Boolean);
        const message = messageParts.join('\r\n');

        // The body needs to be base64url encoded
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });

        console.log(`Message sent from ${senderEmail}: ${res.data.id}`);
        return NextResponse.json({ success: true, messageId: res.data.id });

    } catch (error) {
        console.error('Gmail API Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to send email via Gmail API'
        }, { status: 500 });
    }
}
