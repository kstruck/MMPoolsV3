with open('d:/march-melee-pools/src/components/admin/TournamentManager.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = '''            // Inject 2026 Men's if not present so it can be initialized
            if (!options.some(o => o.id === 'mens-2026')) {
                options.push({
                    id: 'mens-2026',
                    label: "Men's 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }'''

replace1 = '''            // Inject Uninitialized Tournaments if not present
            if (!options.some(o => o.id === 'mens-2026')) {
                options.push({
                    id: 'mens-2026',
                    label: "Men's 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }
            if (!options.some(o => o.id === 'bigeast-2026')) {
                options.push({
                    id: 'bigeast-2026',
                    label: "Big East 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }
            if (!options.some(o => o.id === 'big12-2026')) {
                options.push({
                    id: 'big12-2026',
                    label: "Big 12 2026 (Uninitialized)",
                    seasonYear: 2026,
                    gender: 'mens',
                    isFinalized: false
                });
            }'''

target2 = '''        try {
            const functions = getFunctions();
            const importFn = httpsCallable(functions, 'importTournamentFromESPN');
            const result = await importFn({
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear
            }) as { data: { success: boolean, count: number, teams: number, message?: string } };'''

replace2 = '''        try {
            const functions = getFunctions();
            let importFnName = 'importTournamentFromESPN';
            const params: any = {
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear
            };

            if (selectedTournamentId.startsWith('bigeast') || selectedTournamentId.startsWith('big12')) {
                importFnName = 'importConferenceTournamentFromESPN';
                params.conferenceName = selectedTournamentId.split('-')[0];
            }

            const importFn = httpsCallable(functions, importFnName);
            const result = await importFn(params) as { data: { success: boolean, count: number, teams: number, message?: string } };'''

target3 = '''        try {
            const functions = getFunctions();
            const initFn = httpsCallable(functions, 'adminInitTournament');
            await initFn({
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear,
                gender: selectedOption?.gender || 'mens',
                teams: [],
            });
            setSuccessMsg('Tournament skeleton re-initialized.');'''

replace3 = '''        try {
            const functions = getFunctions();
            let initFnName = 'adminInitTournament';
            if (selectedTournamentId.startsWith('bigeast')) initFnName = 'initializeBigEastTournamentHttp';
            if (selectedTournamentId.startsWith('big12')) initFnName = 'initializeBig12TournamentHttp';

            const initFn = httpsCallable(functions, initFnName);
            await initFn({
                tournamentId: selectedTournamentId,
                seasonYear: selectedYear,
                gender: selectedOption?.gender || 'mens',
                teams: [],
            });
            setSuccessMsg('Tournament skeleton re-initialized.');'''

content = content.replace(target1, replace1)
content = content.replace(target2, replace2)
content = content.replace(target3, replace3)

with open('d:/march-melee-pools/src/components/admin/TournamentManager.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Replaced!')
