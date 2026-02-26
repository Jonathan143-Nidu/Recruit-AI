import { google } from 'googleapis';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('Missing Google Service Account credentials');
}

const auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
    ],
});

export const drive = google.drive({ version: 'v3', auth });
export const sheets = google.sheets({ version: 'v4', auth });
export const SHEET_ID = process.env.GOOGLE_SHEET_ID;
export const GMAIL_SYNC_SHEET_ID = process.env.GMAIL_SYNC_SHEET_ID;
export const GMAIL_SYNC_DRIVE_FOLDER_ID = process.env.GMAIL_SYNC_DRIVE_FOLDER_ID;
