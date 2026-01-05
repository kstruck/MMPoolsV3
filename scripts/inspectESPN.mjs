// Script to save ESPN scoringPlays structure to a file
// Run: node scripts/inspectESPN.mjs <gameId>

import { writeFileSync } from 'fs';

const gameId = process.argv[2] || '401671823';
const league = process.argv[3] || 'nfl'; // 'nfl' or 'college-football'

async function inspect() {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/${league}/summary?event=${gameId}`;

    console.log('Fetching:', url);

    const resp = await fetch(url);
    const data = await resp.json();

    const output = [];
    output.push('=== ESPN API scoringPlays ===');
    output.push(`Game ID: ${gameId}`);
    output.push('');

    if (data.scoringPlays) {
        output.push(`Total plays: ${data.scoringPlays.length}`);
        output.push('');

        data.scoringPlays.forEach((play, i) => {
            output.push(`Play ${i + 1}: ${play.awayScore}-${play.homeScore}`);
            output.push(`  Type: ${play.type?.text || play.scoringType?.displayName}`);
            output.push(`  Team: ${play.team?.abbreviation}`);
            output.push(`  Q${play.period?.number} ${play.clock?.displayValue}`);
            output.push('');
        });

        output.push('=== SAMPLE PLAY STRUCTURE ===');
        output.push(JSON.stringify(data.scoringPlays[0], null, 2));
    } else {
        output.push('NO scoringPlays found');
    }

    const outputPath = 'scripts/espn_output.txt';
    writeFileSync(outputPath, output.join('\n'));
    console.log(`Written to ${outputPath}`);
}

inspect().catch(console.error);
