import re

file_path = 'd:/march-melee-pools/src/components/UserProfile.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add smsOptIn to initial formData state
content = re.sub(
    r'(name: user\.name,\s*phone: user\.phone \|\| \'\',\s*)(socialLinks: {)',
    r'\g<1>smsOptIn: user.smsOptIn || False,\n        \g<2>',
    content,
    count=2
)

# 2. Add smsOptIn to updatedUser object in handleSubmit
content = re.sub(
    r'(name: formData\.name \|\| user\.name,\s*phone: formData\.phone \|\| \'\',\s*)(socialLinks: formData\.socialLinks,)',
    r'\g<1>smsOptIn: formData.smsOptIn || False,\n                \g<2>',
    content,
    count=1
)

# 3. Add UI toggle
phone_block_pattern = re.compile(
    r'(<div className=\"space-y-2\">\s*<label className=\"text-sm font-bold text-slate-300\">Phone Number.*?</div>\s*</div>)',
    re.DOTALL
)

replacement_ui = '''<div className=\"space-y-4\">
                            \g<1>
                            
                            <label className=\"flex items-center gap-3 cursor-pointer group bg-slate-800/50 p-3 rounded-lg border border-slate-700 hover:border-indigo-500/50 transition-colors w-fit\">
                                <div className=\"relative flex items-center\">
                                    <input
                                        type=\"checkbox\"
                                        className=\"sr-only peer\"
                                        checked={formData.smsOptIn || False}
                                        onChange={(e) => setFormData({ ...formData, smsOptIn: e.target.checked })}
                                    />
                                    <div className=\"w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500\"></div>
                                </div>
                                <div className=\"flex flex-col\">
                                    <span className=\"text-sm font-bold text-slate-300 group-hover:text-white transition-colors\">Opt-in to SMS Notifications</span>
                                    <span className=\"text-xs text-slate-500\">Receive important pool updates and reminders via text message.</span>
                                </div>
                            </label>
                        </div>'''

content = phone_block_pattern.sub(replacement_ui, content, count=1)

# fix the False boolean to false in the created file (since JS uses false)
content = content.replace('False', 'false')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Replaced successfully')
