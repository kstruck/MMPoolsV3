
const https = require('https');

const url = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            const events = json.events || [];
            console.log(`Found ${events.length} events.`);

            const game = events.find(e => {
                const name = e.name.toLowerCase();
                // Look for Cardinals and Texans
                const c1 = "cardinals";
                const c2 = "texans";
                return JSON.stringify(e).toLowerCase().includes(c1) && JSON.stringify(e).toLowerCase().includes(c2);
            });

            if (game) {
                console.log("--- FOUND GAME ---");
                console.log("Name:", game.name);
                console.log("id:", game.id);
                console.log("date:", game.date);
                console.log("status:", JSON.stringify(game.status));

                if (game.competitions && game.competitions.length > 0) {
                    const comp = game.competitions[0];
                    console.log("competition.date:", comp.date);
                    console.log("competition.startDate:", comp.startDate);
                    console.log("competition.status:", JSON.stringify(comp.status));
                } else {
                    console.log("No competitions found");
                }
            } else {
                console.log("Start debugging search...");
                events.forEach(e => {
                    console.log("Event:", e.name, "| Date:", e.date);
                });
                console.log("Game not found with strict text search.");
            }
        } catch (e) {
            console.error(e.message);
        }
    });
}).on('error', (e) => {
    console.error(e);
});
