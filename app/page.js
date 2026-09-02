import { sheets, SHEET_ID, GMAIL_SYNC_SHEET_ID } from '@/lib/google';
import DashboardTable from './components/DashboardTable';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { redirect } from "next/navigation";

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0; // Disable cache for real-time updates

export default async function Home({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  // Next.js 15/16: searchParams is a promise
  const resolvedSearchParams = await searchParams;
  const dbType = resolvedSearchParams?.db || 'master';
  const targetSheetId = dbType === 'sync' ? GMAIL_SYNC_SHEET_ID : SHEET_ID;

  let rows = [];
  let error = null;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: targetSheetId,
      range: 'A:Z', // Fetch all rows and columns from active sheet (All Candidates)
      valueRenderOption: 'FORMULA', // Fetch formulas to parse HYPERLINKs
    });
    rows = response.data.values || [];
  } catch (err) {
    console.error("Error fetching data", err);
    error = `Failed to load data from ${dbType === 'sync' ? 'Sync Results' : 'Master Database'}. Please check your Google Sheet ID and Service Account permissions.`;
  }

  const headers = rows.length > 0 ? rows[0] : [
    "Name", "Date", "Subject", "Role", "Exp", "Resume Says", "Email", "Phone", "LinkedIn", "Drive Folder", "Resume", "Sender", "Thread", "Processed By", "Fingerprint"
  ];
  const data = rows.length > 1 ? rows.slice(1) : [];

  return (
    <main style={{ padding: '0', fontFamily: 'Inter, system-ui, sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      {error ? (
        <div style={{ padding: '20px', background: '#ffebee', color: '#c62828', borderRadius: '5px' }}>
          {error}
        </div>
      ) : (
        <DashboardTable data={data} headers={headers} session={session} />
      )}
    </main>
  );
}
