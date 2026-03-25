import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const { sheets, SHEET_ID } = await import('./lib/google.js');

async function checkSheet() {
    console.log("SHEET_ID:", process.env.GOOGLE_SHEET_ID);
    console.log("Checking for 'Analysis_History' sheet...");
    try {
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
        });

        const sheetNames = metadata.data.sheets.map(s => s.properties.title);
        console.log("Existing Sheets:", sheetNames);

        if (sheetNames.includes("Analysis_History")) {
            console.log("✅ Analysis_History sheet found.");
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: 'Analysis_History!A:E',
            });
            const rowCount = response.data.values?.length || 0;
            console.log("Row count:", rowCount);
            
            if (rowCount === 0) {
                console.log("Sheet is empty. Setting headers...");
                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.GOOGLE_SHEET_ID,
                    range: 'Analysis_History!A1:E1',
                    valueInputOption: 'USER_ENTERED',
                    requestBody: {
                        values: [['Timestamp', 'Job Description', 'Candidate Count', 'Results (JSON)', 'Processed By']]
                    }
                });
                console.log("✅ Headers set.");
            }
        } else {
            console.log("❌ Analysis_History sheet NOT found. Creating...");
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                requestBody: {
                    requests: [{ addSheet: { properties: { title: "Analysis_History" } } }]
                }
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: 'Analysis_History!A1:E1',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [['Timestamp', 'Job Description', 'Candidate Count', 'Results (JSON)', 'Processed By']]
                }
            });
            console.log("✅ Sheet created and headers set.");
        }
    } catch (e) {
        console.error("Error checking sheet:", e.message);
    }
}

checkSheet();
