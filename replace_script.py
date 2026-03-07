with open('d:/march-melee-pools/src/components/BracketWizard/BracketWizard.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = '''                                onChange={(e) => {
                                    const type = e.target.value as 'ncaa' | 'bigeast';
                                    const lockAt = type === 'bigeast'
                                        ? new Date('2026-03-11T15:00:00').getTime() // Big East tipoff
                                        : new Date('2026-03-17T12:00:00').getTime();
                                    update({ tournamentType: type, lockAt });
                                }}'''

replace1 = '''                                onChange={(e) => {
                                    const type = e.target.value as 'ncaa' | 'bigeast' | 'big12';
                                    let lockAt = new Date('2026-03-17T12:00:00').getTime(); // NCAA default
                                    if (type === 'bigeast') {
                                        lockAt = new Date('2026-03-11T15:00:00').getTime(); // Big East tipoff
                                    } else if (type === 'big12') {
                                        lockAt = new Date('2026-03-10T12:00:00').getTime(); // Big 12 tipoff
                                    }
                                    update({ tournamentType: type, lockAt });
                                }}'''

target2 = '''                            >
                                <option value="ncaa">NCAA March Madness 2026</option>
                                <option value="bigeast">Big East Championship 2026</option>
                            </select>
                            {formData.tournamentType === 'bigeast' && (
                                <p className="text-[10px] text-amber-400 mt-1">🏀 Big East: 11 teams, 10 picks, lock date auto-set to Mar 11</p>
                            )}'''

replace2 = '''                            >
                                <option value="ncaa">NCAA March Madness 2026</option>
                                <option value="bigeast">Big East Championship 2026</option>
                                <option value="big12">Big 12 Championship 2026</option>
                            </select>
                            {formData.tournamentType === 'bigeast' && (
                                <p className="text-[10px] text-amber-400 mt-1">🏀 Big East: 11 teams, 10 picks, lock date auto-set to Mar 11</p>
                            )}
                            {formData.tournamentType === 'big12' && (
                                <p className="text-[10px] text-amber-400 mt-1">🏀 Big 12: 16 teams, 15 picks, lock date auto-set to Mar 10</p>
                            )}'''

content = content.replace(target1, replace1)
content = content.replace(target2, replace2)

with open('d:/march-melee-pools/src/components/BracketWizard/BracketWizard.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Replaced!')
