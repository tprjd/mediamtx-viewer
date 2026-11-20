# Stream to viewers from your Windows PC

OBS publishes to FrankerzSpam. The relay sends video from your PC to signed-in viewers with Viewing access to
your Channel. Low latency viewers share one WebRTC feed from the site. In HLS
modes, supported browsers get their playlists from the site and their video
and audio chunks from your PC. The PC downloads each shared chunk once.
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

Ask a viewer on another internet connection to open your live Channel. On a
compatible stream they can select **Low latency** for WebRTC or **Smooth** for
buffered HLS. Give the relay a few seconds to connect. The Windows relay window
shows the number of active direct connections, the upload rate for each one,
and the total upload rate in Mbps. A new connection needs two readings to show
a rate. Two playing tabs can use two connections. These rates exclude your OBS
upload and media that viewers download directly from the site.

When signed in as the Channel owner, you can test **Low latency** on your own
Channel in up to 12 tabs at once. Each other account can use up to four
**Low latency** connections to your relay.

HLS connects in the background. Viewers who can reach your PC over a WebRTC
data channel get video and audio chunks from it. The player keeps reading
playlists from the site and uses the site for chunks it cannot get from the PC.
Browsers that use their built-in HLS player for the stream fetch all media from
the site. You can use the relay without changing your router on networks that
allow a direct connection.

If Low latency playback fails, the player can switch to Smooth. The viewer can
select **Low latency** again immediately.

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
  block direct connections. Built-in HLS players also use the site.
- If you manage a router with a public IP, you can forward ports **28189** (Low latency) and **28190** (HLS),
  UDP and TCP, to the relay PC. Set `FRANKERZ_RELAY_PUBLIC_HOST` to your public
  IP or DNS name before starting the launcher. Keep the signaling and
  administration ports, 28889, 29997, and 29998, local to the PC.
