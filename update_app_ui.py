import re

with open('src/App.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sidebar active item look like a lifted card
active_state_pattern = r'''(isActive\([^)]+\)\s*\?\s*)'bg-[^']+'(\s*:\s*'[^']+')'''

# Wait, there are two isActive usages:
# Dashboard
# isActive('/') ? 'bg-red-50 text-red-600' : 'text-slate-600 hover:bg-slate-50'
# Smart Lists
# isActive(item.path) ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'

# Let's replace the Smart Lists and Projects active states:
smart_list_active_pattern = r'''(isActive\(item\.path\)\s*\?\s*)'bg-slate-100 text-slate-900'(\s*:\s*'text-slate-600 hover:bg-slate-50')'''
smart_list_active_replacement = r'''\1'bg-white shadow-sm ring-1 ring-slate-200/50 text-slate-900'\2'''
content = re.sub(smart_list_active_pattern, smart_list_active_replacement, content)

project_active_pattern = r'''(isActive\(\`/project/\$\{project\.id\}\`\)\s*\?\s*)'bg-slate-100 text-slate-900'(\s*:\s*'text-slate-600 hover:bg-slate-50')'''
project_active_replacement = r'''\1'bg-white shadow-sm ring-1 ring-slate-200/50 text-slate-900'\2'''
content = re.sub(project_active_pattern, project_active_replacement, content)

# Dashboard active
dashboard_active_pattern = r'''(isActive\('/'\)\s*\?\s*)'bg-red-50 text-red-600'(\s*:\s*'text-slate-600 hover:bg-slate-50')'''
dashboard_active_replacement = r'''\1'bg-white shadow-sm ring-1 ring-slate-200/50 text-red-600'\2'''
content = re.sub(dashboard_active_pattern, dashboard_active_replacement, content)

# Smooth out sidebar background to match the main bg-[#F9F9FB]
sidebar_bg_pattern = r'''bg-\[#F9F9FB\]'''
# Actually it's already #F9F9FB, which is fine.

with open('src/App.vue', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated App.vue UI")
