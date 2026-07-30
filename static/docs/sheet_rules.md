Explaining the sheet 

the most left column is the number of customers a massuse do 
NM writes the customers name 
RM writes the room the customer assigned 
Price columns write 60 if it is 60 min massage, 90 if it is 90 min massage, 
Tip Columns write the tip 
Note Columns write 3 senses, or facial, or cupping, or other massage add-ons, not including aromatherapy, scalp oil, or pain releif oil or 大套 for luxury or exclusive package


Rule 
1.所有的appt（除了massuess requested appt）是按照turn轮的，例如，根据number顺序，依列排列，例如
#1 按摩师做了第一个按摩，再来预约就是#2 
如果到#2的turn，但是他正在做按摩，那就让下一个turn且依列排列的做的最少数量的按摩师做
请帮我把一天的appt auto分配给按摩师写在这个sheet上, therefore auto fill nm, rm, price, and note 
**Request vs 不着人（staff note）**
- 客人 request 了某个按摩师，但 Note for staff 写了「正常轮」或「不找人」（或「不着人」）→ **不算着人**，整单按 turn。
- Note for staff **没有**写那几个词 → **就是 request**，给点名的按摩师（她该时段空闲就给；只有时间撞车才改 turn）。
When I change masseuse order (swap/rename) or +/- masseuse count, past appointments must NOT stay locked — redistribute the whole day by turn on the new roster.
Turn pointer: walk appts by start time; among free masseuses pick fewest customers, then next index from #1…#N (like a pointer). Past + future same; non-request ignores Square calendar glue.
**Lock checkbox** (left of #): check = pin this customer on this masseuse; turn will not move them. Uncheck = unlock and redistribute.
2. Requested appt: schedule on that masseuse by time/duration if she is free then (even if she already has other customers that day).

**Example day walkthrough (roster #1…#N)**  
- 10:00 不找人/正常轮 → #1  
- 10:30 turn → #2  
- 11:00 request Sophia → #1 Sophia（她空就给）  
- 12:00 turn → #3（#1 已 2 单且可能 busy，#2 已 1，#3 最少）  
- 13:00 Luxury 大套 → turn 给当前最少且空闲的（例 #4）：**只占 90min 按摩**（例 1:00–2:30）；Tina **小脸 30min 小工**（不算 turn / 不算工）  
- 14:00 两单同时 → 谁先来谁先分：下一空闲最少 → 再下一个（例 #5 然后 #6）  
- 15:00 request Casey → Casey  
- 15:30 request May → May  
- 16:00 同时多单：同一开始时间 **着人/request 先分**，再分 turn；Couple = 两个人（staff note 如 Rose Vicky）。  
  **Basic facial + 90min massage**：先让轮到的人做 **90min 按摩**，再 Tina 做 **1hr 脸**（若 Tina 在脸的开始时间有空）。若 Tina 那时没空 → **Tina 先做脸**，90min 按摩再拿出来轮 turn。
3. The sheet changes according to any changes of appt on the schedules. 
4. thee sheet is interactive so i can input, inlcuding editing and changing the massueses names, customer names, note, tip, everything in the sheet can be programed and can take input 
5. for couple massages, it take 2 massueses, for example Yar today looking for May, so it would take May and another massues at the same time 
6. The words on the sheet on the browser look too small, make it more readable but keep everything together without scrolling 
7. if i put tip on the calendar appt boxes, the sheet would be able to take that input and show it on the sheet and still edible for users. 
8. I can add additional massuese on that sheet, the additional massueses can take space which needed for scrolling, and able to delete the additional massuese 
9. only Tina can do facials and lymphatic 
10. only Casey and May can do trigger point therapy
11. After user make an adjustment, the sheet adjust accordingly, such as i change the customer A under one massuese to another customer B, customer A would assign to the other massuese which in order has the least customer and is not busy at that time

12. the name column length should be shorter 
就算规则是这样，作为user我可以有更高的权限违反这些rules
13. If I click the name, I can see the detail informations
14. If i enter a tip for a specific customer, it should update on the calendar appt schedling page
15. always save my last edit 
16. at the NM col, i can click the current name and choose a separate customer, not sure what is the best quicker and ovbious way to perform this task. could you help 
17. masseuses still take turns between appts which requested her, as long as it is her turn, then she would take that customers. 

Also check why today Casey only have Robert and Natalie, cause Natalie does not request her 
18. everyday sheet have to save to hard drive, create a folder name appt records, and each day sheet should be saved in a file under the date 
19. each nm col cell does not need "Pick", but keep the function, if i click the empty box, then i will search the customer name 
20. appt massues was avaliable anyone before paid, but after being paid, it was selected to a particular massueses, please keep the previous record, not after payment when distributing the works as time goes 
21. default masseuse card count on **first open** of a day (before you save a roster):
    - Mon–Thu → **6**
    - Fri–Sun → **9**
    Then you manually pick names/order on each card. After that, saved roster wins; +/− still works.
22. current time, a a green color for the rows of massueses who are doing a massage now based on the current time 
23. no duplicated massues names on the same day  

24. if I enter Lynn or part-time, they do not get distribut like the current defualt rules, rules for them would be 1. user would manually select the customers select 
25. the massueses name can be selected instead of typing in, just like how you did for NM col, i believe you can read from Square Appointment calendar because it has gray massueses col for who's not working  and white massuese col for who's working on that day  

26. 小工，不算工
    facial people -- tina, lynn

    例如 luxury package has 2 hr including 30 min mini facial and 90 min massage 
    如果不是tina或者lynn做luxury package
    那么只有tina或者lynn take over the mini facial, e.g. another massuese can do 1hr, tina comes in for 30 min facial, then another massuese come back to finish the rest 30 min masage. OR another massuese can do 90 min massage, tina comes in to finish the 30 min facial 

    fire cupping qualified -- sophia, casey, and vicky 
    if a massuese A did the massage which require fire cupping, then only the qualified ppl can do fire cupping, not the massuese giving massages  

    小工行：列同 regular：`小工#1 | NM | RM | Dur | Price | Tip | Note`。不算 turn。Tina luxury **小脸** / cupping 也进这类行。

    **标题行控件：** `名字 | # + − | 小工 + − | ×` — `# +/−` 只加删 regular turn 行；`小工 +/−` 只加删小工行。

    **Split（在 Note 里，不另开列）：** Note 右下角 **split**；点了才在 Note 下弹出拖选时间条。

    make sure these features i can later on add or reduce massuese for the skill, have it somewhere on the same page of the sheet  

27. 两个人split一个客人，一个turn，如果小于30 min，算小工，延续26. rule，如果大于等于30min，算一个turn，例如90min massage split to 1hr and 30 min then this customer would display under two massueses on the sheet 

29. ~~旧 #10 小工条已删除~~ — 用每卡 **+ / −** 加普通行；小工与客人同行格式，靠底。 
 
---
not yet take rules 
30. hihghlight the customer row if multiple massues giving a service to that customer  

28. tip calculation proportion 
30. calculation, 针对于第18条
31. 如果人线上预约exclusive package但是改成luxury package



----------
Apperances

Skills toggle — DONE
    Apperances: top bar **Skills** button (left of + Masseuse); panel toggles open/closed.
    Functions: names in Facial / Trigger / Fire cupping / Part-time save forever
      (`sheet_skills.json` on disk + browser backup). Edit + Tab/blur auto-saves; Save button too.
-----

小工design
在name  +, -, x, x左边加上小工button，
点击小工，就在regular rows 下面加row which share the name cols as the regular rows on the top, the format would be like 
小工#1 nm, rm, dur, price, tip, note 

小工funtionality 


-------
Detail + split design — DONE (`?v=38`)
- Every Note cell has a **detail** button → modal: customer, time, service, requested, 15‑min split bar.
- **Click** (not drag) 15‑min chips (short width); gaps OK. **Apply split** updates Dur.
- Unselected → facial 小工; Note shows **w/ Partner**.
- Requested: Square “any available” → **None**; named Square booking or names in staff/customer notes → those names.

-----
Check in/Check out design & functionality



Setup
Build a roster from calendar therapist order (first 9 cards, plus any you add with + Masseuse).
Take the day’s appointments (skip ADDON), sort by start time.
Walk them one by one and assign each to a masseuse card.
Requested vs any-available
Requested = customer booked a named masseuse, and staff note does **not** say 正常轮 / 不找人 / 不着人.
If staff note has those words → turn (不着人), even if Square still shows a therapist.
Past appts use the same turn pointer as future for non-request.
If the requested masseuse is busy (time overlap) → fall through to turn. Having other customers earlier/later does NOT block the request.

Requested → that masseuse if free at that time; if busy → turn.
正常轮 / 不找人 / any-available → turn only.
Turn order (any-available)
Among masseuses who are free at that time:

Prefer skill rules if needed: Tina for facial/lymphatic; Casey/Cassey & May for trigger point.
Prefer the fewest customers so far.
If tied, pick the next person in turn order (starting from who is “up”).
If the preferred skill people are all busy → fall back to anyone free.
After each assign, turn moves to the next person.
If everyone’s busy, it still assigns to whoever has the fewest rows (overlap warning possible).

Couples
Always need two rows (two masseuses) at the same time:

If someone requested a masseuse → that person is forced on.
The second person is by turn (unless the calendar already has a second therapist / second request).
After auto-fill
Each card’s rows are sorted by time. Your manual NM picks / cell edits are pinned on top and kept on refresh; everything else is recalculated from this logic.