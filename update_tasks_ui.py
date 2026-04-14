import re

with open('src/views/TasksView.vue', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Checkbox
# We want to change the checkbox classes to make them smoother
checkbox_pattern = r'''(<!-- Checkbox -->\s*<button[^>]*class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full) border-2( transition-colors[^"]*")\s*:class="task\.status === 'done'\s*\?\s*'border-green-500 bg-green-500'\s*:\s*priorityCheckboxClass\(task\.priority\)\s*\+\s*' hover:border-red-400'"'''

checkbox_replacement = r'''\1 border-2\2
                      :class="task.status === 'done'
                        ? 'border-blue-500 bg-blue-500'
                        : priorityCheckboxClass(task.priority) + ' hover:border-blue-400 hover:bg-blue-50/50'"'''

content = re.sub(checkbox_pattern, checkbox_replacement, content)

# 2. Detail Checkbox
detail_checkbox_pattern = r'''(<!-- Detail Header -->.*?class="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded) border-2( transition-colors[^"]*")\s*:class="selectedTask\.status === 'done' \? 'border-green-500 bg-green-500' : 'border-slate-300 hover:border-blue-400'"'''

detail_checkbox_replacement = r'''\1 border-2\2
              :class="selectedTask.status === 'done' ? 'border-blue-500 bg-blue-500' : 'border-slate-300 hover:border-blue-400 hover:bg-blue-50/50'"'''

content = re.sub(detail_checkbox_pattern, detail_checkbox_replacement, content, flags=re.DOTALL)

# 3. Update Check icon inside checkbox to be a bit thicker (if needed)
# Wait, standard check icon is fine. Let's update text color for done tasks to blue instead of green?
# Let's keep green for done, but wait, I just replaced green with blue above for the checkbox background.
# Actually, blue looks more modern for "done" states (like iOS or Linear). Let's stick with blue!
# Then we should also update the text-green-600 logic elsewhere.

# 4. Due Date badges
due_date_done_pattern = r'''(<span v-if="task\.status === 'done'" class="ml-0\.5 rounded) bg-green-50 px-1 py-0\.5 text-\[10px\] text-green-600 ring-1 ring-green-200(">已完成</span>)'''
due_date_done_replacement = r'''\1 bg-blue-50 px-1 py-0.5 text-[10px] text-blue-600 ring-1 ring-blue-200/50\2'''
content = re.sub(due_date_done_pattern, due_date_done_replacement, content)

due_date_text_pattern = r'''(class="text-xs" :class="task\.status === 'done' \? 'font-medium) text-green-600(' : isTaskOverdue\(task\) \? 'font-medium text-red-600' : task\.dueAt \? 'text-rose-500' : 'text-slate-400'")'''
due_date_text_replacement = r'''\1 text-blue-500\2'''
content = re.sub(due_date_text_pattern, due_date_text_replacement, content)

# 5. Make the group task timeline lines softer
group_header_pattern = r'''(<div\s+v-if="shouldRenderTimelineHeader\(taskIndex\)"\s*:class="\[taskIndex === 0 \? 'mb-3 mt-1' : 'mb-3 mt-6', ')flex cursor-pointer items-center gap-3 select-none('\]")'''
group_header_replacement = r'''\1group/header flex cursor-pointer items-center gap-3 select-none\2'''
content = re.sub(group_header_pattern, group_header_replacement, content)

# Make the divider line dashed and softer
divider_pattern = r'''<div class="h-px flex-1 bg-slate-200" />'''
divider_replacement = r'''<div class="h-[1px] flex-1 bg-gradient-to-r from-slate-200/80 to-transparent" />'''
content = content.replace(divider_pattern, divider_replacement)

# Make task list background totally white or transparent since App.vue main is white
# <div class="flex-1 overflow-auto bg-slate-50 p-6">
bg_pattern = r'''<div class="flex-1 overflow-auto bg-slate-50 p-6">'''
bg_replacement = r'''<div class="flex-1 overflow-auto bg-white p-6">'''
content = content.replace(bg_pattern, bg_replacement)

# Make the header background blur seamlessly into white
# <div class="sticky top-0 z-20 border-b border-slate-200/50 bg-white/80 px-6 py-5 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
header_pattern = r'''<div class="sticky top-0 z-20 border-b border-slate-200/50 bg-white/80 px-6 py-5 backdrop-blur-xl supports-\[backdrop-filter\]:bg-white/60">'''
header_replacement = r'''<div class="sticky top-0 z-20 border-b border-slate-100 bg-white/80 px-6 py-5 backdrop-blur-md supports-[backdrop-filter]:bg-white/80">'''
content = content.replace(header_pattern, header_replacement)

# Update task card hover and borders
task_card_pattern = r'''(v-show="!isTaskInCollapsedGroup\(task\)"\s*:data-task-id="task\.id"\s*class="group relative flex cursor-pointer overflow-hidden rounded-xl bg-white transition-all duration-200 ease-out border) border-transparent shadow-\[0_1px_2px_rgba\(0,0,0,0\.02\)\] ring-1 ring-slate-200/60([^"]*"\s*:class="\[)
\s*selectedTaskId === task\.id \? '!border-blue-300 !ring-blue-300 bg-blue-50/10 shadow-md' : '',
\s*isTaskDragging \? '' : 'hover:shadow-md hover:ring-slate-300/80 hover:bg-slate-50/50','''

task_card_replacement = r'''\1 border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 hover:bg-[#FAFAFA]\2
                    selectedTaskId === task.id ? '!border-blue-300 bg-blue-50/20 shadow-md' : '',
                    isTaskDragging ? '' : '','''
content = re.sub(task_card_pattern, task_card_replacement, content)

# 6. Task input background
task_input_pattern = r'''(<div class="border-b) border-slate-200( bg-white px-6 py-3">)'''
task_input_replacement = r'''\1 border-slate-100\2'''
content = re.sub(task_input_pattern, task_input_replacement, content)

# Input placeholder styling
input_pattern = r'''(placeholder="添加任务，按 Enter 保存…"\s*class="flex-1 text-sm) text-slate-600 placeholder:text-slate-400( focus:outline-none")'''
input_replacement = r'''\1 text-slate-700 placeholder:text-slate-300 font-medium\2'''
content = re.sub(input_pattern, input_replacement, content)

with open('src/views/TasksView.vue', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated TasksView.vue UI")
