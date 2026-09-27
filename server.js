const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Supabase Connection
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://meywyyvqmrnpbzrzzhvm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1leXd5eXZxbXJucGJ6cnp6aHZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM4Nzk2MiwiZXhwIjoyMTA1OTYzOTYyfQ.V3IuQuxRmK7npiS66RPn0SnYjnk7W2xo2pGvl_jWCtI';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let ffmpegProcess = null;
let lastRestartTrigger = null;

console.log("🚀 Stream Engine Starting Simple Direct Mode...");

async function checkDatabaseState() {
  try {
    const { data: config, error } = await supabase
      .from('stream_config')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !config) return;

    // Track/Restart Switch Trigger
    if (config.restart_trigger && config.restart_trigger !== lastRestartTrigger) {
      lastRestartTrigger = config.restart_trigger;
      console.log("🔄 Signal received! Restarting stream...");
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
      console.log("▶️ Starting Live Broadcast...");
      startBroadcaster(config);
    }
  } catch (err) {
    console.error("Database Loop Error:", err);
  }
}

function startBroadcaster(config) {
  const playlist = (config.playlist && config.playlist.length > 0) 
    ? config.playlist 
    : [{ url: 'https://aliakbarshar.github.io/live/TestTrack1.mp4' }];

  const trackIndex = (config.current_track_index !== undefined && playlist[config.current_track_index]) 
    ? config.current_track_index 
    : 0;

  const orderedPlaylist = [...playlist.slice(trackIndex), ...playlist.slice(0, trackIndex)];

  const playlistPath = path.join(__dirname, 'playlist.txt');
  const playlistContent = orderedPlaylist.map(item => `file '${item.url}'`).join('\n');
  fs.writeFileSync(playlistPath, playlistContent);

  let fbUrl = config.fb_key ? config.fb_key.trim() : '';
  let ytUrl = config.yt_key ? config.yt_key.trim() : '';

  // Single URL Resolution logic
  let targetUrl = '';
  if (fbUrl) {
    targetUrl = fbUrl.startsWith('rtmp') ? fbUrl : `rtmps://live-api-s.facebook.com:443/rtmp/${fbUrl}`;
  } else if (ytUrl) {
    targetUrl = ytUrl.startsWith('rtmp') ? ytUrl : `rtmp://a.rtmp.youtube.com/live2/${ytUrl}`;
  }

  if (!targetUrl) {
    console.error("❌ No Stream Key found!");
    return;
  }

  console.log(`🎬 Playing Track Index: ${trackIndex}`);
  console.log(`📡 Stream Destination: ${targetUrl.substring(0, 30)}...`);

  // Direct Light-weight Copy / Encoding
  let ffmpegArgs = [
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-stream_loop', '-1',
    '-i', playlistPath,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', '2500k',
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

  ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', (data) => {
    console.log(`[FFmpeg]: ${data.toString()}`);
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`🔴 FFmpeg Stopped. Code: ${code}`);
    ffmpegProcess = null;
  });
}

function stopBroadcaster() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

setInterval(checkDatabaseState, 5000);

app.get('/', (req, res) => res.send('Stream Engine Running...'));
app.listen(PORT, () => console.log(`🌐 Server active on port ${PORT}`));
