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
        
        /* NEW PREMIUM REDESIGN STYLES */
        .category-header { font-size: 11px; font-weight: 800; margin-bottom: 6px; margin-top: 15px; }
        .header-red { color: #e11d48; }
        .header-amber { color: #f59e0b; }
        
        .gap-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 11px; }
        .gap-table th { text-align: left; padding: 6px 10px; color: #94a3b8; font-weight: 700; border-bottom: 1px solid #f1f5f9; background: #f8fafc; font-size: 9px; text-transform: uppercase; }
        .gap-table td { padding: 6px 10px; border-bottom: 1px solid #f8fafc; line-height: 1.4; color: #1e293b; }
        
        .border-red { border-bottom: 1.5px solid #fee2e2 !important; }
        .border-amber { border-bottom: 1.5px solid #fef3c7 !important; }
        
        .summary-box { margin-top: 15px; padding: 12px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
        .summary-title { font-size: 11px; font-weight: 900; color: #0f172a; margin-bottom: 4px; }
        .summary-match { font-size: 10px; color: #6366f1; font-weight: 700; }
        .summary-gap { font-size: 10px; color: #ef4444; font-weight: 700; }
        
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
            <table style="width: 100%; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 12px; border-collapse: collapse;">
                <tr>
                    <td style="vertical-align: middle;">
                        <span style="font-size: 16px; font-weight: 800; color: #0f172a; line-height: 1.2;">
                            ${jobInfo?.title || 'Not specified'}
                        </span>
                    </td>
                    <td style="text-align: right; vertical-align: middle; width: 140px;">
                        <a href="${jobInfo?.jdLink || '#'}" style="display: inline-block; background-color: #dc2626; color: #ffffff !important; padding: 6px 16px; border-radius: 6px; font-size: 10px; font-weight: 800; text-decoration: none; text-transform: uppercase;">Click for JD</a>
                    </td>
                </tr>
            </table>
            
            <div style="font-size: 11px; color: #475569; font-weight: 700;">
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">LOCATION:</span> <span style="color: #1e293b;">${jobInfo?.location || '---'}</span> &nbsp;|&nbsp;
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">RATE:</span> <span style="color: #1e293b;">${jobInfo?.rate || '---'}</span> &nbsp;|&nbsp;
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">VISA:</span> <span style="color: #1e293b;">${jobInfo?.visa || '---'}</span> &nbsp;|&nbsp;
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">CLIENT:</span> <span style="color: #1e293b;">${jobInfo?.client || '---'}</span> &nbsp;|&nbsp;
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">MODE:</span> <span style="color: #1e293b;">${jobInfo?.mode || '---'}</span> &nbsp;|&nbsp;
                <span style="color: #94a3b8; font-weight: 800; font-size: 9px;">EXP:</span> <span style="color: #1e293b;">${jobInfo?.exp || '---'}</span>
            </div>
        </div>
        <div class="main-layout">
            <div class="content">
                <div class="intro" style="font-size:12px; line-height:1.5;">${customIntro || `Hello ${candidate?.displayName || 'Candidate'},<br/><br/>${senderName} here from Innovcentric. We've carefully reviewed your profile against our current opening. Based on our AI-driven "Forensic Analysis", here is your detailed match report.`}</div>
                
                <div class="section-title">Gap Analysis</div>

                <!-- CATEGORIZED TABLES (PREMIUM AI INSIGHTS STYLE) -->
                
                ${(candidate?.missingSkills?.length > 0) ? `
                    <div class="category-header header-red">Missing Skills:</div>
                    <table class="gap-table">
                        <thead>
                            <tr>
                                <th style="border-bottom: 1.5px solid #fee2e2;">Missing Skills</th>
                                <th style="text-align: center; border-bottom: 1.5px solid #fee2e2;">JD Req</th>
                                <th style="text-align: center; border-bottom: 1.5px solid #fee2e2;">Has</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${candidate.missingSkills.map(s => `
                                <tr>
                                    <td style="font-weight: 800; border-bottom: 1px solid #fee2e2;">• ${typeof s === 'string' ? s : s.skill}</td>
                                    <td style="text-align: center; font-weight: 700; color: #64748b; border-bottom: 1px solid #fee2e2;">Must Have</td>
                                    <td style="text-align: center; font-weight: 900; color: #ef4444; border-bottom: 1px solid #fee2e2;">0m</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : ''}

                ${(candidate?.missingCertifications?.length > 0) ? `
                    <div class="category-header header-red">Missing Certifications:</div>
                    <table class="gap-table">
                        <thead>
                            <tr>
                                <th style="border-bottom: 1.5px solid #fee2e2;">Missing Certifications</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${candidate.missingCertifications.map(c => `
                                <tr>
                                    <td style="font-weight: 800; border-bottom: 1px solid #fee2e2;">• ${typeof c === 'string' ? c : (c.name || c.skill)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : ''}

                ${(candidate?.partialMatchSkills?.length > 0) ? `
                    <div class="category-header header-amber">Partial Match Skills:</div>
                    <table class="gap-table">
                        <thead>
                            <tr>
                                <th style="border-bottom: 1.5px solid #fef3c7;">Partial</th>
                                <th style="text-align: center; border-bottom: 1.5px solid #fef3c7;">JD Req</th>
                                <th style="text-align: center; border-bottom: 1.5px solid #fef3c7;">Has</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${candidate.partialMatchSkills.map(p => `
                                <tr>
                                    <td style="font-weight: 800; border-bottom: 1px solid #fef3c7;">• ${p.skill}</td>
                                    <td style="text-align: center; font-weight: 700; color: #475569; border-bottom: 1px solid #fef3c7;">${p.jdRequirement || p.req || '-'}</td>
                                    <td style="text-align: center; font-weight: 900; color: #f59e0b; border-bottom: 1px solid #fef3c7;">${p.candidateHas || p.has || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : ''}

                <!-- SUMMARY PERCENTAGES -->
                <div class="summary-box">
                    <div class="summary-title">Resume Percentage to JD:</div>
                    <div class="summary-match">(match skills + Partial skills) ${candidate?.matchPercentage || 0}%</div>
                    <div class="summary-gap">Missing skills ${100 - (candidate?.matchPercentage || 0)}%</div>
                </div>
                
                <a href="${careersLink || 'https://careers.innovcentric.com/jobs'}" class="button">View More Jobs</a>

                <div class="signature">${signature || `Best regards,<br/>${senderName}<br/>Innovcentric LLC`}</div>
            </div>
            
            <div class="sidebar-essentials">
                ${candidate?.requiredDetails ? `
                    <div style="margin-top:25px;">
                        <div class="section-title">Required Details</div>
                        <div style="font-size:12px; color:#1e293b; line-height:1.4; font-weight:700;">
${candidate.requiredDetails.trim().replace(/\n/g, '<br/>')}
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
