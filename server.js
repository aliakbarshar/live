const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');
const ytDlp = require('yt-dlp-exec');

const app = express();
const PORT = process.env.PORT || 10000;

// Supabase Connection
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;

console.log("🚀 Server Engine Starting with YouTube Direct Stream Support...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Signal Received! Restarting broadcast...");
      stopBroadcaster();
      if (config.is_live) {
        startBroadcaster(config);
      }
      return;
    }

    if (!config.is_live && ffmpegProcess) {
      console.log("⏹️ Stopping Broadcaster...");
      stopBroadcaster();
    } else if (config.is_live && !ffmpegProcess) {
      console.log("▶️ Live Command Detected! Starting Broadcast...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Check Loop Error:", err);
  }
}

async function resolveDirectUrl(url) {
  // If URL is YouTube, extract direct stream URL via yt-dlp
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    console.log(`🔍 Resolving YouTube Stream URL for: ${url}`);
    try {
      const output = await ytDlp(url, {
        format: 'best',
        getUrl: true
      });
      return output.trim();
    } catch (e) {
      console.error("❌ Failed to resolve YouTube URL:", e.message);
      return url;
    }
  }
  return url;
}

async function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://aliakbarshar.github.io/live/TestTrack1.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const orderedPlaylist = [...playlist.slice(trackIndex), ...playlist.slice(0, trackIndex)];

  // Resolve youtube links in playlist
  let resolvedContent = [];
  for (let item of orderedPlaylist) {
    let directUrl = await resolveDirectUrl(item.url);
    resolvedContent.push(`file '${directUrl}'`);
  }

  const playlistPath = path.join(__dirname, 'playlist.txt');
  fs.writeFileSync(playlistPath, resolvedContent.join('\n'));

  let rawKey = config.fb_key ? config.fb_key.trim() : (config.yt_key ? config.yt_key.trim() : '');

  if (!rawKey) {
    console.error("❌ ERROR: Stream Key is EMPTY in database!");
    return;
  }

  let targetUrl = rawKey;
  if (!rawKey.startsWith('rtmp://') && !rawKey.startsWith('rtmps://')) {
    targetUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${rawKey}`;
  }

  console.log(`🎬 Video Playlist Track Index: ${trackIndex}`);
  console.log(`📡 Pushing Stream to Target...`);

  let ffmpegArgs = [
    '-re',
    '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
    '-f', 'concat',
    '-safe', '0',
    '-stream_loop', '-1',
    '-i', playlistPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    targetUrl
  ];

  try {
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stderr.on('data', (data) => {
      console.log(`[FFmpeg Logs]: ${data.toString()}`);
    });

    ffmpegProcess.on('error', (err) => {
      console.error("❌ FFmpeg Launch Error:", err.message);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`🔴 FFmpeg Process Closed. Exit Code: ${code}`);
      ffmpegProcess = null;
    });
  } catch (e) {
    console.error("❌ Spawn Exception:", e.message);
  }
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
    console.log("🛑 Stream Process Terminated.");
  }
}

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Stream Engine Active'));
app.listen(PORT, () => console.log(`🌐 Web App Active on Port ${PORT}`));
