# Preview the archived Chat designs

The accepted prototype is preserved at commit `23f73b5` on the reference branch.
The implementation branch uses real Chat and no longer has the prototype launcher.

Run this command from the repository root on branch `prototype/chat-design-reference`:

```sh
npm run prototype:chat
```

Open [the Chat prototype](http://localhost:3400/watch/chat-preview?variant=A).

A is the selected design. The bottom arrows retain access to the earlier alternatives.
Each URL retains the selected variant after a reload.

- [A: Compact feed](http://localhost:3400/watch/chat-preview?variant=A)
- [B: Time groups](http://localhost:3400/watch/chat-preview?variant=B)
- [C: Tools rail](http://localhost:3400/watch/chat-preview?variant=C)

Use **State** to preview empty Chat, connection loss, failed submission, restrictions, and unavailable Chat.
Open **Chat settings** in the Chat header and toggle **Show timestamps** to show or hide times before messages.
Hover over a role badge, focus it with the keyboard, or tap it to read its meaning.

Select **Moderator** in the bottom bar to preview the Channel owner's tools.
Open a message's three-dot menu to remove the message, apply a timeout, or apply a ban.
Complete the confirmation form to apply the sample action. Select **Cancel** to keep the message unchanged.
Open a removed message's menu to inspect its sample content.
Use the shield button in the Chat header to view active restrictions and lift a timeout or ban.

Enter a message to try the input. Actions affect only sample data in the current tab.
Reloading resets the timestamp setting, messages, and moderation changes.

Resize the browser to compare portrait and landscape layouts. Use the video frame's theater button to try a wider layout.

Press Ctrl+C in the terminal to stop the prototype.
If port 3400 is occupied, run `PROTOTYPE_CHAT_PORT=3401 npm run prototype:chat` and use port 3401 in the URL.
