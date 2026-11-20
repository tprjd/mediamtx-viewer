# Stream to viewers from your Windows PC

OBS publishes to FrankerzSpam. The relay downloads one copy of the live stream
and sends it directly to signed-in viewers with Viewing access to your Channel.
Five direct viewers at 14 Mbps need about 70 Mbps of upload capacity, plus
your OBS upload and network overhead. Each direct viewer can see your public IP address.

## Pair your PC

1. Sign in on your Windows x64 streaming PC. Open **My channel** and select
   **Download relay for Windows x64**.
2. Double-click `Start-FrankerzSpam-Relay.cmd` within ten minutes. Keep the
   file private. Anyone with an unused download can pair a PC to your Channel.
3. The relay window shows its version at startup. Leave it open. Refresh **My
   channel** and check for **Relay online**.
4. If your Channel has the managed **FrankerzSpam 1080p60 Low latency** profile,
   select it in OBS for H.264 video and Opus audio. Start the stream. Streams
   with AAC audio use HLS.

## Check a direct viewer

Ask a viewer on another internet connection to open your live Channel. With
compatible video and audio, the player selects **Low latency** (WebRTC) by
default. If the viewer previously chose an HLS mode, ask them to select
**Low latency**. Once the video plays, refresh **My channel** and check
**Direct viewers**. The watch page also counts viewers using HLS.

If the direct connection fails, the player retries and then switches to
**Smooth** HLS from Oracle. To retry direct playback, the viewer can select
**Low latency** when it becomes available again.

## Reconnect or stop

- For your next stream, run the same file under the same Windows account.
  Windows protects the saved pairing credential for that account.
- If the site connection drops, leave the relay window open so it can reconnect.
- To stop the relay, close its window or press **Ctrl+C**. Leave OBS streaming
  to keep HLS available.
- To revoke the pairing, select **Disconnect relay** on **My channel**. To
  move to another PC, run a fresh download there. Pairing it replaces the old
  PC. To remove the local files, close the relay and delete the download and
  `%LOCALAPPDATA%\FrankerzSpam\ChannelRelay`.

## If the relay does not connect

- **Pairing failed** or **Relay access ended**. Download a fresh copy from
  **My channel** and run it within ten minutes.
- **Relay online** with zero direct viewers. Check that the viewer selected
  **Low latency** and can play the stream. Some routers and mobile networks
  block direct connections. HLS remains available while OBS publishes.
- If you manage a router with a public IP, you can forward port **28189**,
  UDP and TCP, to the relay PC. Set `FRANKERZ_RELAY_PUBLIC_HOST` to your public
  IP or DNS name before starting the launcher. Keep the signaling and
  administration ports, 28889 and 29997, local to the PC.
