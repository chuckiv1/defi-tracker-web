const ExcelJS = require('exceljs');
const fs = require('fs');

async function createExcel() {
  const data = JSON.parse(fs.readFileSync('/home/chucki/Agentworkspace/data.json', 'utf8'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DeFi Vault';
  workbook.created = new Date();

  // --- Sheet 1: Übersicht & Details ---
  const ws = workbook.addWorksheet('Dashboard', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
  });

  // Stil-Definitionen
  const FONT_ALL = { name: 'Arial', size: 10 };
  const FONT_HEADER = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  const FONT_MAIN_ROW = { name: 'Arial', size: 10, bold: true };
  const FONT_SUB_ROW = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF555555' } };

  const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }; // Dunkelgrau
  const FILL_MAIN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }; // Leichtes Puderblau
  const FILL_SUB_INV = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } }; // Sehr helles Grün
  const FILL_SUB_REW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }; // Sehr helles Gelb

  ws.columns = [
    { header: 'Typ / Aktion', key: 'type', width: 20 },
    { header: 'Strategie / Datum', key: 'name_or_date', width: 35 },
    { header: 'Basis Token', key: 'token', width: 25 },
    { header: 'Investiert ($)', key: 'invested', width: 18 },
    { header: 'Belohnungen ($)', key: 'rewards', width: 18 },
    { header: 'Net PnL ($)', key: 'pnl', width: 18 },
    { header: 'Notizen', key: 'notes', width: 50 },
  ];

  // Header formatieren
  const headerRow = ws.getRow(1);
  headerRow.font = FONT_HEADER;
  headerRow.fill = FILL_HEADER;
  headerRow.height = 25;
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  let currentRowCount = 2; // Starte bei Zeile 2

  data.forEach((strategy) => {
    const investiert = strategy.investmentHistory.reduce((sum, current) => sum + current.amount, 0);
    const rewards = strategy.rewards.reduce((sum, current) => sum + current.amount, 0);
    const basisToken = strategy.token ? `${strategy.token.amount} ${strategy.token.name} (@ ${strategy.token.entryPrice})` : '-';
    
    // 1. HAUPTZEILE (Strategie-Zusammenfassung)
    const mainRow = ws.addRow({
      type: '📌 Strategie',
      name_or_date: strategy.name,
      token: basisToken,
      invested: investiert,
      rewards: rewards,
      pnl: (rewards - investiert) + investiert,
      notes: strategy.notes
    });

    // Hauptzeile stylen
    mainRow.font = FONT_MAIN_ROW;
    mainRow.fill = FILL_MAIN;
    mainRow.height = 22;
    mainRow.getCell('invested').numFmt = '#,##0.00 $';
    mainRow.getCell('rewards').numFmt = '#,##0.00 $';
    mainRow.getCell('pnl').numFmt = '#,##0.00 $';
    mainRow.alignment = { vertical: 'middle' };
    
    // Die Outline-Level der Sub-Zeilen beginnen hier (für Ausklapp-Feature)
    const mainRowIdx = currentRowCount;
    currentRowCount++;

    // 2. UNTERZEILEN: Investitionen
    strategy.investmentHistory.forEach(inv => {
      const subRow = ws.addRow({
        type: '    ➡️ Investition',
        name_or_date: new Date(inv.date).toLocaleDateString() + ' ' + new Date(inv.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        token: '',
        invested: inv.amount,
        rewards: '',
        pnl: '',
        notes: inv.note
      });
      subRow.font = FONT_SUB_ROW;
      subRow.fill = FILL_SUB_INV;
      subRow.getCell('invested').numFmt = '#,##0.00 $';
      subRow.alignment = { vertical: 'middle' };
      // Setze Level für Gruppierung
      subRow.outlineLevel = 1;
      currentRowCount++;
    });

    // 3. UNTERZEILEN: Belohnungen
    strategy.rewards.forEach(rew => {
      const subRow = ws.addRow({
        type: '    🎁 Belohnung',
        name_or_date: new Date(rew.date).toLocaleDateString() + ' ' + new Date(rew.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        token: '',
        invested: '',
        rewards: rew.amount,
        pnl: '',
        notes: rew.note
      });
      subRow.font = FONT_SUB_ROW;
      subRow.fill = FILL_SUB_REW;
      subRow.getCell('rewards').numFmt = '#,##0.00 $';
      subRow.alignment = { vertical: 'middle' };
      // Setze Level für Gruppierung
      subRow.outlineLevel = 1;
      currentRowCount++;
    });
    
    // Leerzeile zur besseren optischen Trennung zwischen den Strategien (optional)
    const divider = ws.addRow({});
    divider.height = 10;
    currentRowCount++;
  });

  // Appiziere Standard-Schriftart auf das gesamte Blatt (außer Header / explizite Rows)
  ws.eachRow({ includeEmpty: false }, function(row, rowNumber) {
    if (rowNumber === 1) return; // Header ignorieren
    // Standard für noch leere Zellen erzwingen
     row.eachCell({ includeEmpty: true }, function(cell) {
         if (!cell.font) cell.font = FONT_ALL;
     });
  });

  // Bis zur Zeile 300 das OutlineLevel auf 0 forcieren, falls es leere Zeilen gibt
  for(let i = currentRowCount; i <= 300; i++) {
     ws.getRow(i).outlineLevel = 0;
     ws.getRow(i).font = FONT_ALL;
  }

  // Gruppierungen zuklappen lassen am Anfang
  ws.properties.outlineProperties = {
    summaryBelow: false,
    summaryRight: false,
  };

  // Speichern
  const outputPath = '/home/chucki/Agentworkspace/WebApp/DefiTrackerpublic/test-excel/Demo_Spreadsheet_Grouped.xlsx';
  await workbook.xlsx.writeFile(outputPath);
  console.log('Erstellt: ' + outputPath);
}

createExcel().catch(console.error);
