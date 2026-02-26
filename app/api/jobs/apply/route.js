import nodemailer from 'nodemailer';

export async function POST(req) {
    try {
        const body = await req.json();
        const { jobId, jobTitle, name, email, phone, linkedin, message } = body;

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_FROM,
                pass: process.env.EMAIL_PASSWORD,
            },
        });

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg,#1e1b4b,#4c1d95); padding: 24px; border-radius: 10px 10px 0 0;">
                    <h2 style="color:white; margin:0; font-size:20px;">📬 New Job Application</h2>
                    <p style="color:rgba(255,255,255,0.75); margin:6px 0 0; font-size:13px;">${jobTitle} · ${jobId}</p>
                </div>
                <div style="background:#f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top:none; border-radius: 0 0 10px 10px;">
                    <table style="width:100%; border-collapse:collapse; font-size:14px;">
                        ${[
                ['👤 Name', name],
                ['📧 Email', email],
                ['📱 Phone', phone || '—'],
                ['🔗 LinkedIn / Resume URL', linkedin || '—'],
            ].map(([label, value]) => `
                            <tr>
                                <td style="padding:10px 12px; background:white; border:1px solid #e5e7eb; font-weight:700; color:#374151; width:180px;">${label}</td>
                                <td style="padding:10px 12px; background:white; border:1px solid #e5e7eb; color:#0f172a;">${value}</td>
                            </tr>
                        `).join('')}
                    </table>
                    ${message ? `
                        <div style="margin-top:16px; background:white; border:1px solid #e5e7eb; border-radius:6px; padding:12px;">
                            <div style="font-weight:700; color:#374151; font-size:13px; margin-bottom:6px;">💬 Cover Note</div>
                            <p style="color:#0f172a; font-size:14px; line-height:1.6; margin:0;">${message.replace(/\n/g, '<br>')}</p>
                        </div>
                    ` : ''}
                    <p style="margin-top:20px; font-size:11px; color:#9ca3af;">Sent from Innovcentric Careers Portal · ${new Date().toLocaleString()}</p>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: `"Innovcentric Careers" <${process.env.EMAIL_FROM}>`,
            to: 'careers@innovcentric.com',
            replyTo: email,
            subject: `Application: ${jobTitle} (${jobId}) — ${name}`,
            html,
        });

        return Response.json({ ok: true });
    } catch (err) {
        console.error('Apply email error:', err);
        return Response.json({ ok: false, error: err.message }, { status: 500 });
    }
}
