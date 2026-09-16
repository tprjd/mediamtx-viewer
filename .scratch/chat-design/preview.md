# Preview the Chat designs

Run this command from the repository root on branch `prototype/chat-design`:

```sh
npm run prototype:chat
```

Open [the Chat prototype](http://localhost:3400/watch/chat-preview?variant=A).

Use the bottom arrows to compare the variants. Each URL retains the selected variant after a reload.

- [A: Compact feed](http://localhost:3400/watch/chat-preview?variant=A)
- [B: Time groups](http://localhost:3400/watch/chat-preview?variant=B)
- [C: Tools rail](http://localhost:3400/watch/chat-preview?variant=C)

Use **State** to preview empty Chat, connection loss, failed submission, restrictions, and unavailable Chat.
Select **Moderator** to reveal sample message actions.
Enter a message to try the input. Actions affect only sample data in the current tab.

Resize the browser to compare portrait and landscape layouts. Use the video frame's theater button to try a wider layout.
Hover over a message, focus it with the keyboard, or tap it to show its timestamp.

Press Ctrl+C in the terminal to stop the prototype.
If port 3400 is occupied, run `PROTOTYPE_CHAT_PORT=3401 npm run prototype:chat` and use port 3401 in the URL.
