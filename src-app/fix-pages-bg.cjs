const fs = require('fs');

// Pages to update: change #f8fafc → #FAF8F3 for background
const pages = [
  'src/pages/Dashboard.tsx',
  'src/pages/CaseDetail.tsx',
  'src/pages/CaseVault.tsx',
  'src/pages/LegalBrain.tsx',
  'src/pages/WarRoom.tsx',
  'src/pages/Drafting.tsx',
  'src/pages/DraftingNew.tsx',
  'src/pages/LiveBench.tsx',
  'src/pages/Pricing.tsx',
  'src/pages/WinSimulator.tsx',
  'src/pages/LegalDatabase.tsx',
  'src/pages/Blog.tsx',
  'src/pages/JoinLiveBench.tsx',
  'src/pages/AdminGrowthOS.tsx',
  'src/pages/Terms.tsx',
  'src/pages/Privacy.tsx',
  'src/pages/RefundPolicy.tsx',
  'src/pages/MarketplacePolicy.tsx',
  'src/pages/Compliance.tsx',
  'src/pages/Accessibility.tsx',
];

let changed = 0;
for (const p of pages) {
  if (!fs.existsSync(p)) { console.log('SKIP (not found):', p); continue; }
  let content = fs.readFileSync(p, 'utf8');
  const orig = content;
  content = content.split("'#f8fafc'").join("'#FAF8F3'");
  content = content.split('"#f8fafc"').join('"#FAF8F3"');
  if (content !== orig) {
    fs.writeFileSync(p, content, 'utf8');
    console.log('Updated:', p);
    changed++;
  } else {
    console.log('No change:', p);
  }
}
console.log(`\nDone. ${changed} files updated.`);
