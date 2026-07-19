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
2. 针对requested masseuse appt, 请根据这个appt的时间和duration，安排每个人一天的schedule
3. The sheet changes according to any changes of appt on the schedules. 
4. thee sheet is interactive so i can input, inlcuding editing and changing the massueses names, customer names, note, tip, everything in the sheet can be programed and can take input 
5. for couple massages, it take 2 massueses, for example Yar today looking for May, so it would take May and another massues at the same time 
6. The words on the sheet on the browser look too small, make it more readable but keep everything together without scrolling 
7. if i put tip on the calendar appt boxes, the sheet would be able to take that input and show it on the sheet and still edible for users. 
8. I can add additional massuese on that sheet, the additional massueses can take space which needed for scrolling 
9. only Tina can do facials and lymphatic 
10. only Casey and May can do trigger point therapy
11. After user make an adjustment, the sheet adjust accordingly 
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
question: what does 300m, 150m mean on the same line of the masseuses name? 


Setup
Build a roster from calendar therapist order (first 9 cards, plus any you add with + Masseuse).
Take the day’s appointments (skip ADDON), sort by start time.
Walk them one by one and assign each to a masseuse card.
Requested vs any-available
An appt is requested if Square says not “any available,” or if it appears in the request list.

Requested → put it on that masseuse (even if she’s “busy” on the sheet). That assignment still advances the turn.
Any-available → use turn order (below).
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